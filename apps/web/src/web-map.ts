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

// Crisp, muted, high-contrast basemap (Carto Positron)
// Neutral gray roads so defects stand out with 100% clarity without competing colors
const HIGH_CONTRAST_STYLE: any = {
  version: 8,
  sources: {
    "carto-positron": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
    }
  },
  layers: [
    {
      id: "carto-positron-layer",
      type: "raster",
      source: "carto-positron",
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
  const fixed = Boolean(r.fixed || (r.fixedVotes && r.fixedVotes > 1));
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
      statusEl.textContent = `${hazards.length} verified defects mapped`;
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
        statusEl.textContent = `${filtered.length} defects shown (${kind === "all" ? "all categories" : kind})`;
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
              `  <wpt lat="${h.lat}" lon="${h.lng}"><name>${h.title}</name><desc>Kind: ${h.kind}, Severity: ${h.severity}, Recorded: ${h.firstSeen || "N/A"}</desc></wpt>`
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
      ? "#15803D"
      : h.kind === "pothole"
      ? "#D9381E"
      : h.kind === "speed_bump"
      ? "#1D4ED8"
      : "#D97706";

    const badgeLabel = h.fixed
      ? "REPAIRED"
      : h.kind === "pothole"
      ? "POTHOLE"
      : h.kind === "speed_bump"
      ? "SPEED HUMP"
      : "ROUGH ROAD";

    const dateStr = h.firstSeen ? new Date(h.firstSeen).toLocaleDateString() : "RECORDED";

    const html = `
      <div style="font-family: 'Plus Jakarta Sans', system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px; min-width: 230px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 8px; border-bottom: 1.5px solid #111417; padding-bottom: 6px;">
          <strong style="font-family: 'Barlow Semi Condensed', sans-serif; font-size: 16px; font-weight: 900; letter-spacing: 0.03em; text-transform: uppercase; color: #111417;">${kindName}</strong>
          <span style="font-family: 'Barlow Semi Condensed', sans-serif; background: ${badgeColor}; color: #ffffff; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.04em;">
            ${badgeLabel}
          </span>
        </div>
        <div style="font-size: 11.5px; color: #424953; margin-bottom: 8px; font-family: 'JetBrains Mono', monospace; font-weight: 600;">
          ${h.locationName}
        </div>
        <div style="font-size: 12px; color: #111417; margin-bottom: 12px; background: #F4F3EE; border: 1px solid #D5D1C6; padding: 8px 10px; border-radius: 4px; line-height: 1.6; font-family: 'JetBrains Mono', monospace;">
          • Impact: <strong>Tier ${h.severity}</strong><br/>
          • Multi-Pass: <strong>${h.passes} passes</strong><br/>
          • Date: <strong>${dateStr}</strong>
        </div>
        <div style="display: flex; gap: 6px;">
          <button id="btn-verify-${h.id}" style="flex: 1; padding: 8px 10px; font-family: 'Barlow Semi Condensed', sans-serif; font-size: 12px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; background: #F5B800; color: #111417; border: 1.5px solid #111417; border-radius: 4px; cursor: pointer;">Still Present</button>
          <button id="btn-fixed-${h.id}" style="flex: 1; padding: 8px 10px; font-family: 'Barlow Semi Condensed', sans-serif; font-size: 12px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; background: #FFFFFF; color: #111417; border: 1.5px solid #111417; border-radius: 4px; cursor: pointer;">Mark Fixed</button>
        </div>
      </div>
    `;

    new Popup({ offset: 12, closeButton: true })
      .setLngLat([h.lng, h.lat])
      .setHTML(html)
      .addTo(map);

    setTimeout(() => {
      const verifyBtn = document.getElementById(`btn-verify-${h.id}`);
      const fixedBtn = document.getElementById(`btn-fixed-${h.id}`);
      verifyBtn?.addEventListener("click", () => {
        verifyBtn.textContent = "Verified";
        verifyBtn.style.background = "#15803D";
        verifyBtn.style.color = "#FFFFFF";
      });
      fixedBtn?.addEventListener("click", () => {
        fixedBtn.textContent = "Marked Fixed";
        fixedBtn.style.background = "#15803D";
        fixedBtn.style.color = "#FFFFFF";
      });
    }, 50);
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
          "pothole", 13,
          "rough_pavement", 10,
          11
        ],
        "circle-color": [
          "case",
          ["get", "fixed"], "#15803D",
          ["==", ["get", "kind"], "pothole"], "#D9381E",
          ["==", ["get", "kind"], "speed_bump"], "#1D4ED8",
          "#D97706"
        ],
        "circle-opacity": 0.22
      }
    });

    // Distinct crisp marker circle with solid stone border
    map.addLayer({
      id: "hazard-point",
      type: "circle",
      source: "hodos-hazards",
      paint: {
        "circle-radius": [
          "match", ["get", "kind"],
          "pothole", 7.5,
          "rough_pavement", 5.5,
          6.5
        ],
        "circle-color": [
          "case",
          ["get", "fixed"], "#15803D",
          ["==", ["get", "kind"], "pothole"], "#D9381E",
          ["==", ["get", "kind"], "speed_bump"], "#1D4ED8",
          "#D97706"
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#111417"
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
      if (statusEl) {
        statusEl.textContent = `${hazards.length} verified defects loaded`;
      }
    }

    onLoaded?.(handle);
  };

  map.on("load", setupLayers);
  setTimeout(() => {
    if (!map.getSource("hodos-hazards")) setupLayers();
  }, 250);

  setTimeout(() => map.resize(), 100);
  window.addEventListener("resize", () => map.resize());

  // 2. Load the 438 verified records immediately from local bundle
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

  // 3. Fetch latest live updates from Appwrite backend asynchronously
  fetch(
    "https://sgp.cloud.appwrite.io/v1/tablesdb/hodos/tables/hazards/rows?queries[]=%7B%22method%22%3A%22limit%22%2C%22values%22%3A%5B500%5D%7D",
    {
      headers: { "X-Appwrite-Project": "6ad7939a002ff135e419" }
    }
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        const remote: WebHazard[] = data.rows
          .map(parseAppwriteRow)
          .filter((h: WebHazard | null): h is WebHazard => h !== null);

        if (remote.length > 0) {
          hazards = remote;
          handle.hazards = remote;
          updateSourceData();
        }
      }
    })
    .catch((err) => {
      console.warn("Background Appwrite fetch skipped:", err);
    });

  return handle;
}
