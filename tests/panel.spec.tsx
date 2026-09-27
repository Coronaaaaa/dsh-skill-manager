/**
 * Panel interaction tests (jsdom): the shell (header, tabs, back control), the
 * last-good list policy when a refresh fails, mutation identity, the create
 * tab's lazy workspace resolution, the loading state, and the edit flow.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InvocationMode, ListPayload, SkillEntry } from '../src/client/api.ts'
import { PanelController } from '../src/client/panel/controller.ts'
import { SkillPanel } from '../src/client/panel/SkillPanel.tsx'

interface CreateArgs {
  scope: 'user-dsh' | 'user-agents' | 'project-dsh' | 'project-agents'
  name: string
  description: string
  whenToUse?: string
  content: string
  cwd: string
  mode: InvocationMode
}

/** Minimal fake api: list is controllable per call, other methods overridable. */
function fakeApi(listResults: Array<() => Promise<ListPayload>>, overrides: Record<string, unknown> = {}) {
  let calls = 0
  return {
    calls: () => calls,
    list: async () => { const fn = listResults[Math.min(calls, listResults.length - 1)]; calls += 1; return fn() },
    setMode: async (_name: string, _path: string, _mode: InvocationMode) => ({ ok: true as const, name: _name, path: _path, mode: _mode }),
    setEnabled: async (_name: string, _path: string, _enabled: boolean) => ({ name: _name, enabled: _enabled, mode: 'on' as InvocationMode, modelInvocable: _enabled }),
    remove: async (_name: string, _path: string) => ({ ok: true as const, name: _name, moved: '' }),
    rename: async (_name: string, _path: string, _newName: string) => ({ ok: true as const, oldName: _name, newName: _newName, path: '' }),
    create: async (args: CreateArgs) => ({ ok: true as const, name: args.name, path: '/work/' + args.name + '/SKILL.md', mode: args.mode }),
    read: async (name: string, path: string) => ({ name, path, description: '', content: '' }),
    update: async () => { throw new Error('unused') },
    ...overrides,
  }
}

/** One skill entry the panel can render. */
function skill(name: string, mode: InvocationMode = 'on'): SkillEntry {
  return {
    name,
    description: 'desc',
    source: 'dsh',
    scope: 'global',
    path: `/work/${name}/SKILL.md`,
    mode,
    modelInvocable: mode !== 'off' && mode !== 'user-invocable-only',
    userInvocable: mode !== 'off',
  }
}

const payload = (names: string[]): ListPayload => ({
  cwd: '/work',
  complete: true,
  workspaces: [{ id: 'ws', path: '/work', title: 'work', active: true }],
  groups: [{
    key: 'workspace:ws',
    title: 'work',
    hint: '/work',
    scope: 'workspace',
    workspacePath: '/work',
    isActive: true,
    subGroups: [{
      key: 'dsh',
      title: '.dsh/skills',
      hint: '',
      skills: names.map(name => skill(name)),
    }],
  }],
})

function mount(api: ReturnType<typeof fakeApi>, controller: PanelController = new PanelController()): {
  container: HTMLDivElement
  controller: PanelController
  dispose: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<SkillPanel api={api as never} controller={controller} />)
  })
  return {
    container,
    controller,
    dispose: () => {
      root.unmount()
      container.remove()
    },
  }
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

/** Click the tab whose label matches. */
async function openTab(container: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    const tab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    tab?.click()
  })
}

