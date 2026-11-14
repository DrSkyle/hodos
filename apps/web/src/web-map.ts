import { setWorkerUrl, Map, NavigationControl, AttributionControl, GeolocateControl, Popup, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { CONTACT_EMAIL } from "./site-constants";

// Explicitly point MapLibre to our self-hosted worker bundle so Vite's asset hashing
// never triggers "Worker failed to load. Check that the worker URL is correct."
setWorkerUrl("/maplibre-gl-worker.js");

export interface WebHazard {
  id: string;
  lat: number;
  lng: number;
  kind: "pothole" | "speed_bump" | "rough_pavement";
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
  filterByKind: (kind: string) => void;
  fitAllHazards: () => void;
  flyToHazard: (id: string) => void;
}

// 100% free, keyless OpenStreetMap raster style — zero API key required, zero CARTO dependency
const OSM_CLEAN_STYLE: any = {
  version: 8,
  sources: {
    "osm-tiles": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    }
  },
  layers: [
    {
      id: "osm-tiles-layer",
      type: "raster",
      source: "osm-tiles",
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

function parseAppwriteRow(r: any): WebHazard | null {
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  const kind =
    r.kind === "speed_bump" || r.kind === "rough_pavement" || r.kind === "pothole"
      ? r.kind
      : "pothole";
  const severity = Math.max(1, Math.min(3, Number(r.severity) || 1));
  const passes = Number(r.passCount ?? r.passes ?? 1);
  const devices = Number(r.deviceCount ?? r.devices ?? 1);
  const published = Boolean(r.published);
  if (!published) return null;
  const fixed = Boolean(r.fixed || (r.fixedVotes && r.fixedVotes > 1) || (r.clearPasses && r.clearPasses >= 3));
  const title =
    kind === "speed_bump"
      ? "Speed bump"
      : kind === "rough_pavement"
      ? "Rough road"
      : "Pothole";

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
    attributionControl: false,
    // Encoding the camera in the URL hash keeps the rider's view across
    // refreshes and makes any spot shareable.
    hash: true
  });

  // Only pull the camera to the hazard spread when the visitor has no position
  // of their own yet (no hash in the URL). A refresh must never yank the map
  // back to the same overview after someone has moved around.
  let shouldAutoFit = !/#\d/.test(window.location.hash);
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
      if (h.fixed) continue;
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
    features: items.map((h) => ({
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
    const qualitySrc = map.getSource("hodos-quality") as any;
    if (qualitySrc) {
      qualitySrc.setData(buildQualityGeoJSON(hazards));
    }
    if (statusEl) {
      statusEl.textContent = hazards.length === 0
        ? "No published road observations yet"
        : `${hazards.length} road observations`;
    }
    onHazardsUpdated?.(hazards);
  };

  const handle: MapInstanceHandle = {
    map,
    hazards,
    filterByKind: (kind: string, query = "") => {
      const src = map.getSource("hodos-hazards") as any;
      if (!src) return;

      const q = query.trim().toLowerCase();
      const filtered = hazards.filter((h) => {
        const matchKind =
          kind === "all"
            ? true
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
      if (statusEl) {
        statusEl.textContent = filtered.length === 0
          ? "No road observations match this filter"
          : `${filtered.length} road observations`;
      }
    },
    fitAllHazards: () => fitBoundsToData(hazards, true),
    flyToHazard: (id: string) => {
      const target = hazards.find((h) => h.id === id);
      if (target) {
        map.flyTo({ center: [target.lng, target.lat], zoom: 15, duration: 1000 });
        showPopupForHazard(target);
      }
    }
  };

  function showPopupForHazard(h: WebHazard) {
    const badgeColor = h.fixed
      ? "#10b981"
      : h.kind === "pothole"
      ? "#e11d48"
      : h.kind === "speed_bump"
      ? "#7c3aed"
      : "#d97706";

    const html = `
      <div style="font-family: 'Overpass Variable', 'Overpass', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 2px; min-width: 200px; color: #1c1a17;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; gap: 8px;">
          <strong style="font-size: 14.5px; font-weight: 700; letter-spacing: -0.01em;">${h.title}</strong>
          <span style="background: ${badgeColor}; color: #ffffff; font-family: 'Overpass Mono Variable', 'Overpass Mono', ui-monospace, monospace; font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 4px;">
            ${h.fixed ? "Repaired" : `Level ${h.severity}`}
          </span>
        </div>
        <div style="font-size: 11px; color: #736d61; font-family: 'Overpass Mono Variable', 'Overpass Mono', ui-monospace, monospace; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 3px;">
          ${h.passes} pass${h.passes === 1 ? "" : "es"} · ${h.devices} device${h.devices === 1 ? "" : "s"}
        </div>
        <div style="font-size: 11px; color: #a39b8b; font-family: 'Overpass Mono Variable', 'Overpass Mono', ui-monospace, monospace;">
          ${h.locationName}
        </div>
      </div>
    `;

    new Popup({ offset: 10, closeButton: true })
      .setLngLat([h.lng, h.lat])
      .setHTML(html)
      .addTo(map);
  }

  function showPopupForPartner(p: WebPartner) {
    const html = `
      <div style="font-family: 'Overpass Variable', 'Overpass', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px; min-width: 200px; color: #1c1a17;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; gap: 8px;">
          <strong style="font-size: 14px; font-weight: 700;">${p.name}</strong>
          <span style="background: #d97706; color: #ffffff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; white-space: nowrap;">
            Local shop
          </span>
        </div>
        ${p.offer ? `<div style="font-size: 12.5px; color: #57534e; margin-bottom: 6px;">${p.offer}</div>` : ""}
        ${p.link ? `<a href="${p.link}" target="_blank" rel="noopener noreferrer nofollow" style="font-size: 12px; font-weight: 600; color: #b45309; text-decoration: none; display:block; margin-bottom:6px;">Visit →</a>` : ""}
        <a href="/partners" style="font-size: 12px; font-weight: 600; color: #b45309; text-decoration: none;">Put your shop here →</a>
      </div>
    `;

    new Popup({ offset: 12, closeButton: true })
      .setLngLat([p.lng, p.lat])
      .setHTML(html)
      .addTo(map);
  }

  const setupLayers = () => {
    if (map.getSource("hodos-hazards")) return;

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

    map.addSource("hodos-hazards", {
      type: "geojson",
      data: buildGeoJSON(hazards)
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
