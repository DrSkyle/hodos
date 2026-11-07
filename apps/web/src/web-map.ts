import { Map, NavigationControl, AttributionControl, GeolocateControl, Popup, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";

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
  exportData: (format: "geojson" | "gpx") => void;
}

// Crisp, keyless raster basemap (CARTO + OpenStreetMap attribution, zero API key required)
const HIGH_CONTRAST_STYLE: any = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
    }
  },
  layers: [
    {
      id: "carto-dark-layer",
      type: "raster",
      source: "carto-dark",
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
      ? "Speed Bump"
      : kind === "rough_pavement"
      ? "Rough Road Pavement"
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
    locationName: `GPS ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
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
    statusEl.textContent = `Connecting to road observations...`;
  }

  // 1. Initialize MapLibre with clean neutral basemap
  const map = new Map({
    container,
    style: HIGH_CONTRAST_STYLE,
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
        locationName: h.locationName,
        confidence: h.confidence ?? 0.8,
        firstSeen: h.firstSeen,
        lastSeen: h.lastSeen
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
      const corroboratedCount = hazards.filter((h) => h.published).length;
      statusEl.textContent =
        corroboratedCount > 0
          ? `${corroboratedCount} corroborated hazards · ${hazards.length} total observations`
          : `${hazards.length} field pilot observations mapped`;
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
        statusEl.textContent = `${filtered.length} observations shown (${kind === "all" ? "all categories" : kind})`;
      }
    },
    fitAllHazards: () => fitBoundsToData(hazards),
    flyToHazard: (id: string) => {
      const target = hazards.find((h) => h.id === id);
      if (target) {
        map.flyTo({ center: [target.lng, target.lat], zoom: 15, duration: 1200 });
        showPopupForHazard(target);
      }
    },
    exportData: (format: "geojson" | "gpx") => {
      let content: string;
      let filename: string;
      let mime: string;
      if (format === "geojson") {
        content = JSON.stringify(buildGeoJSON(hazards), null, 2);
        filename = "hodos-road-defects.geojson";
        mime = "application/geo+json";
      } else {
        const wpt = hazards
          .map(
            (h) =>
              `  <wpt lat="${h.lat}" lon="${h.lng}"><name>${h.title}</name><desc>Kind: ${h.kind}, Severity: ${h.severity}, Passes: ${h.passes}, Devices: ${h.devices}, Corroborated: ${h.published}, Recorded: ${h.firstSeen || "N/A"}</desc></wpt>`
          )
          .join("\n");
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hodos https://hodos.devilabs.dev">\n${wpt}\n</gpx>`;
        filename = "hodos-road-defects.gpx";
        mime = "application/gpx+xml";
      }
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  function showPopupForHazard(h: WebHazard) {
    const kindName =
      h.kind === "speed_bump"
        ? "Speed Bump"
        : h.kind === "rough_pavement"
        ? "Rough Pavement"
        : "Pothole";

    const badgeColor = h.fixed
      ? "#10B981"
      : h.kind === "pothole"
      ? "#FF4D36"
      : h.kind === "speed_bump"
      ? "#38BDF8"
      : "#F59E0B";

    const badgeLabel = h.fixed
      ? "Repaired"
      : h.kind === "pothole"
      ? "Pothole"
      : h.kind === "speed_bump"
      ? "Speed Hump"
      : "Rough Surface";

    const dateStr = h.firstSeen ? new Date(h.firstSeen).toLocaleDateString() : "Recorded";
    const statusText = h.published
      ? `Multi-Device Corroborated (${h.passes} passes · ${h.devices} devices)`
      : `Pilot Sensor Reading (${h.passes} ${h.passes === 1 ? "pass" : "passes"} · awaiting 2nd device)`;
    const confPct = Math.round((h.confidence ?? 0.5) * 100);

    const html = `
      <div style="font-family: 'DM Sans', system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px; min-width: 230px; color: #E2E8F0;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px;">
          <strong style="font-family: 'Outfit', sans-serif; font-size: 14px; color: #F8FAFC;">${kindName}</strong>
          <span style="background: ${badgeColor}; color: #0B0E14; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 99px;">
            ${badgeLabel}
          </span>
        </div>
        <div style="font-size: 11.5px; color: #94A3B8; margin-bottom: 6px; font-family: 'JetBrains Mono', monospace;">
          ${h.locationName}
        </div>
        <div style="font-size: 12px; color: #CBD5E1; margin-bottom: 8px; background: #111622; border: 1px solid #1E293B; padding: 8px 10px; border-radius: 8px; line-height: 1.6;">
          • Impact Severity: <strong style="color:#F8FAFC;">Tier ${h.severity}</strong><br/>
          • Evidence: <strong style="color:#F8FAFC;">${statusText}</strong><br/>
          • Confidence: <strong style="color:#F8FAFC;">${confPct}%</strong> · Logged <strong style="color:#F8FAFC;">${dateStr}</strong>
        </div>
        <div style="font-size: 10.5px; color: #94A3B8; line-height: 1.4;">
          Corroboration &amp; repair verification are recorded on-device via the Hodos Android app.
        </div>
      </div>
    `;

    new Popup({ offset: 12, closeButton: true })
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

    // High contrast glow halo for prominent visibility
    map.addLayer({
      id: "hazard-glow",
      type: "circle",
      source: "hodos-hazards",
      paint: {
        "circle-radius": [
          "match", ["get", "kind"],
          "pothole", 16,
          "rough_pavement", 12,
          13
        ],
        "circle-color": [
          "case",
          ["get", "fixed"], "#10B981",
          ["==", ["get", "kind"], "pothole"], "#FF4D36",
          ["==", ["get", "kind"], "speed_bump"], "#38BDF8",
          "#F59E0B"
        ],
        "circle-opacity": 0.35
      }
    });

    // Distinct crisp marker circle with dark border
    map.addLayer({
      id: "hazard-point",
      type: "circle",
      source: "hodos-hazards",
      paint: {
        "circle-radius": [
          "match", ["get", "kind"],
          "pothole", 7,
          "rough_pavement", 5,
          6
        ],
        "circle-color": [
          "case",
          ["get", "fixed"], "#10B981",
          ["==", ["get", "kind"], "pothole"], "#FF4D36",
          ["==", ["get", "kind"], "speed_bump"], "#38BDF8",
          "#F59E0B"
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#0B0E14"
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

  // 2. Load the 438 pilot records immediately from local bundle
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
    .catch((err) => {
      console.warn("Local static hazards load error:", err);
    });

  // 3. Fetch latest live corroborated updates from Appwrite backend asynchronously
  fetch(
    "https://sgp.cloud.appwrite.io/v1/tablesdb/hodos/tables/hazards/rows?queries[]=%7B%22method%22%3A%22limit%22%2C%22values%22%3A%5B500%5D%7D",
    {
      headers: { "X-Appwrite-Project": "6ad7939a002ff135e419" }
    }
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        // Only replace the map with live backend rows if they are published corroborated hazards,
        // or merge published live hazards with the static pilot dataset
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
    .catch((err) => {
      console.warn("Background Appwrite fetch skipped:", err);
    });

  return handle;
}
