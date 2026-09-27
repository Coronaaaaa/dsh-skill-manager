/**
 * The /api/dsh-skill-manager route family: list (grouped by workspace and
 * sub-source), read (one skill's editable fields and body), set-mode (4-state
 * lifecycle), create, update (rewrites an existing SKILL.md in place, can
 * change the mode), rename (moves the directory + rewrites the `name:` field),
 * delete (move to .trash) and health. Every route carries the shared trust
 * fence (loopback by default; a live paired-device cookie is an extra allow
 * path when remote-web-ui is loaded) plus browser same-origin markers — the
 * write routes touch real skill files, so unpaired LAN clients must not reach
 * them, and read/update only touch paths a fresh scan resolves.
 */

import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isSkillManagerAllowed } from './access.ts'
import {
  buildPayload,
  collectSkills,
  findProjectRoot,
  overwriteSkillFile,
  projectAgentsSkillRoot,
  projectSkillRoot,
  renameSkillFile,
  trashSkillFile,
  userAgentsSkillRoot,
  userSkillRoot,
  writeSkillFile,
  type CollectOptions,
  type SkillEntry,
  type WorkspaceDescriptor,
} from './collect.ts'
import {
  INVOCATION_MODES,
  parseFrontmatter,
  parseInvocationMode,
  setInvocationMode,
  stripFrontmatter,
} from './frontmatter.ts'
import { readJsonBody, writeJson } from './http.ts'

/** Route paths (client bundle mirrors these literals; tests assert both sides). */
export const ROUTES = {
  list: '/api/dsh-skill-manager/list',
  read: '/api/dsh-skill-manager/read',
  setMode: '/api/dsh-skill-manager/set-mode',
  setEnabled: '/api/dsh-skill-manager/set-enabled',
  create: '/api/dsh-skill-manager/create',
  update: '/api/dsh-skill-manager/update',
  rename: '/api/dsh-skill-manager/rename',
  delete: '/api/dsh-skill-manager/delete',
  health: '/api/dsh-skill-manager/health',
} as const

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Skill name pattern shared by the routes (kebab-case). */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Route family dependencies (tests inject fakes). */
export interface SkillRoutesDeps {
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /** Extra custom skill roots from plugin config. */
  customSkillDirs: string[]
  /** ctx.skills registry (snapshot). */
  registry: CollectOptions['registry']
  /** Workspace descriptors from the host's workspaceRegistry. */
  workspaces(): WorkspaceDescriptor[]
  /** Logger. */
  logger: { warn(error: unknown): void }
}

/** Default process cwd fallback (overridable in tests). */
export const DEFAULT_CWD = (): string => process.cwd()

/**
 * Build every /api/dsh-skill-manager route (exact paths).
 * @param ctx - host context; may expose remoteWebUiPairing.
 * @param deps - dshHome/agentsHome/registry/workspaces.
 * @returns the route list for ctx.webServer.register.
 */
