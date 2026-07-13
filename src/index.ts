#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { CliError } from "./client.js";
import { loadEnv } from "./env.js";
import { login, logout } from "./commands/login.js";
import { init } from "./commands/init.js";
import { whoami } from "./commands/whoami.js";
import * as tickets from "./commands/tickets.js";
import * as docs from "./commands/docs.js";
import * as workspaces from "./commands/workspaces.js";
import * as users from "./commands/users.js";

/** Wrap an async command action so errors print friendly + exit non-zero. */
function run(fn: (...args: any[]) => Promise<void> | void) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      const msg =
        err instanceof CliError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      process.stderr.write(`${pc.red("✗")} ${msg}\n`);
      process.exit(1);
    }
  };
}

// Folder-local model (#1027): load the nearest `.env` (cwd, walking up) into
// process.env before any command resolves a token / url / workspace. Real
// process.env always wins over `.env` file values.
loadEnv();

const program = new Command();

// Read the version from package.json at runtime so `--version` can never drift
// from the manifest (#0037). The compiled binary is `dist/index.js`, so
// package.json sits one level up (`dist/../package.json`); npm always ships
// package.json regardless of the `files` allowlist, so this resolves in both
// dev and a published install.
function readVersion(): string {
  try {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

program
  .name("musher")
  .description("Command-line client for the Cloud Musher board API.")
  .version(readVersion());

// auth
program
  .command("login")
  .description("Authenticate with a personal access token and save config")
  .option("--url <url>", "API base URL")
  .option("--token <token>", "personal access token (msh_…)")
  .action(run(login));

program
  .command("logout")
  .description("Remove the token from ./.env")
  .action(run(logout));

program
  .command("init")
  .description("Scaffold ./.env for this folder (api url, token, workspace)")
  .option("--url <url>", "API base URL")
  .option("--token <token>", "personal access token (msh_…)")
  .option("--workspace <slug>", "workspace slug or id for this folder")
  .option("--force", "overwrite an existing ./.env")
  .action(run(init));

program
  .command("whoami")
  .description("Show the authenticated user")
  .option("--json", "emit raw JSON")
  .action(run(whoami));

// tickets
const t = program.command("tickets").description("Manage tickets");
t.command("ls")
  .description("List tickets")
  .option("--workspace <slug>", "filter by workspace")
  .option("--search <q>", "free-text search over title + body")
  .option("--epic <name>", "filter by epic")
  .option("--type <type>", "filter by type")
  .option("--agent <name>", "filter by assigned agent")
  .option("--prio <prio>", "filter by priority")
  .option("--lane <lane>", "filter by lane (server-side state)")
  .option("--limit <n>", "max rows to return (server default 100, max 500)")
  .option("--offset <n>", "skip N rows (pagination)")
  .option("--json", "emit raw JSON")
  .action(run(tickets.ls));
t.command("get <id>")
  .description("Show a ticket incl. body and comment thread")
  .option("--no-comments", "hide the comment thread")
  .option("--json", "emit raw JSON")
  .action(run(tickets.get));
t.command("new")
  .description("Create a ticket")
  .requiredOption("--title <t>", "ticket title")
  .option("--workspace <slug>", "workspace slug")
  .option("--type <type>", "ticket type")
  .option("--prio <prio>", "priority")
  .option("--lane <lane>", "initial lane")
  .option("--epic <epic>", "epic")
  .option("--agents <a,b>", "comma-separated agents")
  .option("--body <md>", "body markdown")
  .option("--json", "emit raw JSON")
  .action(run(tickets.create));
t.command("edit <id>")
  .description("Edit a ticket (only provided fields)")
  .option("--title <t>", "title")
  .option("--prio <prio>", "priority")
  .option("--type <type>", "type")
  .option("--epic <epic>", "epic")
  .option("--agents <a,b>", "comma-separated agents")
  .option("--body <md>", "body markdown")
  .option("--json", "emit raw JSON")
  .action(run(tickets.edit));
t.command("move <id> <lane>")
  .description("Transition a ticket to a lane")
  .option("--evidence <text>", "evidence (required to move to done)")
  .action(run(tickets.move));
t.command("rm <id>")
  .description("Delete a ticket (admin)")
  .option("--yes", "skip confirmation")
  .action(run(tickets.rm));
t.command("comment <id> <body...>")
  .description("Add a comment to a ticket")
  .action(run(tickets.comment));
t.command("comments <id>")
  .description("List comments on a ticket")
  .option("--json", "emit raw JSON")
  .action(run(tickets.comments));

// docs (decisions are documents with kind: "decision")
const doc = program.command("docs").description("Manage documents & decisions");
doc
  .command("ls")
  .description("List documents")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--kind <kind>", "filter by kind (e.g. decision)")
  .option("--search <q>", "free-text search over title + body")
  .option("--json", "emit raw JSON")
  .action(run(docs.ls));
doc
  .command("get <ref>")
  .description("Show a document or decision (by ref, id, or path)")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--json", "emit raw JSON")
  .action(run(docs.get));
doc
  .command("new")
  .description("Create a document or decision")
  .requiredOption("--title <t>", "title")
  .option("--group <group>", "group (required unless --kind decision)")
  .option("--kind <kind>", "document kind (e.g. decision)")
  .option("--path <path>", "folder-style path (e.g. api/documents/foo.md)")
  .option("--collection <slug>", "file into a collection by slug")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--body <md>", "body markdown")
  .option("--json", "emit raw JSON")
  .action(run(docs.create));
doc
  .command("edit <id>")
  .description("Edit a document (only provided fields)")
  .option("--title <t>", "title")
  .option("--group <group>", "group")
  .option("--kind <kind>", "document kind (e.g. decision)")
  .option("--path <path>", "folder-style path (e.g. api/documents/foo.md)")
  .option(
    "--collection <slug>",
    'refile into a collection by slug (use --collection "" to unfile)',
  )
  .option("--workspace <slug>", "workspace slug or id")
  .option("--body <md>", "body markdown")
  .option("--json", "emit raw JSON")
  .action(run(docs.edit));
doc
  .command("accept <ref>")
  .description("Accept a decision → active (admin)")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--json", "emit raw JSON")
  .action(run(docs.accept));
doc
  .command("reject <ref>")
  .description("Reject a decision → deprecated (admin)")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--json", "emit raw JSON")
  .action(run(docs.reject));
doc
  .command("supersede <ref>")
  .description("Supersede a decision with another → superseded (admin)")
  .requiredOption("--by <ref>", "superseding decision ref")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--json", "emit raw JSON")
  .action(run(docs.supersede));

// docs collections (document taxonomy folders, #0037)
const col = doc
  .command("collections")
  .description("Manage document collections (taxonomy folders)");
col
  .command("ls")
  .description("List collections in a workspace")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--json", "emit raw JSON")
  .action(run(docs.collectionsLs));
col
  .command("new")
  .description("Create a collection")
  .requiredOption("--name <name>", "collection name")
  .option("--slug <slug>", "slug (derived from name if omitted)")
  .option("--position <n>", "sort position")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--json", "emit raw JSON")
  .action(run(docs.collectionsNew));
col
  .command("rename <ref>")
  .description("Rename/reslug/reposition a collection (by slug or id)")
  .option("--name <name>", "new name")
  .option("--slug <slug>", "new slug")
  .option("--position <n>", "new sort position")
  .option("--workspace <slug>", "workspace slug or id")
  .option("--json", "emit raw JSON")
  .action(run(docs.collectionsRename));

// workspaces
const w = program.command("workspaces").description("Manage workspaces");
w.command("ls")
  .description("List workspaces")
  .option("--json", "emit raw JSON")
  .action(run(workspaces.ls));
w.command("new")
  .description("Create a workspace")
  .requiredOption("--slug <slug>", "workspace slug")
  .requiredOption("--name <name>", "workspace name")
  .option("--json", "emit raw JSON")
  .action(run(workspaces.create));
w.command("rm <slug>")
  .description("Delete a workspace and ALL its tickets/docs (admin)")
  .option("--yes", "skip the interactive confirm")
  .option("--json", "emit raw JSON")
  .action(run(workspaces.rm));

// users
const u = program.command("users").description("Manage users");
u.command("ls")
  .description("List users")
  .option("--json", "emit raw JSON")
  .action(run(users.ls));

program.parseAsync(process.argv);
