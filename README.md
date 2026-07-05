# musher-cli

A small command-line client for the **Cloud Musher** board API. It lets a
person — or an **AI agent** running headless — drive the board (tickets,
docs & decisions, workspaces) from the terminal by talking to the REST API with a
**personal access token (PAT)**. The CLI acts as that user and inherits their
role (viewer / editor / admin), so RBAC is enforced server-side.

This is a **local operator tool**. It is never deployed to a server.

## Requirements

- Node.js ≥ 20 (uses the global `fetch`)

## Install / build

```bash
npm install
npm run build      # tsc → dist/
node dist/index.js --help
```

Optionally link it so `musher` is on your PATH:

```bash
npm link           # then: musher --help
```

## Authentication — folder-local `.env`

The CLI's identity **and** workspace come from the folder you stand in. Each
workspace folder carries its own `./.env`; one shared `musher` binary aliases to
whichever folder you run it from. There is no ambient global identity.

Tokens are created in the web **Settings** panel (not the CLI). Once you have a
`msh_…` PAT, scaffold the folder:

```bash
musher init                        # prompts for API URL, token, workspace → writes ./.env (0600)
musher init --url http://localhost:3001 --token msh_xxx --workspace musher
musher init --force                # overwrite an existing ./.env
```

`init` validates the token against `/api/auth/me` **before** writing, refuses to
clobber an existing `./.env` without `--force`, and writes mode `0600`. Copy
[`.env.example`](.env.example) by hand if you prefer.

`./.env` holds three keys:

```dotenv
MUSHER_API_URL=http://localhost:3001
MUSHER_TOKEN=msh_…
MUSHER_WORKSPACE=musher            # workspace slug (recommended) or id
```

`musher login` also writes `./.env` (URL + token, preserving any workspace);
`musher logout` clears the token from `./.env`. **Neither writes**
`~/.musher/config.json` anymore.

The nearest `.env` is auto-loaded at startup — the CLI searches the current
directory then **walks up** to the first `.env` it finds, so subfolders inherit
their parent workspace folder's context. Real environment variables always win
over `.env` file values.

Run a command from a folder with no `.env` and no token and you get:

```
No .env or MUSHER_TOKEN in this folder — run 'musher init' here.
```

### Precedence

| What | Order (first wins) |
| --- | --- |
| **workspace** | `--workspace` flag → real `MUSHER_WORKSPACE` env → `.env` file → (error) |
| **token** | real `MUSHER_TOKEN` env → `.env` file → deprecated `~/.musher/config.json` (warns) |
| **apiUrl** | real `MUSHER_API_URL` env → `.env` file → deprecated global config (warns) → `http://localhost:3001` |

Every workspace-scoped command (`tickets ls/new`,
`docs ls/new/get/edit/accept/reject/supersede`) defaults its workspace from this chain, so no
`--workspace` flag is needed inside a configured folder:

```bash
cd my-workspace && musher tickets ls          # scoped to MUSHER_WORKSPACE from ./.env
MUSHER_TOKEN=msh_xxx MUSHER_WORKSPACE=musher musher tickets ls --json   # env-only, for CI
```

> **Workspace id vs slug:** the CLI forwards whatever you set (id or slug). The
> API resolves **slugs** everywhere; a workspace **id (UUID)** currently works
> only on some read paths (RBAC + a few `?workspace=` filters) — the ticket
> list filter and the create handlers are slug-only. **Use the slug** (e.g.
> `musher`) for reliable end-to-end behavior today.

> **Deprecated:** `~/.musher/config.json` is now a **read-only** fallback and
> emits a one-line deprecation warning when used. It is scheduled for removal
> next release — migrate to `./.env` via `musher init`.

## Commands

Every read command accepts `--json` for raw, agent-friendly output.

| Command | Description |
| --- | --- |
| `musher init [--url] [--token] [--workspace] [--force]` | Scaffold `./.env` for this folder |
| `musher login [--url] [--token]` | Authenticate → writes `./.env` |
| `musher logout` | Clear the token from `./.env` |
| `musher whoami [--json]` | Show the authenticated user |
| `musher tickets ls [--workspace <slug>] [--lane <lane>] [--json]` | List tickets |
| `musher tickets get <id> [--json]` | Show a ticket incl. body |
| `musher tickets new --title <t> [--workspace <slug>] [--type] [--prio] [--epic] [--agents a,b] [--body <md>] [--json]` | Create a ticket |
| `musher tickets edit <id> [--title] [--prio] [--type] [--epic] [--agents] [--body]` | Edit provided fields |
| `musher tickets move <id> <lane> [--evidence <text>]` | Transition a ticket |
| `musher tickets rm <id> [--yes]` | Delete a ticket (admin) |
| `musher tickets comment <id> <body…>` | Add a comment |
| `musher tickets comments <id> [--json]` | List comments |
| `musher docs ls [--workspace <slug>] [--kind <kind>] [--json]` | List documents (filter by `--kind decision`) |
| `musher docs get <ref> [--workspace <slug>] [--json]` | Show a document/decision (by ref, id, or path) |
| `musher docs new --title <t> [--group <g>] [--kind <kind>] [--workspace <slug>] [--body <md>]` | Create a document (or a decision with `--kind decision`) |
| `musher docs edit <id> [--title] [--group] [--workspace] [--body]` | Edit provided fields |
| `musher docs accept <ref> [--workspace <slug>]` | Accept a decision → active (admin) |
| `musher docs reject <ref> [--workspace <slug>]` | Reject a decision → deprecated (admin) |
| `musher docs supersede <ref> --by <ref2> [--workspace <slug>]` | Supersede a decision (admin) |
| `musher workspaces ls [--json]` | List workspaces |
| `musher users ls [--json]` | List users |

Global: `musher --version`, `musher --help`, `musher <group> --help`.

## Errors

Failures print a friendly message and exit non-zero:

- **no token in folder** → `No .env or MUSHER_TOKEN in this folder — run 'musher init' here.`
- **401** → `Not authenticated. Run \`musher init\` here (or set MUSHER_TOKEN).`
- **403** → `Permission denied — your role (<role>) can't do that.`
- network error → `Can't reach the Musher API at <url>. Is it running?`

`.env` holds a real PAT — it is gitignored (only `.env.example` is committed) and
written mode `0600`. Never commit or print it.
