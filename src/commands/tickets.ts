import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { api, apiPage, CliError, resolveWorkspace } from "../client.js";
import {
  json,
  pad,
  table,
  colorPrio,
  truncate,
  heading,
  dim,
} from "../format.js";

interface Ticket {
  /** UUID primary key. */
  id: string;
  /** Human-facing ticket number (the `#1005`). */
  number: number;
  t: string;
  workspace?: string;
  type?: string;
  lane?: string;
  prio?: string;
  epic?: string;
  agents?: string[];
  wait?: string;
  wip?: boolean;
  /** UUID of the owning workspace. */
  workspaceId?: string;
  body_md?: string;
}

interface Comment {
  id: number;
  ticketId: string;
  author: { name: string };
  body_md: string;
  createdAt: string;
}

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(/^y(es)?$/i.test(a.trim()));
    }),
  );
}

function splitList(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function ls(opts: {
  workspace?: string;
  search?: string;
  epic?: string;
  type?: string;
  agent?: string;
  prio?: string;
  lane?: string;
  limit?: string;
  offset?: string;
  json?: boolean;
}) {
  // `--workspace` is the scope flag; falls back to MUSHER_WORKSPACE
  // (real env or `./.env`) when no flag is given. Every other flag maps to a
  // server-side `/api/tickets` query param — nothing is filtered client-side,
  // so pagination and totals stay honest.
  const scope = resolveWorkspace(opts.workspace);
  const params = new URLSearchParams();
  if (scope) params.set("workspace", scope);
  if (opts.search) params.set("q", opts.search); // free-text (API `q`)
  if (opts.epic) params.set("epic", opts.epic);
  if (opts.type) params.set("type", opts.type);
  if (opts.agent) params.set("agent", opts.agent);
  if (opts.prio) params.set("priority", opts.prio);
  if (opts.lane) params.set("state", opts.lane); // lane → server-side `state`
  if (opts.limit) params.set("limit", opts.limit);
  if (opts.offset) params.set("offset", opts.offset);
  const qs = params.toString();
  const { data: tickets, meta } = await apiPage<Ticket>(
    `/api/tickets${qs ? `?${qs}` : ""}`,
  );

  if (opts.json) {
    json(tickets);
    return;
  }
  if (tickets.length === 0) {
    stdout.write(dim("No tickets.\n"));
    return;
  }
  const rows = tickets.map((t) => [
    `#${pad(t.number)}`,
    t.lane ?? "",
    colorPrio(t.prio),
    truncate(t.t, 50),
    t.workspace ?? "",
  ]);
  stdout.write(
    table(["ID", "LANE", "PRIO", "TITLE", "WORKSPACE"], rows) + "\n",
  );

  // Surface truncation so it is never silent: if the server holds more rows
  // than this page shows (accounting for offset), point at --limit/--offset.
  if (meta && meta.total > meta.offset + tickets.length) {
    const range = meta.offset > 0
      ? `${meta.offset + 1}-${meta.offset + tickets.length}`
      : `${tickets.length}`;
    stdout.write(
      dim(
        `showing ${range} of ${meta.total} — use --limit/--offset to page\n`,
      ),
    );
  }
}

/** Most recent comments shown inline by `tickets get`; older ones are elided. */
const INLINE_COMMENT_CAP = 5;

/**
 * Render a comment thread into lines. When `cap` is set, only the last `cap`
 * comments are shown (they are newest-last), preceded by a hint pointing at
 * `tickets comments` for the elided remainder.
 */
function renderComments(list: Comment[], id: string, cap?: number): string[] {
  const out: string[] = [];
  out.push(heading(`Comments (${list.length})`));
  if (list.length === 0) {
    out.push(dim("No comments."));
    return out;
  }
  let shown = list;
  if (cap !== undefined && list.length > cap) {
    const hidden = list.length - cap;
    shown = list.slice(-cap);
    out.push(
      dim(`…${hidden} more (use \`tickets comments ${id}\`)`),
    );
  }
  out.push("");
  for (const c of shown) {
    const when = new Date(c.createdAt).toLocaleString();
    out.push(`${heading(c.author.name)} ${dim(`· ${when}`)}`);
    out.push(c.body_md);
    out.push("");
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

export async function get(
  id: string,
  opts: { json?: boolean; comments?: boolean },
) {
  // Commander sets `comments: false` when `--no-comments` is passed; default true.
  const showComments = opts.comments !== false;
  const t = await api<Ticket>(`/api/tickets/${id}`);
  if (opts.json) {
    json(t);
    return;
  }
  const lines: string[] = [];
  lines.push(`${heading(`#${pad(t.number)}`)}  ${t.t}  ${dim(t.id)}`);
  const meta: string[] = [];
  if (t.workspace) meta.push(`workspace: ${t.workspace}`);
  if (t.type) meta.push(`type: ${t.type}`);
  if (t.lane) meta.push(`lane: ${t.lane}`);
  if (t.prio) meta.push(`prio: ${colorPrio(t.prio)}`);
  if (t.epic) meta.push(`epic: ${t.epic}`);
  if (t.agents?.length) meta.push(`agents: ${t.agents.join(", ")}`);
  if (t.wait) meta.push(`wait: ${t.wait}`);
  lines.push(dim(meta.join("  ·  ")));
  if (t.body_md) {
    lines.push("");
    lines.push(t.body_md);
  }
  if (showComments) {
    // Use the ticket's UUID for the comments endpoint; it accepts either, but
    // the number is what the user typed — reuse the same id they passed.
    const list = await api<Comment[]>(`/api/tickets/${id}/comments`);
    lines.push("");
    lines.push(...renderComments(list, id, INLINE_COMMENT_CAP));
  }
  stdout.write(lines.join("\n") + "\n");
}

export async function create(opts: {
  title?: string;
  workspace?: string;
  type?: string;
  prio?: string;
  lane?: string;
  epic?: string;
  agents?: string;
  body?: string;
  json?: boolean;
}) {
  if (!opts.title) throw new CliError("--title is required.");
  // `--workspace` is the scope flag; falls back to MUSHER_WORKSPACE
  // (real env or `./.env`).
  const scope = resolveWorkspace(opts.workspace);
  if (!scope)
    throw new CliError(
      "No workspace — pass --workspace, set MUSHER_WORKSPACE, or run 'musher init'.",
    );
  const payload: Record<string, unknown> = {
    t: opts.title,
    workspace: scope,
  };
  if (opts.type) payload.type = opts.type;
  if (opts.prio) payload.prio = opts.prio;
  if (opts.lane) payload.lane = opts.lane;
  if (opts.epic) payload.epic = opts.epic;
  const agents = splitList(opts.agents);
  if (agents) payload.agents = agents;
  if (opts.body) payload.body_md = opts.body;

  const t = await api<Ticket>("/api/tickets", {
    method: "POST",
    body: payload,
  });
  if (opts.json) {
    json(t);
    return;
  }
  stdout.write(`Created ticket #${pad(t.number)} — ${t.t}\n`);
}

export async function edit(
  id: string,
  opts: {
    title?: string;
    prio?: string;
    type?: string;
    epic?: string;
    agents?: string;
    body?: string;
    json?: boolean;
  },
) {
  const payload: Record<string, unknown> = {};
  if (opts.title !== undefined) payload.t = opts.title;
  if (opts.prio !== undefined) payload.prio = opts.prio;
  if (opts.type !== undefined) payload.type = opts.type;
  if (opts.epic !== undefined) payload.epic = opts.epic;
  const agents = splitList(opts.agents);
  if (agents !== undefined) payload.agents = agents;
  if (opts.body !== undefined) payload.body_md = opts.body;

  if (Object.keys(payload).length === 0) {
    throw new CliError("Nothing to update — pass at least one field.");
  }
  const t = await api<Ticket>(`/api/tickets/${id}`, {
    method: "PATCH",
    body: payload,
  });
  if (opts.json) {
    json(t);
    return;
  }
  stdout.write(`Updated ticket #${pad(t.number)}\n`);
}

export async function move(
  id: string,
  lane: string,
  opts: { evidence?: string },
) {
  const body: Record<string, unknown> = { to: lane };
  if (opts.evidence) body.evidence = opts.evidence;
  const t = await api<Ticket>(`/api/tickets/${id}/transition`, {
    method: "POST",
    body,
  });
  stdout.write(`Moved ticket #${pad(t.number)} → ${t.lane}\n`);
}

export async function rm(id: string, opts: { yes?: boolean }) {
  if (!opts.yes) {
    const ok = await confirm(`Delete ticket #${id}? [y/N] `);
    if (!ok) {
      stdout.write("Aborted.\n");
      return;
    }
  }
  await api(`/api/tickets/${id}`, { method: "DELETE" });
  stdout.write(`Deleted ticket #${id}\n`);
}

export async function comment(id: string, bodyParts: string[]) {
  const body_md = bodyParts.join(" ").trim();
  if (!body_md) throw new CliError("Comment body is empty.");
  const c = await api<Comment>(`/api/tickets/${id}/comments`, {
    method: "POST",
    body: { body_md },
  });
  stdout.write(`Comment #${c.id} added to ticket #${id}\n`);
}

export async function comments(id: string, opts: { json?: boolean }) {
  const list = await api<Comment[]>(`/api/tickets/${id}/comments`);
  if (opts.json) {
    json(list);
    return;
  }
  stdout.write(renderComments(list, id).join("\n") + "\n");
}
