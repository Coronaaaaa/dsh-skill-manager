/**
 * Route-layer tests: the trust fence (loopback + live pairing), list/create/
 * set-mode/set-enabled/rename/delete dispatch (fake IncomingMessage +
 * ServerResponse, temp skill roots).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ROUTES, makeRoutes } from '../src/routes.ts'
import type { WorkspaceDescriptor } from '../src/collect.ts'

const TMP = mkdtempSync(join(tmpdir(), 'skill-manager-routes-'))
const HOME = join(TMP, 'home')
const PROJ = join(TMP, 'proj')
const PROJECT_SKILL = join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md')
const USER_SKILL = join(HOME, 'skills', 'user-tool', 'SKILL.md')
mkdirSync(join(HOME, 'skills'), { recursive: true })
mkdirSync(join(PROJ, '.git'), { recursive: true })
mkdirSync(join(PROJ, '.dsh', 'skills', 'poc-first'), { recursive: true })
mkdirSync(join(HOME, 'skills', 'user-tool'), { recursive: true })
writeFileSync(PROJECT_SKILL, '---\nname: poc-first\ndescription: 快速 POC\ninvocation-mode: on\n---\n# 正文\n', 'utf8')
writeFileSync(USER_SKILL, '---\nname: user-tool\ndescription: 用户级技能\n---\n', 'utf8')

// Symlink support is environment-dependent (Windows needs Developer Mode,
// some sandboxed Linux runners disallow it) — probe once and skip linked cases.
let CAN_SYMLINK = false
try {
  mkdirSync(join(TMP, 'probe', 'target'), { recursive: true })
  symlinkSync(join(TMP, 'probe', 'target'), join(TMP, 'probe', 'linked'), 'dir')
  CAN_SYMLINK = true
} catch {
  CAN_SYMLINK = false
}

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

const registry = {
  snapshot: async () => ({ skills: [], complete: true }),
}

const workspaces: WorkspaceDescriptor[] = [
  { id: 'ws-proj', path: PROJ, title: 'proj', active: true },
]

const deps = {
  dshHome: HOME,
  agentsHome: join(TMP, 'agents'),
  customSkillDirs: [],
  registry,
  workspaces: () => workspaces,
  logger: { warn: () => {} },
}

const emptyCtx = {} as never
const routes = makeRoutes(emptyCtx, deps)
const find = (path: string) => routes.find((route) => route.path === path)

/** One fake IncomingMessage: loopback socket + Host by default. */
function request(url: string, method = 'GET', options: { remoteAddress?: string; host?: string; cookie?: string; body?: unknown } = {}): IncomingMessage {
  const req = {
    url,
    method,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: options.host ?? 'localhost:3080',
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    async *[Symbol.asyncIterator]() {
      if (options.body !== undefined) yield Buffer.from(JSON.stringify(options.body))
    },
  }
  return req as unknown as IncomingMessage
}

/** One fake ServerResponse capturing status/body. */
function response(): { res: ServerResponse; status: () => number; body: () => string } {
  const state = { status: 0, body: '' }
  const res = {
    writeHead(status: number) { state.status = status },
    end(body: string) { state.body = body },
  } as unknown as ServerResponse
  return { res, status: () => state.status, body: () => state.body }
}

/** Flatten a payload's workspace groups into a list of skill names. */
function skillNames(payload: { groups: Array<{ subGroups: Array<{ skills: Array<{ name: string }> }> }> }): string[] {
  return payload.groups.flatMap(g => g.subGroups.flatMap(s => s.skills.map(skill => skill.name)))
}

/** Isolated project/user pair with the same skill name for stale identity tests. */
function staleIdentityFixture(): {
  root: string
  projectFile: string
  userFile: string
  find(path: string): ReturnType<typeof makeRoutes>[number] | undefined
} {
  const root = mkdtempSync(join(tmpdir(), 'skill-manager-stale-'))
  const project = join(root, 'project')
  const home = join(root, 'home')
  const projectFile = join(project, '.dsh', 'skills', 'shared-skill', 'SKILL.md')
  const userFile = join(home, 'skills', 'shared-skill', 'SKILL.md')
  mkdirSync(join(project, '.git'), { recursive: true })
  mkdirSync(join(project, '.dsh', 'skills', 'shared-skill'), { recursive: true })
  mkdirSync(join(home, 'skills', 'shared-skill'), { recursive: true })
  writeFileSync(projectFile, '---\nname: shared-skill\ndescription: project copy\n---\n', 'utf8')
  writeFileSync(userFile, '---\nname: shared-skill\ndescription: user copy\n---\n', 'utf8')
  const isolatedRoutes = makeRoutes(emptyCtx, {
    ...deps,
    dshHome: home,
    agentsHome: join(root, 'agents'),
    workspaces: () => [{ id: 'ws', path: project, title: 'project', active: true }],
  })
  return {
    root,
    projectFile,
    userFile,
    find: path => isolatedRoutes.find(route => route.path === path),
  }
}

