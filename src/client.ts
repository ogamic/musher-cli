import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import pc from "picocolors";

export const DEFAULT_API_URL = "http://localhost:3001";

// DEPRECATED global config. Kept as a READ-ONLY fallback so a currently-live
// global setup keeps working the day #1027 ships; scheduled for removal next
// release. The write path is folder-local `./.env` only (see env.ts).
const CONFIG_FILE = join(homedir(), ".musher", "config.json");

export interface Config {
  apiUrl: string;
  token: string;
}

/** A CLI-level error with an already-friendly message. */
export class CliError extends Error {}

/** DEPRECATED read-only global config (`~/.musher/config.json`). */
export function readConfig(): Partial<Config> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>;
  } catch {
    return {};
  }
}

let deprecationWarned = false;

/** Emit the one-line global-config deprecation notice at most once per run. */
function warnDeprecatedGlobalConfig(): void {
  if (deprecationWarned) return;
  deprecationWarned = true;
  process.stderr.write(
    `${pc.yellow("!")} Using deprecated ~/.musher/config.json — run 'musher init' to create a local .env (global config is removed next release).\n`,
  );
}

const stripSlash = (u: string) => u.replace(/\/+$/, "");

/**
 * Resolve the API URL. Precedence: real env / `.env` file (both surface via
 * `process.env`, real winning) > deprecated global config (warns) > default.
 */
export function resolveApiUrl(): string {
  if (process.env.MUSHER_API_URL) return stripSlash(process.env.MUSHER_API_URL);
  const cfg = readConfig();
  if (cfg.apiUrl) {
    warnDeprecatedGlobalConfig();
    return stripSlash(cfg.apiUrl);
  }
  return DEFAULT_API_URL;
}

/**
 * Resolve the token. Precedence: real env / `.env` file (via `process.env`,
 * real winning) > deprecated global config (warns). May be undefined.
 */
export function resolveToken(): string | undefined {
  if (process.env.MUSHER_TOKEN) return process.env.MUSHER_TOKEN;
  const cfg = readConfig();
  if (cfg.token) {
    warnDeprecatedGlobalConfig();
    return cfg.token;
  }
  return undefined;
}

/**
 * Resolve the target workspace (id or slug — the API accepts both).
 * Precedence: `--workspace` flag > `MUSHER_WORKSPACE` (real env or `.env`,
 * both via `process.env`) > none.
 */
export function resolveWorkspace(flag?: string): string | undefined {
  return flag || process.env.MUSHER_WORKSPACE || undefined;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  /** Override the resolved token (used by `login`/`init` to validate first). */
  token?: string;
  /** Override the resolved API URL (used by `login`/`init`). */
  apiUrl?: string;
}

/**
 * Perform an authenticated request, unwrap `{ data }`, and map failures to
 * friendly CliErrors. Returns the unwrapped `data` payload.
 */
export async function api<T = unknown>(
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const apiUrl = opts.apiUrl ?? resolveApiUrl();
  const token = opts.token ?? resolveToken();
  const method = opts.method ?? "GET";

  // Folder-local model: no `.env`, no real token, and no deprecated global
  // config to fall back on → tell the user to set the folder up.
  if (!token) {
    throw new CliError(
      "No .env or MUSHER_TOKEN in this folder — run 'musher init' here.",
    );
  }

  const headers: Record<string, string> = {};
  headers["Authorization"] = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new CliError(
      `Can't reach the Musher API at ${apiUrl}. Is it running?`,
    );
  }

  // 204 / empty body
  const text = await res.text();
  let payload: any = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (res.ok) {
    return (payload && "data" in payload ? payload.data : payload) as T;
  }

  const apiMsg: string | undefined = payload?.error?.message;

  if (res.status === 401) {
    throw new CliError(
      "Not authenticated. Run `musher init` here (or set MUSHER_TOKEN).",
    );
  }
  if (res.status === 403) {
    const role = await bestEffortRole(apiUrl, token);
    throw new CliError(
      `Permission denied — your role (${role}) can't do that.`,
    );
  }
  if (res.status === 404) {
    throw new CliError(apiMsg || "Not found.");
  }
  throw new CliError(apiMsg || `Request failed (HTTP ${res.status}).`);
}

/** Look up the caller's role for the 403 message; never throws. */
async function bestEffortRole(
  apiUrl: string,
  token: string | undefined,
): Promise<string> {
  if (!token) return "unknown";
  try {
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as any;
    return body?.data?.user?.role || "unknown";
  } catch {
    return "unknown";
  }
}
