import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";

// Folder-local `.env` model (#1027): the CLI's identity + workspace come from
// the folder you stand in. This module owns parsing, the startup walk-up load,
// and the local `./.env` read/write path that `login` / `init` use.

/** The env keys the CLI understands, in the order they're written to `./.env`. */
const ENV_KEY_ORDER = ["MUSHER_API_URL", "MUSHER_TOKEN", "MUSHER_WORKSPACE"];

/**
 * Parse `KEY=VALUE` lines. Ignores blanks and `#` comments, tolerates a leading
 * `export `, trims whitespace, and strips a single layer of matching quotes.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Find the nearest `.env`: check `start`, then walk up to the filesystem root. */
export function findEnvFile(start: string = process.cwd()): string | undefined {
  let dir = start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let loadedEnvPath: string | undefined;

/** Absolute path of the `.env` loaded at startup, or undefined if none. */
export function loadedEnvFile(): string | undefined {
  return loadedEnvPath;
}

/**
 * Load the nearest `.env` (cwd, walking up) into `process.env`. Real
 * `process.env` always wins: a key already present is NOT overwritten — so the
 * standard precedence (real env > `.env` file) holds for every consumer.
 */
export function loadEnv(): void {
  const path = findEnvFile();
  if (!path) return;
  loadedEnvPath = path;
  let values: Record<string, string>;
  try {
    values = parseEnv(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  for (const [k, v] of Object.entries(values)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// ---- The local `./.env` write path (login / init) ------------------------

/** Path of the `.env` in the *current* folder (never a walked-up parent). */
export function localEnvPath(): string {
  return join(process.cwd(), ".env");
}

export function localEnvExists(): boolean {
  return existsSync(localEnvPath());
}

/** Parse `./.env` in the current folder (empty object if absent/unreadable). */
export function readLocalEnv(): Record<string, string> {
  const p = localEnvPath();
  if (!existsSync(p)) return {};
  try {
    return parseEnv(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function serializeEnv(values: Record<string, string>): string {
  const known = ENV_KEY_ORDER.filter((k) => k in values);
  const extra = Object.keys(values).filter((k) => !ENV_KEY_ORDER.includes(k));
  return [...known, ...extra].map((k) => `${k}=${values[k]}`).join("\n") + "\n";
}

/** Write `./.env` (mode 0600) from the given key/value map. */
export function writeLocalEnv(values: Record<string, string>): void {
  writeFileSync(localEnvPath(), serializeEnv(values), { mode: 0o600 });
}

/**
 * Remove `MUSHER_TOKEN` from `./.env` (used by `logout`). Deletes the file if it
 * becomes empty. Returns true if a token was actually cleared.
 */
export function clearLocalEnvToken(): boolean {
  const p = localEnvPath();
  if (!existsSync(p)) return false;
  const values = readLocalEnv();
  if (!("MUSHER_TOKEN" in values)) return false;
  delete values.MUSHER_TOKEN;
  if (Object.keys(values).length === 0) {
    rmSync(p);
  } else {
    writeLocalEnv(values);
  }
  return true;
}
