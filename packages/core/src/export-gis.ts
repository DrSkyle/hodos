import type { HazardKind, Severity } from "./types";

export interface RoadHazardExportItem {
  id: string;
  lat: number;
  lng: number;
  kind: HazardKind;
  severity: Severity;
  passes: number;
  devices: number;
  confidence: number;
  fixed: boolean;
  lastSeen?: string;
}

export interface GeoJsonPointFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    id: string;
    kind: HazardKind;
    severity: Severity;
    severityText: string;
    passes: number;
    devices: number;
    confidence: number;
    fixed: boolean;
    lastSeen?: string;
  };
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonPointFeature[];
}

/**
 * Format numerical severity to standard text label.
 */
export function severityToText(severity: Severity): string {
  switch (severity) {
    case 3:
      return "High";
    case 2:
      return "Medium";
    case 1:
    default:
      return "Low";
  }
}

/**
 * Convert hazard items into standard RFC 7946 GeoJSON FeatureCollection
 * ready for import into QGIS, ArcGIS, or MapLibre.
 */
export function hazardsToGeoJSON(hazards: RoadHazardExportItem[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: hazards.map((h) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [h.lng, h.lat],
      },
      properties: {
        id: h.id,
        kind: h.kind,
        severity: h.severity,
        severityText: severityToText(h.severity),
        passes: h.passes,
        devices: h.devices,
        confidence: Math.round(h.confidence * 100) / 100,
        fixed: h.fixed,
        lastSeen: h.lastSeen,
      },
    })),
  };
}

/**
 * Convert hazard items into CSV format for municipal spreadsheets and infrastructure planning.
 */
export function hazardsToCSV(hazards: RoadHazardExportItem[]): string {
  const headers = [
    "id",
    "latitude",
    "longitude",
    "defect_type",
    "severity",
    "severity_label",
    "observation_count",
    "unique_devices",
    "confidence_score",
    "is_repaired",
    "last_seen",
  ];

  const rows = hazards.map((h) => [
    h.id,
    h.lat.toFixed(6),
    h.lng.toFixed(6),
    h.kind,
    h.severity,
    severityToText(h.severity),
    h.passes,
    h.devices,
    h.confidence.toFixed(2),
    h.fixed ? "true" : "false",
    h.lastSeen ?? "",
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}
