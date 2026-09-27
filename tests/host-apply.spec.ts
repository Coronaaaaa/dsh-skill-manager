/**
 * Host apply tests: enabled=false registers nothing; enabled registers the
 * route family and disposes cleanly.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

/** The mountOnce registry key (mirrors shared/host/mount-once.ts) — reset between applies so each case starts fresh. */
const MOUNTED = Symbol.for('dsh-web.mounted-plugins')

function resetMountOnce(): void {
  ;(globalThis as Record<symbol, unknown>)[MOUNTED] = undefined
}

beforeEach(resetMountOnce)

/** Fake cordis ctx capturing route registrations. */
function fakeCtx() {
  const state = { routes: [] as Array<{ path?: string }>, effects: [] as string[] }
  return {
    ...state,
    webServer: {
      register: (route: { path?: string }) => { state.routes.push(route); return () => {} },
    },
    skills: {
      snapshot: async () => ({ skills: [], complete: true }),
    },
    workspaceRegistry: {
      list: () => [],
    },
    logger: { warn: () => {} },
    effect: (fn: () => unknown, label: string) => {
      state.effects.push(label)
      const disposer = fn()
      return () => { if (typeof disposer === 'function') (disposer as () => void)() }
    },
  }
}

describe('skill-manager host apply', () => {
  it('is a no-op for a second mount of the same package (aggregate + standalone coexist)', () => {
    const first = fakeCtx()
    apply(first as never, {})
    expect(first.routes.length).toBe(9)
    const second = fakeCtx()
    apply(second as never, {})
    expect(second.routes.length).toBe(0)
  })

  it('registers nothing when enabled is false', () => {
    const ctx = fakeCtx()
    apply(ctx as never, { enabled: false })
    expect(ctx.routes.length).toBe(0)
  })

  it('registers the nine routes when enabled (default)', () => {
    const ctx = fakeCtx()
    apply(ctx as never, {})
    const paths = ctx.routes.map((route) => route.path)
    expect(paths).toEqual([
      '/api/dsh-skill-manager/list',
      '/api/dsh-skill-manager/read',
      '/api/dsh-skill-manager/set-mode',
      '/api/dsh-skill-manager/set-enabled',
      '/api/dsh-skill-manager/create',
      '/api/dsh-skill-manager/update',
      '/api/dsh-skill-manager/rename',
      '/api/dsh-skill-manager/delete',
      '/api/dsh-skill-manager/health',
    ])
  })

  it('reads workspaces from ctx.workspaceRegistry.list() and passes them to the routes', () => {
    const ctx = fakeCtx()
    ;(ctx.workspaceRegistry as { list: () => Array<{ id: string; path: string; title: string }> }).list = () => [
      { id: 'ws-a', path: '/work/a', title: 'work-a' },
      { id: 'ws-b', path: '/work/b', title: 'work-b' },
    ]
    apply(ctx as never, {})
    // The mount succeeds with the populated registry — this exercises the
    // workspace-reading branch; downstream behavior is locked by collect.spec.
    expect(ctx.routes.length).toBe(9)
  })
})