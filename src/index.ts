/**
 * dsh-skill-manager — host half. Serves the skill manager data source: the
 * /api/dsh-skill-manager route family (list grouped by workspace + sub-source,
 * set-mode (4-state lifecycle), create, update, rename, delete, health) over
 * the shared trust fence (loopback by default; a live paired-device cookie is
 * an extra allow path). The browser half (./client) renders the skill
 * manager panel.
 *
 * Forked from dsh-skill-explorer (zhu1090093659/dsh-web); everything rides
 * official NPM SDK packages — no DSH source changes.
 */

import { homedir } from 'node:os'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeRoutes, ROUTES } from './routes.ts'
import { mountOnce } from './mount-once.ts'
import type { CollectOptions, WorkspaceDescriptor } from './collect.ts'

/** Stable cordis plugin name. */
export const name = 'skill-manager'

/** Services required before the skill manager routes can mount. */
export const inject = ['webServer', 'skills', 'workspaceRegistry']

/** Route paths (re-exported for the client contract check). */
export { ROUTES }

/** Skill manager services (skills/workspaceRegistry come from harness services not typed on Context). */
interface SkillManagerContext {
  webServer: Context['webServer']
  skills: CollectOptions['registry']
  workspaceRegistry: WorkspaceRegistryShape
}

/** Subset of the workspace registry surface the manager consumes. */
interface WorkspaceRegistryShape {
  list(): Array<{ id: unknown; path: string; title: string }>
}

/** Plugin config. */
export interface Config {
  /** Master switch for the plugin (routes). */
  enabled?: boolean
  /** Extra custom skill root directories (placed in the global group). */
  customSkillDirs?: string[]
  /** User dsh config root override (defaults to $DSH_HOME or ~/.dsh). */
  dshHome?: string
  /** User agents config root override (defaults to $DSH_AGENTS_HOME or ~/.agents). */
  agentsHome?: string
}

/**
 * Read the workspace registry into our descriptor shape. The first workspace
 * whose path equals the cwd of any live session is treated as active; with
 * no live session, the first registry row is the active one (matching the
 * canonical-cwd header index the registry keeps for live sessions).
 */
function readWorkspaces(registry: WorkspaceRegistryShape, _cwd: string): WorkspaceDescriptor[] {
  try {
    const rows = registry.list()
    return rows.map((row, index) => ({
      id: typeof row.id === 'string' && row.id !== '' ? row.id : row.path,
      path: row.path,
      title: row.title,
      // Without a live session, the registry has no active-workspace marker;
      // mark the first row active so the manager can still render the panel.
      active: index === 0,
    }))
  } catch {
    return []
  }
}

/**
 * Mount the skill manager routes (trust fence looks up remoteWebUiPairing on ctx).
 * @param ctx - host plugin context carrying webServer/skills/workspaceRegistry.
 * @param config - resolved plugin config.
 */
function applyImpl(ctx: Context, config?: Config): void {
  if (config?.enabled === false) return
  const skillCtx = ctx as unknown as SkillManagerContext
  const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? homedir() + sep + '.dsh'
  const agentsHome = config?.agentsHome ?? process.env.DSH_AGENTS_HOME ?? homedir() + sep + '.agents'
  const customSkillDirs = Array.isArray(config?.customSkillDirs) ? config.customSkillDirs : []

  const cwd = process.cwd()
  const routes = makeRoutes(ctx, {
    dshHome,
    agentsHome,
    customSkillDirs,
    registry: skillCtx.skills,
    workspaces: () => readWorkspaces(skillCtx.workspaceRegistry, cwd),
    logger: { warn: (error: unknown) => ctx.logger.warn(error) },
  })

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'skill-manager: routes')
}

/**
 * Single-instance guard shared by the plugin family: the aggregate bundle
 * (dsh-web-all) and a standalone install of this package can coexist in
 * one profile, so the second host apply must be a no-op instead of
 * re-registering the same routes and failing the boot.
 */
export const apply = mountOnce('@coronaaaaa/dsh-skill-manager', applyImpl)