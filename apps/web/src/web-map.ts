import { setWorkerUrl, Map, NavigationControl, AttributionControl, GeolocateControl, Popup, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { CONTACT_EMAIL } from "./site-constants";

// Explicitly point MapLibre to our self-hosted worker bundle so Vite's asset hashing
// never triggers "Worker failed to load. Check that the worker URL is correct."
setWorkerUrl("/maplibre-gl-worker.js");

export type LiveAlertKind = "police" | "jam" | "roadblock" | "flood";
export type HazardKind = "pothole" | "speed_bump" | "rough_pavement" | LiveAlertKind;

const LIVE_ALERT_KINDS = new Set<string>(["police", "jam", "roadblock", "flood"]);

export function isLiveAlertKind(kind: string): kind is LiveAlertKind {
  return LIVE_ALERT_KINDS.has(kind);
}

export function hazardTitle(kind: HazardKind): string {
  switch (kind) {
    case "speed_bump":
      return "Speed bump";
    case "rough_pavement":
      return "Rough road";
    case "police":
      return "Police check";
    case "jam":
      return "Traffic jam";
    case "roadblock":
      return "Roadblock / Landslide";
    case "flood":
      return "Flooded road";
    default:
      return "Pothole";
  }
}

export interface WebHazard {
  id: string;
  lat: number;
  lng: number;
  kind: HazardKind;
  severity: number;
  passes: number;
  devices: number;
  published: boolean;
  fixed: boolean;
  fixedVotes?: number;
  clearPasses?: number;
  title: string;
  locationName: string;
  confidence?: number;
  lastSeen?: string;
  firstSeen?: string;
}

export interface WebPartner {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  offer: string;
  sponsorLabel: string;
  link?: string | null;
}

export type ShopsFilterMode = "essentials" | "all" | "off";

export interface MapInstanceHandle {
  map: Map;
  hazards: WebHazard[];
  filterByKind: (kind: string, query?: string) => void;
  setShopsMode: (mode: ShopsFilterMode) => void;
  setShopsVisible: (visible: boolean) => void;
  fitAllHazards: () => void;
  flyToHazard: (id: string) => void;
  addOptimisticHazard: (hazard: WebHazard) => void;
}

const APPWRITE_ENDPOINT = "https://sgp.cloud.appwrite.io/v1";
const APPWRITE_PROJECT = "6ad7939a002ff135e419";

function webDeviceId(): string {
  try {
    const existing = window.localStorage.getItem("hodos.webDeviceId");
    if (existing && existing.length >= 8) return existing;
    const fresh = `web_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
    window.localStorage.setItem("hodos.webDeviceId", fresh);
    return fresh;
  } catch {
    return `web_${Date.now().toString(16)}`;
  }
}

/**
 * Submit a 1-tap Live Road Radar alert (police check, jam, roadblock, flood)
 * directly to Appwrite `events` and request immediate aggregation.
 */
export async function reportLiveAlert(
  lat: number,
  lng: number,
  kind: LiveAlertKind,
  accuracyM = 25
): Promise<WebHazard> {
  const nowIso = new Date().toISOString();
  const severity = kind === "roadblock" || kind === "flood" ? 3 : 2;
  const rowId = `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    deviceId: webDeviceId(),
    tripId: `radar_${Date.now().toString(36)}`,
    recordedAt: nowIso,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    accuracy: Math.max(5, Math.min(100, Math.round(accuracyM))),
    speedKph: 0,
    magnitude: 0,
    severity,
    kind,
    confidence: 0.75,
    mode: "vehicle",
    observation: "alert"
  };

  const res = await fetch(`${APPWRITE_ENDPOINT}/tablesdb/hodos/tables/events/rows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT
    },
    body: JSON.stringify({ rowId, data: payload })
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`Unable to submit alert (${res.status})`);
  }

  // Trigger async aggregation so the alert publishes immediately for other drivers.
  fetch(`${APPWRITE_ENDPOINT}/functions/hodos-aggregate/executions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT
    },
    body: JSON.stringify({ async: true })
  }).catch(() => {});

  return {
    id: rowId,
    lat: payload.lat,
    lng: payload.lng,
    kind,
    severity,
    passes: 1,
    devices: 1,
    published: true,
    fixed: false,
    title: hazardTitle(kind),
    locationName: `${payload.lat.toFixed(4)}, ${payload.lng.toFixed(4)}`,
    confidence: 0.75,
    firstSeen: nowIso,
    lastSeen: nowIso
  };
}

// 100% free, keyless OpenStreetMap standard tiles — includes every local shop,
// temple, hospital, school, chowk and Nepali/Devanagari street name.
const OSM_CLEAN_STYLE: any = {
  version: 8,
  sources: {
    "osm-tiles": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      // Cap tile requests at z18 and omit `maxzoom` on the layer below so
      // MapLibre overzooms z18 tiles cleanly up to z21 without ever hiding
      // the layer or going blank.
      maxzoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    }
  },
  layers: [
    {
      id: "osm-tiles-layer",
      type: "raster",
      source: "osm-tiles",
      minzoom: 0
    }
  ]
};

