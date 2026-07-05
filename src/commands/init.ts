import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { DEFAULT_API_URL, api, CliError } from "../client.js";
import {
  readLocalEnv,
  writeLocalEnv,
  localEnvExists,
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
 * Scaffold `./.env` for this folder (#1027): MUSHER_API_URL / MUSHER_TOKEN /
 * MUSHER_WORKSPACE. Validates the token against `/api/auth/me` before writing,
 * writes mode 0600, and refuses to clobber an existing `./.env` without --force.
 */
export async function init(opts: {
  url?: string;
  token?: string;
  workspace?: string;
  force?: boolean;
}) {
  if (localEnvExists() && !opts.force) {
    throw new CliError(
      `${localEnvPath()} already exists — pass --force to overwrite.`,
    );
  }

  // On --force we merge over the existing file so unrelated keys survive.
  const existing = opts.force ? readLocalEnv() : {};

  let url = opts.url;
  if (url === undefined) {
    const def = existing.MUSHER_API_URL || DEFAULT_API_URL;
    url = (await prompt(`API URL [${def}]: `)) || def;
  }
  url = url.replace(/\/+$/, "");

  let token = opts.token;
  if (token === undefined) {
    token = await prompt("Personal access token (msh_…): ");
  }
  if (!token) throw new CliError("No token provided. Aborting.");

  let workspace = opts.workspace;
  if (workspace === undefined) {
    const def = existing.MUSHER_WORKSPACE || "";
    const label = def ? ` [${def}]` : "";
    workspace = (await prompt(`Workspace (slug or id)${label}: `)) || def;
  }
  if (!workspace) {
    throw new CliError(
      "A workspace (slug or id) is required — this folder's board context.",
    );
  }

  // Validate the token (and URL) before writing anything.
  const me = await api<Me>("/api/auth/me", { apiUrl: url, token });

  writeLocalEnv({
    ...existing,
    MUSHER_API_URL: url,
    MUSHER_TOKEN: token,
    MUSHER_WORKSPACE: workspace,
  });

  stdout.write(
    `${pc.green("✓")} Wrote ${localEnvPath()} (mode 0600)\n` +
      `${pc.dim(`  workspace: ${workspace}  ·  as ${me.user.n} (${me.user.role}) at ${url}`)}\n`,
  );
}
