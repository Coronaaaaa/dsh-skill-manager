/**
 * Skills tab: the grouped skill list with the search / workspace toolbar and
 * the per-row mode selector, edit / rename / delete actions.
 *
 * The host route family is the only data source; a failed refresh keeps the
 * previous payload visible with an inline error.
 *
 * Layout: top-level groups are workspaces (one group per workspace row +
 * one global group for ~/.dsh/skills, ~/.agents/skills, custom and bundled).
 * Inside each workspace group, skills are sub-grouped by source
 * (.dsh/skills / .agents/skills). The active workspace gets a "current" tag
 * so the user can find it without reading paths.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { INVOCATION_MODES, SkillApi, type InvocationMode, type ListPayload, type SkillEntry, type SubGroupPayload, type WorkspaceGroupPayload } from '../api.ts'
import { tt } from '../panel-helpers.ts'
import { selectGroups } from '../skill-filter.ts'
import css from './panel.module.css'

/** Short label per mode (used inside pills and the row header). */
function modeShortLabel(mode: InvocationMode): string {
  const map: Record<InvocationMode, string> = {
    on: tt('mode.on'),
    'name-only': tt('mode.nameOnly'),
    'user-invocable-only': tt('mode.userOnly'),
    off: tt('mode.off'),
  }
  return map[mode]
}

/** Long hint per mode (used for tooltips on the selector). */
function modeHint(mode: InvocationMode): string {
  const map: Record<InvocationMode, string> = {
    on: tt('mode.onHint'),
    'name-only': tt('mode.nameOnlyHint'),
    'user-invocable-only': tt('mode.userOnlyHint'),
    off: tt('mode.offHint'),
  }
  return map[mode]
}

