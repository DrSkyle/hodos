import { describe, expect, it } from "vitest";
import { hazardsToCSV, hazardsToGeoJSON, type RoadHazardExportItem } from "./export-gis";

describe("Municipal GIS & CSV Export", () => {
  const sampleHazards: RoadHazardExportItem[] = [
    {
      id: "hazard-ktm-001",
      lat: 27.7172,
      lng: 85.324,
      kind: "pothole",
      severity: 3,
      passes: 12,
      devices: 5,
      confidence: 0.92,
      fixed: false,
      lastSeen: "2026-11-03T08:00:00Z",
    },
    {
      id: "hazard-ktm-002",
      lat: 27.7185,
      lng: 85.3255,
      kind: "speed_bump",
      severity: 1,
      passes: 8,
      devices: 4,
      confidence: 0.85,
      fixed: true,
      lastSeen: "2026-11-02T14:30:00Z",
    },
  ];

  it("converts hazards to standard RFC 7946 GeoJSON FeatureCollection", () => {
    const geojson = hazardsToGeoJSON(sampleHazards);
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features).toHaveLength(2);

    const first = geojson.features[0]!;
    expect(first.geometry.coordinates).toEqual([85.324, 27.7172]); // [lng, lat]
    expect(first.properties.kind).toBe("pothole");
    expect(first.properties.severityText).toBe("High");
    expect(first.properties.confidence).toBe(0.92);
  });

  it("converts hazards to standard CSV with headers", () => {
    const csv = hazardsToCSV(sampleHazards);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "id,latitude,longitude,defect_type,severity,severity_label,observation_count,unique_devices,confidence_score,is_repaired,last_seen"
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("hazard-ktm-001,27.717200,85.324000,pothole,3,High,12,5,0.92,false");
    expect(lines[2]).toContain("hazard-ktm-002,27.718500,85.325500,speed_bump,1,Low,8,4,0.85,true");
  });
});
