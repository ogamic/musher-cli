import { api } from "../client.js";
import { json, dim } from "../format.js";

interface Me {
  user: { n: string; em: string; role: string };
  permissions: string[];
}

export async function whoami(opts: { json?: boolean }) {
  const me = await api<Me>("/api/auth/me");
  if (opts.json) {
    json(me);
    return;
  }
  const { n, em, role } = me.user;
  process.stdout.write(`${n} ${dim("·")} ${em} ${dim("·")} ${role}\n`);
}
