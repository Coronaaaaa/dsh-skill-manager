/**
 * Skill manager API client (browser half). Talks to the host route family
 * over same-origin fetch; the host enforces the trust fence on its side.
 */

/** Canonical 4-state lifecycle value. Stable union; the type guards stay exported. */
export type InvocationMode = 'on' | 'name-only' | 'user-invocable-only' | 'off'

/** All valid modes, in display order (most-on to most-off). */
export const INVOCATION_MODES: readonly InvocationMode[] = ['on', 'name-only', 'user-invocable-only', 'off']

/**
 * Route paths mirrored from the host (src/routes.ts ROUTES).
 *
 * DOCUMENT-RELATIVE on purpose (no leading slash): the harness serves the GUI
 * with `<base href="./">`, so a sub-path deployment (`/dsh/dsh/`) is the
 * entry directory. A root-absolute `/api/...` escapes that prefix and the
 * request never reaches the plugin's route (issue #1707); the official client
 * posts its own routes the same way (`api/session.list`).
 */
const API = {
  list: 'api/dsh-skill-manager/list',
  read: 'api/dsh-skill-manager/read',
  setMode: 'api/dsh-skill-manager/set-mode',
  setEnabled: 'api/dsh-skill-manager/set-enabled',
  create: 'api/dsh-skill-manager/create',
  update: 'api/dsh-skill-manager/update',
  rename: 'api/dsh-skill-manager/rename',
  delete: 'api/dsh-skill-manager/delete',
} as const

/** Sub-source key inside a workspace/global group. */
export type SubSourceKey = 'dsh' | 'agents' | 'custom' | 'runtime' | 'bundled'

/** Where a skill belongs. */
export type SkillScope = 'global' | 'workspace'

/** One skill entry as served by the host. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  source: SubSourceKey
  path?: string
  /** True for skills discovered through a symlink entry (rename/delete not allowed). */
  linked?: boolean
  /** Canonical 4-state mode. */
  mode: InvocationMode
  /** Legacy mirror of the official core's pair, derived from `mode`. */
  modelInvocable: boolean
  userInvocable: boolean
  /** Where the skill lives. */
  scope: SkillScope
  /** Workspace path the skill belongs to (workspace entries only). */
  workspacePath?: string
  /** Workspace display name (workspace entries only). */
  workspaceName?: string
  /** True when the skill belongs to the active session's workspace. */
  isActiveWorkspace?: boolean
}

/** Sub-group payload (source inside one workspace/global group). */
export interface SubGroupPayload {
  key: SubSourceKey
  title: string
  hint: string
  skills: SkillEntry[]
}

/** Top-level workspace group (one per workspace + one global). */
export interface WorkspaceGroupPayload {
  key: string
  title: string
  hint: string
  scope: SkillScope
  workspacePath?: string
  isActive: boolean
  subGroups: SubGroupPayload[]
}

/** Workspace descriptor served by the host (from workspaceRegistry). */
export interface WorkspaceDescriptor {
  id: string
  path: string
  title: string
  active: boolean
}

/** List payload served by the host. */
export interface ListPayload {
  cwd: string
  complete: boolean
  groups: WorkspaceGroupPayload[]
  workspaces: WorkspaceDescriptor[]
}

/** One thrown API error with the host-provided message. */
export class ApiError extends Error {}

/** Skill manager API client. */
export class SkillApi {
  /** Fetch the grouped skill list. */
  async list(cwd?: string): Promise<ListPayload> {
    const url = typeof cwd === 'string' && cwd.trim() !== ''
      ? `${API.list}?cwd=${encodeURIComponent(cwd)}`
      : API.list
    return this.request<ListPayload>(url)
  }

  /** Set the canonical 4-state mode (atomic write, mirrors the legacy pair). */
  async setMode(name: string, path: string, mode: InvocationMode): Promise<{ ok: true; name: string; path: string; mode: InvocationMode }> {
    return this.request(API.setMode, { method: 'POST', body: { name, path, mode } })
  }

  /** Legacy on/off toggle (maps to `on` or `off`). */
  async setEnabled(name: string, path: string, enabled: boolean): Promise<{ name: string; enabled: boolean; mode: InvocationMode; modelInvocable: boolean; path?: string }> {
    return this.request(API.setEnabled, { method: 'POST', body: { name, path, enabled } })
  }

  /** Create a skill file under the user or project root. */
  async create(payload: {
    scope: 'global' | 'workspace' | 'user-dsh' | 'user-agents' | 'project-dsh' | 'project-agents'
    name: string
    description: string
    whenToUse?: string
    content: string
    cwd: string
    mode: InvocationMode
  }): Promise<{ ok: true; name: string; path: string; mode: InvocationMode }> {
    return this.request(API.create, { method: 'POST', body: payload })
  }

  /** One skill's editable fields and body, resolved from the panel's path. */
  async read(name: string, path: string): Promise<{ name: string; path: string; description: string; whenToUse?: string; content: string }> {
    return this.request(`${API.read}?name=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`)
  }

  /** Rewrite an existing skill file in place (name and location unchanged; can also flip the mode). */
  async update(payload: { name: string; path: string; description: string; whenToUse?: string; content: string; mode?: InvocationMode }): Promise<{ ok: true; name: string; path: string; mode: InvocationMode }> {
    return this.request(API.update, { method: 'POST', body: payload })
  }

  /** Rename a skill (move the directory + rewrite the `name:` field). */
  async rename(name: string, path: string, newName: string): Promise<{ ok: true; oldName: string; newName: string; path: string }> {
    return this.request(API.rename, { method: 'POST', body: { name, path, newName } })
  }

  /** Delete a skill (moves it into .trash). */
  async remove(name: string, path: string): Promise<{ ok: true; name: string; moved: string }> {
    return this.request(API.delete, { method: 'POST', body: { name, path } })
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers = options.body === undefined
      ? new Headers()
      : new Headers({ 'content-type': 'application/json' })
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`
      throw new ApiError(message)
    }
    return body as T
  }
}