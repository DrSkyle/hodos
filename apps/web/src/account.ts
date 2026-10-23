import { CONFIG } from "./config";
import { emailFor, passwordFor } from "./identity";

function base(path: string): string {
  return `${CONFIG.appwrite.endpoint}${path}`;
}

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(base(path), {
    ...init,
    credentials: "include",
    headers: {
      "X-Appwrite-Project": CONFIG.appwrite.projectId,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function table(name: string): string {
  return `/tablesdb/${CONFIG.appwrite.databaseId}/tables/${name}/rows`;
}

export async function accountId(): Promise<string | null> {
  try {
    const res = await request("/account");
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { $id?: string };
    return body.$id ?? null;
  } catch {
    return null;
  }
}

/**
 * Establish a session for a recovery code. The account is created the first
 * time the code is seen and simply signed into afterwards, so the same call
 * serves both a first run and a restore.
 */
export async function establishSession(code: string): Promise<boolean> {
  const email = emailFor(code);
  const password = passwordFor(code);
  try {
    const signin = await request("/account/sessions/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (signin.ok) {
      return true;
    }
    await request("/account", {
      method: "POST",
      body: JSON.stringify({ userId: "unique()", email, password }),
    });
    const retry = await request("/account/sessions/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return retry.ok;
  } catch {
    return false;
  }
}

export async function loadProfile(): Promise<string | null> {
  try {
    const res = await request(table("profiles"));
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { rows?: Array<{ data?: string }> };
    const row = body.rows?.[0];
    return typeof row?.data === "string" ? row.data : null;
  } catch {
    return null;
  }
}

export async function saveProfile(data: string): Promise<void> {
  try {
    const list = await request(table("profiles"));
    const body = (await list.json()) as { rows?: Array<{ $id: string }> };
    const row = body.rows?.[0];
    if (row !== undefined) {
      await request(`${table("profiles")}/${row.$id}`, {
        method: "PATCH",
        body: JSON.stringify({ data: { data } }),
      });
      return;
    }
    const id = await accountId();
    const permissions =
      id === null ? [] : [`read("user:${id}")`, `update("user:${id}")`];
    await request(table("profiles"), {
      method: "POST",
      body: JSON.stringify({ rowId: "unique()", data: { data }, permissions }),
    });
  } catch {
    /* the local copy remains the source of truth when the network is absent */
  }
}
