/**
 * Workspace isolation and multi-workspace presentation tests: every registered
 * workspace becomes its own top-level group, the active workspace carries an
 * "active" tag, and the panel filter lets the user focus on one.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { buildPayload, collectSkills, type WorkspaceDescriptor } from '../src/collect.ts'
import { PanelController } from '../src/client/panel/controller.ts'
import { SkillPanel } from '../src/client/panel/SkillPanel.tsx'
import type { ListPayload } from '../src/client/api.ts'

const TMP = mkdtempSync(join(tmpdir(), 'skill-ws-test-'))
const PROJ_A = join(TMP, 'workspace-a')
const PROJ_B = join(TMP, 'workspace-b')
const HOME = join(TMP, 'home')
const AGENTS = join(TMP, 'agents')

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

// Workspace A (Active)
write(join(PROJ_A, '.git', 'keep'), '')
write(join(PROJ_A, '.dsh', 'skills', 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: Skill in Workspace A\n---\n# Code A\n')
// Conflict skill in both A and B
write(join(PROJ_A, '.dsh', 'skills', 'conflict-skill', 'SKILL.md'), '---\nname: conflict-skill\ndescription: Conflict skill from Workspace A\n---\n')

// Workspace B (Inactive)
write(join(PROJ_B, '.git', 'keep'), '')
write(join(PROJ_B, '.dsh', 'skills', 'skill-b', 'SKILL.md'), '---\nname: skill-b\ndescription: Skill in Workspace B\n---\n# Code B\n')
write(join(PROJ_B, '.dsh', 'skills', 'conflict-skill', 'SKILL.md'), '---\nname: conflict-skill\ndescription: Conflict skill from Workspace B\n---\n')

// User skill
write(join(HOME, 'skills', 'global-user', 'SKILL.md'), '---\nname: global-user\ndescription: Global user skill\n---\n')

const dummyRegistry = {
  snapshot: async () => ({ skills: [], complete: true }),
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

const workspaces: WorkspaceDescriptor[] = [
  { id: 'ws-a', path: PROJ_A, title: 'workspace-a', active: true },
  { id: 'ws-b', path: PROJ_B, title: 'workspace-b', active: false },
]

describe('collectSkills and buildPayload workspace awareness', () => {
  it('identifies active and inactive workspaces and resolves conflict towards active workspace', async () => {
    const result = await collectSkills({
      cwd: PROJ_A,
      workspaces,
      dshHome: HOME,
      agentsHome: AGENTS,
      registry: dummyRegistry,
    })

    const skillA = result.skills.find((s) => s.name === 'skill-a')
    expect(skillA).toBeDefined()
    expect(skillA?.workspacePath).toBe(PROJ_A)
    expect(skillA?.workspaceName).toBe('workspace-a')
    expect(skillA?.isActiveWorkspace).toBe(true)

    const skillB = result.skills.find((s) => s.name === 'skill-b')
    expect(skillB).toBeDefined()
    expect(skillB?.workspacePath).toBe(PROJ_B)
    expect(skillB?.workspaceName).toBe('workspace-b')
    expect(skillB?.isActiveWorkspace).toBe(false)

    // Conflict resolution: active workspace skill should win
    const conflict = result.skills.find((s) => s.name === 'conflict-skill')
    expect(conflict).toBeDefined()
    expect(conflict?.description).toBe('Conflict skill from Workspace A')
    expect(conflict?.isActiveWorkspace).toBe(true)

    // Global skill has no workspace
    const globalSkill = result.skills.find((s) => s.name === 'global-user')
    expect(globalSkill).toBeDefined()
    expect(globalSkill?.workspacePath).toBeUndefined()
    expect(globalSkill?.isActiveWorkspace).toBeUndefined()

    // buildPayload emits one group per workspace + a trailing global group.
    const payload = buildPayload(result.skills, result.complete, workspaces)
    expect(payload.workspaces.length).toBe(2)
    expect(payload.groups.length).toBe(3)
    expect(payload.groups[0].key).toBe(`workspace:${workspaces[0].id}`)
    expect(payload.groups[0].isActive).toBe(true)
    expect(payload.groups[1].key).toBe(`workspace:${workspaces[1].id}`)
    expect(payload.groups[1].isActive).toBe(false)
    expect(payload.groups[2].scope).toBe('global')
  })
})

describe('SkillPanel workspace presentation and filtering', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders workspace group headers, mode selectors, and the workspace filter', async () => {
    const testPayload: ListPayload = {
      cwd: '/path/ws-a',
      complete: true,
      workspaces: [
        { id: 'ws-a', path: '/path/ws-a', title: 'ws-a', active: true },
        { id: 'ws-b', path: '/path/ws-b', title: 'ws-b', active: false },
      ],
      groups: [
        {
          key: 'workspace:ws-a',
          title: 'ws-a',
          hint: '/path/ws-a',
          scope: 'workspace',
          workspacePath: '/path/ws-a',
          isActive: true,
          subGroups: [{
            key: 'dsh',
            title: '.dsh/skills',
            hint: '',
            skills: [{
              name: 'proj-skill-a',
              description: 'Skill in A',
              source: 'dsh',
              scope: 'workspace',
              workspacePath: '/path/ws-a',
              workspaceName: 'ws-a',
              isActiveWorkspace: true,
              path: '/path/ws-a/.dsh/skills/proj-skill-a/SKILL.md',
              mode: 'on',
              modelInvocable: true,
              userInvocable: true,
            }],
          }],
        },
        {
          key: 'workspace:ws-b',
          title: 'ws-b',
          hint: '/path/ws-b',
          scope: 'workspace',
          workspacePath: '/path/ws-b',
          isActive: false,
          subGroups: [{
            key: 'dsh',
            title: '.dsh/skills',
            hint: '',
            skills: [{
              name: 'proj-skill-b',
              description: 'Skill in B',
              source: 'dsh',
              scope: 'workspace',
              workspacePath: '/path/ws-b',
              workspaceName: 'ws-b',
              isActiveWorkspace: false,
              path: '/path/ws-b/.dsh/skills/proj-skill-b/SKILL.md',
              mode: 'on',
              modelInvocable: true,
              userInvocable: true,
            }],
          }],
        },
      ],
    }

    const fakeApi = {
      list: async () => testPayload,
      setMode: async () => ({ ok: true as const, name: '', path: '', mode: 'on' as const }),
      setEnabled: async () => ({ name: '', enabled: true, mode: 'on' as const, modelInvocable: true }),
      remove: async () => ({ ok: true as const, name: '', moved: '' }),
      rename: async () => ({ ok: true as const, oldName: '', newName: '', path: '' }),
      create: async () => { throw new Error('unused') },
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(SkillPanel, { api: fakeApi as never, controller: new PanelController() }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Both workspace group headers render.
    expect(container.textContent).toContain('ws-a')
    expect(container.textContent).toContain('ws-b')

    // Active workspace carries the "current" tag.
    const activeHeader = container.querySelector('[data-workspace-key="workspace:ws-a"]')
    expect(activeHeader?.hasAttribute('data-active')).toBe(true)
    const inactiveHeader = container.querySelector('[data-workspace-key="workspace:ws-b"]')
    expect(inactiveHeader?.hasAttribute('data-active')).toBe(false)

    // Both rows render with their workspace name badge.
    const rows = container.querySelectorAll('[data-dsh-part="skill-row"]')
    expect(rows.length).toBe(2)

    // Mode selector is present on each row.
    const selects = container.querySelectorAll('select[data-mode]')
    expect(selects.length).toBe(2)

    // Dropdown filter rendered (All + ws-a + ws-b + Global).
    // Selects on the page: one per skill row (mode selector) plus one
    // workspace picker when more than 2 workspaces are present.
    const workspaceSelect = Array.from(container.querySelectorAll('select'))
      .find((el) => !el.hasAttribute('data-mode')) as HTMLSelectElement
    expect(workspaceSelect).not.toBeUndefined()
    expect(workspaceSelect.options.length).toBe(4)

    // Filter to ws-a only: only one row remains.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(workspaceSelect, '/path/ws-a')
      workspaceSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const filteredRows = container.querySelectorAll('[data-dsh-part="skill-row"]')
    expect(filteredRows.length).toBe(1)
    expect(filteredRows[0].textContent).toContain('proj-skill-a')

    root.unmount()
    container.remove()
  })
})