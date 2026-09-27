/**
 * SKILL.md frontmatter lightweight parsing and rewriting (zero dependency).
 *
 * Ported from the local plugin family's shared implementation; the official
 * dsh-skill-filesystem provider parses frontmatter with its own stack, so
 * this module keeps a stable export surface for unit tests to lock behavior.
 *
 * 4-state lifecycle: the canonical field is `invocation-mode`, with the four
 * valid values `on` / `name-only` / `user-invocable-only` / `off`. When the
 * field is absent we derive the mode from the legacy `disable-model-invocation`
 * / `user-invocable` pair, so existing skill files keep working unchanged.
 * Writes set both `invocation-mode` and the legacy pair so a SKILL.md written
 * here still reads correctly in any DSH tool that only knows the pair.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

/** Parse a YAML boolean (true/false/yes/no/on/off/1/0, case-insensitive); undefined when not boolean. */
export function parseYamlBool(value: unknown): boolean | undefined {
  const text = String(value).toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(text)) return true
  if (['false', 'no', 'off', '0'].includes(text)) return false
  return undefined
}

/** Strip single or double quotes around a scalar value. */
function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/** The four skill lifecycle states. Stable string union; the type guards stay exported. */
export type InvocationMode = 'on' | 'name-only' | 'user-invocable-only' | 'off'

/** All valid mode values, in display order (most-on to most-off). */
export const INVOCATION_MODES: readonly InvocationMode[] = ['on', 'name-only', 'user-invocable-only', 'off']

/** The legacy boolean pair the official core uses, derived from one mode. */
export interface InvocationPolicy {
  /** The model can use this skill automatically. */
  modelInvocable: boolean
  /** The skill appears in the user /skills menu. */
  userInvocable: boolean
}

/** Parsed frontmatter fields consumed by the skill manager. */
export interface Frontmatter {
  name?: string
  description?: string
  whenToUse?: string
  hint?: string
  recordInput?: boolean
  /** Canonical 4-state mode; present when the file declares it explicitly. */
  invocationMode?: InvocationMode
  /** Legacy mirror of `disable-model-invocation`. */
  disableModelInvocation?: boolean
  /** Legacy mirror of `user-invocable`. */
  userInvocable?: boolean
}

/** Parse an invocation-mode scalar; undefined when not a known mode. */
export function parseInvocationMode(value: unknown): InvocationMode | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (INVOCATION_MODES.includes(text as InvocationMode)) return text as InvocationMode
  return undefined
}

/** Map one canonical mode to the legacy pair the official core reads. */
export function invocationPolicy(mode: InvocationMode): InvocationPolicy {
  switch (mode) {
    case 'on':
      return { modelInvocable: true, userInvocable: true }
    case 'name-only':
      // The official core reads the pair only. `name-only` is a manager-level
      // intent that the manager itself surfaces; the legacy pair mirrors `on`
      // so a tool that only knows the pair still treats the skill as enabled.
      return { modelInvocable: true, userInvocable: true }
    case 'user-invocable-only':
      return { modelInvocable: false, userInvocable: true }
    case 'off':
      return { modelInvocable: false, userInvocable: false }
  }
}

/**
 * Resolve the canonical mode from a parsed frontmatter. When `invocation-mode`
 * is set, it wins; otherwise we derive from the legacy pair, treating absent
 * values as the on default (modelInvocable=true, userInvocable=true).
 */
export function resolveInvocationMode(frontmatter: Frontmatter): InvocationMode {
  if (frontmatter.invocationMode !== undefined) return frontmatter.invocationMode
  const model = frontmatter.disableModelInvocation !== true
  const user = frontmatter.userInvocable !== false
  if (model && user) return 'on'
  if (!model && user) return 'user-invocable-only'
  return 'off'
}

/**
 * Parse scalar fields from the leading frontmatter block (lightweight, zero
 * dependency). Supports name/description/whenToUse (including | / > block
 * scalars), the input nested block (hint / recordInput) and the
 * disable-model-invocation / user-invocable / invocation-mode fields.
 * @param content - raw SKILL.md content.
 * @returns parsed fields (empty object when no frontmatter).
 */
export function parseFrontmatter(content: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (match === null) return {}
  const out: Frontmatter = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (kv === null) continue
    const key = kv[1]
    const rest = kv[2].trim()
    // Nested block: indented sub-items under "input:" (hint / recordInput).
    if (key === 'input' && rest === '') {
      const nested: { hint?: string; recordInput?: boolean } = {}
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]
        const sub = /^\s+([a-zA-Z][\w-]*):\s*(.*)$/.exec(line)
        if (sub === null) {
          if (line.trim() === '') continue
          break
        }
        const subKey = sub[1]
        const subValue = sub[2].trim()
        if (subKey === 'hint') nested.hint = unquote(subValue)
        else if (subKey === 'recordInput') nested.recordInput = parseYamlBool(subValue)
      }
      if (nested.hint !== undefined) out.hint = nested.hint
      if (nested.recordInput !== undefined) out.recordInput = nested.recordInput
      continue
    }
    if (rest === '') continue
    // Block scalar (| / > with fold/keep modifiers): collect indented
    // continuation lines and fold them into one line.
    if (/^[|>][-+]?$/.test(rest)) {
      const collected: string[] = []
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]
        if (line === '' || /^\s/.test(line)) collected.push(line.trim())
        else break
      }
      const text = collected.join(' ').trim()
      if (key === 'name') out.name = text || undefined
      else if (key === 'description') out.description = text || undefined
      else if (key === 'whenToUse') out.whenToUse = text || undefined
      continue
    }
    if (key === 'name') out.name = unquote(rest)
    else if (key === 'description') out.description = unquote(rest)
    else if (key === 'whenToUse') out.whenToUse = unquote(rest)
    else if (key === 'disable-model-invocation') out.disableModelInvocation = parseYamlBool(rest)
    else if (key === 'user-invocable') out.userInvocable = parseYamlBool(rest)
    else if (key === 'invocation-mode') {
      const parsed = parseInvocationMode(unquote(rest))
      if (parsed !== undefined) out.invocationMode = parsed
    }
    else if (key === 'recordInput') out.recordInput = parseYamlBool(rest)
  }
  return out
}