/** Type into a controlled input/textarea the way React expects. */
async function typeInto(element: HTMLElement, value: string): Promise<void> {
  const prototype = element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  await act(async () => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SkillPanel shell', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('user opening the panel sees the back control and a title without a workspace path (#1215)', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    const header = mount_.container.querySelector('[data-dsh-center-view-back]')?.parentElement
    expect(header?.textContent).toContain('技能管理')
    expect(header?.textContent).toContain('返回会话')
    expect(header?.textContent).not.toContain('cwd:')
    mount_.dispose()
  })

  it('user opening the panel sees the family semantic attributes and the active tab', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    const panel = mount_.container.querySelector('[data-dsh-plugin="skill-manager"]')
    expect(panel).toBeInstanceOf(HTMLDivElement)
    const tabs = Array.from(mount_.container.querySelectorAll('[data-dsh-part="tab"]'))
    expect(tabs.map(tab => tab.textContent)).toEqual(['技能', '创建'])
    expect(tabs[0]?.hasAttribute('data-active')).toBe(true)
    expect(tabs[1]?.hasAttribute('data-active')).toBe(false)
    mount_.dispose()
  })

  it('user pressing the back control leaves the panel, and Escape does not', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    // Escape doesn't change the controller (the host listens separately).
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(mount_.controller.getSnapshot().panelOpen).toBe(false)
    // The back control closes the panel.
    mount_.controller.open()
    await act(async () => {
      const back = mount_.container.querySelector('[data-dsh-center-view-back]') as HTMLButtonElement
      back.click()
    })
    expect(mount_.controller.getSnapshot().panelOpen).toBe(false)
    mount_.dispose()
  })

  it('user switching to the create tab sees the create form', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '创建')
    expect(mount_.container.querySelector('form')).toBeInstanceOf(HTMLFormElement)
    expect(mount_.container.textContent).toContain('创建位置')
    mount_.dispose()
  })

  it('user sees the per-row mode selector with the four valid states', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    const select = mount_.container.querySelector('select[data-mode]') as HTMLSelectElement
    expect(select).toBeInstanceOf(HTMLSelectElement)
    expect(select.value).toBe('on')
    const options = Array.from(select.querySelectorAll('option')).map(o => o.value)
    expect(options).toEqual(['on', 'name-only', 'user-invocable-only', 'off'])
    mount_.dispose()
  })

  it('user opening the rename tab sees the rename form', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    // Click the rename link on the row.
    const rename = Array.from(mount_.container.querySelectorAll('button')).find(b => b.textContent?.trim() === '重命名')
    expect(rename).toBeInstanceOf(HTMLButtonElement)
    await act(async () => { rename!.click() })
    await flush()
    expect(mount_.container.textContent).toContain('当前名称')
    expect(mount_.container.textContent).toContain('新名称（kebab-case）')
    mount_.dispose()
  })
})

describe('SkillPanel create tab', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('user creating a skill right after opening the panel gets the workspace resolved once', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const create = vi.fn(async (args: CreateArgs) => ({ ok: true as const, name: args.name, path: '/work/' + args.name + '/SKILL.md', mode: args.mode }))
    api.create = create
    const mount_ = mount(api)
    await flush()
    const firstCallCount = api.calls()
    await openTab(mount_.container, '创建')
    const inputs = mount_.container.querySelectorAll('input')
    await typeInto(inputs[0]!, 'my-workflow')
    await typeInto(inputs[1]!, 'demo skill')
    await typeInto(mount_.container.querySelector('textarea')!, '# steps')
    await act(async () => {
      const submit = Array.from(mount_.container.querySelectorAll('button')).find(b => b.textContent?.trim() === '创建技能')
      submit?.click()
    })
    await flush()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0].cwd).toBe('/work')
    expect(create.mock.calls[0]![0].name).toBe('my-workflow')
    expect(api.calls()).toBe(firstCallCount + 1)
    expect(mount_.container.textContent).toContain('已创建')
    mount_.dispose()
  })

  it('user submitting an empty create form sees the validation banner', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const create = vi.fn(async (args: CreateArgs) => ({ ok: true as const, name: args.name, path: '/', mode: args.mode }))
    api.create = create
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '创建')
    await act(async () => {
      const submit = Array.from(mount_.container.querySelectorAll('button')).find(b => b.textContent?.trim() === '创建技能')
      submit?.click()
    })
    expect(create).not.toHaveBeenCalled()
    expect(mount_.container.textContent).toContain('技能名/描述/内容不能为空')
    mount_.dispose()
  })
})

