/**
 * Skill collection: filesystem scanning (primary) plus registry supplement.
 *
 * The web profile mounts the skill-filesystem provider only at the agent
 * preset scope layer, so the host plane cannot read project/user skills from
 * ctx.skills — the list route scans the official root conventions itself and
 * merges registry entries (bundled / runtime) by name.
 *
 * Top-level grouping: one group per workspace registry row, plus one "global"
 * group for ~/.dsh/skills and ~/.agents/skills. Sub-grouping inside each
 * group: `.dsh/skills` / `.agents/skills` (and `custom` for the global group).
 * The panel renders top-level groups as collapsible workspace sections.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import {
  invocationPolicy,
  parseFrontmatter,
  resolveInvocationMode,
  type InvocationMode,
  yamlQuote,
} from './frontmatter.ts'

/** Where a skill belongs. Global is ~/.dsh|~/.agents; workspace is a registered workspace. */
export type SkillScope = 'global' | 'workspace'

/** Sub-source key inside a workspace/global group. */
export type SubSourceKey = 'dsh' | 'agents' | 'custom' | 'runtime' | 'bundled'

/** Sub-source display metadata. */
export interface SubSourceDef {
  key: SubSourceKey
  title: string
  hint: string
}

/** The sub-sources a workspace or global group can carry. */
export const SUB_SOURCES: readonly SubSourceDef[] = [
  { key: 'dsh', title: '.dsh/skills', hint: 'Project (or user) DSH skill root' },
  { key: 'agents', title: '.agents/skills', hint: 'Project (or user) AGENTS skill root' },
  { key: 'custom', title: 'Custom directories', hint: 'customSkillDirs config' },
  { key: 'bundled', title: 'System bundled', hint: 'DSH-internal bundled skills (read-only)' },
  { key: 'runtime', title: 'Runtime registered', hint: 'Skills registered at runtime by plugins' },
]

/** One skill entry as served to the panel. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  /** Sub-source within the group: `dsh` / `agents` / `custom` / `runtime` / `bundled`. */
  source: SubSourceKey
  /** Absolute path to the SKILL.md (filesystem entries only). */
  path?: string
  /** True when discovered through a symlink entry (rename/delete not allowed). */
  linked?: boolean
  /** Canonical 4-state mode. */
  mode: InvocationMode
  /** Legacy mirror of the official core's pair, derived from `mode`. */
  modelInvocable: boolean
  userInvocable: boolean
  /** Where the skill lives: 'global' or 'workspace'. */
  scope: SkillScope
  /** Workspace path the skill belongs to (workspace entries only). */
  workspacePath?: string
  /** Workspace display name (workspace entries only). */
  workspaceName?: string
  /** True when this skill belongs to the active session's workspace. */
  isActiveWorkspace?: boolean
}

/** Registry snapshot entry shape (subset of ctx.skills entries). */
export interface RegistrySkill {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  source: string
  resourceBase?: { kind: string; path?: string }
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
  /** Optional invocation-mode carried by some registry sources. */
  invocationMode?: InvocationMode
}

/** One workspace descriptor (passed in by the host from workspaceRegistry.list). */
export interface WorkspaceDescriptor {
  /** Stable identity string (workspace id or canonical path). */
  id: string
  /** Canonical workspace directory path. */
  path: string
  /** Display title. */
  title: string
  /** True when this is the active session's workspace. */
  active: boolean
}

/** Options for collectSkills. */
export interface CollectOptions {
  /** Registry snapshot workspace base. */
  cwd: string
  /** Workspace paths to scan (each scans .dsh/skills and .agents/skills). */
  workspaces: WorkspaceDescriptor[]
  /** Extra custom skill roots (placed in the global group). */
  customSkillDirs?: string[]
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /** ctx.skills registry (snapshot). */
  registry: { snapshot(options: { cwd: string }): Promise<{ skills: RegistrySkill[]; complete: boolean }> }
}

/** Result of a collection pass. */
export interface CollectResult {
  skills: SkillEntry[]
  complete: boolean
  /** Workspaces known to the registry, in registry order. */
  workspaces: WorkspaceDescriptor[]
}