/**
 * Popups interpolate backend-supplied strings (partner names, offers, links,
 * reported locations) straight into HTML. Escape them, and accept only http(s)
 * links so a stored `javascript:` URL cannot run.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;")
  );
}

function safeHttpUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function parseAppwriteRow(r: any): WebHazard | null {
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  const kind: HazardKind =
    r.kind === "speed_bump" ||
    r.kind === "rough_pavement" ||
    r.kind === "pothole" ||
    r.kind === "police" ||
    r.kind === "jam" ||
    r.kind === "roadblock" ||
    r.kind === "flood"
      ? r.kind
      : "pothole";
  const severity = Math.max(1, Math.min(3, Number(r.severity) || 1));
  const passes = Number(r.passCount ?? r.passes ?? 1);
  const devices = Number(r.deviceCount ?? r.devices ?? 1);
  const published = Boolean(r.published);
  if (!published) return null;
  const fixedVotes = Number(r.fixedVotes ?? 0) || 0;
  const clearPasses = Number(r.clearPasses ?? 0) || 0;
  const fixed = Boolean(r.fixed || fixedVotes >= 2 || clearPasses >= 3);
  const title = hazardTitle(kind);

  return {
    id: String(r.$id || r.id || r.hazardId || `${lat}:${lng}`),
    lat,
    lng,
    kind,
    severity,
    passes,
    devices,
    published,
    fixed,
    fixedVotes,
    clearPasses,
    title,
    locationName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    confidence: Number(r.confidence) || 0.8,
    firstSeen: r.firstSeen || r.$createdAt,
    lastSeen: r.lastSeen || r.$updatedAt
  };
}

export function initWebMap(
  containerId: string,
  statusId?: string,
  onLoaded?: (handle: MapInstanceHandle) => void,
  onHazardsUpdated?: (hazards: WebHazard[]) => void
): MapInstanceHandle | null {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const statusEl = statusId ? document.getElementById(statusId) : null;
  let hazards: WebHazard[] = [];
  let partners: WebPartner[] = [];

  if (statusEl) {
    statusEl.textContent = "Loading road observations...";
  }

  const map = new Map({
    container,
    style: OSM_CLEAN_STYLE,
    center: [0, 20],
    zoom: 2,
    minZoom: 2,
    maxZoom: 21,
    // Without this the world repeats sideways forever as you drag.
    renderWorldCopies: false,
    attributionControl: false
    // No `hash: true`: MapLibre's own hash handler applies a shared link's
    // zoom before the style has loaded, so anything at or past the tile
    // ceiling ends up with zero tile requests and a blank map. The camera is
    // written below, after load, instead.
  });

  /**
   * Restore or clamp the camera from the URL hash, once the style is live.
   */
  const MAX_ZOOM = 21;
  const applyHashCamera = () => {
    const match = /^#([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(window.location.hash);
    if (!match) return false;
    const zoom = Math.min(Number(match[1]) || 2, MAX_ZOOM);
    const lat = Math.max(-85, Math.min(85, Number(match[2]) || 20));
    const lng = Number(match[3]) || 0;
    map.jumpTo({ center: [lng, lat], zoom });
    return true;
  };

  // Only pull the camera to the hazard spread when the visitor has no position
  // of their own yet (no hash in the URL). A refresh must never yank the map
  // back to the same overview after someone has moved around.
  let shouldAutoFit = !/^#[\d.]/.test(window.location.hash);
  map.on("moveend", () => {
    shouldAutoFit = false;
  });

  map.addControl(new NavigationControl({ showCompass: true, visualizePitch: false }), "top-right");
  map.addControl(
    new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
      showUserLocation: true
    }),
    "top-right"
  );
  map.addControl(new AttributionControl({ compact: true }), "bottom-right");

  // Road-quality cells derived from public hazards, bucketed on the grid
  // declared by the shared layer spec so the website and app agree.
  const CELL_DEG = 0.0015;
  const buildQualityGeoJSON = (items: WebHazard[]): FeatureCollection => {
    const buckets = new globalThis.Map<
      string,
      { lat: number; lng: number; hazards: number; stress: number }
    >();
    for (const h of items) {
      if (h.fixed || isLiveAlertKind(h.kind)) continue;
      const latBucket = Math.floor(h.lat / CELL_DEG);
      const scale = Math.max(0.2, Math.cos((h.lat * Math.PI) / 180));
      const lngBucket = Math.floor(h.lng / (CELL_DEG / scale));
      const key = `${latBucket}:${lngBucket}`;
      const existing = buckets.get(key);
      const stress = h.severity === 3 ? 5 : h.severity === 2 ? 2.5 : 1;
      if (existing) {
        existing.hazards += 1;
        existing.stress += stress;
      } else {
        buckets.set(key, {
          lat: (latBucket + 0.5) * CELL_DEG,
          lng: (lngBucket + 0.5) * (CELL_DEG / scale),
          hazards: 1,
          stress
        });
      }
    }
    return {
      type: "FeatureCollection",
      features: Array.from(buckets.values()).map((cell) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [cell.lng, cell.lat] },
        properties: {
          hazards: cell.hazards,
          quality: Math.max(0, Math.min(100, Math.round(100 - cell.stress * 8)))
        }
      }))
    };
  };

  const buildGeoJSON = (items: WebHazard[]): FeatureCollection => ({
    type: "FeatureCollection",
    features: items
      .filter((h) => !isLiveAlertKind(h.kind))
      .map((h) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [h.lng, h.lat]
        },
        properties: {
          id: h.id,
          title: h.title,
          kind: h.kind,
          severity: h.severity,
          passes: h.passes,
          devices: h.devices,
          published: h.published,
          fixed: h.fixed,
          locationName: h.locationName
        }
      }))
  });

  const buildAlertsGeoJSON = (items: WebHazard[]): FeatureCollection => ({
    type: "FeatureCollection",
    features: items
      .filter((h) => isLiveAlertKind(h.kind) && !h.fixed)
      .map((h) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [h.lng, h.lat]
        },
        properties: {
          id: h.id,
          title: h.title,
          kind: h.kind,
          icon: `radar-${h.kind}`
        }
      }))
  });

  const partnerVisual = (
    rawCategory: string
  ): { icon: string; label: string; color: string; tier: "essential" | "pitstop" } => {
    const c = (rawCategory || "").toLowerCase();
    if (/tyre|tire|garage|mechanic|auto|car|moto|bike|wash|tow|workshop|repair|service|parts/.test(c)) {
      return { icon: "shop-auto", label: "Auto & Tyre", color: "#27272a", tier: "essential" };
    }
    if (/ev|charg|fuel|petrol|gas|battery/.test(c)) {
      return { icon: "shop-ev", label: "EV & Fuel", color: "#0f766e", tier: "essential" };
    }
    if (/pharm|med|clinic|hospital|health|first/.test(c)) {
      return { icon: "shop-health", label: "Pharmacy", color: "#9d174d", tier: "essential" };
    }
    if (/cafe|coffee|tea|food|restaurant|biryani|bakery|snack|dhaba|eat|dining/.test(c)) {
      return { icon: "shop-food", label: "Food & Café", color: "#6b4423", tier: "pitstop" };
    }
    return { icon: "shop-local", label: "Local stop", color: "#3f3f46", tier: "pitstop" };
  };

  const hasRiderPerk = (offer: string): boolean =>
    /free|check|lube|air|pressure|alignment|perk|discount|complimentary/i.test(offer || "");

  const focusedShopId = (() => {
    try {
      return new URLSearchParams(window.location.search).get("shop")?.trim() || null;
    } catch {
      return null;
    }
  })();

  let shopsMode: ShopsFilterMode = "all";
  const MAX_VIEWPORT_SHOPS = 12;

  const selectPartnersForViewport = (items: WebPartner[]): WebPartner[] => {
    if (shopsMode === "off" || items.length === 0) return [];
    const eligible = items.filter((p) => {
      if (focusedShopId && p.id === focusedShopId) return true;
      if (shopsMode === "essentials") return partnerVisual(p.category).tier === "essential";
      return true;
    });
    // When an area is not crowded, show every shop transparently. Only engage
    // the 12-pin prioritization cap + clustering when density exceeds 12.
    if (eligible.length <= MAX_VIEWPORT_SHOPS) return eligible;

    const bounds = map.getBounds();
    const center = map.getCenter();
    const inView: WebPartner[] = [];
    const outside: WebPartner[] = [];
    for (const p of eligible) {
      if (bounds && bounds.contains([p.lng, p.lat])) inView.push(p);
      else outside.push(p);
    }
    if (inView.length <= MAX_VIEWPORT_SHOPS) {
      return [...inView, ...outside.slice(0, 80)];
    }
    const score = (p: WebPartner) => {
      if (focusedShopId && p.id === focusedShopId) return 10_000;
      const vis = partnerVisual(p.category);
      const tierScore = vis.tier === "essential" ? 200 : 0;
      const perkScore = hasRiderPerk(p.offer) ? 80 : 0;
      const dist = Math.hypot(p.lat - center.lat, p.lng - center.lng);
      return tierScore + perkScore - dist * 120;
    };
    inView.sort((a, b) => score(b) - score(a));
    return [...inView.slice(0, MAX_VIEWPORT_SHOPS), ...outside.slice(0, 60)];
  };

  const buildPartnerGeoJSON = (items: WebPartner[]): FeatureCollection => ({
    type: "FeatureCollection",
    features: selectPartnersForViewport(items).map((p) => {
      const vis = partnerVisual(p.category);
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [p.lng, p.lat]
        },
        properties: {
          id: p.id,
          name: p.name,
          category: p.category,
          categoryLabel: vis.label,
          tier: vis.tier,
          icon: vis.icon,
          offer: p.offer,
          sponsorLabel: p.sponsorLabel
        }
      };
    })
  });

  const refreshPartnerSource = () => {
    const src = map.getSource("hodos-partners") as any;
    if (src) src.setData(buildPartnerGeoJSON(partners));
    const vis = shopsMode === "off" ? "none" : "visible";
    for (const layerId of ["hodos-partner-clusters", "hodos-partner-icons"]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", vis);
      }
    }
  };

  const fitBoundsToData = (targetHazards: WebHazard[], force = false) => {
    if ((!force && !shouldAutoFit) || targetHazards.length === 0) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const h of targetHazards) {
      if (h.lng < minLng) minLng = h.lng;
      if (h.lng > maxLng) maxLng = h.lng;
      if (h.lat < minLat) minLat = h.lat;
      if (h.lat > maxLat) maxLat = h.lat;
    }
    if (minLng !== Infinity && maxLng !== -Infinity && Number.isFinite(minLng)) {
      const pad = 0.08;
      map.fitBounds(
        [
          [minLng - pad, minLat - pad],
          [maxLng + pad, maxLat + pad]
        ],
        { padding: 50, maxZoom: 14, duration: 900 }
      );
    }
  };

  const updateSourceData = () => {
    const src = map.getSource("hodos-hazards") as any;
    if (src) {
      src.setData(buildGeoJSON(hazards));
    }
    const alertsSrc = map.getSource("hodos-alerts") as any;
    if (alertsSrc) {
      alertsSrc.setData(buildAlertsGeoJSON(hazards));
    }
    const qualitySrc = map.getSource("hodos-quality") as any;
    if (qualitySrc) {
      qualitySrc.setData(buildQualityGeoJSON(hazards));
    }
    if (statusEl) {
      const alertCount = hazards.filter((h) => isLiveAlertKind(h.kind) && !h.fixed).length;
      const surfaceCount = hazards.filter((h) => !isLiveAlertKind(h.kind)).length;
      statusEl.textContent = hazards.length === 0
        ? "No published road observations yet"
        : `${alertCount} live alert${alertCount === 1 ? "" : "s"} · ${surfaceCount} road hazard${surfaceCount === 1 ? "" : "s"}`;
    }
    onHazardsUpdated?.(hazards);
  };

  const handle: MapInstanceHandle = {
    map,
    hazards,
    filterByKind: (kind: string, query = "") => {
      const src = map.getSource("hodos-hazards") as any;
      const alertsSrc = map.getSource("hodos-alerts") as any;
      if (!src) return;

      const q = query.trim().toLowerCase();
      const filtered = hazards.filter((h) => {
        const matchKind =
          kind === "all"
            ? true
            : kind === "alerts"
            ? isLiveAlertKind(h.kind) && !h.fixed
            : kind === "fixed"
            ? h.fixed
            : h.kind === kind && !h.fixed;
        const matchQuery =
          !q ||
          h.title.toLowerCase().includes(q) ||
          h.locationName.toLowerCase().includes(q) ||
          h.id.toLowerCase().includes(q);
        return matchKind && matchQuery;
      });

      src.setData(buildGeoJSON(filtered));
      if (alertsSrc) {
        alertsSrc.setData(buildAlertsGeoJSON(filtered));
      }
      if (statusEl) {
        statusEl.textContent = filtered.length === 0
          ? "No road observations match this filter"
          : `${filtered.length} matching report${filtered.length === 1 ? "" : "s"}`;
      }
    },
    setShopsMode: (mode: ShopsFilterMode) => {
      shopsMode = mode;
      refreshPartnerSource();
    },
    setShopsVisible: (visible: boolean) => {
      shopsMode = visible ? "essentials" : "off";
      refreshPartnerSource();
    },
    fitAllHazards: () => fitBoundsToData(hazards, true),
    flyToHazard: (id: string) => {
      const target = hazards.find((h) => h.id === id);
      if (target) {
        map.flyTo({ center: [target.lng, target.lat], zoom: 15, duration: 1000 });
        showPopupForHazard(target);
      }
    },
    addOptimisticHazard: (hazard: WebHazard) => {
      const byId = new globalThis.Map<string, WebHazard>();
      for (const h of hazards) byId.set(h.id, h);
      byId.set(hazard.id, hazard);
      hazards = Array.from(byId.values());
      handle.hazards = hazards;
      updateSourceData();
      map.flyTo({ center: [hazard.lng, hazard.lat], zoom: Math.max(map.getZoom(), 14), duration: 700 });
      showPopupForHazard(hazard);
    }
  };

  function formatAlertTime(iso?: string): string {
    if (!iso) return "Reported just now";
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return "Reported live";
    const clock = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
    const ago =
      mins < 1
        ? "just now"
        : mins < 60
        ? `${mins}m ago`
        : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
    return `Reported ${ago} (${clock})`;
  }

  function hasVotedOn(id: string): string | null {
    try {
      return window.localStorage.getItem(`hodos.vote.${id}`);
    } catch {
      return null;
    }
  }

  function recordVotedOn(id: string, vote: string) {
    try {
      window.localStorage.setItem(`hodos.vote.${id}`, vote);
    } catch {
      // ignore
    }
  }

  function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  async function verifyVoterNearby(
    targetLat: number,
    targetLng: number,
    isAlert: boolean
  ): Promise<{ lat: number; lng: number; accuracyM: number }> {
    if (!("geolocation" in navigator)) {
      throw new Error("Location access is required to confirm road alerts.");
    }
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 7000,
        maximumAge: 30_000
      });
    }).catch(() => {
      throw new Error("Allow GPS location to confirm — only drivers near this spot can vote.");
    });
    const accuracyM = Math.round(pos.coords.accuracy || 50);
    if (accuracyM > 250) {
      throw new Error(`GPS accuracy is too low (±${accuracyM} m). Step outside with GPS on to vote.`);
    }
    const maxKm = isAlert ? 1.5 : 0.5;
    const dist = distanceKm(pos.coords.latitude, pos.coords.longitude, targetLat, targetLng);
    if (dist > maxKm) {
      const limitLabel = isAlert ? "1.5 km" : "500 m";
      throw new Error(`You are ${dist.toFixed(1)} km away. Only drivers within ${limitLabel} can confirm or clear this.`);
    }
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM };
  }

  async function voteOnHazard(h: WebHazard, vote: "still_there" | "cleared"): Promise<{ statusText: string }> {
    if (hasVotedOn(h.id)) {
      throw new Error("You have already voted on this report from this device.");
    }
    const isAlert = isLiveAlertKind(h.kind);
    const fix = await verifyVoterNearby(h.lat, h.lng, isAlert);

    const nowIso = new Date().toISOString();
    const rowId = `vt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const payload: Record<string, unknown> =
      vote === "still_there"
        ? isAlert
          ? {
              deviceId: webDeviceId(),
              tripId: `confirm_${Date.now().toString(36)}`,
              recordedAt: nowIso,
              lat: Number(h.lat.toFixed(6)),
              lng: Number(h.lng.toFixed(6)),
              accuracy: fix.accuracyM,
              speedKph: 0,
              magnitude: 0,
              severity: h.severity || 2,
              kind: h.kind,
              confidence: 0.75,
              mode: "vehicle",
              observation: "alert"
            }
          : {
              deviceId: webDeviceId(),
              tripId: `confirm_${Date.now().toString(36)}`,
              recordedAt: nowIso,
              lat: Number(h.lat.toFixed(6)),
              lng: Number(h.lng.toFixed(6)),
              accuracy: fix.accuracyM,
              speedKph: 0,
              magnitude: 0,
              severity: h.severity || 1,
              kind: h.kind,
              confidence: 0.3,
              mode: "vehicle",
              observation: "impact",
              hazardRef: h.id
            }
        : {
            deviceId: webDeviceId(),
            tripId: `fix_${Date.now().toString(36)}`,
            recordedAt: nowIso,
            lat: Number(h.lat.toFixed(6)),
            lng: Number(h.lng.toFixed(6)),
            accuracy: fix.accuracyM,
            speedKph: 0,
            magnitude: 0,
            severity: h.severity || 1,
            kind: h.kind,
            confidence: 0.75,
            mode: "vehicle",
            observation: "fix",
            hazardRef: h.id
          };

    await fetch(`${APPWRITE_ENDPOINT}/tablesdb/hodos/tables/events/rows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT
      },
      body: JSON.stringify({ rowId, data: payload })
    });

    fetch(`${APPWRITE_ENDPOINT}/functions/hodos-aggregate/executions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT
      },
      body: JSON.stringify({ async: true })
    }).catch(() => {});

    recordVotedOn(h.id, vote);
    let statusText: string;
    if (vote === "still_there") {
      h.devices = (h.devices || 1) + 1;
      h.passes = (h.passes || 1) + 1;
      h.lastSeen = nowIso;
      statusText = `Confirmed (${h.devices} device${h.devices === 1 ? "" : "s"})`;
    } else {
      // Multi-device quorum: a single user NEVER deletes a corroborated surface
      // defect or a verified (>=2 devices) live alert. Only an unverified
      // 1-device live alert can be cleared by 1 independent nearby driver.
      const nextVotes = (h.fixedVotes || 0) + 1;
      h.fixedVotes = nextVotes;
      const needed = isAlert ? (h.devices >= 2 ? 2 : 1) : 2;
      if (nextVotes >= needed) {
        h.fixed = true;
        statusText = isAlert
          ? needed === 1
            ? "Cleared (unverified alert removed)"
            : "Cleared by 2+ independent drivers"
          : "Marked as repaired (2+ independent drivers)";
      } else {
        statusText = isAlert
          ? `Clear vote recorded (${nextVotes}/${needed}) — needs 1 more driver to clear`
          : `Repair vote recorded (${nextVotes}/${needed}) — needs 1 more driver or 3 smooth passes`;
      }
    }
    updateSourceData();
    return { statusText };
  }

  function showPopupForHazard(h: WebHazard) {
    const isAlert = isLiveAlertKind(h.kind);
    const timeLine = formatAlertTime(h.lastSeen || h.firstSeen);
    const metaLine = h.fixed
      ? `Cleared · ${timeLine}`
      : isAlert
      ? `${timeLine} · ${h.devices} report${h.devices === 1 ? "" : "s"}${h.devices >= 2 ? " · Verified" : " · Unverified"}`
      : `Severity ${h.severity} · ${h.passes} pass${h.passes === 1 ? "" : "es"} · ${h.devices} device${h.devices === 1 ? "" : "s"} · ${timeLine}`;
    const existingVote = hasVotedOn(h.id);

    const container = document.createElement("div");
    container.style.cssText =
      "font-family: 'Host Grotesk', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 13px; line-height: 1.45; padding: 2px 4px; min-width: 210px; color: var(--ink, #1c1a17);";
    container.innerHTML = `
      <div style="font-size: 14.5px; font-weight: 700; letter-spacing: -0.015em; margin-bottom: 3px;">
        ${escapeHtml(h.title)}
      </div>
      <div style="font-size: 11.5px; color: var(--muted, #736d61); margin-bottom: 2px;">
        ${escapeHtml(metaLine)}
      </div>
      <div style="font-size: 11px; color: var(--muted, #736d61); font-family: 'Overpass Mono Variable', 'Overpass Mono', ui-monospace, monospace;">
        ${escapeHtml(h.locationName)}
      </div>
      ${
        existingVote
          ? `<div style="font-size: 11px; color: var(--muted, #736d61); margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line, rgba(128,128,128,0.2));">Feedback recorded</div>`
          : `<div data-vote-bar style="display: flex; align-items: center; gap: 12px; margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--line, rgba(128,128,128,0.2)); font-size: 12px;">
              <button type="button" data-vote="still_there" style="border: 0; background: none; padding: 0; font: inherit; font-weight: 600; color: var(--ink, inherit); cursor: pointer; text-decoration: underline; text-underline-offset: 3px;">
                Still there
              </button>
              <span style="color: var(--muted, #736d61);">·</span>
              <button type="button" data-vote="cleared" style="border: 0; background: none; padding: 0; font: inherit; font-weight: 500; color: var(--muted, #736d61); cursor: pointer; text-decoration: underline; text-underline-offset: 3px;">
                ${isAlert ? "Cleared" : "Repaired"}
              </button>
            </div>
            <div data-vote-status style="font-size: 11px; color: var(--muted, #736d61); margin-top: 6px; display: none;"></div>`
      }
    `;

    const statusNode = container.querySelector("[data-vote-status]") as HTMLElement | null;
    const voteBar = container.querySelector("[data-vote-bar]") as HTMLElement | null;
    container.querySelectorAll<HTMLButtonElement>("button[data-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const vote = btn.dataset.vote as "still_there" | "cleared";
        container.querySelectorAll<HTMLButtonElement>("button[data-vote]").forEach((b) => {
          b.disabled = true;
        });
        if (statusNode) {
          statusNode.style.display = "block";
          statusNode.textContent = "Checking GPS…";
        }
        try {
          const outcome = await voteOnHazard(h, vote);
          if (voteBar) voteBar.style.display = "none";
          if (statusNode) {
            statusNode.textContent = outcome.statusText;
          }
        } catch (err) {
          if (statusNode) {
            statusNode.textContent =
              err instanceof Error ? err.message : "Could not record — try again.";
          }
          if (!hasVotedOn(h.id)) {
            container.querySelectorAll<HTMLButtonElement>("button[data-vote]").forEach((b) => {
              b.disabled = false;
            });
          }
        }
      });
    });

    new Popup({ offset: 10, closeButton: true })
      .setLngLat([h.lng, h.lat])
      .setDOMContent(container)
      .addTo(map);
  }

  function showPopupForPartner(p: WebPartner) {
    const href = safeHttpUrl(p.link);
    const vis = partnerVisual(p.category);
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}`;
    const html = `
      <div style="font-family: 'Host Grotesk', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 13.5px; line-height: 1.5; padding: 4px 2px; min-width: 220px; max-width: 270px; color: var(--ink, #1c1a17); display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; flex-direction: column; gap: 4px; padding-right: 18px;">
          <span style="align-self: flex-start; background: ${vis.color}; color: #ffffff; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px;">
            ${escapeHtml(vis.label)}
          </span>
          <strong style="font-size: 15.5px; font-weight: 750; line-height: 1.25; letter-spacing: -0.015em; color: var(--ink, #1c1a17);">${escapeHtml(p.name)}</strong>
        </div>
        ${p.offer ? `<div style="font-size: 13px; line-height: 1.5; color: var(--muted, #57534e);">${escapeHtml(p.offer)}</div>` : ""}
        <div style="display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; border-top: 1px solid var(--line, rgba(28,26,23,0.1));">
          <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; font-size: 12px; font-weight: 700; padding: 6px 11px; border-radius: 999px; background: var(--ink, #1c1a17); color: var(--paper, #ffffff); text-decoration: none;">Directions ↗</a>
          ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow" style="display: inline-flex; align-items: center; font-size: 12px; font-weight: 650; padding: 6px 11px; border-radius: 999px; background: var(--soft, #f4e8ea); color: var(--ink, #1c1a17); text-decoration: none;">Website →</a>` : ""}
        </div>
      </div>
    `;

    new Popup({ offset: 14, closeButton: true })
      .setLngLat([p.lng, p.lat])
      .setHTML(html)
      .addTo(map);
  }

  const setupLayers = () => {
    if (map.getSource("hodos-hazards")) return;

    // The camera from the URL, applied now that the style is live. Before the
    // style loads, MapLibre has no tiles to place the camera against, and a
    // zoom from a shared link applied too early is exactly how the map ends up
    // blank with zero tile requests.
    applyHashCamera();

    const registerPartnerBadges = () => {
      const specs: Array<{ id: string; bg: string; draw: (ctx: CanvasRenderingContext2D, s: number) => void }> = [
        {
          id: "shop-auto",
          bg: "#27272a",
          draw: (ctx, s) => {
            // Minimal wrench / wheel-nut glyph
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3.2;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.arc(s * 0.5, s * 0.5, s * 0.16, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(s * 0.5, s * 0.5, s * 0.055, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            for (let i = 0; i < 6; i++) {
              const a = (i * Math.PI) / 3;
              ctx.beginPath();
              ctx.moveTo(s * 0.5 + Math.cos(a) * s * 0.16, s * 0.5 + Math.sin(a) * s * 0.16);
              ctx.lineTo(s * 0.5 + Math.cos(a) * s * 0.24, s * 0.5 + Math.sin(a) * s * 0.24);
              ctx.stroke();
            }
          }
        },
        {
          id: "shop-ev",
          bg: "#0f766e",
          draw: (ctx, s) => {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.moveTo(s * 0.54, s * 0.24);
            ctx.lineTo(s * 0.34, s * 0.53);
            ctx.lineTo(s * 0.49, s * 0.53);
            ctx.lineTo(s * 0.45, s * 0.76);
            ctx.lineTo(s * 0.66, s * 0.47);
            ctx.lineTo(s * 0.51, s * 0.47);
            ctx.closePath();
            ctx.fill();
          }
        },
        {
          id: "shop-food",
          bg: "#6b4423",
          draw: (ctx, s) => {
            // Minimal café cup glyph
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3.2;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.roundRect(s * 0.3, s * 0.38, s * 0.32, s * 0.28, 5);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(s * 0.64, s * 0.5, s * 0.08, -Math.PI * 0.5, Math.PI * 0.5);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(s * 0.28, s * 0.72);
            ctx.lineTo(s * 0.66, s * 0.72);
            ctx.stroke();
          }
        },
        {
          id: "shop-health",
          bg: "#9d174d",
          draw: (ctx, s) => {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.roundRect(s * 0.44, s * 0.28, s * 0.12, s * 0.44, 3);
            ctx.roundRect(s * 0.28, s * 0.44, s * 0.44, s * 0.12, 3);
            ctx.fill();
          }
        },
        {
          id: "shop-local",
          bg: "#3f3f46",
          draw: (ctx, s) => {
            // Minimal storefront glyph
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3.2;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(s * 0.28, s * 0.42);
            ctx.lineTo(s * 0.34, s * 0.3);
            ctx.lineTo(s * 0.66, s * 0.3);
            ctx.lineTo(s * 0.72, s * 0.42);
            ctx.closePath();
            ctx.stroke();
            ctx.beginPath();
            ctx.roundRect(s * 0.32, s * 0.44, s * 0.36, s * 0.26, 3);
            ctx.stroke();
          }
        },
        {
          id: "shop-cluster",
          bg: "#18181b",
          draw: (ctx, s) => {
            // Minimal stacked-stops cluster glyph (zero external glyph fonts needed)
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.roundRect(s * 0.26, s * 0.34, s * 0.3, s * 0.3, 4);
            ctx.stroke();
            ctx.beginPath();
            ctx.roundRect(s * 0.44, s * 0.24, s * 0.3, s * 0.3, 4);
            ctx.fillStyle = "#18181b";
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(s * 0.59, s * 0.39, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      ];

      for (const spec of specs) {
        if (map.hasImage(spec.id)) continue;
        const size = 56;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = spec.bg;
        ctx.beginPath();
        ctx.roundRect(6, 6, size - 12, size - 12, 13);
        ctx.fill();

        ctx.shadowColor = "transparent";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        spec.draw(ctx, size);
        const img = ctx.getImageData(0, 0, size, size);
        map.addImage(spec.id, { width: size, height: size, data: img.data }, { pixelRatio: 2 });
      }
    };

    registerPartnerBadges();

    // Local shop stops render BELOW road hazards, stay hidden on zoomed-out
    // highway/city views (minzoom 11.5), and automatically cluster so dense
    // neighbourhoods never turn the road map into ad clutter.
    map.addSource("hodos-partners", {
      type: "geojson",
      data: buildPartnerGeoJSON(partners),
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 48
    });

    map.addLayer({
      id: "hodos-partner-clusters",
      type: "symbol",
      source: "hodos-partners",
      minzoom: 10,
      filter: ["has", "point_count"],
      layout: {
        "icon-image": "shop-cluster",
        "icon-size": ["step", ["get", "point_count"], 0.85, 10, 0.96, 30, 1.06],
        "icon-allow-overlap": false,
        "icon-padding": 4
      }
    });

    map.addLayer({
      id: "hodos-partner-icons",
      type: "symbol",
      source: "hodos-partners",
      minzoom: 10,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["coalesce", ["get", "icon"], "shop-local"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.74, 15, 0.94],
        "icon-allow-overlap": false,
        "icon-padding": 4
      }
    });

    map.on("click", "hodos-partner-clusters", (e: MapLayerMouseEvent) => {
      const feat = e.features?.[0];
      const clusterId = feat?.properties?.cluster_id;
      const src = map.getSource("hodos-partners") as any;
      if (clusterId == null || !src?.getClusterExpansionZoom) return;
      src.getClusterExpansionZoom(clusterId, (err: unknown, zoom: number) => {
        if (err || !feat?.geometry || feat.geometry.type !== "Point") return;
        map.easeTo({
          center: feat.geometry.coordinates as [number, number],
          zoom: Math.min(16, (zoom || 14) + 0.5),
          duration: 450
        });
      });
    });

    map.on("click", "hodos-partner-icons", (e: MapLayerMouseEvent) => {
      const feat = e.features?.[0];
      if (!feat || !feat.properties) return;
      const target = partners.find((p) => p.id === feat.properties?.id);
      if (target) showPopupForPartner(target);
    });
    for (const layerId of ["hodos-partner-icons", "hodos-partner-clusters"]) {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    map.on("moveend", refreshPartnerSource);

    const registerRadarBadges = () => {
      const defs: Array<{ id: string; color: string; glyph: string; shape: "shield" | "diamond" | "octagon" | "circle" }> = [
        { id: "radar-police", color: "#2563eb", glyph: "P", shape: "shield" },
        { id: "radar-jam", color: "#ea580c", glyph: "!", shape: "diamond" },
        { id: "radar-roadblock", color: "#dc2626", glyph: "✕", shape: "octagon" },
        { id: "radar-flood", color: "#0891b2", glyph: "≈", shape: "circle" }
      ];
      for (const def of defs) {
        if (map.hasImage(def.id)) continue;
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const cx = size / 2;
        const cy = size / 2;
        const r = size * 0.4;
        ctx.beginPath();
        if (def.shape === "shield") {
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx + r * 0.88, cy - r * 0.55);
          ctx.lineTo(cx + r * 0.8, cy + r * 0.18);
          ctx.quadraticCurveTo(cx + r * 0.52, cy + r * 0.78, cx, cy + r);
          ctx.quadraticCurveTo(cx - r * 0.52, cy + r * 0.78, cx - r * 0.8, cy + r * 0.18);
          ctx.lineTo(cx - r * 0.88, cy - r * 0.55);
          ctx.closePath();
        } else if (def.shape === "diamond") {
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx + r, cy);
          ctx.lineTo(cx, cy + r);
          ctx.lineTo(cx - r, cy);
          ctx.closePath();
        } else if (def.shape === "octagon") {
          const d = r * 0.44;
          ctx.moveTo(cx - d, cy - r);
          ctx.lineTo(cx + d, cy - r);
          ctx.lineTo(cx + r, cy - d);
          ctx.lineTo(cx + r, cy + d);
          ctx.lineTo(cx + d, cy + r);
          ctx.lineTo(cx - d, cy + r);
          ctx.lineTo(cx - r, cy + d);
          ctx.lineTo(cx - r, cy - d);
          ctx.closePath();
        } else {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = def.color;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "800 26px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(def.glyph, cx, cy + 1);
        const img = ctx.getImageData(0, 0, size, size);
        map.addImage(def.id, { width: size, height: size, data: img.data }, { pixelRatio: 2 });
      }
    };

    map.addSource("hodos-hazards", {
      type: "geojson",
      data: buildGeoJSON(hazards)
    });
    map.addSource("hodos-alerts", {
      type: "geojson",
      data: buildAlertsGeoJSON(hazards)
    });
    map.addSource("hodos-quality", {
      type: "geojson",
      data: buildQualityGeoJSON(hazards)
    });

    // The hazard marker rendering is defined once in
    // /map/hodos-layers.json and consumed by both the website and the
    // Android app, so the map reads identically everywhere.
    fetch("/map/hodos-layers.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((spec) => {
        if (!spec || !Array.isArray(spec.layers)) return;
        for (const layer of spec.layers) {
          if (map.getLayer(layer.id)) continue;
          map.addLayer({
            id: layer.id,
            type: layer.type,
            source: layer.source,
            paint: layer.paint
          });
        }
        registerRadarBadges();
        if (!map.getLayer("hodos-alert-symbols")) {
          map.addLayer({
            id: "hodos-alert-symbols",
            type: "symbol",
            source: "hodos-alerts",
            layout: {
              "icon-image": ["get", "icon"],
              "icon-size": 1,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true
            }
          });
        }
        map.on("click", "hodos-alert-symbols", (e: MapLayerMouseEvent) => {
          const feat = e.features?.[0];
          if (!feat || !feat.properties) return;
          const target = hazards.find((h) => h.id === feat.properties?.id);
          if (target) showPopupForHazard(target);
        });
        map.on("mouseenter", "hodos-alert-symbols", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "hodos-alert-symbols", () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("click", "hodos-hazard-point", (e: MapLayerMouseEvent) => {
          const feat = e.features?.[0];
          if (!feat || !feat.properties) return;
          const target = hazards.find((h) => h.id === feat.properties?.id);
          if (target) showPopupForHazard(target);
        });
        map.on("mouseenter", "hodos-hazard-point", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "hodos-hazard-point", () => {
          map.getCanvas().style.cursor = "";
        });
        if (hazards.length > 0) {
          fitBoundsToData(hazards);
        }
        updateSourceData();
        onLoaded?.(handle);
      })
      .catch(() => {});

    // A slow breathing pulse on the hazard halos — the map is alive even
    // when nobody is touching it.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const startedAt = performance.now();
      const breathe = (now: number) => {
        if (!map.getLayer("hodos-hazard-glow")) return;
        const wave = Math.sin((now - startedAt) / 1900);
        map.setPaintProperty(
          "hodos-hazard-glow",
          "circle-opacity",
          0.11 + (wave * 0.5 + 0.5) * 0.09
        );
        requestAnimationFrame(breathe);
      };
      requestAnimationFrame(breathe);
    }
  };

  map.on("load", setupLayers);
  setTimeout(() => {
    if (!map.getSource("hodos-hazards")) setupLayers();
  }, 250);

  setTimeout(() => map.resize(), 100);
  window.addEventListener("resize", () => map.resize());

  // Live backend only. There is no static snapshot: the map must never show
  // a hazard that the corroboration pipeline has not actually published.
  fetch(
    "https://sgp.cloud.appwrite.io/v1/tablesdb/hodos/tables/hazards/rows?queries[]=%7B%22method%22%3A%22limit%22%2C%22values%22%3A%5B500%5D%7D",
    {
      headers: { "X-Appwrite-Project": "6ad7939a002ff135e419" }
    }
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        const remoteRows: WebHazard[] = data.rows
          .map(parseAppwriteRow)
          .filter((h: WebHazard | null): h is WebHazard => h !== null);

        if (remoteRows.length > 0) {
          const byId = new globalThis.Map<string, WebHazard>();
          for (const h of hazards) byId.set(h.id, h);
          for (const h of remoteRows) byId.set(h.id, h);
          hazards = Array.from(byId.values());
          handle.hazards = hazards;
          updateSourceData();
        }
      }
    })
    .catch(() => {});

  // Partner placements are served from the backend only.
  fetch(
    "https://sgp.cloud.appwrite.io/v1/tablesdb/hodos/tables/partners/rows?queries[]=%7B%22method%22%3A%22limit%22%2C%22values%22%3A%5B100%5D%7D",
    {
      headers: { "X-Appwrite-Project": "6ad7939a002ff135e419" }
    }
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !Array.isArray(data.rows)) return;
      const parsed: WebPartner[] = [];
      const now = Date.now();
      (data.rows as any[]).forEach((raw, i) => {
        const lat = Number(raw.lat);
        const lng = Number(raw.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !raw.name) return;
        // A placement is sold by the day. Once the day is over the pin must
        // disappear without anyone having to remember to take it down.
        const until = Date.parse(String(raw.activeUntil ?? ""));
        if (Number.isFinite(until) && until < now) return;
        parsed.push({
          id: String(raw.$id ?? raw.id ?? `partner-${i}`),
          name: String(raw.name),
          category: String(raw.category ?? "pit-stop"),
          lat,
          lng,
          offer: String(raw.offer ?? ""),
          sponsorLabel: String(raw.sponsorLabel ?? "Local shop"),
          link: typeof raw.link === "string" && raw.link ? raw.link : null
        });
      });
      if (parsed.length === 0) return;
      partners = parsed;
      refreshPartnerSource();
      if (focusedShopId) {
        const target = parsed.find((p) => p.id === focusedShopId);
        if (target) {
          shouldAutoFit = false;
          map.flyTo({ center: [target.lng, target.lat], zoom: 16, duration: 700 });
          showPopupForPartner(target);
        }
      }
    })
    .catch(() => {});

  return handle;
}
