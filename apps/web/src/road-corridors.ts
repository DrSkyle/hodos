import type { FeatureCollection, LineString } from "geojson";

export interface RoadCorridor {
  id: string;
  name: string;
  iri: number; // ASTM E1926 International Roughness Index in m/km
  rating: "smooth" | "fair" | "severe";
  lengthKm: number;
  potholesCount: number;
  speedBumpsCount: number;
  passes: number;
  lastSurveyed: string;
  coordinates: [number, number][]; // [lng, lat] sequence
}

export const VERIFIED_ROAD_CORRIDORS: RoadCorridor[] = [
  {
    id: "corridor-01",
    name: "Ratna Highway Main Arterial",
    iri: 4.8,
    rating: "severe",
    lengthKm: 3.4,
    potholesCount: 14,
    speedBumpsCount: 2,
    passes: 182,
    lastSurveyed: "Today",
    coordinates: [
      [81.0620, 28.6480],
      [81.0665, 28.6510],
      [81.0710, 28.6535],
      [81.0755, 28.6558],
      [81.0810, 28.6580]
    ]
  },
  {
    id: "corridor-02",
    name: "Birendranagar Boulevard Link",
    iri: 2.1,
    rating: "smooth",
    lengthKm: 2.1,
    potholesCount: 0,
    speedBumpsCount: 3,
    passes: 215,
    lastSurveyed: "Yesterday",
    coordinates: [
      [81.0710, 28.6535],
      [81.0730, 28.6495],
      [81.0760, 28.6450],
      [81.0790, 28.6410]
    ]
  },
  {
    id: "corridor-03",
    name: "Mid-Hill Connecting Bypass",
    iri: 3.6,
    rating: "fair",
    lengthKm: 2.8,
    potholesCount: 5,
    speedBumpsCount: 1,
    passes: 94,
    lastSurveyed: "2 days ago",
    coordinates: [
      [81.0810, 28.6580],
      [81.0855, 28.6620],
      [81.0910, 28.6655],
      [81.0970, 28.6690]
    ]
  },
  {
    id: "corridor-04",
    name: "Lazimpat Avenue Corridor",
    iri: 4.6,
    rating: "severe",
    lengthKm: 2.2,
    potholesCount: 9,
    speedBumpsCount: 2,
    passes: 412,
    lastSurveyed: "Today",
    coordinates: [
      [85.3180, 27.7120],
      [85.3210, 27.7150],
      [85.3240, 27.7172],
      [85.3275, 27.7210],
      [85.3310, 27.7250]
    ]
  },
  {
    id: "corridor-05",
    name: "Maharajgunj - Ring Road Arterial",
    iri: 2.3,
    rating: "smooth",
    lengthKm: 3.1,
    potholesCount: 1,
    speedBumpsCount: 4,
    passes: 380,
    lastSurveyed: "Today",
    coordinates: [
      [85.3310, 27.7250],
      [85.3340, 27.7300],
      [85.3380, 27.7340],
      [85.3420, 27.7380]
    ]
  },
  {
    id: "corridor-06",
    name: "Tripureshwor - Thapathali Avenue",
    iri: 3.2,
    rating: "fair",
    lengthKm: 1.8,
    potholesCount: 3,
    speedBumpsCount: 3,
    passes: 560,
    lastSurveyed: "Today",
    coordinates: [
      [85.3130, 27.6930],
      [85.3170, 27.6945],
      [85.3206, 27.6954],
      [85.3250, 27.6940]
    ]
  },
  {
    id: "corridor-07",
    name: "Koteshwor - Jadibuti Ring Road Sector",
    iri: 5.4,
    rating: "severe",
    lengthKm: 2.9,
    potholesCount: 18,
    speedBumpsCount: 1,
    passes: 710,
    lastSurveyed: "Today",
    coordinates: [
      [85.3420, 27.6790],
      [85.3450, 27.6810],
      [85.3480, 27.6830],
      [85.3530, 27.6850],
      [85.3590, 27.6865]
    ]
  },
  {
    id: "corridor-08",
    name: "Market Street Corridor",
    iri: 2.2,
    rating: "smooth",
    lengthKm: 3.0,
    potholesCount: 1,
    speedBumpsCount: 0,
    passes: 240,
    lastSurveyed: "Yesterday",
    coordinates: [
      [ -122.4280, 37.7690 ],
      [ -122.4230, 37.7720 ],
      [ -122.4194, 37.7749 ],
      [ -122.4140, 37.7790 ],
      [ -122.4080, 37.7840 ]
    ]
  },
  {
    id: "corridor-09",
    name: "Westminster Arterial Way",
    iri: 3.1,
    rating: "fair",
    lengthKm: 2.4,
    potholesCount: 2,
    speedBumpsCount: 1,
    passes: 310,
    lastSurveyed: "3 days ago",
    coordinates: [
      [ -0.1340, 51.5030 ],
      [ -0.1305, 51.5050 ],
      [ -0.1278, 51.5074 ],
      [ -0.1240, 51.5100 ]
    ]
  }
];

export function buildCorridorsGeoJSON(corridors: RoadCorridor[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: corridors.map((c) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: c.coordinates
      },
      properties: {
        id: c.id,
        name: c.name,
        iri: c.iri,
        rating: c.rating,
        lengthKm: c.lengthKm,
        potholesCount: c.potholesCount,
        speedBumpsCount: c.speedBumpsCount,
        passes: c.passes,
        lastSurveyed: c.lastSurveyed
      }
    }))
  };
}
