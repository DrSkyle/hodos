export const CONFIG = {
  appwrite: {
    endpoint: import.meta.env.VITE_APPWRITE_ENDPOINT ?? "https://sgp.cloud.appwrite.io/v1",
    projectId: import.meta.env.VITE_APPWRITE_PROJECT_ID ?? "6ad7939a002ff135e419",
    databaseId: "hodos",
    eventsTable: "events",
    hazardsTable: "hazards",
  },
  map: {
    styleUrl:
      import.meta.env.VITE_MAP_STYLE ??
      "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    /** Fallback centre when there is no location and no hazards yet. */
    defaultCenter: { lat: 27.7172, lng: 85.324 } as const,
  },
  detection: {
    /** How often (ms) the live window is re-analysed while recording. */
    analysisIntervalMs: 2000,
    /** Motion samples retained for analysis (ms). */
    windowMs: 30_000,
  },
} as const;