describe('/api/dsh-skill-manager trust fence', () => {
  it('rejects non-loopback requests with 403 before touching the service', async () => {
    for (const route of routes) {
      const { res, status, body } = response()
      await route.handler(request(route.path, 'GET', { remoteAddress: '192.168.1.20' }), res)
      expect(status()).toBe(403)
      expect(JSON.parse(body())).toEqual({ error: 'forbidden: loopback-only' })
    }
  })

  it('allows a non-loopback client when pairing reports a live device', async () => {
    const isPairedDevice = vi.fn(() => true)
    const ctx = { get: () => ({ isPairedDevice }) }
    const pairedRoutes = makeRoutes(ctx as never, deps)
    const list = pairedRoutes.find((route) => route.path === ROUTES.list)!
    const { res, status } = response()
    await list.handler(request(ROUTES.list, 'GET', {
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
    }), res)
    expect(status()).toBe(200)
    expect(isPairedDevice).toHaveBeenCalled()
  })

  it('allows a non-loopback write when pairing reports a live device', async () => {
    const ctx = { get: () => ({ isPairedDevice: () => true }) }
    const pairedRoutes = makeRoutes(ctx as never, deps)
    const setMode = pairedRoutes.find((route) => route.path === ROUTES.setMode)!
    const { res, status } = response()
    await setMode.handler(request(ROUTES.setMode, 'POST', {
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
      body: { name: 'poc-first', path: PROJECT_SKILL, mode: 'name-only' },
    }), res)
    expect(status()).toBe(200)
  })

  it('still rejects a non-loopback client when pairing reports false', async () => {
    const ctx = { get: () => ({ isPairedDevice: () => false }) }
    const revokedRoutes = makeRoutes(ctx as never, deps)
    for (const route of revokedRoutes) {
      const { res, status, body } = response()
      await route.handler(request(route.path, 'GET', {
        remoteAddress: '192.168.1.20',
        host: 'dsh.example:443',
        cookie: 'dsh_pair=revoked',
      }), res)
      expect(status()).toBe(403)
      expect(JSON.parse(body())).toEqual({ error: 'forbidden: loopback-only' })
    }
  })

  it('rejects wrong methods with 405', async () => {
    const { res, status } = response()
    await find(ROUTES.list)!.handler(request(ROUTES.list, 'POST'), res)
    expect(status()).toBe(405)
  })

  it('serves list for loopback clients with workspace groups', async () => {
    const { res, status, body } = response()
    await find(ROUTES.list)!.handler(request(ROUTES.list, 'GET'), res)
    expect(status()).toBe(200)
    const payload = JSON.parse(body())
    expect(payload.complete).toBe(true)
    // Workspace groups: one for the project + one global.
    expect(payload.groups.length).toBe(2)
    expect(payload.groups[0].scope).toBe('workspace')
    expect(payload.groups[1].scope).toBe('global')
    expect(skillNames(payload)).toContain('poc-first')
    expect(skillNames(payload)).toContain('user-tool')
  })

  it('uses workspaces() when no explicit cwd query param is provided', async () => {
    const activePath = '/virtual/active-project'
    const snapshotFn = vi.fn().mockResolvedValue({ skills: [{ name: 'project-skill', description: 'desc', source: 'project-dsh' }], complete: true })
    const activeRoutes = makeRoutes(emptyCtx, {
      ...deps,
      workspaces: () => [{ id: 'ws', path: activePath, title: 'active', active: true }],
      registry: { snapshot: snapshotFn },
    })
    const list = activeRoutes.find((r) => r.path === ROUTES.list)!
    const { res, status, body } = response()
    await list.handler(request(ROUTES.list, 'GET'), res)
    expect(status()).toBe(200)
    const payload = JSON.parse(body())
    expect(payload.cwd).toBe(activePath)
    expect(snapshotFn).toHaveBeenCalledWith(expect.objectContaining({ cwd: activePath }))
  })

  it('serves health with a skill count and the plugin name', async () => {
    const { res, status, body } = response()
    await find(ROUTES.health)!.handler(request(ROUTES.health, 'GET'), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body()).plugin).toBe('skill-manager')
    expect(JSON.parse(body()).skills).toBeGreaterThan(0)
  })
})