describe('SkillPanel loading state', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function hasRefresh(container: HTMLElement): boolean {
    return Array.from(container.querySelectorAll('button')).some(button => button.textContent?.trim() === '刷新')
  }

  it('user opening the panel sees no refresh control while the list loads', async () => {
    let releaseInitial: (() => void) | undefined
    let releaseRefresh: (() => void) | undefined
    const api = fakeApi([
      async () => new Promise<ListPayload>((resolve) => {
        releaseInitial = () => { resolve(payload(['demo-skill'])) }
      }),
      async () => new Promise<ListPayload>((resolve) => {
        releaseRefresh = () => { resolve(payload(['demo-skill'])) }
      }),
    ])
    const mount_ = mount(api)
    expect(mount_.container.textContent).toContain('加载中')
    expect(hasRefresh(mount_.container)).toBe(false)
    await act(async () => { releaseInitial?.() })
    await flush()
    expect(hasRefresh(mount_.container)).toBe(true)
    await act(async () => {
      const refresh = Array.from(mount_.container.querySelectorAll('button')).find(button => button.textContent?.trim() === '刷新')
      refresh?.click()
    })
    expect(hasRefresh(mount_.container)).toBe(false)
    await act(async () => { releaseRefresh?.() })
    await flush()
    expect(hasRefresh(mount_.container)).toBe(true)
    mount_.dispose()
  })

  it('user whose first load fails keeps the refresh control as the retry path', async () => {
    const api = fakeApi([async () => { throw new Error('boom') }])
    const mount_ = mount(api)
    await flush()
    expect(mount_.container.textContent).toContain('boom')
    expect(hasRefresh(mount_.container)).toBe(true)
    mount_.dispose()
  })
})

describe('SkillPanel last-good list policy', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('user refreshing after a failure keeps the previous list and sees the error', async () => {
    const api = fakeApi([
      async () => payload(['demo-skill']),
      async () => { throw new Error('boom') },
    ])
    const mount_ = mount(api)
    await flush()
    expect(mount_.container.textContent).toContain('demo-skill')
    await act(async () => {
      const refresh = Array.from(mount_.container.querySelectorAll('button')).find(b => b.textContent?.trim() === '刷新')
      refresh?.click()
    })
    await flush()
    const text = mount_.container.textContent ?? ''
    expect(text).toContain('demo-skill')
    expect(text).toContain('boom')
    mount_.dispose()
  })
})

describe('SkillPanel mutation identity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('user changing the mode selector certifies the displayed path', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const setMode = vi.fn(async (name: string, path: string, mode: InvocationMode) => ({ ok: true as const, name, path, mode }))
    api.setMode = setMode
    const mount_ = mount(api)
    await flush()
    const select = mount_.container.querySelector('select[data-mode]') as HTMLSelectElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, 'user-invocable-only')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(setMode).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md', 'user-invocable-only')
    mount_.dispose()
  })

  it('user deleting a skill certifies the displayed path', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = fakeApi([async () => payload(['demo-skill'])])
    const remove = vi.fn(async () => ({ ok: true as const, name: 'demo-skill', moved: '/trash/SKILL.md' }))
    api.remove = remove
    const mount_ = mount(api)
    await flush()
    const deleteButton = Array.from(mount_.container.querySelectorAll('button')).find(button => button.textContent?.trim() === '删除')
    await act(async () => {
      deleteButton?.click()
    })
    await flush()
    expect(remove).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md')
    mount_.dispose()
  })

  it('user renaming a skill certifies the displayed path and gets the new path back', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const rename = vi.fn(async () => ({ ok: true as const, oldName: 'demo-skill', newName: 'renamed-skill', path: '/work/renamed-skill/SKILL.md' }))
    api.rename = rename
    const mount_ = mount(api)
    await flush()
    const renameButton = Array.from(mount_.container.querySelectorAll('button')).find(b => b.textContent?.trim() === '重命名')
    await act(async () => {
      renameButton?.click()
    })
    await flush()
    // The rename tab is open; type a new name and submit.
    const newInput = Array.from(mount_.container.querySelectorAll('input')).find(i => i.readOnly === false) as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(newInput, 'renamed-skill')
      newInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = mount_.container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    expect(rename).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md', 'renamed-skill')
    mount_.dispose()
  })
})

