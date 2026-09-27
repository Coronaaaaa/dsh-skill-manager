/**
 * Skill manager panel state ownership.
 *
 * The panel's tab and editor target live in the controller because the layout
 * mounts a keyed main page only while its panel is selected: component-local
 * state would drop the open tab and any in-progress edit on every panel
 * switch. These cases lock that contract, plus the layout handshake the native
 * registration depends on.
 */
import { describe, expect, it } from 'vitest'
import type { SkillEntry } from '../src/client/api.ts'
import { PanelController, SKILL_MANAGER_PANEL_ID } from '../src/client/panel/controller.ts'

/** A skill row the editor can be opened for. */
function skill(name: string): SkillEntry {
  return {
    name,
    description: '',
    source: 'dsh',
    scope: 'global',
    mode: 'on',
    modelInvocable: true,
    userInvocable: true,
  }
}

/** A controller plus the panel ids it asked the layout to select. */
function withPanelFace() {
  const selections: Array<string | null> = []
  const controller = new PanelController({ panel: { select: id => { selections.push(id) } } })
  return { controller, selections }
}

describe('skill manager panel state', () => {
  it('operator sees the open tab survive a panel switch away and back', () => {
    const { controller } = withPanelFace()
    controller.open()
    controller.setActiveTab('create')

    controller.syncPanelSelection(null)
    controller.syncPanelSelection(SKILL_MANAGER_PANEL_ID)

    expect(controller.getSnapshot().activeTab).toBe('create')
    expect(controller.getSnapshot().panelOpen).toBe(true)
  })

  it('operator editing a skill sees the edit target survive a panel switch', () => {
    const { controller } = withPanelFace()
    controller.open()
    controller.openEditor(skill('alpha'))

    controller.syncPanelSelection(null)
    controller.syncPanelSelection(SKILL_MANAGER_PANEL_ID)

    expect(controller.getSnapshot().activeTab).toBe('edit')
    expect(controller.getSnapshot().editing?.name).toBe('alpha')

    controller.closeEditor()
    expect(controller.getSnapshot().activeTab).toBe('skills')
    expect(controller.getSnapshot().editing).toBeUndefined()
  })

  it('operator renaming a skill sees the rename target survive a panel switch', () => {
    const { controller } = withPanelFace()
    controller.open()
    controller.openRename(skill('beta'))

    controller.syncPanelSelection(null)
    controller.syncPanelSelection(SKILL_MANAGER_PANEL_ID)

    expect(controller.getSnapshot().activeTab).toBe('rename')
    expect(controller.getSnapshot().renaming?.name).toBe('beta')

    controller.closeRename()
    expect(controller.getSnapshot().activeTab).toBe('skills')
    expect(controller.getSnapshot().renaming).toBeUndefined()
  })

  it('operator opening the panel sees the layout asked to select it', () => {
    const { controller, selections } = withPanelFace()

    controller.open()
    controller.close()

    expect(selections).toEqual([SKILL_MANAGER_PANEL_ID, null])
  })

  it('operator selecting another panel row sees the controller follow the layout', () => {
    const { controller } = withPanelFace()
    controller.open()

    controller.syncPanelSelection('task-board')

    expect(controller.getSnapshot().panelOpen).toBe(false)
  })

  it('operator sees a snapshot stay stable until something changes', () => {
    const { controller } = withPanelFace()

    const first = controller.getSnapshot()
    const second = controller.getSnapshot()

    expect(second).toBe(first)

    controller.setActiveTab('create')
    expect(controller.getSnapshot()).not.toBe(first)
  })

  it('operator opening the rename tab while editing sees only the rename target set', () => {
    const { controller } = withPanelFace()
    controller.open()
    controller.openEditor(skill('alpha'))
    controller.openRename(skill('beta'))

    expect(controller.getSnapshot().editing).toBeUndefined()
    expect(controller.getSnapshot().renaming?.name).toBe('beta')
    expect(controller.getSnapshot().activeTab).toBe('rename')
  })
})