// @vitest-environment jsdom
/**
 * The skill manager's registrations validated against the REAL slot core.
 *
 * Every other spec in this package drives a fake seats service, so it checks
 * the wiring but not the registry's own rules: that a keyed slot admits one
 * entry per key, that a list entry carries the id/order/label shape its kind
 * requires, and that disposal releases what was registered. This spec runs
 * `registerSkillManagerPanel` against the genuine `SlotCore` the running
 * shell installs, so an option shape the registry rejects fails here instead
 * of in the GUI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillApi } from '../src/client/api.ts'
import { registerSkillManagerPanel } from '../src/client/native-panel.tsx'
import { PanelController } from '../src/client/panel/controller.ts'

/** A controller with no layout face: the registration drives its own state. */
function controller(): PanelController {
  return new PanelController()
}

/** The API face the page receives; the registration never calls it. */
const api = {} as SkillApi

/**
 * A client context whose slots service is the real SlotCore. `inject` answers
 * immediately (the real one defers until ui-layout / ui-sidebar declare the
 * seats), which is the point: the core itself validates the option shapes.
 *
 * The core only admits a registration into a DECLARED seat, so the harness
 * declares the two seats the way the shell does.
 */
function realCoreContext() {
  const core = new SlotCore()
  const slots = {
    register: (options: never, component: never) => core.register(options, component as never),
    inject: (_key: string, callback: () => () => void) => callback(),
  }
  const ctx = {
    effect(callback: () => void | (() => void)) { callback() },
    get: () => undefined,
    on: () => () => {},
    slots,
  }
  return { ctx: ctx as never, core, declare: () => {
    core.register({
      name: 'root',
      children: {
        main: { kind: 'keyed', scope: 'root' },
        sidebar: { kind: 'single', scope: 'root' },
      },
    } as never, (() => null) as never)
    core.register({
      name: 'sidebar',
      children: {
        'sidebar.panellist': { kind: 'list', scope: 'root' },
      },
    } as never, (() => null) as never)
  } }
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })

describe('skill-manager registrations against the real slot core', () => {
  it('operator sees the skill manager occupy the keyed main seat and a list row seat', () => {
    const { ctx, core, declare } = realCoreContext()
    declare()

    const dispose = registerSkillManagerPanel(ctx, controller(), api)

    const main = core.entries('main')
    const rows = core.entries('sidebar.panellist')
    expect(main).toHaveLength(1)
    expect(main[0]!.options.key).toBe('skill-manager')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.options.id).toBe('skill-manager')
    expect(rows[0]!.options.order).toBe(30)

    dispose()
    expect(core.entries('main')).toHaveLength(0)
    expect(core.entries('sidebar.panellist')).toHaveLength(0)
  })

  it('operator switching language sees the row label resolve through the registry', () => {
    const { ctx, core, declare } = realCoreContext()
    declare()
    const dispose = registerSkillManagerPanel(ctx, controller(), api)

    const label = core.entries('sidebar.panellist')[0]!.options.label

    expect(typeof label).toBe('function')
    const text = (label as () => string)()
    expect(text).not.toBe('entry.label')
    expect(text.length).toBeGreaterThan(0)

    dispose()
  })

  it('operator sees a duplicate panel registration refused, never silently duplicated', () => {
    const { ctx, declare } = realCoreContext()
    declare()
    registerSkillManagerPanel(ctx, controller(), api)

    expect(() => registerSkillManagerPanel(ctx, controller(), api)).toThrow(/already has an entry/)
  })
})