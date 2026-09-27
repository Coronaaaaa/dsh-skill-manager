/**
 * The skill manager panel shell: a header with the back-to-conversation
 * control, a tab bar, and the active tab's content.
 *
 * The tab and the editor target live in the controller, not in component
 * state: the layout mounts this page only while the panel is selected, so
 * local state would drop the open tab and any in-progress edit on every panel
 * switch. The inactive tab unmounts, so the tab that needs the workspace
 * resolves it itself and the list refetches when it returns.
 *
 * The edit / rename tabs appear only while a skill is being edited or
 * renamed: the list row hands the chosen skill over, and leaving the editor
 * returns to the list.
 */
import { useSyncExternalStore } from 'react'
import { SkillApi } from '../api.ts'
import { tt } from '../panel-helpers.ts'
import type { PanelController, SkillTab } from './controller.ts'
import { CreateTab } from './CreateTab.tsx'
import { EditTab } from './EditTab.tsx'
import { RenameTab } from './RenameTab.tsx'
import { SkillsTab } from './SkillsTab.tsx'
import css from './panel.module.css'

/** Panel shell props. */
export interface SkillPanelProps {
  /** The panel state owner (open/close/toggle, active tab, editor target). */
  controller: PanelController
  /** The skill manager API client every tab operates through. */
  api: SkillApi
}

/** The skill manager panel. */
export function SkillPanel({ controller, api }: SkillPanelProps) {
  const { activeTab, editing, renaming } = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
  )

  const tabs: ReadonlyArray<{ id: SkillTab; label: () => string }> = [
    { id: 'skills', label: () => tt('tab.list') },
    { id: 'create', label: () => tt('tab.create') },
    ...(editing === undefined ? [] : [{ id: 'edit' as SkillTab, label: () => tt('tab.edit') }]),
    ...(renaming === undefined ? [] : [{ id: 'rename' as SkillTab, label: () => tt('tab.rename') }]),
  ]

  return (
    <div className={css.panel} data-dsh-plugin="skill-manager">
      <div className={css.panelHeader}>
        {/* Shared hook: dsh-web-all offsets center-view back controls beside the collapsed mobile sidebar. */}
        <button
          type="button"
          className={`${css.ghostButton} ${css.backButton}`}
          aria-label={tt('panel.backToConversation')}
          data-dsh-center-view-back=""
          onClick={() => { controller.close() }}
        >
          <span aria-hidden="true">‹</span>
          <span>{tt('panel.backToConversation')}</span>
        </button>
        <h2 className={css.panelTitle}>{tt('panel.title')}</h2>
      </div>
      <div className={css.tabBar} role="tablist" data-dsh-part="tab-bar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-active={activeTab === tab.id ? '' : undefined}
            data-dsh-part="tab"
            className={css.tab}
            onClick={() => { controller.setActiveTab(tab.id) }}
          >
            {tab.label()}
          </button>
        ))}
      </div>
      <div className={css.panelContent}>
        {activeTab === 'skills' && (
          <SkillsTab
            api={api}
            onEdit={skill => { controller.openEditor(skill) }}
            onRename={skill => { controller.openRename(skill) }}
          />
        )}
        {activeTab === 'create' && <CreateTab api={api} />}
        {activeTab === 'edit' && editing !== undefined && (
          <EditTab
            api={api}
            skill={editing}
            onDone={() => { controller.closeEditor() }}
            onCancel={() => { controller.closeEditor() }}
          />
        )}
        {activeTab === 'rename' && renaming !== undefined && (
          <RenameTab
            api={api}
            skill={renaming}
            onDone={() => { controller.closeRename() }}
            onCancel={() => { controller.closeRename() }}
          />
        )}
      </div>
    </div>
  )
}