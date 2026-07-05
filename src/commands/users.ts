import { stdout } from "node:process";
import { api } from "../client.js";
import { json, table, dim } from "../format.js";

interface User {
  id: string;
  n: string;
  em: string;
  role: string;
  active?: boolean;
  seen?: string;
}

export async function ls(opts: { json?: boolean }) {
  const list = await api<User[]>("/api/users");
  if (opts.json) {
    json(list);
    return;
  }
  if (list.length === 0) {
    stdout.write(dim("No users.\n"));
    return;
  }
  const rows = list.map((u) => [
    u.n ?? "",
    u.em ?? "",
    u.role ?? "",
    u.seen ?? "",
  ]);
  stdout.write(table(["NAME", "EMAIL", "ROLE", "SEEN"], rows) + "\n");
}
