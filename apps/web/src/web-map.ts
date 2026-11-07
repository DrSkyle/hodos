import { setWorkerUrl, Map, NavigationControl, AttributionControl, GeolocateControl, Popup, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";

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

  if (statusEl) {
    statusEl.textContent = "Loading road observations...";
  }

  const map = new Map({
    container,
    style: OSM_CLEAN_STYLE,
    center: [82.5, 28.1],
    zoom: 7,
    attributionControl: false
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

  const fitBoundsToData = (targetHazards: WebHazard[]) => {
    if (targetHazards.length === 0) return;
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
    if (statusEl) {
      statusEl.textContent = `${hazards.length} road observations`;
    }
    onHazardsUpdated?.(hazards);
  };

  const handle: MapInstanceHandle = {
    map,
    hazards,
    filterByKind: (kind: string) => {
      const src = map.getSource("hodos-hazards") as any;
      if (!src) return;

      const filtered =
        kind === "all"
          ? hazards
          : kind === "fixed"
          ? hazards.filter((h) => h.fixed)
          : hazards.filter((h) => h.kind === kind && !h.fixed);

      src.setData(buildGeoJSON(filtered));
      if (statusEl) {
        statusEl.textContent = `${filtered.length} road observations`;
      }
    },
    fitAllHazards: () => fitBoundsToData(hazards),
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
      ? "#367b62"
      : h.kind === "pothole"
      ? "#c95b3c"
      : h.kind === "speed_bump"
      ? "#3b76a8"
      : "#d68454";

    const html = `
      <div style="font-family: 'DM Sans', system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px; min-width: 190px; color: #172d29;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; gap: 8px;">
          <strong style="font-size: 14px;">${h.title}</strong>
          <span style="background: ${badgeColor}; color: #fffdf7; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px;">
            ${h.fixed ? "Repaired" : `Level ${h.severity}`}
          </span>
        </div>
        <div style="font-size: 11.5px; color: #586e63; font-family: ui-monospace, monospace;">
          ${h.locationName}
        </div>
      </div>
    `;

    new Popup({ offset: 10, closeButton: true })
      .setLngLat([h.lng, h.lat])
      .setHTML(html)
      .addTo(map);
  }

  const setupLayers = () => {
    if (map.getSource("hodos-hazards")) return;

    map.addSource("hodos-hazards", {
      type: "geojson",
      data: buildGeoJSON(hazards)
    });

    map.addLayer({
      id: "hazard-glow",
      type: "circle",
      source: "hodos-hazards",
      paint: {
        "circle-radius": [
          "match", ["get", "kind"],
          "pothole", 14,
          "rough_pavement", 10,
          11
        ],
        "circle-color": [
          "case",
          ["get", "fixed"], "#367b62",
          ["==", ["get", "kind"], "pothole"], "#c95b3c",
          ["==", ["get", "kind"], "speed_bump"], "#3b76a8",
          "#d68454"
        ],
        "circle-opacity": 0.28
      }
    });

    map.addLayer({
      id: "hazard-point",
      type: "circle",
      source: "hodos-hazards",
      paint: {
        "circle-radius": [
          "match", ["get", "kind"],
          "pothole", 6.5,
          "rough_pavement", 5,
          5.5
        ],
        "circle-color": [
          "case",
          ["get", "fixed"], "#367b62",
          ["==", ["get", "kind"], "pothole"], "#c95b3c",
          ["==", ["get", "kind"], "speed_bump"], "#3b76a8",
          "#d68454"
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fffdf7"
      }
    });

    map.on("click", "hazard-point", (e: MapLayerMouseEvent) => {
      const feat = e.features?.[0];
      if (!feat || !feat.properties) return;
      const target = hazards.find((h) => h.id === feat.properties?.id);
      if (target) showPopupForHazard(target);
    });

    map.on("mouseenter", "hazard-point", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "hazard-point", () => {
      map.getCanvas().style.cursor = "";
    });

    if (hazards.length > 0) {
      fitBoundsToData(hazards);
      updateSourceData();
    }

    onLoaded?.(handle);
  };

  map.on("load", setupLayers);
  setTimeout(() => {
    if (!map.getSource("hodos-hazards")) setupLayers();
  }, 250);

  setTimeout(() => map.resize(), 100);
  window.addEventListener("resize", () => map.resize());

  fetch("/data/hazards.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        const parsed: WebHazard[] = data.rows
          .map(parseAppwriteRow)
          .filter((h: WebHazard | null): h is WebHazard => h !== null);
        if (parsed.length > 0) {
          hazards = parsed;
          handle.hazards = parsed;
          updateSourceData();
          fitBoundsToData(hazards);
        }
      }
    })
    .catch(() => {});

  fetch(
    "https://sgp.cloud.appwrite.io/v1/tablesdb/hodos/tables/hazards/rows?queries[]=%7B%22method%22%3A%22limit%22%2C%22values%22%3A%5B500%5D%7D",
    {
      headers: { "X-Appwrite-Project": "6ad7939a002ff135e419" }
    }
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        const remoteCorroborated: WebHazard[] = data.rows
          .filter((r: any) => r && r.published === true)
          .map(parseAppwriteRow)
          .filter((h: WebHazard | null): h is WebHazard => h !== null);

        if (remoteCorroborated.length > 0) {
          const byId = new globalThis.Map<string, WebHazard>();
          for (const h of hazards) byId.set(h.id, h);
          for (const h of remoteCorroborated) byId.set(h.id, h);
          hazards = Array.from(byId.values());
          handle.hazards = hazards;
          updateSourceData();
        }
      }
    })
    .catch(() => {});

  return handle;
}
