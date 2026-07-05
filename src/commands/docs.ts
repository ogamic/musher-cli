import { stdout } from "node:process";
import { api, CliError, resolveWorkspace } from "../client.js";
import { json, table, heading, dim, truncate } from "../format.js";

interface Doc {
  id: number;
  group: string;
  title: string;
  path?: string;
  updated?: string;
  owner?: string;
  norm?: boolean;
  body_md?: string;
  related?: string[];
  // Decisions are documents (kind: "decision"); these DocDto fields carry the
  // governance state that used to live on DecisionDto.
  ref?: string;
  kind?: string;
  status?: string;
  supersededBy?: string | null;
  supersedes?: string[];
}

export async function ls(opts: { json?: boolean; workspace?: string; kind?: string }) {
  const ws = resolveWorkspace(opts.workspace);
  const params = new URLSearchParams();
  if (ws) params.set("workspace", ws);
  if (opts.kind) params.set("kind", opts.kind);
  const q = params.toString() ? `?${params.toString()}` : "";
  const list = await api<Doc[]>(`/api/documents${q}`);
  if (opts.json) {
    json(list);
    return;
  }
  if (list.length === 0) {
    stdout.write(dim("No documents.\n"));
    return;
  }
  const rows = list.map((d) => [
    d.ref ?? String(d.id),
    d.kind ?? "",
    d.status ?? "",
    d.group ?? "",
    truncate(d.title, 45),
    d.updated ?? "",
  ]);
  stdout.write(
    table(["REF", "KIND", "STATUS", "GROUP", "TITLE", "UPDATED"], rows) + "\n",
  );
}

export async function get(id: string, opts: { json?: boolean; workspace?: string }) {
  // Decisions resolve by their bare ref (e.g. "0004"), which is only unique
  // within a workspace, so forward `?workspace=` to disambiguate. A uuid/path
  // is globally unique and ignores the hint harmlessly.
  const ws = resolveWorkspace(opts.workspace);
  const q = ws ? `?workspace=${encodeURIComponent(ws)}` : "";
  const d = await api<Doc>(`/api/documents/${id}${q}`);
  if (opts.json) {
    json(d);
    return;
  }
  const lines: string[] = [];
  lines.push(`${heading(d.title)}`);
  const meta: string[] = [];
  meta.push(`id: ${d.id}`);
  if (d.ref) meta.push(`ref: ${d.ref}`);
  if (d.kind) meta.push(`kind: ${d.kind}`);
  if (d.status) meta.push(`status: ${d.status}`);
  meta.push(`group: ${d.group}`);
  if (d.path) meta.push(`path: ${d.path}`);
  if (d.owner) meta.push(`owner: ${d.owner}`);
  if (d.norm) meta.push("normative");
  if (d.supersededBy) meta.push(`superseded by: ${d.supersededBy}`);
  if (d.supersedes?.length) meta.push(`supersedes: ${d.supersedes.join(", ")}`);
  if (d.related?.length) meta.push(`related: ${d.related.join(", ")}`);
  lines.push(dim(meta.join("  ·  ")));
  if (d.body_md) {
    lines.push("");
    lines.push(d.body_md);
  }
  stdout.write(lines.join("\n") + "\n");
}

export async function create(opts: {
  title?: string;
  group?: string;
  body?: string;
  workspace?: string;
  kind?: string;
  json?: boolean;
}) {
  if (!opts.title) throw new CliError("--title is required.");
  const isDecision = opts.kind === "decision";
  // Decisions are grouped by the API (governance home), so `--group` is only
  // required for ordinary documents.
  if (!isDecision && !opts.group) throw new CliError("--group is required.");
  // The API requires a workspace on document creation.
  const ws = resolveWorkspace(opts.workspace);
  if (!ws)
    throw new CliError(
      "No workspace — pass --workspace, set MUSHER_WORKSPACE, or run 'musher init'.",
    );
  const payload: Record<string, unknown> = {
    title: opts.title,
    workspace: ws,
    body_md: opts.body ?? "",
  };
  if (opts.kind) payload.kind = opts.kind;
  if (!isDecision) payload.group = opts.group;
  const d = await api<Doc>("/api/documents", { method: "POST", body: payload });
  if (opts.json) {
    json(d);
    return;
  }
  const label = d.ref ? `${d.kind ?? "document"} ${d.ref}` : `document #${d.id}`;
  stdout.write(`Created ${label} — ${d.title}\n`);
}

export async function edit(
  id: string,
  opts: {
    title?: string;
    group?: string;
    body?: string;
    workspace?: string;
    json?: boolean;
  },
) {
  // The API resolves the workspace from the document id, so `--workspace` is
  // accepted for surface parity but not sent in the PATCH body.
  const payload: Record<string, unknown> = {};
  if (opts.title !== undefined) payload.title = opts.title;
  if (opts.group !== undefined) payload.group = opts.group;
  if (opts.body !== undefined) payload.body_md = opts.body;
  if (Object.keys(payload).length === 0) {
    throw new CliError("Nothing to update — pass at least one field.");
  }
  const d = await api<Doc>(`/api/documents/${id}`, {
    method: "PATCH",
    body: payload,
  });
  if (opts.json) {
    json(d);
    return;
  }
  stdout.write(`Updated document #${d.id}\n`);
}

/** Drive a governance transition on a document (admin-gated server-side). */
async function transition(
  ref: string,
  body: Record<string, unknown>,
  opts: { workspace?: string; json?: boolean },
): Promise<Doc> {
  const ws = resolveWorkspace(opts.workspace);
  const q = ws ? `?workspace=${encodeURIComponent(ws)}` : "";
  const d = await api<Doc>(`/api/documents/${ref}/transition${q}`, {
    method: "POST",
    body,
  });
  return d;
}

function reportTransition(d: Doc, opts: { json?: boolean }) {
  if (opts.json) {
    json(d);
    return;
  }
  stdout.write(`${d.ref ?? `#${d.id}`} → ${d.status}\n`);
}

export async function accept(ref: string, opts: { workspace?: string; json?: boolean }) {
  const d = await transition(ref, { status: "active" }, opts);
  reportTransition(d, opts);
}

export async function reject(ref: string, opts: { workspace?: string; json?: boolean }) {
  const d = await transition(ref, { status: "deprecated" }, opts);
  reportTransition(d, opts);
}

export async function supersede(
  ref: string,
  opts: { by?: string; workspace?: string; json?: boolean },
) {
  if (!opts.by)
    throw new CliError("--by <ref> is required (the superseding decision ref).");
  const d = await transition(
    ref,
    { status: "superseded", supersededBy: opts.by },
    opts,
  );
  reportTransition(d, opts);
}
