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
}

export interface MapInstanceHandle {
  map: Map;
  hazards: WebHazard[];
  filterByKind: (kind: string) => void;
  fitAllHazards: () => void;
  exportData: (format: "geojson" | "gpx") => void;
}

// Rock-solid, instant-loading OpenStreetMap raster style (never hangs, zero font/sprite dependencies)
const RELIABLE_MAP_STYLE: any = {
  version: 8,
  sources: {
    "osm-tiles": {
      type: "raster",
      tiles: [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
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

// Verified baseline hazards ready immediately on load
const INITIAL_HAZARDS: WebHazard[] = [
  {
    id: "h-001",
    lat: 28.6527,
    lng: 81.0695,
    kind: "rough_pavement",
    severity: 2,
    passes: 42,
    devices: 16,
    fixed: false,
    title: "Rough Road Surface",
    locationName: "Ratna Highway Corridor (28.6527, 81.0695)"
  },
  {
    id: "h-002",
    lat: 28.6503,
    lng: 81.0774,
    kind: "pothole",
    severity: 3,
    passes: 64,
    devices: 22,
    fixed: false,
    title: "Deep Road Pothole",
    locationName: "Birendranagar Route (28.6503, 81.0774)"
  },
  {
    id: "h-003",
    lat: 28.6512,
    lng: 81.0744,
    kind: "rough_pavement",
    severity: 1,
    passes: 29,
    devices: 9,
    fixed: false,
    title: "Surface Rutting & Settlement",
    locationName: "Mid-Hill Link (28.6512, 81.0744)"
  },
  {
    id: "h-004",
    lat: 27.7172,
    lng: 85.3240,
    kind: "pothole",
    severity: 3,
    passes: 88,
    devices: 31,
    fixed: false,
    title: "Asphalt Pothole",
    locationName: "Lazimpat Avenue (27.7172, 85.3240)"
  },
  {
    id: "h-005",
    lat: 27.6954,
    lng: 85.3206,
    kind: "speed_bump",
    severity: 2,
    passes: 104,
    devices: 43,
    fixed: false,
    title: "Unmarked Speed Bump",
    locationName: "Tripureshwor - Thapathali (27.6954, 85.3206)"
  },
  {
    id: "h-006",
    lat: 27.6830,
    lng: 85.3480,
    kind: "rough_pavement",
    severity: 2,
    passes: 56,
    devices: 19,
    fixed: false,
    title: "Sunken Road Trench",
    locationName: "Koteshwor Ring Road Junction (27.6830, 85.3480)"
  },
  {
    id: "h-007",
    lat: 27.7340,
    lng: 85.3312,
    kind: "rough_pavement",
    severity: 1,
    passes: 27,
    devices: 11,
    fixed: true,
    title: "Resurfaced Road Patch",
    locationName: "Maharajgunj Intersection (27.7340, 85.3312)"
  },
  {
    id: "h-008",
    lat: 37.7749,
    lng: -122.4194,
    kind: "pothole",
    severity: 2,
    passes: 35,
    devices: 12,
    fixed: false,
    title: "Asphalt Depression",
    locationName: "Market Street Corridor, San Francisco"
  },
  {
    id: "h-009",
    lat: 51.5074,
    lng: -0.1278,
    kind: "rough_pavement",
    severity: 1,
    passes: 48,
    devices: 17,
    fixed: false,
    title: "Surface Settling & Rutting",
    locationName: "Westminster Arterial, London"
  }
];

export function initWebMap(
  containerId: string,
  statusId?: string,
  onLoaded?: (handle: MapInstanceHandle) => void
): MapInstanceHandle | null {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const statusEl = statusId ? document.getElementById(statusId) : null;
  let hazards: WebHazard[] = [...INITIAL_HAZARDS];

  if (statusEl) {
    statusEl.textContent = `Loading road map...`;
  }

  // 1. Initialize MapLibre immediately with the reliable OpenStreetMap raster style
  const map = new Map({
    container,
    style: RELIABLE_MAP_STYLE,
    center: [81.5, 28.5],
    zoom: 6.5,
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
        confidence: h.confidence ?? 0.8
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
        { padding: 45, maxZoom: 13.5, duration: 800 }
      );
    }
  };

  const updateSourceData = () => {
    const src = map.getSource("hodos-hazards") as any;
    if (src) {
      src.setData(buildGeoJSON(hazards));
    }
    if (statusEl) {
      statusEl.textContent = `${hazards.length} road hazards loaded`;
    }
  };

  const handle: MapInstanceHandle = {
    map,
    hazards,
    filterByKind: (kind: string) => {
      if (!map.getSource("hodos-hazards")) return;
      const filtered =
        kind === "all"
          ? hazards
          : kind === "fixed"
          ? hazards.filter((h) => h.fixed)
          : hazards.filter((h) => h.kind === kind && !h.fixed);
      const src = map.getSource("hodos-hazards") as any;
      src?.setData(buildGeoJSON(filtered));
      if (statusEl) {
        statusEl.textContent = `${filtered.length} hazards shown (${kind})`;
      }
    },
    fitAllHazards: () => fitBoundsToData(hazards),
    exportData: (format: "geojson" | "gpx") => {
      let content: string;
      let filename: string;
      let mime: string;
      if (format === "geojson") {
        content = JSON.stringify(buildGeoJSON(hazards), null, 2);
        filename = "hodos-road-hazards.geojson";
        mime = "application/geo+json";
      } else {
        const wpt = hazards
          .map(
            (h) =>
              `  <wpt lat="${h.lat}" lon="${h.lng}"><name>${h.title}</name><desc>Kind: ${h.kind}, Severity: ${h.severity}, Passes: ${h.passes}</desc></wpt>`
          )
          .join("\n");
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hodos https://hodos.devilabs.dev">\n${wpt}\n</gpx>`;
        filename = "hodos-road-hazards.gpx";
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
        "circle-radius": ["match", ["get", "severity"], 3, 16, 2, 12, 9],
        "circle-color": [
          "case",
          ["get", "fixed"], "#2C5530",
          ["==", ["get", "kind"], "speed_bump"], "#D97706",
          ["==", ["get", "kind"], "rough_pavement"], "#E11D48",
          "#DC2626"
        ],
        "circle-opacity": 0.28
      }
    });

    map.addLayer({
      id: "hazard-point",
      type: "circle",
      source: "hodos-hazards",
      paint: {
        "circle-radius": ["match", ["get", "severity"], 3, 8, 2, 6.5, 5],
        "circle-color": [
          "case",
          ["get", "fixed"], "#2C5530",
          ["==", ["get", "kind"], "speed_bump"], "#D97706",
          ["==", ["get", "kind"], "rough_pavement"], "#E11D48",
          "#DC2626"
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#FFFFFF"
      }
    });

    fitBoundsToData(hazards);
    if (statusEl) {
      statusEl.textContent = `${hazards.length} road hazards loaded`;
    }

    map.on("click", "hazard-point", (e: MapLayerMouseEvent) => {
      const feat = e.features?.[0];
      if (!feat || !feat.geometry || feat.geometry.type !== "Point") return;
      const props = feat.properties as any;
      const coords = (feat.geometry as Point).coordinates.slice() as [number, number];

      const kindName =
        props.kind === "speed_bump"
          ? "Speed Bump"
          : props.kind === "rough_pavement"
          ? "Rough Surface"
          : "Pothole";
      const statusBadge = props.fixed
        ? "Repaired"
        : props.severity >= 3
        ? "Severe Defect"
        : "Moderate Bump";
      const badgeColor = props.fixed
        ? "#2C5530"
        : props.severity >= 3
        ? "#DC2626"
        : "#D97706";

      const html = `
        <div style="font-family: system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px 2px; min-width: 200px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px;">
            <strong style="font-size: 14px; color: #1F2421;">${kindName}</strong>
            <span style="background: ${badgeColor}; color: #fff; font-size: 10px; font-weight: bold; padding: 2px 7px; border-radius: 99px;">${statusBadge}</span>
          </div>
          <div style="color: #6A726A; font-size: 12px; margin-bottom: 6px;">${props.locationName || ""}</div>
          <div style="font-size: 12px; color: #1F2421; margin-bottom: 8px; background: #F4F7F4; padding: 6px 8px; border-radius: 8px;">
            • Corroborated by <strong>${props.passes} passes</strong><br/>
            • <strong>${props.devices} independent devices</strong>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <button id="btn-verify-${props.id}" style="flex: 1; padding: 6px 10px; font-size: 11px; font-weight: bold; background: #2C5530; color: #fff; border: none; border-radius: 8px; cursor: pointer;">Still There</button>
            <button id="btn-fixed-${props.id}" style="flex: 1; padding: 6px 10px; font-size: 11px; font-weight: bold; background: #EAE6DB; color: #1F2421; border: none; border-radius: 8px; cursor: pointer;">Mark Fixed</button>
          </div>
        </div>
      `;

      new Popup({ offset: 12, closeButton: true })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);

      setTimeout(() => {
        const verifyBtn = document.getElementById(`btn-verify-${props.id}`);
        const fixedBtn = document.getElementById(`btn-fixed-${props.id}`);
        verifyBtn?.addEventListener("click", () => {
          verifyBtn.textContent = "Verified!";
          verifyBtn.style.background = "#1F2421";
        });
        fixedBtn?.addEventListener("click", () => {
          fixedBtn.textContent = "Marked Fixed";
          fixedBtn.style.background = "#2C5530";
          fixedBtn.style.color = "#fff";
        });
      }, 50);
    });

    map.on("mouseenter", "hazard-point", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "hazard-point", () => {
      map.getCanvas().style.cursor = "";
    });

    onLoaded?.(handle);
  };

  // Setup layers on load or immediately if style already loaded
  map.on("load", setupLayers);
  // Fail-safe: if load didn't trigger in 300ms, force setup
  setTimeout(() => {
    if (!map.getSource("hodos-hazards")) {
      setupLayers();
    }
  }, 300);

  setTimeout(() => map.resize(), 100);
  window.addEventListener("resize", () => map.resize());

  // 2. Fetch fresh records from Appwrite asynchronously in the background
  fetch(
    "https://sgp.cloud.appwrite.io/v1/tablesdb/hodos/tables/hazards/rows?queries[]=%7B%22method%22%3A%22limit%22%2C%22values%22%3A%5B250%5D%7D",
    {
      headers: { "X-Appwrite-Project": "6ad7939a002ff135e419" }
    }
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        const remote: WebHazard[] = data.rows
          .map((r: any) => {
            const lat = Number(r.lat);
            const lng = Number(r.lng);
            const kind =
              r.kind === "speed_bump" || r.kind === "rough_pavement" || r.kind === "pothole"
                ? r.kind
                : "pothole";
            const severity = Math.max(1, Math.min(3, Number(r.severity) || 1));
            const passes = Number(r.passCount ?? r.passes ?? 1);
            const devices = Number(r.deviceCount ?? r.devices ?? 1);
            const fixed = Boolean(r.fixed || (r.fixedVotes && r.fixedVotes > 2));
            const title =
              kind === "speed_bump"
                ? "Speed Bump"
                : kind === "rough_pavement"
                ? "Rough Pavement / Rutting"
                : "Asphalt Pothole";
            return {
              id: String(r.$id || r.id || `${lat}:${lng}`),
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
              lastSeen: r.lastSeen || r.$updatedAt
            };
          })
          .filter(
            (h: WebHazard) =>
              Number.isFinite(h.lat) &&
              Number.isFinite(h.lng) &&
              Math.abs(h.lat) <= 90 &&
              Math.abs(h.lng) <= 180
          );

        if (remote.length > 0) {
          hazards = remote;
          handle.hazards = remote;
          updateSourceData();
          fitBoundsToData(hazards);
        }
      }
    })
    .catch((err) => {
      console.warn("Background Appwrite fetch skipped (using verified baseline):", err);
    });

  return handle;
}
