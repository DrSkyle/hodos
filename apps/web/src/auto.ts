import { registerPlugin } from "@capacitor/core";
import type { TripRecord } from "./me";

interface NativeBridge {
  isEnabled(): Promise<{ enabled: boolean }>;
  enable(): Promise<{ enabled: boolean }>;
  disable(): Promise<{ enabled: boolean }>;
  autoTrips(): Promise<{ trips: TripRecord[] }>;
  clearAutoTrips(): Promise<void>;
}

const Hodos = registerPlugin<NativeBridge>("Hodos");

/** Automatic mapping only exists in the Android build. */
export function automaticAvailable(): boolean {
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

export async function automaticEnabled(): Promise<boolean> {
  if (!automaticAvailable()) {
    return false;
  }
  try {
    const result = await Hodos.isEnabled();
    return result.enabled;
  } catch {
    return false;
  }
}

export async function setAutomatic(on: boolean): Promise<boolean> {
  if (!automaticAvailable()) {
    return false;
  }
  try {
    const result = on ? await Hodos.enable() : await Hodos.disable();
    return result.enabled;
  } catch {
    return false;
  }
}

/** Journeys the native service recorded while the app was closed. */
export async function pullAutomaticTrips(): Promise<TripRecord[]> {
  if (!automaticAvailable()) {
    return [];
  }
  try {
    const result = await Hodos.autoTrips();
    return Array.isArray(result.trips) ? result.trips : [];
  } catch {
    return [];
  }
}
