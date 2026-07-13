import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { api, CliError } from "../client.js";
import { json, table, dim } from "../format.js";

interface Workspace {
  id: string;
  slug: string;
  name: string;
}

/** Counts returned by DELETE /api/workspaces/:slug (the contract). */
interface DeleteResult {
  tickets: number;
  documents: number;
  workspace: Workspace;
}

/**
 * Slugs the CLI will never delete — the real boards. Refused by the seatbelt
 * before any network call, even with --yes.
 */
const PROTECTED_SLUGS = new Set(["musher", "wander"]);

/** Prompt on stdin and resolve the trimmed answer. */
function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    }),
  );
}

export async function ls(opts: { json?: boolean }) {
  const list = await api<Workspace[]>("/api/workspaces");
  if (opts.json) {
    json(list);
    return;
  }
  if (list.length === 0) {
    stdout.write(dim("No workspaces.\n"));
    return;
  }
  const rows = list.map((w) => [w.slug, w.name, dim(w.id)]);
  stdout.write(table(["SLUG", "NAME", "ID"], rows) + "\n");
}

export async function create(opts: {
  slug?: string;
  name?: string;
  json?: boolean;
}) {
  if (!opts.slug) throw new CliError("--slug is required.");
  if (!opts.name) throw new CliError("--name is required.");
  const w = await api<Workspace>("/api/workspaces", {
    method: "POST",
    body: { slug: opts.slug, name: opts.name },
  });
  if (opts.json) {
    json(w);
    return;
  }
  stdout.write(`Created workspace ${w.slug} — ${w.name}  ${dim(w.id)}\n`);
}

export async function rm(
  slug: string,
  opts: { yes?: boolean; json?: boolean },
) {
  // Seatbelt: refuse the real boards before any network call, even with --yes.
  if (PROTECTED_SLUGS.has(slug)) {
    throw new CliError(
      `Refusing to delete protected workspace '${slug}' — this is a real board and cannot be deleted with the CLI.`,
    );
  }

  if (!opts.yes) {
    const answer = await ask(
      `Delete workspace ${slug} and ALL its tickets/docs? Type the slug to confirm: `,
    );
    if (answer !== slug) {
      stdout.write("Aborted.\n");
      return;
    }
  }

  const res = await api<DeleteResult>(`/api/workspaces/${slug}`, {
    method: "DELETE",
  });
  if (opts.json) {
    json(res);
    return;
  }
  stdout.write(
    `Deleted workspace ${slug} — ${res.tickets} ticket(s), ${res.documents} doc(s)\n`,
  );
}
