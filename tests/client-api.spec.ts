/**
 * SkillApi client-side tests: request headers, error handling, and defense
 * against third-party fetch wrappers that inspect init.headers.
 * test-standards-allow: client fetch wrapper unit tests
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, SkillApi } from '../src/client/api.ts'

describe('SkillApi', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('user listing skills gets an explicit Headers instance even without a body (issue #1609)', async () => {
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      if (init && 'headers' in init) {
        if (init.headers === undefined) {
          throw new TypeError("Cannot read properties of undefined (reading 'toString')")
        }
      }
      return new Response(JSON.stringify({ cwd: '/test', complete: true, groups: [], workspaces: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    const result = await api.list()

    expect(result.cwd).toBe('/test')
    expect(capturedInit?.headers).toBeInstanceOf(Headers)
    expect((capturedInit?.headers as Headers).get('content-type')).toBeNull()
  })

  it('user listing one directory gets its cwd URL-encoded', async () => {
    let capturedUrl: string | undefined
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return new Response(JSON.stringify({ cwd: '/my/path', complete: true, groups: [], workspaces: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await api.list('/my/path')

    expect(capturedUrl).toBe('api/dsh-skill-manager/list?cwd=%2Fmy%2Fpath')
  })

  it('user flipping the 4-state mode sends the canonical mode field', async () => {
    let capturedInit: RequestInit | undefined
    let capturedUrl: string | undefined
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({ ok: true, name: 'test-skill', path: '/p', mode: 'name-only' }), { status: 200 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await api.setMode('test-skill', '/p', 'name-only')

    expect(capturedUrl).toBe('api/dsh-skill-manager/set-mode')
    expect(capturedInit?.method).toBe('POST')
    expect((capturedInit?.headers as Headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      name: 'test-skill',
      path: '/p',
      mode: 'name-only',
    })
  })

  it('user enabling a skill sends application/json with the picked state (legacy route)', async () => {
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ name: 'test-skill', enabled: true, mode: 'on', modelInvocable: true }), { status: 200 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await api.setEnabled('test-skill', '/path/to/skill', true)

    expect(capturedInit?.method).toBe('POST')
    expect((capturedInit?.headers as Headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      name: 'test-skill',
      path: '/path/to/skill',
      enabled: true,
    })
  })

  it('user reading one skill gets name and path URL-encoded', async () => {
    let capturedUrl: string | undefined
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return new Response(JSON.stringify({ name: 'my skill', path: '/a b/SKILL.md', description: 'd', content: 'body' }), { status: 200 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    const result = await api.read('my skill', '/a b/SKILL.md')

    expect(capturedUrl).toBe('api/dsh-skill-manager/read?name=my%20skill&path=%2Fa%20b%2FSKILL.md')
    expect(result.content).toBe('body')
  })

  it('user saving an edit posts the edited fields + the new mode to the update route', async () => {
    let capturedInit: RequestInit | undefined
    let capturedUrl: string | undefined
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({ ok: true, name: 'test-skill', path: '/path/SKILL.md', mode: 'on' }), { status: 200 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await api.update({ name: 'test-skill', path: '/path/SKILL.md', description: 'new', whenToUse: 'when', content: 'body', mode: 'on' })

    expect(capturedUrl).toBe('api/dsh-skill-manager/update')
    expect(capturedInit?.method).toBe('POST')
    expect((capturedInit?.headers as Headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      name: 'test-skill',
      path: '/path/SKILL.md',
      description: 'new',
      whenToUse: 'when',
      content: 'body',
      mode: 'on',
    })
  })

  it('user renaming posts old + new names + the displayed path', async () => {
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ ok: true, oldName: 'a', newName: 'b', path: '/work/b/SKILL.md' }), { status: 200 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await api.rename('a', '/work/a/SKILL.md', 'b')

    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      name: 'a',
      path: '/work/a/SKILL.md',
      newName: 'b',
    })
  })

  it('user whose delete is rejected sees the server error message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'skill is locked' }), { status: 400 })
    }) as unknown as typeof fetch

    const api = new SkillApi()

    await expect(api.remove('test', '/path')).rejects.toThrow(ApiError)
    await expect(api.remove('test', '/path')).rejects.toThrow('skill is locked')
  })

  it('user hitting a non-JSON error sees the HTTP status instead', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Not Found', { status: 404 })
    }) as unknown as typeof fetch

    const api = new SkillApi()

    await expect(api.list()).rejects.toThrow('HTTP 404')
  })
})