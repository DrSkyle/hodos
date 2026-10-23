import { CONFIG } from "./config";
import type { Hazard } from "@hodos/core";

export interface HazardRecord extends Hazard {
  rowId: string;
}

interface AppwriteRow {
  $id: string;
  hazardId?: string;
  lat: number;
  lng: number;
  kind: string;
  severity: number;
  passCount: number;
  deviceCount: number;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  published: boolean;
  fixedVotes?: number;
  dayCount?: number;
  clearPasses?: number;
}

function tablesUrl(table: string): string {
  const { endpoint, databaseId } = CONFIG.appwrite;
  return `${endpoint}/tablesdb/${databaseId}/tables/${table}/rows`;
}

function headers(): Record<string, string> {
  return {
    "X-Appwrite-Project": CONFIG.appwrite.projectId,
    "Content-Type": "application/json",
  };
}

function toHazard(row: AppwriteRow): HazardRecord {
  return {
    rowId: row.$id,
    id: row.hazardId ?? row.$id,
    lat: row.lat,
    lng: row.lng,
    kind: row.kind as Hazard["kind"],
    severity: row.severity as Hazard["severity"],
    passCount: row.passCount,
    deviceCount: row.deviceCount,
    dayCount: row.dayCount ?? 1,
    confidence: row.confidence,
    firstSeen: Date.parse(row.firstSeen),
    lastSeen: Date.parse(row.lastSeen),
    published: row.published,
    fixedVotes: row.fixedVotes ?? 0,
    clearPasses: row.clearPasses ?? 0,
  };
}

export interface EventInput {
  deviceId: string;
  tripId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  accuracy: number;
  speedKph: number;
  magnitude: number;
  severity: number;
  kind: string;
  confidence: number;
  mode: string;
  /** "impact" for something felt, "pass" for travelling a hazard silently, "fix" for a repair report. */
  observation?: string;
  /** The hazard a pass, confirmation or fix relates to. */
  hazardRef?: string;
}

/**
 * Append one observation to the write-only event log. Clients never write the
 * map directly: the log is the only thing a Device contributes to, and the
 * aggregation function derives every hazard from it.
 */
export async function appendEvent(event: EventInput): Promise<void> {
  const res = await fetch(tablesUrl(CONFIG.appwrite.eventsTable), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ rowId: "unique()", data: event }),
  });
  if (!res.ok) {
    throw new Error(`appendEvent failed: ${res.status} ${await res.text()}`);
  }
}

export async function listHazards(): Promise<HazardRecord[]> {
  const res = await fetch(`${tablesUrl(CONFIG.appwrite.hazardsTable)}?limit=500`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`listHazards failed: ${res.status}`);
  }
  const body = (await res.json()) as { rows?: AppwriteRow[] };
  return (body.rows ?? []).map(toHazard);
}

/** Ask the aggregation function to recompute the map from the event log. */
export async function runAggregation(): Promise<void> {
  try {
    await fetch(`${CONFIG.appwrite.endpoint}/functions/hodos-aggregate/executions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ async: true }),
    });
  } catch {
    /* the hourly schedule will catch up */
  }
}