/** The 4-state selector: a small dropdown that rewrites the SKILL.md frontmatter. */
function ModeSelector({ skill, api, onChanged }: { skill: SkillEntry; api: SkillApi; onChanged: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  // Sync ref guard: a double click before the re-render would fire twice.
  const busyRef = useRef(false)

  const change = async (next: InvocationMode): Promise<void> => {
    if (busyRef.current) return
    const path = skill.path
    if (path === undefined) return
    if (next === skill.mode) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await api.setMode(skill.name, path, next)
      onChanged()
    } catch (err) {
      setError(tt('mode.changeFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className={css.modeCell}>
      <select
        className={css.modeSelect}
        value={skill.mode}
        disabled={busy || skill.path === undefined}
        title={modeHint(skill.mode)}
        data-mode={skill.mode}
        onChange={(event) => { void change(event.target.value as InvocationMode) }}
      >
        {INVOCATION_MODES.map((mode) => (
          <option key={mode} value={mode} title={modeHint(mode)}>{modeShortLabel(mode)}</option>
        ))}
      </select>
      {error !== undefined && <span className={css.modeError} data-kind="error">{error}</span>}
    </div>
  )
}

/** One skill row: name, badges, mode selector, edit / rename / delete actions. */
function SkillRow({
  skill,
  api,
  onChanged,
  onEdit,
  onRename,
}: {
  skill: SkillEntry
  api: SkillApi
  onChanged: () => void
  onEdit: (skill: SkillEntry) => void
  onRename: (skill: SkillEntry) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  // Sync ref guard: a double click before the re-render would fire twice.
  const busyRef = useRef(false)

  const remove = async (): Promise<void> => {
    const path = skill.path
    if (path === undefined) return
    if (!window.confirm(tt('list.deleteConfirm', { name: skill.name }))) return
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await api.remove(skill.name, path)
      onChanged()
    } catch (err) {
      setError(tt('list.deleteFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const isLinked = skill.linked === true
  const pathEditable = skill.path !== undefined

  return (
    <article className={css.skillRow} data-dsh-part="skill-row" data-skill-name={skill.name}>
      <header className={css.skillHeader}>
        <span className={css.skillName}>{skill.name}</span>
        {skill.workspaceName !== undefined && (
          <span className={`${css.badge} ${css.badgeWorkspace}`}>{skill.workspaceName}</span>
        )}
        {skill.provider !== undefined && (
          <span className={css.badge} title={skill.provider}>
            {skill.provider}
          </span>
        )}
        {isLinked && <span className={css.badge}>{tt('list.linked')}</span>}
        <div className={css.headerSpacer} />
        {pathEditable && (
          <ModeSelector skill={skill} api={api} onChanged={onChanged} />
        )}
        {pathEditable && !isLinked && (
          <button type="button" className={css.linkButton} disabled={busy} onClick={() => { onEdit(skill) }}>
            {tt('list.edit')}
          </button>
        )}
        {pathEditable && !isLinked && (
          <button type="button" className={css.linkButton} disabled={busy} onClick={() => { onRename(skill) }}>
            {tt('list.rename')}
          </button>
        )}
        {pathEditable && !isLinked && (
          <button type="button" className={`${css.linkButton} ${css.deleteButton}`} data-danger="" disabled={busy} onClick={() => { void remove() }}>
            {tt('list.delete')}
          </button>
        )}
      </header>
      <p className={css.skillDesc}>{skill.description}</p>
      {skill.whenToUse !== undefined && skill.whenToUse !== '' && (
        <p className={css.skillWhen}>{tt('list.when', { when: skill.whenToUse })}</p>
      )}
      {skill.path !== undefined && <div className={css.skillPath}>{tt('list.path', { path: skill.path })}</div>}
      {error !== undefined && <p className={css.banner} data-kind="error">{error}</p>}
    </article>
  )
}

/** One sub-group: a small section inside a workspace group. */
function SubGroupSection({
  group,
  api,
  onChanged,
  onEdit,
  onRename,
}: {
  group: SubGroupPayload
  api: SkillApi
  onChanged: () => void
  onEdit: (skill: SkillEntry) => void
  onRename: (skill: SkillEntry) => void
}): React.JSX.Element {
  const hintKey = `subSourceHint.${group.key}` as const
  const hint = tt(hintKey as Parameters<typeof tt>[0])
  return (
    <section className={css.subGroup}>
      <h4 className={css.subGroupTitle}>
        {group.title}
        <span className={css.count}>{tt('list.count', { count: String(group.skills.length) })}</span>
      </h4>
      {hint !== '' && hint !== hintKey && <p className={css.groupHint}>{hint}</p>}
      {group.skills.length === 0
        ? <p className={css.subGroupEmpty}>{tt('list.emptyGroup')}</p>
        : group.skills.map(skill => (
          <SkillRow
            key={skill.name}
            skill={skill}
            api={api}
            onChanged={onChanged}
            onEdit={onEdit}
            onRename={onRename}
          />
        ))}
    </section>
  )
}

/** One top-level workspace group (workspace or global). */
function WorkspaceGroupSection({
  group,
  api,
  onChanged,
  onEdit,
  onRename,
}: {
  group: WorkspaceGroupPayload
  api: SkillApi
  onChanged: () => void
  onEdit: (skill: SkillEntry) => void
  onRename: (skill: SkillEntry) => void
}): React.JSX.Element {
  const totalSkills = group.subGroups.reduce((total, sub) => total + sub.skills.length, 0)
  return (
    <section
      className={css.workspaceGroup}
      data-scope={group.scope}
      data-workspace-key={group.key}
      data-active={group.isActive ? '' : undefined}
    >
      <header className={css.workspaceGroupHeader}>
        <h3 className={css.workspaceGroupTitle}>
          {group.title}
          {group.isActive && <span className={`${css.badge} ${css.badgeActive}`}>{tt('group.activeTag')}</span>}
        </h3>
        <span className={css.workspaceGroupCount}>
          {tt('group.workspaceCount', { count: String(totalSkills) })}
        </span>
      </header>
      {group.hint !== '' && <p className={css.workspaceGroupHint}>{group.hint}</p>}
      {group.subGroups.map(sub => (
        <SubGroupSection
          key={sub.key}
          group={sub}
          api={api}
          onChanged={onChanged}
          onEdit={onEdit}
          onRename={onRename}
        />
      ))}
    </section>
  )
}

/** Skills tab body. */
export function SkillsTab({
  api,
  onEdit,
  onRename,
}: {
  api: SkillApi
  onEdit: (skill: SkillEntry) => void
  onRename: (skill: SkillEntry) => void
}): React.JSX.Element {
  const [payload, setPayload] = useState<ListPayload | undefined>(undefined)
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  // Sequence guard: a slow earlier load must not overwrite a newer one.
  const loadSeq = useRef(0)

  const load = async (): Promise<void> => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const next = await api.list()
      if (seq !== loadSeq.current) return
      setPayload(next)
      setError(undefined)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(tt('list.loadFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }

  useEffect(() => { void load() }, [api])

  // The workspace picker value maps to one of:
  //   'all'          — every workspace + global
  //   'global'       — only the global group
  //   workspace path — only that workspace's group
  // The selector shows workspaces in registry order; the global option sits
  // at the bottom so it does not push the user's workspaces off-screen.
  const workspaceOptions = useMemo(() => {
    const list = (payload?.workspaces ?? []).map((w) => ({ key: w.path, label: w.title, active: w.active }))
    return [
      { key: 'all', label: tt('filter.workspaceAll'), active: false },
      ...list,
      { key: 'global', label: tt('filter.workspaceGlobal'), active: false },
    ]
  }, [payload?.workspaces])

  // Refresh control is hidden while a load runs.
  const refreshButton = loading
    ? undefined
    : (
      <button type="button" className={css.ghostButton} onClick={() => { void load() }}>
        {tt('refresh')}
      </button>
    )

  // Last-good policy: a failed refresh keeps the previous payload visible.
  if (payload === undefined) {
    return (
      <div className={css.fillBody}>
        {loading
          ? <p className={css.empty}>{tt('list.loading')}</p>
          : (
            <>
              <p className={css.empty}>{error}</p>
              <div className={css.toolbar}>{refreshButton}</div>
            </>
          )}
      </div>
    )
  }

  const visibleGroups = selectGroups(payload.groups, { workspace: selectedWorkspace, query })
  const visibleCount = visibleGroups.reduce((total, group) => total + group.subGroups.reduce((s, sub) => s + sub.skills.length, 0), 0)

  return (
    <div className={css.fillBody}>
      <div className={css.toolbar} data-dsh-part="filter-bar">
        <input
          className={css.search}
          type="search"
          value={query}
          spellCheck={false}
          aria-label={tt('filter.searchLabel')}
          placeholder={tt('filter.searchPlaceholder')}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Escape' && query !== '') setQuery('') }}
        />
        {workspaceOptions.length > 2 && (
          <select
            className={css.select}
            value={selectedWorkspace}
            aria-label={tt('filter.workspaceLabel')}
            onChange={(event) => { setSelectedWorkspace(event.target.value) }}
          >
            {workspaceOptions.map(opt => (
              <option key={opt.key} value={opt.key}>
                {opt.active ? `${opt.label} (current)` : opt.label}
              </option>
            ))}
          </select>
        )}
        <div className={css.toolbarSpacer} />
        {refreshButton}
      </div>
      {error !== undefined && <p className={css.banner} data-kind="error">{error}</p>}
      {visibleCount === 0
        ? <p className={css.empty}>{query.trim() === '' ? tt('filter.emptyWorkspace') : tt('filter.empty', { query: query.trim() })}</p>
        : (
          <div className={css.list}>
            {visibleGroups.map(group => (
              <WorkspaceGroupSection
                key={group.key}
                group={group}
                api={api}
                onChanged={() => { void load() }}
                onEdit={onEdit}
                onRename={onRename}
              />
            ))}
          </div>
        )}
    </div>
  )
}