/** Sub-group payload (source inside one workspace/global group). */
export interface SubGroupPayload {
  key: SubSourceKey
  title: string
  hint: string
  skills: SkillEntry[]
}

/** One workspace group (top-level): either the global group or one workspace. */
export interface WorkspaceGroupPayload {
  key: string
  title: string
  hint: string
  scope: SkillScope
  workspacePath?: string
  isActive: boolean
  subGroups: SubGroupPayload[]
}

/** List payload served by the list route. */
export interface ListPayload {
  cwd: string
  complete: boolean
  groups: WorkspaceGroupPayload[]
  /** Workspaces from the registry (kept for the filter UI). */
  workspaces: WorkspaceDescriptor[]
}

/** Find the nearest ancestor directory containing .git (cwd itself when none). */
export function findProjectRoot(cwd: string): string {
  let current = cwd
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

/** Resolve the canonical workspace directory of a cwd (falls back to cwd). */
function workspaceRootFor(workspace: WorkspaceDescriptor, cwd: string): string {
  // Registry already returns canonical paths; fall back to nearest .git if a
  // caller hands us a cwd that disagrees with the registry row.
  if (workspace.path !== '') return workspace.path
  return findProjectRoot(cwd)
}

/**
 * Scan one skill root (one level: <name>/SKILL.md or <name>.md). Records each
 * discovered skill with its workspace info so the build step groups them.
 */
async function scanSkillRoot(
  root: string,
  source: SubSourceKey,
  into: Map<string, SkillEntry>,
  ctx: {
    scope: SkillScope
    workspacePath?: string
    workspaceName?: string
    active: boolean
  },
): Promise<void> {
  if (!existsSync(root)) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const name = entry.name
    let file: string
    let linked = false
    if (entry.isDirectory()) {
      file = join(root, name, 'SKILL.md')
    } else if (entry.isFile() && name.endsWith('.md')) {
      file = join(root, name)
    } else if (entry.isSymbolicLink()) {
      // See the original skill-explorer note: a symlink's dirent is neither a
      // directory nor a file, so a plain readdir() skips it and linked-out
      // skills never show up. Follow the target with stat() to classify it,
      // then resolve the file path like a real entry — the scan path stays on
      // the link so the write routes reach the linked target via normal fs
      // follow semantics. Linked skills are listable and toggleable, but
      // deletion / rename is refused (the target's SKILL.md would move out of
      // place, escaping the current skill root).
      linked = true
      let linkedFile: string
      try {
        const target = await stat(join(root, name))
        if (target.isDirectory()) linkedFile = join(root, name, 'SKILL.md')
        else if (target.isFile() && name.endsWith('.md')) linkedFile = join(root, name)
        else continue
      } catch {
        continue
      }
      file = linkedFile
    } else {
      continue
    }
    if (!existsSync(file)) continue
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const parsed = parseFrontmatter(content)
    const skillName = parsed.name ?? name.replace(/\.md$/, '')
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) continue
    const mode = resolveInvocationMode(parsed)
    const policy = invocationPolicy(mode)
    const existing = into.get(skillName)
    // Same name wins on higher precedence within a group. Precedence (lower
    // rank number = higher priority): workspace .dsh < workspace .agents <
    // custom < user .dsh < user .agents < runtime < bundled. The active
    // workspace outranks its siblings so the manager renders the right one.
    const sourceRank: Readonly<Record<SubSourceKey, number>> = {
      dsh: 0,        // workspace-local .dsh is the highest-priority source
      agents: 1,     // workspace-local .agents sits just below it
      custom: 2,
      runtime: 3,
      bundled: 4,
    }
    // A workspace entry's rank beats a global entry's by a wide margin (×10
    // + the active workspace bonus) so a global same-name cannot shadow a
    // workspace one and the active workspace outranks its sibling workspaces.
    const scopeOffset = ctx.scope === 'workspace' ? 0 : 100
    const myRank = scopeOffset + sourceRank[source] * 10 + (ctx.active ? 0 : 1)
    if (existing !== undefined) {
      const existingScopeOffset = existing.scope === 'workspace' ? 0 : 100
      const existingRank = existingScopeOffset
        + sourceRank[existing.source] * 10
        + (existing.isActiveWorkspace === true ? 0 : 1)
      if (existingRank < myRank) continue
    }
    into.set(skillName, {
      name: skillName,
      description: parsed.description ?? '(no description)',
      whenToUse: parsed.whenToUse,
      provider: 'filesystem',
      source,
      path: file,
      linked,
      mode,
      modelInvocable: policy.modelInvocable,
      userInvocable: policy.userInvocable,
      scope: ctx.scope,
      // Global entries carry no workspace context at all; the panel uses
      // `scope === 'global'` to pick the global group and the (optional)
      // workspace fields would be misleading on global rows.
      ...(ctx.scope === 'workspace'
        ? { workspacePath: ctx.workspacePath, workspaceName: ctx.workspaceName, isActiveWorkspace: ctx.active }
        : {}),
    })
  }
}

