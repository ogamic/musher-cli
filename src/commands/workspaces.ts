import { stdout } from "node:process";
import { api } from "../client.js";
import { json, table, dim } from "../format.js";

interface Workspace {
  id: string;
  slug: string;
  name: string;
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
