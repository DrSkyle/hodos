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

export interface MapInstanceHandle {
  map: Map;
  hazards: WebHazard[];
  filterByKind: (kind: string, query?: string) => void;
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

// 100% free, keyless OpenStreetMap raster style — zero API key required, zero CARTO dependency
const OSM_CLEAN_STYLE: any = {
  version: 8,
  sources: {
    "osm-tiles": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      // Cap tile fetches at z18 and omit `maxzoom` on the layer below so
      // MapLibre overzooms z18 tiles cleanly up to z22 without hiding the
      // layer (in MapLibre, a layer `maxzoom: 19` is exclusive — at zoom >= 19
      // the layer is hidden completely!).
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
  const fixed = Boolean(r.fixed || (r.fixedVotes && r.fixedVotes > 1) || (r.clearPasses && r.clearPasses >= 3));
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

  const buildPartnerGeoJSON = (items: WebPartner[]): FeatureCollection => ({
    type: "FeatureCollection",
    features: items.map((p) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [p.lng, p.lat]
      },
      properties: {
        id: p.id,
        name: p.name,
        category: p.category,
        offer: p.offer,
        sponsorLabel: p.sponsorLabel
      }
    }))
  });

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

  function showPopupForHazard(h: WebHazard) {
    const isAlert = isLiveAlertKind(h.kind);
    const badgeColor = h.fixed
      ? "#10b981"
      : h.kind === "police"
      ? "#2563eb"
      : h.kind === "jam"
      ? "#ea580c"
      : h.kind === "roadblock"
      ? "#dc2626"
      : h.kind === "flood"
      ? "#0891b2"
      : h.kind === "pothole"
      ? "#e11d48"
      : h.kind === "speed_bump"
      ? "#7c3aed"
      : "#d97706";

    const badgeText = h.fixed ? "Repaired" : isAlert ? "Live alert" : `Level ${h.severity}`;
    const subline = isAlert
      ? "Reported live · auto-expires"
      : `${h.passes} pass${h.passes === 1 ? "" : "es"} · ${h.devices} device${h.devices === 1 ? "" : "s"}`;

    const html = `
      <div style="font-family: 'Overpass Variable', 'Overpass', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 2px; min-width: 200px; color: var(--ink, #1c1a17);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; gap: 8px;">
          <strong style="font-size: 14.5px; font-weight: 700; letter-spacing: -0.01em;">${escapeHtml(h.title)}</strong>
          <span style="background: ${badgeColor}; color: #ffffff; font-family: 'Overpass Mono Variable', 'Overpass Mono', ui-monospace, monospace; font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 4px;">
            ${escapeHtml(badgeText)}
          </span>
        </div>
        <div style="font-size: 11px; color: var(--muted, #736d61); font-family: 'Overpass Mono Variable', 'Overpass Mono', ui-monospace, monospace; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 3px;">
          ${escapeHtml(subline)}
        </div>
        <div style="font-size: 11px; color: var(--muted, #736d61); font-family: 'Overpass Mono Variable', 'Overpass Mono', ui-monospace, monospace;">
          ${escapeHtml(h.locationName)}
        </div>
      </div>
    `;

    new Popup({ offset: 10, closeButton: true })
      .setLngLat([h.lng, h.lat])
      .setHTML(html)
      .addTo(map);
  }

  function showPopupForPartner(p: WebPartner) {
    const href = safeHttpUrl(p.link);
    const html = `
      <div style="font-family: 'Overpass Variable', 'Overpass', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px; min-width: 200px; color: var(--ink, #1c1a17);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; gap: 8px;">
          <strong style="font-size: 14px; font-weight: 700;">${escapeHtml(p.name)}</strong>
          <span style="background: #d97706; color: #ffffff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; white-space: nowrap;">
            Local shop
          </span>
        </div>
        ${p.offer ? `<div style="font-size: 12.5px; color: var(--muted, #57534e); margin-bottom: 6px;">${escapeHtml(p.offer)}</div>` : ""}
        ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow" style="font-size: 12px; font-weight: 600; color: var(--accent, #b45309); text-decoration: none; display:block; margin-bottom:6px;">Visit →</a>` : ""}
        <a href="/partners" style="font-size: 12px; font-weight: 600; color: var(--accent, #b45309); text-decoration: none;">Put your shop here →</a>
      </div>
    `;

    new Popup({ offset: 12, closeButton: true })
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

    // Sponsored pins first (so hazard layers render on top — safety data always
    // wins), then the hazard layers.
    map.addSource("hodos-partners", {
      type: "geojson",
      data: buildPartnerGeoJSON(partners)
    });
    map.addLayer({
      id: "partner-halo",
      type: "circle",
      source: "hodos-partners",
      paint: {
        "circle-radius": 16,
        "circle-color": "#d97706",
        "circle-opacity": 0.14
      }
    });
    // MapLibre circle layers have no dashed stroke, so the partner pin reads as
    // a white dot inside an amber ring: an outer translucent ring plus the dot.
    map.addLayer({
      id: "hodos-partner-ring",
      type: "circle",
      source: "hodos-partners",
      paint: {
        "circle-radius": 11.5,
        "circle-color": "#d97706",
        "circle-opacity": 0.18,
        "circle-stroke-color": "#d97706",
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": 0.55
      }
    });
    map.addLayer({
      id: "hodos-partner-dots",
      type: "circle",
      source: "hodos-partners",
      paint: {
        "circle-radius": 7.5,
        "circle-color": "#fffdf7",
        "circle-stroke-color": "#d97706",
        "circle-stroke-width": 2.5
      }
    });
    map.on("click", "hodos-partner-dots", (e: MapLayerMouseEvent) => {
      const feat = e.features?.[0];
      if (!feat || !feat.properties) return;
      const target = partners.find((p) => p.id === feat.properties?.id);
      if (target) showPopupForPartner(target);
    });
    map.on("mouseenter", "hodos-partner-dots", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "hodos-partner-dots", () => {
      map.getCanvas().style.cursor = "";
    });

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
          id: String(raw.id ?? `partner-${i}`),
          name: String(raw.name),
          category: String(raw.category ?? "pit-stop"),
          lat,
          lng,
          offer: String(raw.offer ?? ""),
          sponsorLabel: String(raw.sponsorLabel ?? "Sponsored"),
          link: typeof raw.link === "string" && raw.link ? raw.link : null
        });
      });
      if (parsed.length === 0) return;
      partners = parsed;
      const src = map.getSource("hodos-partners") as any;
      if (src) src.setData(buildPartnerGeoJSON(parsed));
    })
    .catch(() => {});

  return handle;
}