export function makeRoutes(ctx: Context, deps: SkillRoutesDeps): WebRoute[] {
  const { dshHome, agentsHome, customSkillDirs, registry, logger } = deps

  /** Resolve the workspace descriptors safely (degrades to [] on error). */
  const safeWorkspaces = (): WorkspaceDescriptor[] => {
    try {
      return deps.workspaces()
    } catch {
      return []
    }
  }

  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isSkillManagerAllowed(ctx, req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** Collect options shared by list/set-mode/delete/health handlers. */
  const collectOptions = (cwd: string): CollectOptions => ({
    cwd,
    workspaces: safeWorkspaces(),
    customSkillDirs,
    dshHome,
    agentsHome,
    registry,
  })

  /** Find a skill by name from a fresh collection pass (trusts scanned paths only). */
  const findSkill = async (name: string, cwd: string): Promise<SkillEntry | undefined> => {
    const { skills } = await collectSkills(collectOptions(cwd))
    return skills.find((candidate) => candidate.name === name)
  }

  /** Resolve the exact file the panel showed, rejecting stale same-name fallbacks. */
  const resolveScannedSkill = async (
    name: string,
    expectedPath: string,
    cwd: string,
    res: ServerResponse,
  ): Promise<(SkillEntry & { path: string }) | undefined> => {
    const skill = await findSkill(name, cwd)
    if (skill?.path === undefined) {
      writeJson(res, 404, { error: `skill ${name} has no editable file` })
      return undefined
    }
    if (skill.path !== expectedPath) {
      writeJson(res, 409, { error: `skill ${name} changed since the panel loaded; refresh and retry` })
      return undefined
    }
    return skill as SkillEntry & { path: string }
  }

  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: ROUTES.list,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const sessionCwds = safeWorkspaces().map((w) => w.path)
          const cwd = queryParam(url, 'cwd') ?? sessionCwds[0] ?? DEFAULT_CWD()
          const { skills, complete, workspaces } = await collectSkills(collectOptions(cwd))
          writeJson(res, 200, buildPayload(skills, complete, workspaces))
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.read,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const name = queryParam(url, 'name')
          const path = queryParam(url, 'path')
          if (name === undefined || !NAME_PATTERN.test(name) || path === undefined || path.trim() === '') {
            writeJson(res, 400, { error: 'expected ?name=<kebab-case>&path=<absolute SKILL.md>' })
            return
          }
          // The submitted path is only an identity claim: a fresh scan must
          // resolve the same file the panel showed, so no request can read an
          // arbitrary path.
          const skill = await resolveScannedSkill(name, path, DEFAULT_CWD(), res)
          if (skill === undefined) return
          const raw = readFileSync(skill.path, 'utf8')
          const frontmatter = parseFrontmatter(raw)
          writeJson(res, 200, {
            name,
            path: skill.path,
            description: frontmatter.description ?? skill.description,
            ...(frontmatter.whenToUse === undefined ? {} : { whenToUse: frontmatter.whenToUse }),
            content: stripFrontmatter(raw).trim(),
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.setMode,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { name, path, mode } = payload
          if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
            writeJson(res, 400, { error: 'name must be kebab-case' })
            return
          }
          if (typeof path !== 'string' || path.trim() === '') {
            writeJson(res, 400, { error: 'path is required' })
            return
          }
          const nextMode = parseInvocationMode(mode)
          if (nextMode === undefined) {
            writeJson(res, 400, { error: `mode must be one of: ${INVOCATION_MODES.join(' | ')}` })
            return
          }
          // The client path is only an identity claim: a fresh scan must
          // resolve the same effective skill before any file is touched.
          const skill = await resolveScannedSkill(name, path, DEFAULT_CWD(), res)
          if (skill === undefined) return
          // Atomic write of the canonical mode + mirror to legacy pair.
          setInvocationMode(skill.path, nextMode)
          writeJson(res, 200, {
            ok: true,
            name,
            path: skill.path,
            mode: nextMode,
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.setEnabled,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { name, path, enabled } = payload
          if (typeof name !== 'string' || !NAME_PATTERN.test(name) || typeof path !== 'string' || path.trim() === '' || typeof enabled !== 'boolean') {
            writeJson(res, 400, { error: 'expected { name, path, enabled }' })
            return
          }
          // The legacy on/off shape maps to one of the four modes.
          const nextMode = enabled ? 'on' : 'off'
          const skill = await resolveScannedSkill(name, path, DEFAULT_CWD(), res)
          if (skill === undefined) return
          setInvocationMode(skill.path, nextMode)
          writeJson(res, 200, {
            name,
            enabled,
            mode: nextMode,
            modelInvocable: enabled,
            path: skill.path,
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.create,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { root, scope, name, description, whenToUse, content, cwd, mode } = payload
          // root: 'user' (legacy alias) or scope: 'global' | 'workspace' | 'user-dsh' | 'user-agents' | 'project-dsh' | 'project-agents'
          const normalizedScope =
            typeof scope === 'string'
              ? scope
              : root === 'user'
                ? 'global'
                : root === 'project'
                  ? 'workspace'
                  : undefined
          if (
            normalizedScope !== 'global' &&
            normalizedScope !== 'workspace' &&
            normalizedScope !== 'user-dsh' &&
            normalizedScope !== 'user-agents' &&
            normalizedScope !== 'project-dsh' &&
            normalizedScope !== 'project-agents'
          ) {
            writeJson(res, 400, { error: 'scope must be global | workspace | user-dsh | user-agents | project-dsh | project-agents' })
            return
          }
          if (typeof cwd !== 'string' || cwd.trim() === '') {
            writeJson(res, 400, { error: 'cwd is required (the workspace shown by the panel)' })
            return
          }
          if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
            writeJson(res, 400, { error: 'name must be kebab-case (lowercase letters/digits first)' })
            return
          }
          if (typeof description !== 'string' || description.trim() === '') {
            writeJson(res, 400, { error: 'description is required' })
            return
          }
          if (typeof content !== 'string' || content.trim() === '') {
            writeJson(res, 400, { error: 'content is required' })
            return
          }
          if (Buffer.byteLength(content, 'utf8') > 64 * 1024) {
            writeJson(res, 400, { error: 'content exceeds 64KB limit' })
            return
          }
          const nextMode = parseInvocationMode(mode) ?? 'on'
          const baseDir = resolveCreateBaseDir({
            scope: normalizedScope,
            cwd,
            dshHome,
            agentsHome,
          })
          const target = await writeSkillFile(
            baseDir,
            name,
            description,
            typeof whenToUse === 'string' ? whenToUse : undefined,
            content,
            nextMode,
          )
          writeJson(res, 200, { ok: true, name, path: target, mode: nextMode })
        } catch (error) {
          if (error instanceof Error && /already exists/.test(error.message)) {
            writeJson(res, 409, { error: error.message })
            return
          }
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.update,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { name, path, description, whenToUse, content, mode } = payload
          if (typeof name !== 'string' || !NAME_PATTERN.test(name) || typeof path !== 'string' || path.trim() === '') {
            writeJson(res, 400, { error: 'expected { name, path, description, content, mode? }' })
            return
          }
          if (typeof description !== 'string' || description.trim() === '') {
            writeJson(res, 400, { error: 'description is required' })
            return
          }
          if (typeof content !== 'string' || content.trim() === '') {
            writeJson(res, 400, { error: 'content is required' })
            return
          }
          if (Buffer.byteLength(content, 'utf8') > 64 * 1024) {
            writeJson(res, 400, { error: 'content exceeds 64KB limit' })
            return
          }
          const skill = await resolveScannedSkill(name, path, DEFAULT_CWD(), res)
          if (skill === undefined) return
          // A linked skill lives behind a symlink: rewriting it would edit a
          // file outside this skill root, so the panel must not offer it.
          if (skill.linked === true) {
            writeJson(res, 400, { error: `skill ${name} is a linked skill and cannot be edited` })
            return
          }
          // Mode is optional in the update payload: when omitted, keep the
          // current mode; when present, validate it.
          const currentMode = parseFrontmatter(readFileSync(skill.path, 'utf8')).invocationMode
          const explicitMode = parseInvocationMode(mode)
          const nextMode = explicitMode ?? currentMode ?? skill.mode
          const target = await overwriteSkillFile(
            skill.path,
            name,
            description.trim(),
            typeof whenToUse === 'string' ? whenToUse : undefined,
            content,
            nextMode,
          )
          writeJson(res, 200, { ok: true, name, path: target, mode: nextMode })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.rename,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { name, path, newName } = payload
          if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
            writeJson(res, 400, { error: 'name must be kebab-case' })
            return
          }
          if (typeof path !== 'string' || path.trim() === '') {
            writeJson(res, 400, { error: 'path is required' })
            return
          }
          if (typeof newName !== 'string' || !NAME_PATTERN.test(newName)) {
            writeJson(res, 400, { error: 'newName must be kebab-case' })
            return
          }
          if (newName === name) {
            writeJson(res, 400, { error: 'newName must differ from the current name' })
            return
          }
          const skill = await resolveScannedSkill(name, path, DEFAULT_CWD(), res)
          if (skill === undefined) return
          // Linked skills cannot be renamed: the target directory would move
          // out of the skill root, escaping the mount-of-intent boundary.
          if (skill.linked === true) {
            writeJson(res, 400, { error: `skill ${name} is a linked skill and cannot be renamed` })
            return
          }
          const target = await renameSkillFile(skill.path, newName)
          writeJson(res, 200, { ok: true, oldName: name, newName, path: target })
        } catch (error) {
          if (error instanceof Error && /already exists/.test(error.message)) {
            writeJson(res, 409, { error: error.message })
            return
          }
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.delete,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { name, path } = payload
          if (typeof name !== 'string' || !NAME_PATTERN.test(name) || typeof path !== 'string' || path.trim() === '') {
            writeJson(res, 400, { error: 'expected { name, path }' })
            return
          }
          const skill = await resolveScannedSkill(name, path, DEFAULT_CWD(), res)
          if (skill === undefined) return
          // A linked skill lives behind a symlink (mount-of-intent content, not
          // created under this root). Deletion would move the target's real
          // SKILL.md out of place, escaping this skill root — refuse deletion.
          if (skill.linked === true) {
            writeJson(res, 400, { error: `skill ${name} is a linked skill and cannot be deleted` })
            return
          }
          const moved = await trashSkillFile(skill.path)
          writeJson(res, 200, { ok: true, name, moved })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const { skills } = await collectSkills(collectOptions(DEFAULT_CWD()))
          writeJson(res, 200, { ok: true, plugin: 'skill-manager', skills: skills.length })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
  return routes
}

/** Resolve the absolute base directory a new-skill create call should write to. */
function resolveCreateBaseDir(opts: {
  scope: string
  cwd: string
  dshHome: string
  agentsHome: string
}): string {
  switch (opts.scope) {
    case 'global':
      // Legacy "user" alias defaults to ~/.dsh/skills, matching the explorer.
      return userSkillRoot(opts.dshHome)
    case 'user-dsh':
      return userSkillRoot(opts.dshHome)
    case 'user-agents':
      return userAgentsSkillRoot(opts.agentsHome)
    case 'workspace':
    case 'project-dsh':
      return projectSkillRoot(findProjectRoot(opts.cwd))
    case 'project-agents':
      return projectAgentsSkillRoot(findProjectRoot(opts.cwd))
    default:
      throw new Error(`unknown scope: ${opts.scope}`)
  }
}