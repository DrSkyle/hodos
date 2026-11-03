import {
  latLngToCell,
  cellToLatLng,
  cellToBoundary,
  gridDisk,
  type CoordPair
} from "h3-js";

export interface GeoPoint {
  lat: number;
  lng: number;
  severity?: number;
  kind?: string;
  id?: string;
}

export interface H3HexBin {
  h3Index: string;
  center: { lat: number; lng: number };
  boundary: Array<[number, number]>; // [lng, lat] pairs for GeoJSON
  count: number;
  averageSeverity: number;
  points: GeoPoint[];
}

/**
 * Standard H3 resolutions for road monitoring:
 * - Resolution 12: ~9m edge length (exact pothole & bump clustering)
 * - Resolution 10: ~65m edge length (street block / segment roughness)
 * - Resolution 7: ~1.2km edge length (municipal neighborhood / ward macro index)
 */
export const H3_RESOLUTIONS = {
  HAZARD_POINT: 12,
  ROAD_SEGMENT: 10,
  MUNICIPAL_WARD: 7
} as const;

export type H3Resolution = number;

/**
 * Convert lat/lng coordinates to an H3 hexagonal index string.
 */
export function pointToH3(lat: number, lng: number, resolution: number = H3_RESOLUTIONS.ROAD_SEGMENT): string {
  return latLngToCell(lat, lng, resolution);
}

/**
 * Get geographic center of an H3 hex cell.
 */
export function h3Center(h3Index: string): { lat: number; lng: number } {
  const [lat, lng] = cellToLatLng(h3Index);
  return { lat, lng };
}

/**
 * Get polygon boundary of an H3 hex cell as GeoJSON [lng, lat] coordinates.
 */
export function h3BoundaryGeoJSON(h3Index: string): Array<[number, number]> {
  const boundary = cellToBoundary(h3Index);
  // cellToBoundary returns [[lat, lng], ...]; GeoJSON requires [lng, lat]
  const coordinates: Array<[number, number]> = boundary.map(([lat, lng]) => [lng, lat]);
  // Close the polygon ring if not already closed
  if (coordinates.length > 0) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      coordinates.push([first[0], first[1]]);
    }
  }
  return coordinates;
}

/**
 * Group raw road observations into discrete H3 hexagonal spatial bins.
 * Instant O(N) spatial indexing without pairwise distance searches.
 */
export function binObservationsToH3(
  points: GeoPoint[],
  resolution = H3_RESOLUTIONS.ROAD_SEGMENT
): Map<string, H3HexBin> {
  const bins = new Map<string, H3HexBin>();

  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const h3Index = latLngToCell(point.lat, point.lng, resolution);

    let bin = bins.get(h3Index);
    if (!bin) {
      bin = {
        h3Index,
        center: h3Center(h3Index),
        boundary: h3BoundaryGeoJSON(h3Index),
        count: 0,
        averageSeverity: 0,
        points: []
      };
      bins.set(h3Index, bin);
    }

    bin.points.push(point);
    bin.count++;
    const totalSeverity = bin.points.reduce((acc, p) => acc + (p.severity ?? 1), 0);
    bin.averageSeverity = totalSeverity / bin.points.length;
  }

  return bins;
}

/**
 * Convert H3 hexagonal bins into standard RFC 7946 GeoJSON FeatureCollection
 * for QGIS, ArcGIS, and MapLibre rendering.
 */
export function h3BinsToGeoJSON(bins: Map<string, H3HexBin> | H3HexBin[]): any {
  const binList = Array.isArray(bins) ? bins : Array.from(bins.values());

  return {
    type: "FeatureCollection",
    features: binList.map((bin) => ({
      type: "Feature",
      id: bin.h3Index,
      geometry: {
        type: "Polygon",
        coordinates: [bin.boundary]
      },
      properties: {
        h3Index: bin.h3Index,
        count: bin.count,
        averageSeverity: Math.round(bin.averageSeverity * 10) / 10,
        centerLat: bin.center.lat,
        centerLng: bin.center.lng
      }
    }))
  };
}
