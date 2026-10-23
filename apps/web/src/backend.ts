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
    confidence: row.confidence,
    firstSeen: Date.parse(row.firstSeen),
    lastSeen: Date.parse(row.lastSeen),
    published: row.published,
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
}

/** Append one observation to the private, write-only event log. */
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

export interface HazardUpsert {
  rowId: string;
  hazard: Hazard;
}

async function getRow(rowId: string): Promise<HazardRecord | null> {
  const res = await fetch(`${tablesUrl(CONFIG.appwrite.hazardsTable)}/${rowId}`, {
    headers: headers(),
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`getRow failed: ${res.status}`);
  }
  return toHazard((await res.json()) as AppwriteRow);
}

function toData(hazard: Hazard): Record<string, unknown> {
  return {
    hazardId: hazard.id,
    lat: hazard.lat,
    lng: hazard.lng,
    kind: hazard.kind,
    severity: hazard.severity,
    passCount: hazard.passCount,
    deviceCount: hazard.deviceCount,
    confidence: hazard.confidence,
    firstSeen: new Date(hazard.firstSeen).toISOString(),
    lastSeen: new Date(hazard.lastSeen).toISOString(),
    published: hazard.published,
  };
}

/**
 * Merge a locally detected hazard into the public map. The counters of the
 * existing row are added to the incoming cluster's, then the merged row is
 * written back.
 */
export async function upsertHazard(upsert: HazardUpsert): Promise<void> {
  const existing = await getRow(upsert.rowId);
  const incoming = upsert.hazard;
  if (existing === null) {
    const res = await fetch(tablesUrl(CONFIG.appwrite.hazardsTable), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ rowId: upsert.rowId, data: toData(incoming) }),
    });
    if (!res.ok) {
      throw new Error(`createHazard failed: ${res.status} ${await res.text()}`);
    }
    return;
  }
  const merged: Hazard = {
    ...incoming,
    passCount: existing.passCount + incoming.passCount,
    deviceCount: Math.max(existing.deviceCount, incoming.deviceCount),
    severity: Math.max(existing.severity, incoming.severity) as Hazard["severity"],
    confidence: Math.max(existing.confidence, incoming.confidence),
    firstSeen: Math.min(existing.firstSeen, incoming.firstSeen),
    lastSeen: Math.max(existing.lastSeen, incoming.lastSeen),
    published: existing.published || incoming.published,
  };
  const res = await fetch(`${tablesUrl(CONFIG.appwrite.hazardsTable)}/${upsert.rowId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ data: toData(merged) }),
  });
  if (!res.ok) {
    throw new Error(`updateHazard failed: ${res.status} ${await res.text()}`);
  }
}
