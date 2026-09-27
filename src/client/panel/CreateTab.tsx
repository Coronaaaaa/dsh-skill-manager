/**
 * Create tab: the new-skill form (user / project root, .dsh or .agents).
 *
 * The host's create route needs the cwd the list payload carries (one of
 * the registered workspaces). The inactive tab unmounts, so a user who
 * opens this tab first has no cwd: the first submit resolves it with one
 * list call and reuses it afterwards.
 */
import { useState, type FormEvent } from 'react'
import { INVOCATION_MODES, SkillApi, type InvocationMode } from '../api.ts'
import { tt } from '../panel-helpers.ts'
import css from './panel.module.css'

/** Create-form feedback line. */
type Feedback = { text: string; kind: 'ok' | 'error' }

/** Which physical root the create route should write to. */
type CreateScope = 'global' | 'globalAgents' | 'project' | 'projectAgents'

/** Map a UI scope to the API scope value. */
function scopeToApi(scope: CreateScope): 'user-dsh' | 'user-agents' | 'project-dsh' | 'project-agents' {
  switch (scope) {
    case 'global': return 'user-dsh'
    case 'globalAgents': return 'user-agents'
    case 'project': return 'project-dsh'
    case 'projectAgents': return 'project-agents'
  }
}

/** Short label per mode (mirror of SkillsTab). */
function modeShortLabel(mode: InvocationMode): string {
  const map: Record<InvocationMode, string> = {
    on: tt('mode.on'),
    'name-only': tt('mode.nameOnly'),
    'user-invocable-only': tt('mode.userOnly'),
    off: tt('mode.off'),
  }
  return map[mode]
}

/** The create tab body. */
export function CreateTab({ api }: { api: SkillApi }): React.JSX.Element {
  const [scope, setScope] = useState<CreateScope>('global')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<InvocationMode>('on')
  const [cwd, setCwd] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || description.trim() === '' || content.trim() === '') {
      setFeedback({ text: tt('create.empty'), kind: 'error' })
      return
    }
    setBusy(true)
    try {
      const workspace = cwd ?? (await api.list()).cwd
      setCwd(workspace)
      const result = await api.create({
        scope: scopeToApi(scope),
        name: name.trim(),
        description: description.trim(),
        whenToUse: whenToUse.trim() || undefined,
        content,
        cwd: workspace,
        mode,
      })
      setFeedback({ text: tt('create.created', { path: result.path }), kind: 'ok' })
      setName('')
      setDescription('')
      setWhenToUse('')
      setContent('')
      setMode('on')
    } catch (err) {
      setFeedback({ text: tt('create.failed', { error: err instanceof Error ? err.message : String(err) }), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.tabBody}>
      <form className={css.form} onSubmit={(event) => { void submit(event) }}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.scope')}</span>
          <select className={css.select} value={scope} onChange={(event) => { setScope(event.target.value as CreateScope) }}>
            <option value="global">{tt('create.scope.global')}</option>
            <option value="globalAgents">{tt('create.scope.globalAgents')}</option>
            <option value="project">{tt('create.scope.project')}</option>
            <option value="projectAgents">{tt('create.scope.projectAgents')}</option>
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.name')}</span>
          <input className={css.input} value={name} placeholder={tt('create.namePlaceholder')} onChange={(event) => { setName(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.description')}</span>
          <input className={css.input} value={description} onChange={(event) => { setDescription(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.whenToUse')}</span>
          <input className={css.input} value={whenToUse} onChange={(event) => { setWhenToUse(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.content')}</span>
          <textarea className={`${css.input} ${css.textarea}`} value={content} onChange={(event) => { setContent(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.mode')}</span>
          <select className={css.select} value={mode} onChange={(event) => { setMode(event.target.value as InvocationMode) }}>
            {INVOCATION_MODES.map((m) => (
              <option key={m} value={m}>{modeShortLabel(m)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={css.primaryButton} disabled={busy}>{tt('create.submit')}</button>
        {feedback !== undefined && <p className={css.banner} data-kind={feedback.kind}>{feedback.text}</p>}
        <p className={css.note}>{tt('create.note')}</p>
      </form>
    </div>
  )
}