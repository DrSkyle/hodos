import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HazardRecord } from "./backend";
import { hazardStatus, type Hazard, type Impact } from "@hodos/core";
import { CONFIG } from "./config";

const SEVERITY_LABEL = ["Minor", "Moderate", "Severe"];

function hazardFeatureCollection(records: HazardRecord[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: records.map((record) => ({
      type: "Feature",
      id: record.rowId,
      geometry: { type: "Point", coordinates: [record.lng, record.lat] },
      properties: {
        severity: record.severity,
        kind: record.kind,
        passCount: record.passCount,
        deviceCount: record.deviceCount,
        dayCount: record.dayCount,
        confidence: record.confidence,
        published: record.published,
        fixed: hazardStatus(record) === "fixed",
        clearPasses: record.clearPasses,
      },
    })),
  };
}

function impactFeatureCollection(impacts: Impact[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: impacts.map((impact) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [impact.lng, impact.lat] },
      properties: { severity: impact.severity, magnitude: impact.magnitude },
    })),
  };
}

const HAZARD_COLOR: maplibregl.ExpressionSpecification = [
  "case",
  ["==", ["get", "fixed"], true],
  "#34d399",
  ["match", ["get", "severity"], 3, "#f87171", 2, "#fbbf24", "#2dd4bf"],
];

function isFixed(): maplibregl.ExpressionSpecification {
  return ["==", ["get", "fixed"], true];
}

/**
 * The hazard map. Rendering is best effort: a device without WebGL, or a browser
 * that blocks it, must not take the rest of the app down with it, so a failed
 * construction leaves this inert rather than thrown.
 */
export class HazardMap {
  private map: maplibregl.Map | null = null;
  private ready = false;
  private pendingHazards: HazardRecord[] = [];
  private pendingImpacts: Impact[] = [];
  private userMarker?: maplibregl.Marker;

  constructor(container: HTMLElement, private readonly onSelect?: (record: HazardRecord) => void) {
    try {
      const map = new maplibregl.Map({
        container,
        style: CONFIG.map.styleUrl,
        center: [CONFIG.map.defaultCenter.lng, CONFIG.map.defaultCenter.lat],
        zoom: 12,
        attributionControl: { compact: true },
      });
      this.map = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        this.installLayers();
        this.ready = true;
        this.flush();
      });
    } catch {
      this.map = null;
    }
  }

  private installLayers(): void {
    const map = this.map;
    if (map === null) {
      return;
    }
    map.addSource("hazards", { type: "geojson", data: hazardFeatureCollection([]) });
    map.addLayer({
      id: "hazards-halo",
      type: "circle",
      source: "hazards",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "confidence"], 0, 6, 1, 18],
        "circle-color": HAZARD_COLOR,
        "circle-opacity": ["case", isFixed(), 0.08, 0.18],
      },
    });
    map.addLayer({
      id: "hazards-core",
      type: "circle",
      source: "hazards",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "passCount"], 1, 3, 20, 8],
        "circle-color": HAZARD_COLOR,
        "circle-stroke-color": "#0b0f14",
        "circle-stroke-width": 1.5,
        "circle-opacity": ["case", isFixed(), 0.45, 1],
      },
    });

    map.addSource("trip", { type: "geojson", data: impactFeatureCollection([]) });
    map.addLayer({
      id: "trip-impacts",
      type: "circle",
      source: "trip",
      paint: {
        "circle-radius": 5,
        "circle-color": "#a78bfa",
        "circle-stroke-color": "#0b0f14",
        "circle-stroke-width": 1,
      },
    });

    map.on("click", "hazards-core", (event) => {
      const feature = event.features?.[0];
      if (!feature) {
        return;
      }
      const record: HazardRecord = {
        rowId: String(feature.id ?? ""),
        id: String(feature.id ?? ""),
        lat: (feature.geometry as GeoJSON.Point).coordinates[1] ?? 0,
        lng: (feature.geometry as GeoJSON.Point).coordinates[0] ?? 0,
        kind: feature.properties?.kind as Hazard["kind"],
        severity: feature.properties?.severity as Hazard["severity"],
        passCount: Number(feature.properties?.passCount ?? 0),
        deviceCount: Number(feature.properties?.deviceCount ?? 0),
        dayCount: Number(feature.properties?.dayCount ?? 1),
        confidence: Number(feature.properties?.confidence ?? 0),
        firstSeen: 0,
        lastSeen: 0,
        published: Boolean(feature.properties?.published),
        fixedVotes: feature.properties?.fixed === true ? 2 : 0,
        clearPasses: Number(feature.properties?.clearPasses ?? 0),
      };
      this.onSelect?.(record);
    });
    map.on("mouseenter", "hazards-core", () => {
      const canvas = map.getCanvas();
      if (canvas) {
        canvas.style.cursor = "pointer";
      }
    });
    map.on("mouseleave", "hazards-core", () => {
      const canvas = map.getCanvas();
      if (canvas) {
        canvas.style.cursor = "";
      }
    });
  }

  private flush(): void {
    const map = this.map;
    if (map === null) {
      return;
    }
    const hazards = map.getSource("hazards") as maplibregl.GeoJSONSource | undefined;
    hazards?.setData(hazardFeatureCollection(this.pendingHazards));
    const trip = map.getSource("trip") as maplibregl.GeoJSONSource | undefined;
    trip?.setData(impactFeatureCollection(this.pendingImpacts));
  }

  setHazards(records: HazardRecord[]): void {
    this.pendingHazards = records;
    if (this.ready) {
      this.flush();
    }
  }

  setTripImpacts(impacts: Impact[]): void {
    this.pendingImpacts = impacts;
    if (this.ready) {
      this.flush();
    }
  }

  setUserPosition(lat: number, lng: number): void {
    const map = this.map;
    if (map === null) {
      return;
    }
    try {
      if (this.userMarker === undefined) {
        this.userMarker = new maplibregl.Marker({ color: "#38bdf8" }).setLngLat([lng, lat]);
        this.userMarker.addTo(map);
      } else {
        this.userMarker.setLngLat([lng, lat]);
      }
    } catch {
      /* marker is decoration */
    }
  }

  focus(lat: number, lng: number, zoom = 16): void {
    this.map?.flyTo({ center: [lng, lat], zoom });
  }

  centreOn(lat: number, lng: number): void {
    this.map?.setCenter([lng, lat]);
  }
}

export function severityLabel(severity: number): string {
  return SEVERITY_LABEL[severity - 1] ?? "Unknown";
}