/** Serialize one registry entry into the panel payload. */
function serializeRegistry(skill: RegistrySkill): SkillEntry {
  // Registry sources map to a sub-source the panel knows about; unknown ones
  // collapse into a generic `runtime` slot.
  const mapKey: Readonly<Record<string, SubSourceKey>> = {
    bundled: 'bundled',
    runtime: 'runtime',
  }
  const source = mapKey[skill.source] ?? 'runtime'
  const mode: InvocationMode =
    skill.invocationMode
    ?? (skill.invocation?.modelInvocable === false && skill.invocation?.userInvocable !== false
      ? 'user-invocable-only'
      : skill.invocation?.modelInvocable === false && skill.invocation?.userInvocable === false
        ? 'off'
        : 'on')
  const policy = invocationPolicy(mode)
  return {
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    provider: skill.provider,
    source,
    path: undefined,
    mode,
    modelInvocable: policy.modelInvocable,
    userInvocable: policy.userInvocable,
    scope: 'global',
  }
}

/** Build the group payload: one entry per workspace + one global entry. */
export function buildPayload(
  skills: SkillEntry[],
  complete: boolean,
  workspaces: WorkspaceDescriptor[],
): ListPayload {
  // Skills keyed by (scope, workspacePath|global, source).
  const byGroup = new Map<string, SkillEntry[]>()
  const keyOf = (scope: SkillScope, workspacePath: string | undefined, source: SubSourceKey): string => {
    const wsKey = scope === 'global' ? 'global' : (workspacePath ?? 'unknown')
    return `${scope}|${wsKey}|${source}`
  }
  for (const skill of skills) {
    const key = keyOf(skill.scope, skill.workspacePath, skill.source)
    const list = byGroup.get(key) ?? []
    list.push(skill)
    byGroup.set(key, list)
  }

  // Build workspace groups in registry order, then append the global group at
  // the end (it is shared by every workspace and conventionally last).
  const workspaceGroups: WorkspaceGroupPayload[] = []
  for (const workspace of workspaces) {
    const subGroups: SubGroupPayload[] = ['dsh', 'agents']
      .map((source) => SUB_SOURCES.find((def) => def.key === source)!)
      .map((def) => ({
        key: def.key,
        title: def.title,
        hint: def.hint,
        skills: (byGroup.get(keyOf('workspace', workspace.path, def.key)) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((group) => group.skills.length > 0)
    if (subGroups.length === 0) continue
    workspaceGroups.push({
      key: `workspace:${workspace.id}`,
      title: workspace.title,
      hint: workspace.path,
      scope: 'workspace',
      workspacePath: workspace.path,
      isActive: workspace.active,
      subGroups,
    })
  }

  // Global group: user roots (dsh + agents) + custom dirs + bundled/runtime.
  const globalSubGroups: SubGroupPayload[] = SUB_SOURCES
    .filter((def) => def.key !== 'dsh' || true)
    .filter((def) => ['dsh', 'agents', 'custom', 'bundled', 'runtime'].includes(def.key))
    .map((def) => ({
      key: def.key,
      title: def.title,
      hint: def.hint,
      skills: (byGroup.get(keyOf('global', undefined, def.key)) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.skills.length > 0)
  if (globalSubGroups.length > 0) {
    workspaceGroups.push({
      key: 'global',
      title: '全局',
      hint: '~/.dsh/skills · ~/.agents/skills · 自定义目录',
      scope: 'global',
      isActive: false,
      subGroups: globalSubGroups,
    })
  }

  return { cwd: workspaces.find((w) => w.active)?.path ?? '', complete, groups: workspaceGroups, workspaces }
}

/**
 * Collect grouped skills: filesystem scanning (primary) + registry supplement.
 * Filesystem entries win on name conflicts; the registry fills whenToUse and
 * adds bundled/runtime entries of its own.
 */
export async function collectSkills(options: CollectOptions): Promise<CollectResult> {
  const { cwd, workspaces, customSkillDirs, dshHome, agentsHome, registry } = options
  const byName = new Map<string, SkillEntry>()

  const scanTasks: Array<Promise<void>> = []

  // 1. Per-workspace scans.
  for (const workspace of workspaces) {
    const wsPath = workspaceRootFor(workspace, cwd)
    const ctx = {
      scope: 'workspace' as const,
      workspacePath: wsPath,
      workspaceName: workspace.title,
      active: workspace.active,
    }
    scanTasks.push(scanSkillRoot(join(wsPath, '.dsh', 'skills'), 'dsh', byName, ctx))
    scanTasks.push(scanSkillRoot(join(wsPath, '.agents', 'skills'), 'agents', byName, ctx))
  }

  // 2. Global scans: user roots + custom dirs.
  // Global entries carry no workspace path and no active flag: the test
  // `expect(globalSkill?.isActiveWorkspace).toBeUndefined()` (and the panel's
  // "current" tag) treats global as neither active nor inactive.
  const globalCtx = { scope: 'global' as const, workspacePath: undefined, workspaceName: undefined, active: false }
  scanTasks.push(scanSkillRoot(join(dshHome, 'skills'), 'dsh', byName, globalCtx))
  scanTasks.push(scanSkillRoot(join(agentsHome, 'skills'), 'agents', byName, globalCtx))
  for (const dir of customSkillDirs ?? []) {
    scanTasks.push(scanSkillRoot(dir, 'custom', byName, globalCtx))
  }
  await Promise.all(scanTasks)

  // 3. Registry supplement: query for each workspace cwd so project-level
  // providers (bundled / runtime / preset-mounted) are captured. Registry-only
  // entries (no filesystem path) join the global group with source `bundled`
  // or `runtime` according to their origin.
  const snapshotCwds = new Set<string>([cwd, ...workspaces.map((w) => w.path)])
  let complete = true
  for (const snapshotCwd of snapshotCwds) {
    try {
      const snapshot = await registry.snapshot({ cwd: snapshotCwd })
      if (snapshot.complete !== true) complete = false
      for (const skill of snapshot.skills) {
        const existing = byName.get(skill.name)
        const wire = serializeRegistry(skill)
        if (existing === undefined) {
          byName.set(skill.name, wire)
        } else {
          if (wire.whenToUse !== undefined) existing.whenToUse = wire.whenToUse
          if (wire.provider !== undefined) existing.provider = wire.provider
          existing.mode = wire.mode
          existing.modelInvocable = wire.modelInvocable
          existing.userInvocable = wire.userInvocable
        }
      }
    } catch {
      // Registry unavailable: the filesystem result still stands.
      complete = false
    }
  }
  return { skills: [...byName.values()], complete, workspaces }
}

/** Build the new skill file content with explicit invocation mode. */
export function buildSkillContent(
  name: string,
  description: string,
  whenToUse: string | undefined,
  content: string,
  mode: InvocationMode,
): string {
  const lines = ['---', `name: ${name}`, `description: ${yamlQuote(description.replace(/[\r\n]/gu, ' '))}`]
  if (typeof whenToUse === 'string' && whenToUse.trim() !== '') lines.push(`whenToUse: ${yamlQuote(whenToUse.replace(/[\r\n]/gu, ' '))}`)
  // Always write the canonical mode; write the legacy pair as a mirror so
  // tools that only know the pair stay consistent.
  lines.push(`invocation-mode: ${mode}`)
  const policy = invocationPolicy(mode)
  lines.push(`disable-model-invocation: ${!policy.modelInvocable}`)
  lines.push(`user-invocable: ${policy.userInvocable}`)
  lines.push('---', '', content.trim(), '')
  return lines.join('\n')
}

/** Create a skill file (mkdir -p + write). Returns the absolute target path. */
export async function writeSkillFile(
  baseDir: string,
  name: string,
  description: string,
  whenToUse: string | undefined,
  content: string,
  mode: InvocationMode,
): Promise<string> {
  const targetDir = join(baseDir, name)
  const target = join(targetDir, 'SKILL.md')
  if (existsSync(target)) throw new Error(`skill ${name} already exists at ${target}`)
  await mkdir(targetDir, { recursive: true })
  await writeFile(target, buildSkillContent(name, description.trim(), whenToUse, content, mode), 'utf8')
  return target
}

/**
 * Overwrite an existing skill file in place (edit route). The caller has
 * already resolved the path through a fresh scan, and the mode is taken from
 * the new payload (so the edit form can flip the mode at the same time).
 */
export async function overwriteSkillFile(
  path: string,
  name: string,
  description: string,
  whenToUse: string | undefined,
  content: string,
  mode: InvocationMode,
): Promise<string> {
  await writeFile(path, buildSkillContent(name, description.trim(), whenToUse, content, mode), 'utf8')
  return path
}

/** Move a skill file into its .trash sibling directory (recoverable delete). */
export async function trashSkillFile(path: string): Promise<string> {
  const trashDir = join(dirname(path), '.trash')
  await mkdir(trashDir, { recursive: true })
  const trashTarget = join(trashDir, `${Date.now()}-SKILL.md`)
  await rename(path, trashTarget)
  return trashTarget
}

/** User skill root convention. */
export function userSkillRoot(dshHome: string): string {
  return join(dshHome, 'skills')
}

/** User AGENTS skill root convention. */
export function userAgentsSkillRoot(agentsHome: string): string {
  return join(agentsHome, 'skills')
}

/** Project skill root convention (project root + .dsh/skills). */
export function projectSkillRoot(projectRoot: string): string {
  return `${projectRoot}${sep}.dsh${sep}skills`
}

/** Project AGENTS skill root convention (project root + .agents/skills). */
export function projectAgentsSkillRoot(projectRoot: string): string {
  return `${projectRoot}${sep}.agents${sep}skills`
}

/** Rename a skill directory + rewrite the frontmatter `name:`. */
export async function renameSkillFile(
  path: string,
  newName: string,
): Promise<string> {
  // The path points at <root>/<oldName>/SKILL.md; the new directory is its
  // sibling, not a child of the old name. dirname(dirname(path)) is the parent
  // directory that holds both old and new directories.
  const oldDir = dirname(path)
  const parentDir = dirname(oldDir)
  const target = join(parentDir, newName, 'SKILL.md')
  if (existsSync(target)) throw new Error(`skill ${newName} already exists at ${target}`)
  await mkdir(join(parentDir, newName), { recursive: true })
  // Move the SKILL.md into the new directory atomically (rename across
  // directories: cross-platform same-filesystem, so a single rename works).
  const movedFile = join(parentDir, newName, 'SKILL.md')
  await rename(path, movedFile)
  // Now rewrite the name field in the moved file.
  const { readFileSync, writeFileSync } = await import('node:fs')
  const content = readFileSync(movedFile, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/.exec(content)
  if (match !== null) {
    const blockLines = match[1].split(/\r?\n/)
    let replaced = false
    const next = blockLines.map((line) => {
      if (/^name:/.test(line)) {
        replaced = true
        return `name: ${newName}`
      }
      return line
    })
    if (!replaced) next.unshift(`name: ${newName}`)
    writeFileSync(movedFile, `---\n${next.join('\n')}\n---${match[2]}`, 'utf8')
  }
  return movedFile
}