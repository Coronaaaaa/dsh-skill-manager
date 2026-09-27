/**
 * List filtering rules: the search box and the workspace picker are pure
 * functions over the host payload, so they are tested without a DOM.
 */
import { describe, expect, it } from 'vitest'
import { matchRank, selectGroups } from '../src/client/skill-filter.ts'
import type { SkillEntry, SubGroupPayload, SubSourceKey, WorkspaceGroupPayload } from '../src/client/api.ts'

function skill(name: string, description: string, extra: Partial<SkillEntry> = {}): SkillEntry {
  return {
    name,
    description,
    source: 'dsh',
    scope: 'global',
    path: '/work/' + name + '/SKILL.md',
    mode: 'on',
    modelInvocable: true,
    userInvocable: true,
    ...extra,
  }
}

function workspaceGroup(
  key: string,
  scope: 'workspace' | 'global',
  workspacePath: string | undefined,
  subGroups: SubGroupPayload[],
  active = false,
): WorkspaceGroupPayload {
  return { key, title: key, hint: '', scope, workspacePath, isActive: active, subGroups }
}

function subGroup(key: SubSourceKey | string, skills: SkillEntry[]): SubGroupPayload {
  return { key: key as SubSourceKey, title: key, hint: '', skills }
}

describe('matchRank', () => {
  it('ranks a name hit above a description hit', () => {
    expect(matchRank(skill('alpha-skill', 'plain'), 'alpha')).toBe(0)
    expect(matchRank(skill('plain', 'alpha helper'), 'alpha')).toBe(1)
  })

  it('matches case-insensitively and reports no hit as undefined', () => {
    expect(matchRank(skill('Alpha-Skill', 'x'), 'alpha')).toBe(0)
    expect(matchRank(skill('plain', 'X'), 'x')).toBe(1)
    expect(matchRank(skill('plain', 'plain'), 'nope')).toBeUndefined()
  })

  it('treats an empty needle as a match', () => {
    expect(matchRank(skill('plain', 'plain'), '')).toBe(0)
  })
})

describe('selectGroups', () => {
  const groups: WorkspaceGroupPayload[] = [
    workspaceGroup('global', 'global', undefined, [
      subGroup('dsh', [
        skill('gamma-skill', 'unrelated'),
        skill('beta-skill', 'alpha related'),
        skill('alpha-skill', 'first helper'),
      ]),
      subGroup('runtime', [skill('runtime-only', 'plugin embedded')]),
    ]),
  ]

  it('returns every group in host order when neither axis is set', () => {
    const visible = selectGroups(groups, { workspace: 'all', query: '' })
    expect(visible.map(item => item.key)).toEqual(['global'])
    const allSkills = visible[0].subGroups.flatMap(s => s.skills)
    expect(allSkills.map(s => s.name)).toEqual(['gamma-skill', 'beta-skill', 'alpha-skill', 'runtime-only'])
  })

  it('keeps name hits before description hits and drops non-matches', () => {
    const visible = selectGroups(groups, { workspace: 'all', query: 'alpha' })
    expect(visible.map(item => item.key)).toEqual(['global'])
    const allSkills = visible[0].subGroups.flatMap(s => s.skills)
    expect(allSkills.map(s => s.name)).toEqual(['alpha-skill', 'beta-skill'])
  })

  it('reports no group when nothing matches', () => {
    expect(selectGroups(groups, { workspace: 'all', query: 'zzz' })).toEqual([])
  })

  it('combines the workspace axis with the query', () => {
    const mixed: WorkspaceGroupPayload[] = [
      workspaceGroup('ws-one', 'workspace', '/repo/one', [
        subGroup('dsh', [
          skill('project-alpha', 'alpha project', { scope: 'workspace', workspacePath: '/repo/one' }),
          skill('project-beta', 'alpha other', { scope: 'workspace', workspacePath: '/repo/one' }),
        ]),
      ]),
      workspaceGroup('ws-two', 'workspace', '/repo/two', [
        subGroup('dsh', [
          skill('project-alpha', 'alpha project', { scope: 'workspace', workspacePath: '/repo/two' }),
        ]),
      ]),
      workspaceGroup('global', 'global', undefined, [
        subGroup('dsh', [skill('global-alpha', 'alpha global')]),
      ]),
    ]
    const visible = selectGroups(mixed, { workspace: '/repo/one', query: 'alpha' })
    // /repo/one + global survive the workspace axis; ws-two is dropped (no
    // matching skills under that workspace).
    expect(visible.map(item => item.key)).toEqual(['ws-one', 'global'])
    // project-alpha is a name hit (rank 0); project-beta is a description
    // hit (rank 1). The filter keeps both and sorts name hits first.
    const oneSkills = visible[0].subGroups[0].skills
    expect(oneSkills.map(s => s.name)).toEqual(['project-alpha', 'project-beta'])
    const globalSkills = visible[1].subGroups[0].skills
    expect(globalSkills.map(s => s.name)).toEqual(['global-alpha'])
  })

  it('drops empty workspace groups and empty sub-groups without mutating the payload', () => {
    const before = JSON.stringify(groups)
    const visible = selectGroups(groups, { workspace: 'all', query: 'runtime' })
    // Only the runtime sub-group survives; the dsh sub-group is dropped (still inside the global workspace group).
    expect(visible.map(item => item.key)).toEqual(['global'])
    expect(visible[0].subGroups.map(s => s.key)).toEqual(['runtime'])
    expect(JSON.stringify(groups)).toBe(before)
  })

  it('the global filter shows only the global group', () => {
    const mixed: WorkspaceGroupPayload[] = [
      workspaceGroup('ws', 'workspace', '/repo', [
        subGroup('dsh', [skill('project-only', 'p', { scope: 'workspace', workspacePath: '/repo' })]),
      ]),
      workspaceGroup('global', 'global', undefined, [
        subGroup('dsh', [skill('global-only', 'g')]),
      ]),
    ]
    const visible = selectGroups(mixed, { workspace: 'global', query: '' })
    expect(visible.map(item => item.key)).toEqual(['global'])
    expect(visible[0].subGroups[0].skills.map(s => s.name)).toEqual(['global-only'])
  })
})