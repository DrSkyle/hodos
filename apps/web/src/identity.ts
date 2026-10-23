const KEY = "hodos.identity.v1";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface Identity {
  /** The recovery code. It alone determines the account. */
  code: string;
}

/**
 * The recovery code is the whole identity: it derives both the account's
 * address and its password, so a user who keeps the code can restore everything
 * on a new device, and a user who loses it has lost nothing they were told to
 * expect to keep.
 */
export function newCode(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length] ?? "A");
  return chars.join("").replace(/(.{4})(?=.)/g, "$1-");
}

export function normaliseCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 20);
}

export function isValidCode(code: string): boolean {
  return normaliseCode(code).length === 20;
}

export function emailFor(code: string): string {
  return `${normaliseCode(code).toLowerCase()}@hodos.app`;
}

export function passwordFor(code: string): string {
  return `Hodos-${normaliseCode(code)}-Aa1`;
}

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Identity>;
    return typeof parsed.code === "string" && isValidCode(parsed.code)
      ? { code: normaliseCode(parsed.code) }
      : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* storage unavailable */
  }
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
