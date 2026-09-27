# @coronaaaaa/dsh-skill-manager

English | [中文](README.zh.md)

A **skill manager** for the DSH web GUI: browse every loaded skill grouped
**by workspace** (one group per registered workspace + one global group for
`~/.dsh/skills`, `~/.agents/skills`, custom directories and runtime/bundled
entries), each group subdivided by sub-source (`.dsh/skills` /
`.agents/skills` / `custom` / `bundled` / `runtime`). Manage the 4-state
lifecycle (`on` / `name-only` / `user-invocable-only` / `off`), edit
description / when-to-use / body, rename the directory + frontmatter
together, and delete into a recoverable trash.

Forked from `@linxin666/dsh-client-ui-skill-explorer`.

## What it does

- **Sidebar row** "Skill Manager" opens a native center-column page — a row
  in the shell's own panel list, beside Plugins, Schedule and the task
  board — with a tab bar and a back-to-chat control.
- **Skills tab**: skills grouped into one top-level **workspace group per
  registered workspace** (from `ctx.workspaceRegistry.list()`), plus a
  single **Global** group at the bottom that covers
  `~/.dsh/skills` / `~/.agents/skills` / `customSkillDirs` / bundled /
  runtime. Inside each workspace group, skills are subdivided by sub-source
  (`.dsh/skills`, `.agents/skills`). The active workspace carries a
  "current" tag. A search box filters by name or description (name hits
  first; Escape clears) and stacks with the workspace picker (All / one
  specific workspace / Global).
- **Per-row 4-state mode selector**: each row carries a dropdown for the
  canonical `invocation-mode`:
  - `on` — model sees name + description + body in context; appears in
    `/skills` menu.
  - `name-only` — model sees only the name in context (saves tokens);
    description and body hidden; still appears in `/skills` menu.
  - `user-invocable-only` (rendered as **user-only** in `/skills` menu) —
    invisible to the model; the user can still trigger it manually.
  - `off` — completely hidden; invoking returns an error.
- **Edit / Rename / Delete actions** on each row. Edit rewrites the
  description, when-to-use, body and (optionally) the mode in place. Rename
  moves the directory and synchronizes the frontmatter `name:` field in one
  atomic write. Delete moves the file into `.trash` (recoverable).
- **Create tab**: a form to create a new skill under one of four scopes —
  global `~/.dsh/skills`, global `~/.agents/skills`, the active
  workspace's `.dsh/skills`, or the active workspace's `.agents/skills` —
  with an initial mode selector.
- Data comes from a filesystem scan following the official
  dsh-skill-filesystem root conventions, merged with the `ctx.skills`
  registry (bundled / runtime entries). The plugin never changes the skill
  loading or injection semantics — it is a pure GUI management layer.

## Frontmatter contract

The canonical field is `invocation-mode` with four legal values:

```yaml
---
name: code-review
description: Reviews code changes for style and correctness.
invocation-mode: name-only      # canonical 4-state
disable-model-invocation: false  # mirrored from mode (legacy core reads this pair)
user-invocable: true             # mirrored from mode
---

# skill body…
```

| Mode                   | in-model-context | `/skills` menu | modelInvocable | userInvocable |
| ---------------------- | ---------------- | -------------- | -------------- | ------------- |
| `on`                   | name + desc + body | ✓            | true           | true          |
| `name-only`            | name only        | ✓              | true           | true          |
| `user-invocable-only`  | hidden           | ✓              | false          | true          |
| `off`                  | hidden           | ✗              | false          | false         |