describe('set-mode (4-state lifecycle)', () => {
  it('writes invocation-mode and mirrors to the legacy pair', async () => {
    const file = PROJECT_SKILL
    const { res, status, body } = response()
    await find(ROUTES.setMode)!.handler(request(ROUTES.setMode, 'POST', { body: { name: 'poc-first', path: file, mode: 'user-invocable-only' } }), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ ok: true, name: 'poc-first', path: file, mode: 'user-invocable-only' })
    const written = readFileSync(file, 'utf8')
    expect(written).toContain('invocation-mode: user-invocable-only')
    expect(written).toContain('disable-model-invocation: true')
    expect(written).toContain('user-invocable: true')
  })

  it('accepts every valid mode and rejects unknown values', async () => {
    const file = PROJECT_SKILL
    for (const mode of ['on', 'name-only', 'user-invocable-only', 'off'] as const) {
      const { res, status } = response()
      await find(ROUTES.setMode)!.handler(request(ROUTES.setMode, 'POST', { body: { name: 'poc-first', path: file, mode } }), res)
      expect(status()).toBe(200)
    }
    const { res, status } = response()
    await find(ROUTES.setMode)!.handler(request(ROUTES.setMode, 'POST', { body: { name: 'poc-first', path: file, mode: 'mystery' } }), res)
    expect(status()).toBe(400)
  })

  it('rejects invalid payloads with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.setMode)!.handler(request(ROUTES.setMode, 'POST', { body: { name: 'bad name!', path: PROJECT_SKILL, mode: 'on' } }), res)
    expect(status()).toBe(400)
  })

  it('rejects GET with 405 and never rewrites files', async () => {
    const file = PROJECT_SKILL
    const before = readFileSync(file, 'utf8')
    const { res, status } = response()
    await find(ROUTES.setMode)!.handler(request(ROUTES.setMode, 'GET'), res)
    expect(status()).toBe(405)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('returns 404 for skills without an editable file', async () => {
    const { res, status } = response()
    await find(ROUTES.setMode)!.handler(request(ROUTES.setMode, 'POST', { body: { name: 'not-exist', path: join(TMP, 'missing', 'SKILL.md'), mode: 'on' } }), res)
    expect(status()).toBe(404)
  })

  it('does not rewrite a same-name fallback when the displayed file disappears', async () => {
    const fixture = staleIdentityFixture()
    try {
      rmSync(join(fixture.projectFile, '..'), { recursive: true })
      const before = readFileSync(fixture.userFile, 'utf8')
      const { res, status, body } = response()
      await fixture.find(ROUTES.setMode)!.handler(request(ROUTES.setMode, 'POST', {
        body: { name: 'shared-skill', path: fixture.projectFile, mode: 'off' },
      }), res)
      expect(status()).toBe(409)
      expect(JSON.parse(body()).error).toContain('refresh and retry')
      expect(readFileSync(fixture.userFile, 'utf8')).toBe(before)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

describe('set-enabled (legacy on/off)', () => {
  it('maps enabled=true to mode=on and enabled=false to mode=off', async () => {
    const file = PROJECT_SKILL
    let res = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'poc-first', path: file, enabled: false } }), res.res)
    expect(res.status()).toBe(200)
    expect(JSON.parse(res.body()).mode).toBe('off')
    expect(readFileSync(file, 'utf8')).toContain('invocation-mode: off')
    res = response()
    await find(ROUTES.setEnabled)!.handler(request(ROUTES.setEnabled, 'POST', { body: { name: 'poc-first', path: file, enabled: true } }), res.res)
    expect(res.status()).toBe(200)
    expect(JSON.parse(res.body()).mode).toBe('on')
  })
})

describe('create', () => {
  it('creates a skill under the user root with a chosen mode', async () => {
    const { res, status, body } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { scope: 'user-dsh', name: 'new-skill', description: '新技能', whenToUse: '测试', content: '正文', cwd: PROJ, mode: 'name-only' } }), res)
    expect(status()).toBe(200)
    const target = join(HOME, 'skills', 'new-skill', 'SKILL.md')
    expect(JSON.parse(body()).path).toBe(target)
    expect(JSON.parse(body()).mode).toBe('name-only')
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain("description: '新技能'")
    expect(readFileSync(target, 'utf8')).toContain('invocation-mode: name-only')
  })

  it('creates a skill under the project .dsh/skills root derived from cwd', async () => {
    const { res, status, body } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { scope: 'project-dsh', name: 'proj-skill', description: '项目技能', content: '正文', cwd: join(PROJ, 'nested', 'dir') } }), res)
    expect(status()).toBe(200)
    const target = join(PROJ, '.dsh', 'skills', 'proj-skill', 'SKILL.md')
    expect(JSON.parse(body()).path).toBe(target)
    expect(existsSync(target)).toBe(true)
  })

  it('creates a skill under the project .agents/skills root', async () => {
    mkdirSync(join(PROJ, '.agents', 'skills'), { recursive: true })
    const { res, status, body } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { scope: 'project-agents', name: 'agent-skill', description: '项目 agents 技能', content: '正文', cwd: PROJ } }), res)
    expect(status()).toBe(200)
    const target = join(PROJ, '.agents', 'skills', 'agent-skill', 'SKILL.md')
    expect(JSON.parse(body()).path).toBe(target)
    expect(existsSync(target)).toBe(true)
  })

  it('rejects a missing cwd with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { scope: 'project-dsh', name: 'no-cwd-skill', description: 'x', content: 'y' } }), res)
    expect(status()).toBe(400)
  })

  it('rejects duplicates with 409', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { scope: 'user-dsh', name: 'new-skill', description: 'x', content: 'y', cwd: PROJ } }), res)
    expect(status()).toBe(409)
  })

  it('rejects invalid names with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { scope: 'user-dsh', name: 'Bad_Name', description: 'x', content: 'y', cwd: PROJ } }), res)
    expect(status()).toBe(400)
  })

  it('rejects oversized content with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.create)!.handler(request(ROUTES.create, 'POST', { body: { scope: 'user-dsh', name: 'big-skill', description: 'x', content: 'x'.repeat(64 * 1024 + 1), cwd: PROJ } }), res)
    expect(status()).toBe(400)
  })
})

