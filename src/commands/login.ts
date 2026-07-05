import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { DEFAULT_API_URL, api, CliError } from "../client.js";
import {
  readLocalEnv,
  writeLocalEnv,
  clearLocalEnvToken,
  localEnvPath,
} from "../env.js";
import pc from "picocolors";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

interface Me {
  user: { n: string; role: string };
}

/**
 * Authenticate and persist to the folder-local `./.env` (#1027) — NEVER to the
 * deprecated global `~/.musher/config.json`. Preserves any existing keys (e.g.
 * MUSHER_WORKSPACE) in `./.env`.
 */
export async function login(opts: { url?: string; token?: string }) {
  const existing = readLocalEnv();
  const defaultUrl = existing.MUSHER_API_URL || DEFAULT_API_URL;

  let url = opts.url;
  if (!url) {
    const answer = await prompt(`API URL [${defaultUrl}]: `);
    url = answer || defaultUrl;
  }
  url = url.replace(/\/+$/, "");

  let token = opts.token;
  if (!token) {
    token = await prompt("Paste your personal access token (msh_…): ");
  }
  if (!token) throw new CliError("No token provided. Aborting.");

  // Validate before saving.
  const me = await api<Me>("/api/auth/me", { apiUrl: url, token });

  writeLocalEnv({ ...existing, MUSHER_API_URL: url, MUSHER_TOKEN: token });
  stdout.write(
    `${pc.green("✓")} Logged in as ${pc.bold(me.user.n)} (${me.user.role}) at ${url}\n`,
  );
  stdout.write(`${pc.dim(`  wrote ${localEnvPath()} (mode 0600)`)}\n`);
}

/** Clear the token from the folder-local `./.env`. */
export function logout() {
  const cleared = clearLocalEnvToken();
  stdout.write(
    cleared
      ? "Logged out. Token removed from ./.env.\n"
      : "No ./.env token in this folder to remove.\n",
  );
}
