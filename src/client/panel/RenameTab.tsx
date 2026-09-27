/**
 * Rename tab: rename one skill.
 *
 * The host's rename route moves the directory and rewrites the frontmatter
 * `name:` field in one atomic write. The directory name and the frontmatter
 * name must stay aligned, so the form only takes the new kebab-case name and
 * refuses to send an identical one.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { SkillApi, type SkillEntry } from '../api.ts'
import { tt } from '../panel-helpers.ts'
import css from './panel.module.css'

/** Rename tab props. */
export interface RenameTabProps {
  /** The skill manager API client. */
  api: SkillApi
  /** The skill whose directory and frontmatter this form rewrites. */
  skill: SkillEntry
  /** Called after a successful rename: the list refetches on the way back. */
  onDone: () => void
  /** Called when the user leaves without renaming. */
  onCancel: () => void
}

/** Kebab-case predicate (letters / digits / hyphens; must start with letter/digit). */
const KEBAB_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** The rename tab body. */
export function RenameTab({ api, skill, onDone, onCancel }: RenameTabProps): React.JSX.Element {
  const skillPath = skill.path ?? ''
  const [newName, setNewName] = useState(skill.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // Reset the input when the chosen skill changes.
  useEffect(() => { setNewName(skill.name) }, [skill.name])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = newName.trim()
    if (trimmed === '') {
      setError(tt('rename.empty'))
      return
    }
    if (!KEBAB_PATTERN.test(trimmed)) {
      setError(tt('rename.empty'))
      return
    }
    if (trimmed === skill.name) {
      setError(tt('rename.sameAsOld'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await api.rename(skill.name, skillPath, trimmed)
      onDone()
    } catch (err) {
      setError(tt('rename.failed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.tabBody}>
      <form className={css.form} onSubmit={(event) => { void submit(event) }}>
        <h3 className={css.renameTitle}>{tt('rename.title')}</h3>
        <p className={css.note}>{tt('rename.hint')}</p>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('rename.current')}</span>
          <input className={css.input} value={skill.name} readOnly />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('rename.new')}</span>
          <input
            className={css.input}
            value={newName}
            spellCheck={false}
            onChange={(event) => { setNewName(event.target.value) }}
          />
        </label>
        <div className={css.formActions}>
          <button type="button" className={css.ghostButton} disabled={busy} onClick={onCancel}>{tt('rename.back')}</button>
          <button type="submit" className={css.primaryButton} disabled={busy}>{tt('rename.submit')}</button>
        </div>
        {error !== undefined && <p className={css.banner} data-kind="error">{error}</p>}
      </form>
    </div>
  )
}