Reads prefer `invocation-mode`; when absent, the legacy
`disable-model-invocation` / `user-invocable` pair is interpreted
backwards-compatibly (`{modelInvocable=true, userInvocable=true}` → `on`,
`{false, true}` → `user-invocable-only`, anything else → `off`). Writes
mirror the canonical mode to all three fields, so a SKILL.md written here
stays readable by any tool that only knows the legacy pair.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @coronaaaaa/dsh-skill-manager@latest
```

### From the repository (development)

```sh
git clone https://github.com/Coronaaaaa/dsh-skill-manager.git
cd dsh-skill-manager
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)
```

Restart `dsh web` after installing; the "Skill Manager" entry appears in
the sidebar.

## Routes

| Route                                | Method | Purpose                                                                  |
| ------------------------------------ | ------ | ------------------------------------------------------------------------ |
| `/api/dsh-skill-manager/list`        | GET    | Workspace-grouped skill list                                             |
| `/api/dsh-skill-manager/read`        | GET    | One skill's editable fields and body (`?name=&path=`)                    |
| `/api/dsh-skill-manager/set-mode`    | POST   | Set the canonical 4-state mode (`{ name, path, mode }`)                  |
| `/api/dsh-skill-manager/set-enabled` | POST   | Legacy on/off toggle; maps to `on` or `off`                              |
| `/api/dsh-skill-manager/create`      | POST   | Create a skill (`{ scope, name, description, whenToUse?, content, mode, cwd }`) |
| `/api/dsh-skill-manager/update`      | POST   | Edit an existing skill in place (can also flip the mode)                 |
| `/api/dsh-skill-manager/rename`      | POST   | Rename a skill (move the directory + rewrite the frontmatter `name:`)    |
| `/api/dsh-skill-manager/delete`      | POST   | Delete (move into .trash)                                                |
| `/api/dsh-skill-manager/health`      | GET    | Health probe                                                             |

`scope` for create accepts: `user-dsh`, `user-agents`, `project-dsh`,
`project-agents` (and the legacy `global` / `workspace` aliases for
backward compatibility with the explorer).

## Security model

- Every `/api/dsh-skill-manager/*` route is loopback-only by default (the
  shared plugin-family fence: loopback socket + Host header + browser
  same-origin markers): unpaired LAN clients get `403 forbidden:
  loopback-only` before any skill-file access. When `dsh-remote-web-ui` is
  also loaded, a live paired-device cookie is an additional allow path;
  unpaired and revoked devices stay 403. The skill manager does not depend
  on the remote plugin.
- Write routes accept the path displayed by the panel only as an identity
  claim; before mutating, a fresh filesystem scan must resolve the same
  skill name and exact path. Arbitrary paths and stale same-name fallbacks
  are rejected, so a disappeared project skill cannot redirect a pending
  action to a user or custom skill with the same name. The read route
  applies the same resolution, so it cannot be used to read an arbitrary
  path either.
- The edit route rewrites an existing SKILL.md in place and does not touch
  the skill name or location; it carries the current mode over, so an edit
  never silently re-enables a disabled skill. The rename route moves the
  directory; the create / update / set-mode / set-enabled / delete routes
  never move directories.
- Skill content is user-authored markdown; the create and update forms cap
  content at 64KB.
- The panel renders skill descriptions with text nodes only (no HTML
  injection).
- Scans follow symbolic links: symlinked skill directories and single `.md`
  links inside a skill root are listed as ordinary skills. Because a link
  expresses the user's intentional mount, the target is not constrained to
  fall inside a skill root; a symlink inside a project root (which may come
  from a cloned repository) is treated as part of that project, and a
  `SKILL.md` in its target directory is read and shown — this is the
  intended trust boundary. **Linked skills can be listed and their mode
  flipped (rewriting the target's own frontmatter), but cannot be deleted
  or renamed**: deletion would move the target's `SKILL.md` out of place,
  escaping the current skill root, so the delete button is hidden for
  linked skills and the delete route refuses them (400). For the same
  escape reason the rename route refuses linked skills too, and the panel
  hides the rename button for them. Edit is also refused for the same
  reason.

## Known limitations

- Workspace detection reads `ctx.workspaceRegistry.list()`; the active
  workspace is the first row in registry order (the registry keeps a
  canonical-cwd header index for live sessions, but it is not exposed
  synchronously through the listed APIs).
- Frontmatter parsing is a lightweight zero-dependency implementation
  (block scalars, booleans, input nested block); exotic YAML features are
  not supported — the official dsh-skill-filesystem provider remains the
  authoritative parser.
- Linked skills cannot be deleted or renamed (see the security model);
  mode flipping works normally on them (rewriting the target's
  `SKILL.md` frontmatter). Both directory and single-file links list
  normally; a single-file link (pointing at one `.md`) is replaced by a
  plain file during the atomic mode write — the link is not kept and the
  target file is left untouched.

## License

BSD-3-Clause.