describe('SkillPanel search filter (#1423)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const searchPayload: ListPayload = {
    cwd: '/work',
    complete: true,
    workspaces: [{ id: 'ws', path: '/work', title: 'work', active: true }],
    groups: [{
      key: 'workspace:ws',
      title: 'work',
      hint: '/work',
      scope: 'workspace',
      workspacePath: '/work',
      isActive: true,
      subGroups: [{
        key: 'dsh',
        title: '.dsh/skills',
        hint: '',
        skills: [
          { name: 'gamma-skill', description: 'unrelated', source: 'dsh', scope: 'workspace', workspacePath: '/work', path: '/work/gamma-skill/SKILL.md', mode: 'on', modelInvocable: true, userInvocable: true },
          { name: 'beta-skill', description: 'alpha related helper', source: 'dsh', scope: 'workspace', workspacePath: '/work', path: '/work/beta-skill/SKILL.md', mode: 'on', modelInvocable: true, userInvocable: true },
          { name: 'alpha-skill', description: 'first helper', source: 'dsh', scope: 'workspace', workspacePath: '/work', path: '/work/alpha-skill/SKILL.md', mode: 'on', modelInvocable: true, userInvocable: true },
        ],
      }],
    }],
  }

  async function typeSearch(container: HTMLElement, value: string): Promise<void> {
    await typeInto(container.querySelector('input[type="search"]')!, value)
  }

  function rows(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[data-dsh-part="skill-row"]')).map(row => row.querySelector('span')?.textContent ?? '')
  }

  it('user typing a query sees name hits before description hits', async () => {
    const api = fakeApi([async () => searchPayload])
    const mount_ = mount(api)
    await flush()
    expect(rows(mount_.container)).toHaveLength(3)
    await typeSearch(mount_.container, 'ALPHA')
    expect(rows(mount_.container)).toEqual(['alpha-skill', 'beta-skill'])
    mount_.dispose()
  })

  it('user searching for an unmatched query sees the empty state', async () => {
    const api = fakeApi([async () => searchPayload])
    const mount_ = mount(api)
    await flush()
    await typeSearch(mount_.container, 'zzz')
    expect(rows(mount_.container)).toHaveLength(0)
    expect(mount_.container.textContent).toContain('没有匹配「zzz」的技能')
    mount_.dispose()
  })

  it('user pressing Escape in the search box clears the query', async () => {
    const api = fakeApi([async () => searchPayload])
    const mount_ = mount(api)
    await flush()
    await typeSearch(mount_.container, 'alpha')
    expect(rows(mount_.container)).toHaveLength(2)
    const input = mount_.container.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(rows(mount_.container)).toHaveLength(3)
    mount_.dispose()
  })
})

describe('SkillPanel edit flow (#1622)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('user editing a skill from its card saves the edited fields and the new mode', async () => {
    const read = vi.fn(async (name: string, path: string) => ({ name, path, description: '旧描述', whenToUse: '旧场景', content: '# 旧正文' }))
    const update = vi.fn(async (payload: { name: string; path: string; description: string; whenToUse?: string; content: string; mode: InvocationMode }) => ({
      ok: true as const,
      name: payload.name,
      path: payload.path,
      mode: payload.mode,
    }))
    const api = fakeApi([async () => payload(['demo-skill'])], { read, update })
    const mount_ = mount(api)
    await flush()

    const editButton = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '编辑')
    expect(editButton).toBeInstanceOf(HTMLButtonElement)
    await act(async () => { editButton!.click() })
    await flush()
    await flush()

    expect(read).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md')
    const description = Array.from(mount_.container.querySelectorAll('input')).find((input) => input.value === '旧描述') as HTMLInputElement
    expect(description).toBeInstanceOf(HTMLInputElement)
    expect(Array.from(mount_.container.querySelectorAll('input')).some((input) => input.value === 'demo-skill' && input.readOnly)).toBe(true)
    expect((mount_.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('# 旧正文')

    // Change description + flip mode to user-invocable-only.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(description, '新描述')
      description.dispatchEvent(new Event('input', { bubbles: true }))
      const modeSelect = mount_.container.querySelector('select:not([data-mode])') as HTMLSelectElement
      const modeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      modeSetter.call(modeSelect, 'user-invocable-only')
      modeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const form = mount_.container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0]![0]).toMatchObject({
      name: 'demo-skill',
      path: '/work/demo-skill/SKILL.md',
      description: '新描述',
      whenToUse: '旧场景',
      content: '# 旧正文',
      mode: 'user-invocable-only',
    })
    await flush()

    const savedRow = mount_.container.querySelector('[data-dsh-part="skill-row"]')
    expect(savedRow?.textContent).toContain('demo-skill')
    mount_.dispose()
  })

  it('user whose skill read fails sees the failure instead of an empty form', async () => {
    const read = vi.fn(async () => { throw new Error('gone') })
    const api = fakeApi([async () => payload(['demo-skill'])], { read })
    const mount_ = mount(api)
    await flush()

    const editButton = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '编辑')
    await act(async () => { editButton!.click() })
    await flush()
    await flush()

    expect(mount_.container.textContent).toContain('读取失败：gone')
    mount_.dispose()
  })
})