describe('rename', () => {
  /** One isolated project root with one renameable skill. */
  function renameFixture(name = 'rename-source'): {
    root: string
    file: string
    find(path: string): ReturnType<typeof makeRoutes>[number] | undefined
  } {
    const root = mkdtempSync(join(tmpdir(), 'skill-manager-rename-'))
    const proj = join(root, 'proj')
    const home = join(root, 'home')
    const file = join(proj, '.dsh', 'skills', name, 'SKILL.md')
    mkdirSync(join(proj, '.git'), { recursive: true })
    mkdirSync(join(proj, '.dsh', 'skills', name), { recursive: true })
    writeFileSync(file, `---\nname: ${name}\ndescription: source\n---\n# body\n`, 'utf8')
    const isolatedRoutes = makeRoutes(emptyCtx, {
      ...deps,
      dshHome: home,
      agentsHome: join(root, 'agents'),
      workspaces: () => [{ id: 'ws', path: proj, title: 'proj', active: true }],
    })
    return { root, file, find: path => isolatedRoutes.find(route => route.path === path) }
  }

  it('moves the directory and rewrites the frontmatter name', async () => {
    const fixture = renameFixture()
    try {
      const { res, status, body } = response()
      await fixture.find(ROUTES.rename)!.handler(request(ROUTES.rename, 'POST', { body: { name: 'rename-source', path: fixture.file, newName: 'rename-target' } }), res)
      expect(status()).toBe(200)
      const parsed = JSON.parse(body())
      expect(parsed.oldName).toBe('rename-source')
      expect(parsed.newName).toBe('rename-target')
      const newFile = join(fixture.root, 'proj', '.dsh', 'skills', 'rename-target', 'SKILL.md')
      expect(parsed.path).toBe(newFile)
      expect(existsSync(newFile)).toBe(true)
      expect(readFileSync(newFile, 'utf8')).toContain('name: rename-target')
      expect(existsSync(fixture.file)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('refuses when newName equals the current name', async () => {
    const fixture = renameFixture()
    try {
      const { res, status } = response()
      await fixture.find(ROUTES.rename)!.handler(request(ROUTES.rename, 'POST', { body: { name: 'rename-source', path: fixture.file, newName: 'rename-source' } }), res)
      expect(status()).toBe(400)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('refuses invalid kebab-case newName', async () => {
    const fixture = renameFixture()
    try {
      const { res, status } = response()
      await fixture.find(ROUTES.rename)!.handler(request(ROUTES.rename, 'POST', { body: { name: 'rename-source', path: fixture.file, newName: 'Bad Name' } }), res)
      expect(status()).toBe(400)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('returns 409 when newName collides with an existing skill', async () => {
    const fixture = renameFixture('rename-source')
    try {
      // Plant a colliding sibling in the same project root.
      mkdirSync(join(fixture.root, 'proj', '.dsh', 'skills', 'collides'), { recursive: true })
      writeFileSync(join(fixture.root, 'proj', '.dsh', 'skills', 'collides', 'SKILL.md'),
        '---\nname: collides\ndescription: d\n---\n', 'utf8')
      const { res, status } = response()
      await fixture.find(ROUTES.rename)!.handler(request(ROUTES.rename, 'POST', { body: { name: 'rename-source', path: fixture.file, newName: 'collides' } }), res)
      expect(status()).toBe(409)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('refuses to rename a linked skill (target would escape)', async () => {
    if (!CAN_SYMLINK) return
    const fixture = renameFixture('linked-rename')
    // Convert the fixture to a symlinked directory, then ask to rename.
    try {
      const shared = join(fixture.root, 'shared', 'linked-target')
      mkdirSync(shared, { recursive: true })
      writeFileSync(join(shared, 'SKILL.md'), '---\nname: linked-rename\ndescription: 链接技能\n---\n', 'utf8')
      // Remove the fixture directory and replace it with a symlink of the
      // same name pointing at the shared target — the rename route walks
      // the symlink and discovers the link flag from the scan.
      rmSync(join(fixture.root, 'proj', '.dsh', 'skills', 'linked-rename'), { recursive: true, force: true })
      symlinkSync(shared, join(fixture.root, 'proj', '.dsh', 'skills', 'linked-rename'), 'dir')
      const { res, status } = response()
      await fixture.find(ROUTES.rename)!.handler(request(ROUTES.rename, 'POST', { body: { name: 'linked-rename', path: join(fixture.root, 'proj', '.dsh', 'skills', 'linked-rename', 'SKILL.md'), newName: 'renamed' } }), res)
      expect(status()).toBe(400)
      expect(existsSync(join(shared, 'SKILL.md'))).toBe(true)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

describe('delete', () => {
  it('moves a skill into .trash', async () => {
    const { res, status, body } = response()
    const path = join(HOME, 'skills', 'new-skill', 'SKILL.md')
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'new-skill', path } }), res)
    expect(status()).toBe(200)
    expect(existsSync(join(HOME, 'skills', 'new-skill', 'SKILL.md'))).toBe(false)
    expect(body().length).toBeGreaterThan(0)
  })

  it('refuses to delete a linked skill (target is left in place)', async () => {
    if (!CAN_SYMLINK) return
    const shared = join(TMP, 'shared', 'linked-skill')
    mkdirSync(shared, { recursive: true })
    writeFileSync(join(shared, 'SKILL.md'), '---\nname: linked-skill\ndescription: 链接技能\n---\n', 'utf8')
    symlinkSync(shared, join(HOME, 'skills', 'linked-skill'), 'dir')
    try {
      const { res, status } = response()
      await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'linked-skill', path: join(HOME, 'skills', 'linked-skill', 'SKILL.md') } }), res)
      expect(status()).toBe(400)
      expect(existsSync(join(shared, 'SKILL.md'))).toBe(true)
    } finally {
      rmSync(join(HOME, 'skills', 'linked-skill'), { recursive: true, force: true })
      rmSync(shared, { recursive: true, force: true })
    }
  })

  it('returns 404 for unknown skills', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'not-exist', path: join(TMP, 'missing', 'SKILL.md') } }), res)
    expect(status()).toBe(404)
  })

  it('requires the displayed file path', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'user-tool' } }), res)
    expect(status()).toBe(400)
  })

  it('rejects invalid names with 400', async () => {
    const { res, status } = response()
    await find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', { body: { name: 'Bad Name', path: USER_SKILL } }), res)
    expect(status()).toBe(400)
  })

  it('does not delete a same-name fallback when the displayed file disappears', async () => {
    const fixture = staleIdentityFixture()
    try {
      rmSync(join(fixture.projectFile, '..'), { recursive: true })
      const { res, status, body } = response()
      await fixture.find(ROUTES.delete)!.handler(request(ROUTES.delete, 'POST', {
        body: { name: 'shared-skill', path: fixture.projectFile },
      }), res)
      expect(status()).toBe(409)
      expect(JSON.parse(body()).error).toContain('refresh and retry')
      expect(existsSync(fixture.userFile)).toBe(true)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

/** Isolated user-root skill for the read/update routes. */
function editFixture(name = 'edit-target'): {
  root: string
  file: string
  find(path: string): ReturnType<typeof makeRoutes>[number] | undefined
} {
  const root = mkdtempSync(join(tmpdir(), 'skill-manager-edit-'))
  const home = join(root, 'home')
  const file = join(home, 'skills', name, 'SKILL.md')
  mkdirSync(join(home, 'skills', name), { recursive: true })
  writeFileSync(file, `---\nname: ${name}\ndescription: 原始描述\nwhenToUse: 原始场景\ninvocation-mode: off\ndisable-model-invocation: true\nuser-invocable: false\n---\n\n# 原始正文\n`, 'utf8')
  const isolatedRoutes = makeRoutes(emptyCtx, { ...deps, dshHome: home, agentsHome: join(root, 'agents') })
  return { root, file, find: path => isolatedRoutes.find(route => route.path === path) }
}

describe('read', () => {
  it('user reading a skill gets the editable fields and the body without frontmatter', async () => {
    const fixture = editFixture()
    try {
      const { res, status, body } = response()
      const url = `${ROUTES.read}?name=edit-target&path=${encodeURIComponent(fixture.file)}`
      await fixture.find(ROUTES.read)!.handler(request(url, 'GET'), res)

      expect(status()).toBe(200)
      expect(JSON.parse(body())).toEqual({
        name: 'edit-target',
        path: fixture.file,
        description: '原始描述',
        whenToUse: '原始场景',
        content: '# 原始正文',
      })
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user reading a path the fresh scan does not resolve gets 409', async () => {
    const fixture = editFixture()
    try {
      const { res, status } = response()
      const url = `${ROUTES.read}?name=edit-target&path=${encodeURIComponent(join(fixture.root, 'elsewhere', 'SKILL.md'))}`
      await fixture.find(ROUTES.read)!.handler(request(url, 'GET'), res)

      expect(status()).toBe(409)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user omitting name and path gets 400', async () => {
    const { res, status } = response()
    await find(ROUTES.read)!.handler(request(ROUTES.read, 'GET'), res)
    expect(status()).toBe(400)
  })

  it('user posting to the read route gets 405', async () => {
    const fixture = editFixture()
    try {
      const { res, status } = response()
      const url = `${ROUTES.read}?name=edit-target&path=${encodeURIComponent(fixture.file)}`
      await fixture.find(ROUTES.read)!.handler(request(url, 'POST'), res)
      expect(status()).toBe(405)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

describe('update', () => {
  it('user editing a skill rewrites the file and can flip the mode', async () => {
    const fixture = editFixture()
    try {
      const { res, status, body } = response()
      await fixture.find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'edit-target', path: fixture.file, description: '新描述', whenToUse: '新场景', content: '# 新正文', mode: 'on' },
      }), res)

      expect(status()).toBe(200)
      const parsed = JSON.parse(body())
      expect(parsed.ok).toBe(true)
      expect(parsed.mode).toBe('on')
      const written = readFileSync(fixture.file, 'utf8')
      expect(written).toContain("description: '新描述'")
      expect(written).toContain('invocation-mode: on')
      expect(written).toContain('disable-model-invocation: false')
      expect(written).toContain('user-invocable: true')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user editing without a mode keeps the current mode (omitted mode = preserve)', async () => {
    const fixture = editFixture()
    try {
      const { res, status, body } = response()
      await fixture.find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'edit-target', path: fixture.file, description: '改', content: '改' },
      }), res)

      expect(status()).toBe(200)
      expect(JSON.parse(body()).mode).toBe('off')
      expect(readFileSync(fixture.file, 'utf8')).toContain('invocation-mode: off')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user editing a linked skill gets 400 and the link target stays untouched', async () => {
    if (!CAN_SYMLINK) return
    const root = mkdtempSync(join(tmpdir(), 'skill-manager-linked-edit-'))
    const home = join(root, 'home')
    const shared = join(root, 'shared', 'linked-edit')
    mkdirSync(shared, { recursive: true })
    mkdirSync(join(home, 'skills'), { recursive: true })
    writeFileSync(join(shared, 'SKILL.md'), '---\nname: linked-edit\ndescription: 链接技能\n---\n', 'utf8')
    symlinkSync(shared, join(home, 'skills', 'linked-edit'), 'dir')
    try {
      const isolatedRoutes = makeRoutes(emptyCtx, { ...deps, dshHome: home, agentsHome: join(root, 'agents') })

      const { res, status } = response()
      await isolatedRoutes.find(route => route.path === ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'linked-edit', path: join(home, 'skills', 'linked-edit', 'SKILL.md'), description: '改', content: '改' },
      }), res)

      expect(status()).toBe(400)
      expect(readFileSync(join(shared, 'SKILL.md'), 'utf8')).toContain('链接技能')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('user editing without the displayed file path gets 400', async () => {
    const { res, status } = response()
    await find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', { body: { name: 'user-tool', description: '改', content: '改' } }), res)
    expect(status()).toBe(400)
  })

  it('user saving whitespace-only content gets 400', async () => {
    const fixture = editFixture()
    try {
      const { res, status } = response()
      await fixture.find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'edit-target', path: fixture.file, description: '改', content: '   ' },
      }), res)
      expect(status()).toBe(400)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('user saving an edit whose displayed file disappeared gets 409 without a fallback rewrite', async () => {
    const fixture = staleIdentityFixture()
    try {
      rmSync(join(fixture.projectFile, '..'), { recursive: true })
      const { res, status, body } = response()
      await fixture.find(ROUTES.update)!.handler(request(ROUTES.update, 'POST', {
        body: { name: 'shared-skill', path: fixture.projectFile, description: '改', content: '改' },
      }), res)
      expect(status()).toBe(409)
      expect(JSON.parse(body()).error).toContain('refresh and retry')
      expect(readFileSync(fixture.userFile, 'utf8')).toContain('user copy')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

describe('workspaces degradation', () => {
  it('still serves list when workspaces() throws (empty project roots)', async () => {
    const brokenDeps = {
      ...deps,
      workspaces: () => { throw new Error('workspaces boom') },
    }
    const brokenRoutes = makeRoutes(emptyCtx, brokenDeps)
    const { res, status, body } = response()
    await brokenRoutes.find((route) => route.path === ROUTES.list)!.handler(request(ROUTES.list, 'GET'), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body()).complete).toBe(true)
  })
})

describe('registry degradation', () => {
  it('still serves list with complete=false when the registry snapshot throws', async () => {
    // Self-contained fixture: the shared TMP dir has been mutated by earlier
    // tests (rename / set-mode / create), so we build a fresh one whose only
    // file is a single fixture skill, then verify the filesystem scan
    // survives the registry throwing.
    const fixture = mkdtempSync(join(tmpdir(), 'skill-manager-registry-'))
    const fixtureProj = join(fixture, 'proj')
    const fixtureHome = join(fixture, 'home')
    mkdirSync(join(fixtureProj, '.git'), { recursive: true })
    mkdirSync(join(fixtureProj, '.dsh', 'skills', 'fixture-skill'), { recursive: true })
    writeFileSync(join(fixtureProj, '.dsh', 'skills', 'fixture-skill', 'SKILL.md'),
      '---\nname: fixture-skill\ndescription: fixture\n---\n# body\n', 'utf8')

    const brokenRegistry = { snapshot: async () => { throw new Error('registry boom') } }
    const brokenDeps = {
      dshHome: fixtureHome,
      agentsHome: join(fixture, 'agents'),
      customSkillDirs: [],
      registry: brokenRegistry,
      workspaces: () => [{ id: 'fixture', path: fixtureProj, title: 'fixture', active: true }],
      logger: { warn: () => {} },
    }
    const brokenRoutes = makeRoutes(emptyCtx, brokenDeps)
    const { res, status, body } = response()
    await brokenRoutes.find((route) => route.path === ROUTES.list)!.handler(request(ROUTES.list, 'GET'), res)
    expect(status()).toBe(200)
    const payload = JSON.parse(body())
    expect(payload.complete).toBe(false)
    expect(skillNames(payload)).toContain('fixture-skill')
    rmSync(fixture, { recursive: true, force: true })
  })
})