/**
 * Frontmatter parsing, 4-state lifecycle derivation, and rewriting tests.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  invocationPolicy,
  parseFrontmatter,
  parseInvocationMode,
  resolveInvocationMode,
  setFrontmatterField,
  setFrontmatterScalar,
  setInvocationMode,
  stripFrontmatter,
} from '../src/frontmatter.ts'

const TMP = mkdtempSync(join(tmpdir(), 'skill-manager-fm-'))
afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('parseFrontmatter', () => {
  it('parses scalar fields and booleans', () => {
    const fm = parseFrontmatter('---\nname: my-skill\ndescription: 描述\nwhenToUse: 场景\ndisable-model-invocation: true\nuser-invocable: false\n---\n正文\n')
    expect(fm.name).toBe('my-skill')
    expect(fm.description).toBe('描述')
    expect(fm.whenToUse).toBe('场景')
    expect(fm.disableModelInvocation).toBe(true)
    expect(fm.userInvocable).toBe(false)
  })

  it('parses the canonical invocation-mode field', () => {
    const fm = parseFrontmatter('---\nname: my-skill\ninvocation-mode: user-invocable-only\n---\n')
    expect(fm.invocationMode).toBe('user-invocable-only')
  })

  it('folds block scalars (| and >) into single lines', () => {
    const fm = parseFrontmatter([
      '---',
      'name: block-desc',
      'description: >-',
      '  块标量的',
      '  多行描述。',
      'whenToUse: >',
      '  块标量',
      '  适用场景',
      '---',
      '',
    ].join('\n'))
    expect(fm.description).toBe('块标量的 多行描述。')
    expect(fm.whenToUse).toBe('块标量 适用场景')
  })

  it('parses the input nested block (hint / recordInput)', () => {
    const fm = parseFrontmatter('---\nname: x\ninput:\n  hint: 请输入\n  recordInput: true\n---\n')
    expect(fm.hint).toBe('请输入')
    expect(fm.recordInput).toBe(true)
  })

  it('returns empty object when there is no frontmatter', () => {
    expect(parseFrontmatter('# 无 frontmatter\n\n正文')).toEqual({})
  })

  it('strips quotes around scalar values', () => {
    const fm = parseFrontmatter('---\nname: "quoted-name"\ndescription: \'单引号\'\n---\n')
    expect(fm.name).toBe('quoted-name')
    expect(fm.description).toBe('单引号')
  })
})

describe('stripFrontmatter', () => {
  it('user sees the body verbatim once the leading block is dropped', () => {
    const source = '---\nname: a\ndescription: d\n---\n\n# Body\n'
    const body = stripFrontmatter(source)
    expect(body).toBe('\n# Body\n')
  })

  it('user keeps a body whose own text starts with a fence', () => {
    const source = '---\nname: a\n---\n\n---\nnot frontmatter\n'
    const body = stripFrontmatter(source)
    expect(body).toBe('\n---\nnot frontmatter\n')
  })

  it('user gets the input back when there is no frontmatter block', () => {
    const source = '# Just a body\n'
    expect(stripFrontmatter(source)).toBe('# Just a body\n')
  })
})

describe('parseInvocationMode', () => {
  it('accepts every valid mode value (case-insensitive)', () => {
    expect(parseInvocationMode('on')).toBe('on')
    expect(parseInvocationMode('name-only')).toBe('name-only')
    expect(parseInvocationMode('user-invocable-only')).toBe('user-invocable-only')
    expect(parseInvocationMode('off')).toBe('off')
    expect(parseInvocationMode('NAME-ONLY')).toBe('name-only')
  })

  it('returns undefined for unknown values', () => {
    expect(parseInvocationMode('mystery')).toBeUndefined()
    expect(parseInvocationMode(42)).toBeUndefined()
    expect(parseInvocationMode(null)).toBeUndefined()
    expect(parseInvocationMode(undefined)).toBeUndefined()
  })
})

describe('invocationPolicy', () => {
  it('maps the four modes to the right legacy pair', () => {
    expect(invocationPolicy('on')).toEqual({ modelInvocable: true, userInvocable: true })
    expect(invocationPolicy('name-only')).toEqual({ modelInvocable: true, userInvocable: true })
    expect(invocationPolicy('user-invocable-only')).toEqual({ modelInvocable: false, userInvocable: true })
    expect(invocationPolicy('off')).toEqual({ modelInvocable: false, userInvocable: false })
  })
})

describe('resolveInvocationMode', () => {
  it('returns the explicit invocation-mode when present', () => {
    expect(resolveInvocationMode({ invocationMode: 'off' })).toBe('off')
    expect(resolveInvocationMode({ invocationMode: 'user-invocable-only', disableModelInvocation: false, userInvocable: true })).toBe('user-invocable-only')
  })

  it('derives the mode from the legacy pair when invocation-mode is absent', () => {
    expect(resolveInvocationMode({})).toBe('on')
    expect(resolveInvocationMode({ disableModelInvocation: false, userInvocable: true })).toBe('on')
    expect(resolveInvocationMode({ disableModelInvocation: true, userInvocable: true })).toBe('user-invocable-only')
    expect(resolveInvocationMode({ disableModelInvocation: true, userInvocable: false })).toBe('off')
    expect(resolveInvocationMode({ disableModelInvocation: false, userInvocable: false })).toBe('off')
  })

  it('ignores the legacy pair when invocation-mode is present (canonical wins)', () => {
    expect(resolveInvocationMode({
      invocationMode: 'name-only',
      disableModelInvocation: true,
      userInvocable: false,
    })).toBe('name-only')
  })
})

describe('setFrontmatterField', () => {
  const dir = join(TMP, 'toggle')
  mkdirSync(dir, { recursive: true })

  it('rewrites an existing field and preserves the body', () => {
    const file = join(dir, 'a.md')
    writeFileSync(file, '---\nname: a\ndescription: d\n---\n# 正文\n', 'utf8')
    const fm = setFrontmatterField(file, 'disable-model-invocation', true)
    expect(fm.disableModelInvocation).toBe(true)
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('disable-model-invocation: true')
    expect(content).toContain('# 正文')
    expect(content).toContain('name: a')
  })

  it('appends the field when absent', () => {
    const file = join(dir, 'b.md')
    writeFileSync(file, '---\nname: b\n---\n', 'utf8')
    setFrontmatterField(file, 'disable-model-invocation', true)
    expect(readFileSync(file, 'utf8')).toContain('disable-model-invocation: true')
  })

  it('re-enables by writing false', () => {
    const file = join(dir, 'c.md')
    writeFileSync(file, '---\nname: c\ndisable-model-invocation: true\n---\n', 'utf8')
    const fm = setFrontmatterField(file, 'disable-model-invocation', false)
    expect(fm.disableModelInvocation).toBe(false)
  })

  it('throws when the file has no frontmatter', () => {
    const file = join(dir, 'd.md')
    writeFileSync(file, '# no frontmatter\n', 'utf8')
    expect(() => setFrontmatterField(file, 'disable-model-invocation', true)).toThrow(/no frontmatter/)
  })
})

describe('setFrontmatterScalar', () => {
  const dir = join(TMP, 'scalar')
  mkdirSync(dir, { recursive: true })

  it('appends a new invocation-mode field', () => {
    const file = join(dir, 'a.md')
    writeFileSync(file, '---\nname: a\n---\n# body\n', 'utf8')
    setFrontmatterScalar(file, 'invocation-mode', 'off')
    const fm = parseFrontmatter(readFileSync(file, 'utf8'))
    expect(fm.invocationMode).toBe('off')
  })

  it('replaces an existing field', () => {
    const file = join(dir, 'b.md')
    writeFileSync(file, '---\nname: b\ninvocation-mode: on\n---\n', 'utf8')
    setFrontmatterScalar(file, 'invocation-mode', 'off')
    const fm = parseFrontmatter(readFileSync(file, 'utf8'))
    expect(fm.invocationMode).toBe('off')
  })
})

describe('setInvocationMode', () => {
  const dir = join(TMP, 'mode')
  mkdirSync(dir, { recursive: true })

  it('writes the canonical mode and mirrors the legacy pair', () => {
    const file = join(dir, 'a.md')
    writeFileSync(file, '---\nname: a\n---\n# body\n', 'utf8')
    const fm = setInvocationMode(file, 'user-invocable-only')
    expect(fm.invocationMode).toBe('user-invocable-only')
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('invocation-mode: user-invocable-only')
    expect(content).toContain('disable-model-invocation: true')
    expect(content).toContain('user-invocable: true')
  })

  it('accepts every valid mode and writes the matching mirror', () => {
    const cases: Array<['on' | 'name-only' | 'user-invocable-only' | 'off', boolean, boolean]> = [
      ['on', false, true],
      ['name-only', false, true],
      ['user-invocable-only', true, true],
      ['off', true, false],
    ]
    for (const [mode, disableModel, userInvocable] of cases) {
      const file = join(dir, `${mode}.md`)
      writeFileSync(file, '---\nname: x\n---\n# body\n', 'utf8')
      setInvocationMode(file, mode)
      const content = readFileSync(file, 'utf8')
      expect(content).toContain(`invocation-mode: ${mode}`)
      expect(content).toContain(`disable-model-invocation: ${disableModel}`)
      expect(content).toContain(`user-invocable: ${userInvocable}`)
    }
  })

  it('overwrites a previous invocation-mode in place', () => {
    const file = join(dir, 'b.md')
    writeFileSync(file, '---\nname: b\ninvocation-mode: on\ndisable-model-invocation: false\nuser-invocable: true\n---\n', 'utf8')
    setInvocationMode(file, 'off')
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('invocation-mode: off')
    expect(content).toContain('disable-model-invocation: true')
    expect(content).toContain('user-invocable: false')
    // No duplicate lines: each field appears exactly once.
    expect(content.match(/invocation-mode:/g)?.length).toBe(1)
    expect(content.match(/disable-model-invocation:/g)?.length).toBe(1)
    expect(content.match(/user-invocable:/g)?.length).toBe(1)
  })

  it('throws when the file has no frontmatter', () => {
    const file = join(dir, 'c.md')
    writeFileSync(file, '# no frontmatter\n', 'utf8')
    expect(() => setInvocationMode(file, 'on')).toThrow(/no frontmatter/)
  })
})