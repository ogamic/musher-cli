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

export async function ls(opts: {
  json?: boolean;
  workspace?: string;
  kind?: string;
  search?: string;
}) {
  const ws = resolveWorkspace(opts.workspace);
  const params = new URLSearchParams();
  if (ws) params.set("workspace", ws);
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.search) {
    params.set("q", opts.search); // free-text server-side FTS (API `q`)
    // A content search means "find anything" — override the list's legacy
    // default (`kind != decision`) so governance decisions aren't silently
    // omitted. Mirrors the web (`includeKinds=all`). An explicit `--kind`
    // still wins: it's a narrower scope the user asked for.
    if (!opts.kind) params.set("includeKinds", "all");
  }
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
  path?: string;
  collection?: string;
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
  // Folder-style path (e.g. api/documents/coding-conventions.md) keeps identical
  // filenames across sub-projects from colliding on the globally-unique path;
  // the API derives a title-slug only when it's absent.
  if (opts.path) payload.path = opts.path;
  // File the new doc into a collection by slug (#0037). The API accepts a
  // `collection` slug on create and resolves it to the collectionId.
  if (opts.collection) payload.collection = opts.collection;
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
    kind?: string;
    path?: string;
    collection?: string;
    json?: boolean;
  },
) {
  // The API resolves the workspace from the document id, so `--workspace` is
  // accepted for surface parity but not sent in the PATCH body.
  const payload: Record<string, unknown> = {};
  if (opts.title !== undefined) payload.title = opts.title;
  if (opts.group !== undefined) payload.group = opts.group;
  if (opts.kind !== undefined) payload.kind = opts.kind;
  if (opts.path !== undefined) payload.path = opts.path;
  if (opts.body !== undefined) payload.body_md = opts.body;
  // Re-file (or unfile) into a collection by slug (#0037). `--collection ""`
  // arrives as an empty string, which the API treats as "unfile" (collectionId
  // → null); a non-empty slug files it there. `undefined` (flag absent) is left
  // untouched so an edit never silently unfiles.
  if (opts.collection !== undefined) payload.collection = opts.collection;
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

// ─── collections (document taxonomy folders, #0037) ─────────────────────────
// A collection is a workspace's document folder — the taxonomy the new
// Documents UI groups by. Mirrors the API row shape verbatim (the contract):
// GET /api/collections returns these fields directly (unpaginated).

interface Collection {
  /** UUID primary key. */
  id: string;
  slug: string;
  name: string;
  position: number;
  /** UUID of the owning workspace, or null for a global (cross-ws) collection. */
  workspaceId: string | null;
}

/** Parse a `--position` flag to a number, rejecting non-numeric input early. */
function parsePosition(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new CliError(`--position must be a number, got '${v}'.`);
  return n;
}

/**
 * Resolve a collection reference (slug or uuid) to its uuid via the GET list —
 * PATCH /api/collections/:id keys on the uuid, but users think in slugs. A ref
 * that matches neither is a friendly "not found" rather than a raw 404.
 */
async function resolveCollectionId(ref: string, workspace?: string): Promise<string> {
  const ws = resolveWorkspace(workspace);
  const q = ws ? `?workspace=${encodeURIComponent(ws)}` : "";
  const list = await api<Collection[]>(`/api/collections${q}`);
  const match = list.find((c) => c.slug === ref || c.id === ref);
  if (!match)
    throw new CliError(
      `No collection '${ref}'${ws ? ` in workspace ${ws}` : ""}.`,
    );
  return match.id;
}

export async function collectionsLs(opts: { json?: boolean; workspace?: string }) {
  const ws = resolveWorkspace(opts.workspace);
  const q = ws ? `?workspace=${encodeURIComponent(ws)}` : "";
  const list = await api<Collection[]>(`/api/collections${q}`);
  if (opts.json) {
    json(list);
    return;
  }
  if (list.length === 0) {
    stdout.write(dim("No collections.\n"));
    return;
  }
  const rows = list.map((c) => [c.slug, truncate(c.name, 45), String(c.position)]);
  stdout.write(table(["SLUG", "NAME", "POSITION"], rows) + "\n");
}

export async function collectionsNew(opts: {
  name?: string;
  slug?: string;
  position?: string;
  workspace?: string;
  json?: boolean;
}) {
  if (!opts.name) throw new CliError("--name is required.");
  const ws = resolveWorkspace(opts.workspace);
  if (!ws)
    throw new CliError(
      "No workspace — pass --workspace, set MUSHER_WORKSPACE, or run 'musher init'.",
    );
  const payload: Record<string, unknown> = { workspace: ws, name: opts.name };
  // slug is optional — the API derives one from the name when absent.
  if (opts.slug) payload.slug = opts.slug;
  const position = parsePosition(opts.position);
  if (position !== undefined) payload.position = position;
  const c = await api<Collection>("/api/collections", {
    method: "POST",
    body: payload,
  });
  if (opts.json) {
    json(c);
    return;
  }
  stdout.write(`Created collection ${c.slug} — ${c.name}\n`);
}

export async function collectionsRename(
  ref: string,
  opts: {
    name?: string;
    slug?: string;
    position?: string;
    workspace?: string;
    json?: boolean;
  },
) {
  const payload: Record<string, unknown> = {};
  if (opts.name !== undefined) payload.name = opts.name;
  if (opts.slug !== undefined) payload.slug = opts.slug;
  const position = parsePosition(opts.position);
  if (position !== undefined) payload.position = position;
  if (Object.keys(payload).length === 0) {
    throw new CliError(
      "Nothing to update — pass --name, --slug, or --position.",
    );
  }
  // Resolve slug→uuid first (PATCH keys on the uuid).
  const id = await resolveCollectionId(ref, opts.workspace);
  const c = await api<Collection>(`/api/collections/${id}`, {
    method: "PATCH",
    body: payload,
  });
  if (opts.json) {
    json(c);
    return;
  }
  stdout.write(`Updated collection ${c.slug} — ${c.name}\n`);
}
