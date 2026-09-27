/**
 * Skill manager list filtering (pure, browser half): the search box and the
 * workspace picker are two axes over the same grouped payload, so the
 * matching rules live here and stay unit-testable without a DOM.
 */

import type { SkillEntry, SubGroupPayload, WorkspaceGroupPayload } from './api.ts'

/** The list tab's filter state. */
export interface SkillListFilter {
  /** Selected workspace key: a workspace id, 'global', or 'all'. */
  workspace: string
  /** Raw search text; trimmed and lowercased before matching. */
  query: string
}

/**
 * Match rank of one skill against a lowercased needle: 0 when the name hits,
 * 1 when only the description hits, undefined when neither does. An empty
 * needle matches everything at rank 0.
 */
export function matchRank(skill: SkillEntry, needle: string): 0 | 1 | undefined {
  if (needle === '') return 0
  if (skill.name.toLowerCase().includes(needle)) return 0
  if (skill.description.toLowerCase().includes(needle)) return 1
  return undefined
}

/**
 * Whether a skill survives the workspace axis. Global skills (no workspace
 * path) stay visible in every selection, because a user-pinned project skill
 * should not silence the `~/.agents/skills` the user relies on everywhere.
 */
function inWorkspace(skill: SkillEntry, workspace: string): boolean {
  if (workspace === 'all') return true
  if (workspace === 'global') return skill.scope === 'global'
  // Global skills (no workspacePath) survive any workspace selection;
  // workspace-scope skills survive only the matching workspace path.
  if (skill.workspacePath === undefined) return true
  return skill.workspacePath === workspace
}

/** Filter one sub-group by the workspace + query axes (sorted, empty dropped). */
function filterSubGroup(group: SubGroupPayload, filter: SkillListFilter): SubGroupPayload | undefined {
  const needle = filter.query.trim().toLowerCase()
  const ranked = group.skills
    .filter(skill => inWorkspace(skill, filter.workspace))
    .map(skill => ({ skill, rank: matchRank(skill, needle) }))
    .filter((row): row is { skill: SkillEntry; rank: 0 | 1 } => row.rank !== undefined)
  if (needle !== '') ranked.sort((left, right) => left.rank - right.rank)
  const skills = ranked.map(row => row.skill)
  if (skills.length === 0) return undefined
  return { ...group, skills }
}

/**
 * Apply both axes to a payload's workspace groups. Empty workspace groups and
 * empty sub-groups are dropped so the caller renders only what has content.
 * @param groups - host payload workspace groups in host order.
 * @param filter - workspace + query.
 * @returns the visible workspace groups; the input is never mutated.
 */
export function selectGroups(groups: readonly WorkspaceGroupPayload[], filter: SkillListFilter): WorkspaceGroupPayload[] {
  const out: WorkspaceGroupPayload[] = []
  for (const workspaceGroup of groups) {
    const subGroups = workspaceGroup.subGroups
      .map(sub => filterSubGroup(sub, filter))
      .filter((sub): sub is SubGroupPayload => sub !== undefined)
    if (subGroups.length === 0) continue
    out.push({ ...workspaceGroup, subGroups })
  }
  return out
}