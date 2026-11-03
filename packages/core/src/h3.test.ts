import { describe, it, expect } from "vitest";
import {
  pointToH3,
  h3Center,
  h3BoundaryGeoJSON,
  binObservationsToH3,
  h3BinsToGeoJSON,
  H3_RESOLUTIONS,
  type GeoPoint
} from "./h3";

describe("H3 Spatial Hexagonal Indexing", () => {
  const KATHMANDU = { lat: 27.7172, lng: 85.324 };
  const NEARBY = { lat: 27.71725, lng: 85.32405 };
  const DISTANT = { lat: 27.7500, lng: 85.3500 };

  it("produces valid H3 indexes across resolutions", () => {
    const idx12 = pointToH3(KATHMANDU.lat, KATHMANDU.lng, H3_RESOLUTIONS.HAZARD_POINT);
    const idx10 = pointToH3(KATHMANDU.lat, KATHMANDU.lng, H3_RESOLUTIONS.ROAD_SEGMENT);
    const idx7 = pointToH3(KATHMANDU.lat, KATHMANDU.lng, H3_RESOLUTIONS.MUNICIPAL_WARD);

    expect(typeof idx12).toBe("string");
    expect(idx12.length).toBeGreaterThan(10);
    expect(typeof idx10).toBe("string");
    expect(typeof idx7).toBe("string");
  });

  it("calculates accurate hex center", () => {
    const idx = pointToH3(KATHMANDU.lat, KATHMANDU.lng, 10);
    const center = h3Center(idx);
    expect(center.lat).toBeCloseTo(KATHMANDU.lat, 2);
    expect(center.lng).toBeCloseTo(KATHMANDU.lng, 2);
  });

  it("generates closed GeoJSON polygon ring for boundaries", () => {
    const idx = pointToH3(KATHMANDU.lat, KATHMANDU.lng, 10);
    const ring = h3BoundaryGeoJSON(idx);
    expect(ring.length).toBeGreaterThanOrEqual(6);
    // Closed ring: first point equals last point
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    expect(first[0]).toEqual(last[0]);
    expect(first[1]).toEqual(last[1]);
  });

  it("groups nearby points into the same hex bin and separates distant points", () => {
    const points: GeoPoint[] = [
      { lat: KATHMANDU.lat, lng: KATHMANDU.lng, severity: 2, id: "p1" },
      { lat: NEARBY.lat, lng: NEARBY.lng, severity: 3, id: "p2" },
      { lat: DISTANT.lat, lng: DISTANT.lng, severity: 1, id: "p3" }
    ];

    const bins = binObservationsToH3(points, H3_RESOLUTIONS.ROAD_SEGMENT);
    expect(bins.size).toBe(2);

    const ktmBin = Array.from(bins.values()).find((b) => b.points.some((p) => p.id === "p1"));
    expect(ktmBin).toBeDefined();
    expect(ktmBin?.count).toBe(2);
    expect(ktmBin?.averageSeverity).toBe(2.5);
  });

  it("exports valid GeoJSON FeatureCollection", () => {
    const points: GeoPoint[] = [
      { lat: KATHMANDU.lat, lng: KATHMANDU.lng, severity: 2 }
    ];
    const bins = binObservationsToH3(points, 10);
    const geojson = h3BinsToGeoJSON(bins);

    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features.length).toBe(1);
    expect(geojson.features[0].geometry.type).toBe("Polygon");
    expect(geojson.features[0].properties.count).toBe(1);
  });
});
