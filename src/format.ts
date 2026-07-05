import pc from "picocolors";

export function json(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function pad(id: number | string, width = 4): string {
  return String(id).padStart(width, "0");
}

/** Render a simple aligned table. `rows` are already-stringified cells. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd();
  const out: string[] = [];
  out.push(pc.bold(line(headers)));
  out.push(pc.dim(widths.map((w) => "─".repeat(w)).join("  ")));
  for (const r of rows) out.push(line(r));
  return out.join("\n");
}

const PRIO_COLOR: Record<string, (s: string) => string> = {
  high: pc.red,
  med: pc.yellow,
  medium: pc.yellow,
  low: pc.dim,
};

export function colorPrio(prio: string | undefined): string {
  if (!prio) return "";
  return (PRIO_COLOR[prio] ?? ((s: string) => s))(prio);
}

export function truncate(s: string | undefined, max = 60): string {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

export function heading(s: string): string {
  return pc.bold(s);
}

export function dim(s: string): string {
  return pc.dim(s);
}