/**
 * The body after the leading frontmatter block, verbatim.
 * @param content - raw SKILL.md content.
 * @returns the content after the closing fence (the whole input when absent).
 */
export function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)
  return match === null ? content : content.slice(match[0].length)
}

/**
 * Rewrite one boolean frontmatter field (appends when absent), atomically.
 * Preserves every other line and the body verbatim.
 * @param file - absolute SKILL.md path.
 * @param field - frontmatter field name (e.g. disable-model-invocation).
 * @param value - target boolean value.
 * @returns the parsed frontmatter of the rewritten content.
 */
export function setFrontmatterField(file: string, field: string, value: boolean): Frontmatter {
  const content = readFileSync(file, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/.exec(content)
  if (match === null) throw new Error(`setFrontmatterField: ${file} has no frontmatter`)
  const blockLines = match[1].split(/\r?\n/)
  const linePattern = new RegExp(`^${field}:`)
  let replaced = false
  const next = blockLines.map((line) => {
    if (linePattern.test(line)) {
      replaced = true
      return `${field}: ${value}`
    }
    return line
  })
  if (!replaced) next.push(`${field}: ${value}`)
  const rewritten = `---\n${next.join('\n')}\n---${match[2]}`
  // Atomic write: tmp file + rename, so a watcher never reads a half-written
  // state. The tmp name is unpredictable and created with O_EXCL ('wx'), so a
  // planted symlink at a guessable name can never redirect the write.
  const tmp = `${file}.${Date.now().toString(36)}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, rewritten, { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, file)
  } catch (error) {
    // Best-effort cleanup of a half-written tmp file; the original file is untouched.
    try {
      unlinkSync(tmp)
    } catch {
      // ignore
    }
    throw error
  }
  return parseFrontmatter(rewritten)
}

/**
 * Set one frontmatter scalar field (appends when absent), atomically. Used by
 * the manager to write `invocation-mode: <mode>`; for booleans prefer
 * `setFrontmatterField` (boolean serialization stays in one place).
 */
export function setFrontmatterScalar(file: string, field: string, value: string): Frontmatter {
  const content = readFileSync(file, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/.exec(content)
  if (match === null) throw new Error(`setFrontmatterScalar: ${file} has no frontmatter`)
  const blockLines = match[1].split(/\r?\n/)
  const linePattern = new RegExp(`^${field}:`)
  let replaced = false
  const next = blockLines.map((line) => {
    if (linePattern.test(line)) {
      replaced = true
      return `${field}: ${value}`
    }
    return line
  })
  if (!replaced) next.push(`${field}: ${value}`)
  const rewritten = `---\n${next.join('\n')}\n---${match[2]}`
  const tmp = `${file}.${Date.now().toString(36)}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, rewritten, { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // ignore
    }
    throw error
  }
  return parseFrontmatter(rewritten)
}

/**
 * Atomically write the canonical invocation mode and mirror it to the legacy
 * `disable-model-invocation` / `user-invocable` pair, so a SKILL.md stays
 * readable by tools that only know the pair. Writes one tmp file + rename.
 * @param file - absolute SKILL.md path.
 * @param mode - one of the four valid modes.
 * @returns the parsed frontmatter after the write.
 */
export function setInvocationMode(file: string, mode: InvocationMode): Frontmatter {
  const content = readFileSync(file, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/.exec(content)
  if (match === null) throw new Error(`setInvocationMode: ${file} has no frontmatter`)
  const policy = invocationPolicy(mode)
  const blockLines = match[1].split(/\r?\n/)
  const targets: ReadonlyArray<{ field: string; value: string | boolean }> = [
    { field: 'invocation-mode', value: mode },
    { field: 'disable-model-invocation', value: !policy.modelInvocable },
    { field: 'user-invocable', value: policy.userInvocable },
  ]
  // Mark each target replaced; targets written in a single pass, preserving
  // every other line.
  const replaced = new Set<string>()
  const next = blockLines.map((line) => {
    for (const target of targets) {
      if (replaced.has(target.field)) continue
      if (new RegExp(`^${target.field}:`).test(line)) {
        replaced.add(target.field)
        return `${target.field}: ${target.value}`
      }
    }
    return line
  })
  for (const target of targets) {
    if (!replaced.has(target.field)) {
      next.push(`${target.field}: ${target.value}`)
    }
  }
  const rewritten = `---\n${next.join('\n')}\n---${match[2]}`
  const tmp = `${file}.${Date.now().toString(36)}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, rewritten, { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // ignore
    }
    throw error
  }
  return parseFrontmatter(rewritten)
}

/** Single-quote a YAML scalar (doubling embedded quotes); keeps the frontmatter parseable for values containing colons. */
export function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}