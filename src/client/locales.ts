/**
 * skill-manager surface copy: zh is the key source, en mirrors every key.
 */

export const zh = {
  // sidebar / panel chrome
  'entry.label': '技能管理',
  'entry.tooltip': '技能管理：按工作区分组浏览与编辑 skill',
  'panel.title': '技能管理',
  'panel.backToConversation': '返回会话',
  'tab.list': '技能',
  'tab.create': '创建',
  'tab.edit': '编辑技能',
  'tab.rename': '重命名',

  // workspace-level grouping
  'group.global': '全局',
  'groupHint.global': '~/.dsh/skills · ~/.agents/skills · 自定义目录 · 运行时注册',
  'group.activeTag': '当前',
  'group.workspaceCount': '{count} 个 skill',

  // sub-source keys
  'subSource.dsh': '.dsh/skills',
  'subSource.agents': '.agents/skills',
  'subSource.custom': '自定义目录',
  'subSource.bundled': '系统内置',
  'subSource.runtime': '运行时注册',
  'subSourceHint.dsh': '项目（或用户）DSH 技能根目录',
  'subSourceHint.agents': '项目（或用户）AGENTS 技能根目录',
  'subSourceHint.custom': 'customSkillDirs 配置目录',
  'subSourceHint.bundled': 'DSH 内置与插件随附的全局技能',
  'subSourceHint.runtime': '插件运行时代码内嵌注册',

  // list rendering
  'list.loading': '加载中…',
  'list.loadFailed': '加载失败：{error}',
  'list.empty': '当前没有已加载的 skill。',
  'list.emptyGroup': '此分组下没有 skill。',
  'list.count': '{count} 个',
  'list.when': '适用：{when}',
  'list.linked': '软链接',
  'list.path': '路径：{path}',

  // invocation mode — 4 states
  'mode.label': '调用状态',
  'mode.on': '开启',
  'mode.onHint': '模型可在上下文中看到名称 + 描述 + 正文；出现在 /skills 菜单',
  'mode.nameOnly': '仅名称',
  'mode.nameOnlyHint': '模型可在上下文中看到名称（节省 token），隐藏描述与正文；仍出现在 /skills 菜单',
  'mode.userOnly': '用户专属',
  'mode.userOnlyHint': '对模型不可见；出现在 /skills 菜单（仅用户可手动触发）',
  'mode.off': '关闭',
  'mode.offHint': '对模型与 /skills 菜单都不可见；调用会报错',
  'mode.changeFailed': '修改调用状态失败：{error}',

  // row actions
  'list.rename': '重命名',
  'list.renameConfirm': '将「{name}」重命名为「{newName}」？',
  'list.renameFailed': '重命名失败：{error}',
  'list.delete': '删除',
  'list.deleteConfirm': '删除技能「{name}」？将移入 .trash。',
  'list.deleteFailed': '删除失败：{error}',
  'list.edit': '编辑',

  // filter toolbar
  'filter.searchLabel': '搜索',
  'filter.searchPlaceholder': '按名称或描述筛选',
  'filter.workspaceLabel': '工作区',
  'filter.workspaceAll': '全部',
  'filter.workspaceGlobal': '全局',
  'filter.empty': '没有匹配「{query}」的技能',
  'filter.emptyWorkspace': '当前筛选下没有技能。',

  // create form
  'create.scope': '创建位置',
  'create.scope.global': '全局（~/.dsh/skills）',
  'create.scope.globalAgents': '全局（~/.agents/skills）',
  'create.scope.project': '当前工作区（.dsh/skills）',
  'create.scope.projectAgents': '当前工作区（.agents/skills）',
  'create.name': '技能名（kebab-case，与目录同名）',
  'create.namePlaceholder': '如 my-workflow',
  'create.description': '描述',
  'create.whenToUse': '适用场景（可选）',
  'create.content': '指令内容（Markdown）',
  'create.mode': '初始调用状态',
  'create.submit': '创建技能',
  'create.empty': '技能名/描述/内容不能为空',
  'create.created': '已创建：{path}',
  'create.failed': '创建失败：{error}',
  'create.note': '创建后立即生效（skill-filesystem 会热扫描）。内容会作为指令注入模型上下文——不要写入敏感信息。',

  // edit form
  'edit.name': '技能名（不可修改）',
  'edit.loading': '正在读取技能内容…',
  'edit.loadFailed': '读取失败：{error}',
  'edit.submit': '保存修改',
  'edit.back': '返回列表',
  'edit.failed': '保存失败：{error}',
  'edit.mode': '调用状态（编辑时可同时修改）',
  'edit.note': '保存后立即生效（skill-filesystem 会热扫描）。',

  // rename form
  'rename.title': '重命名技能',
  'rename.hint': '重命名会移动原目录并将 frontmatter 的 name 字段同步更新；目录名与 frontmatter name 必须保持一致。',
  'rename.current': '当前名称',
  'rename.new': '新名称（kebab-case）',
  'rename.submit': '重命名',
  'rename.back': '返回列表',
  'rename.failed': '重命名失败：{error}',
  'rename.empty': '新名称不能为空',
  'rename.sameAsOld': '新名称必须与当前名称不同',

  // misc
  'refresh': '刷新',
} as const

export const en: Record<keyof typeof zh, string> = {
  'entry.label': 'Skill Manager',
  'entry.tooltip': 'Skill manager: browse and edit skills per workspace',
  'panel.title': 'Skill Manager',
  'panel.backToConversation': 'Back to chat',
  'tab.list': 'Skills',
  'tab.create': 'Create',
  'tab.edit': 'Edit skill',
  'tab.rename': 'Rename',

  'group.global': 'Global',
  'groupHint.global': '~/.dsh/skills · ~/.agents/skills · custom · runtime',
  'group.activeTag': 'active',
  'group.workspaceCount': '{count} skills',

  'subSource.dsh': '.dsh/skills',
  'subSource.agents': '.agents/skills',
  'subSource.custom': 'Custom directories',
  'subSource.bundled': 'System bundled',
  'subSource.runtime': 'Runtime registered',
  'subSourceHint.dsh': 'Project (or user) DSH skill root',
  'subSourceHint.agents': 'Project (or user) AGENTS skill root',
  'subSourceHint.custom': 'customSkillDirs config',
  'subSourceHint.bundled': 'DSH-internal bundled skills',
  'subSourceHint.runtime': 'Skills registered at runtime by plugins',

  'list.loading': 'Loading…',
  'list.loadFailed': 'Failed to load: {error}',
  'list.empty': 'No skills loaded yet.',
  'list.emptyGroup': 'No skills in this group.',
  'list.count': '{count}',
  'list.when': 'When: {when}',
  'list.linked': 'symlinked',
  'list.path': 'Path: {path}',

  'mode.label': 'Invocation',
  'mode.on': 'On',
  'mode.onHint': 'Model sees name + description + body in context; appears in /skills menu',
  'mode.nameOnly': 'Name only',
  'mode.nameOnlyHint': 'Model sees only the name in context (saves tokens), description/body hidden; still appears in /skills menu',
  'mode.userOnly': 'User only',
  'mode.userOnlyHint': 'Hidden from model context; appears in /skills menu (only the user can trigger)',
  'mode.off': 'Off',
  'mode.offHint': 'Hidden from both model and /skills menu; invoking returns an error',
  'mode.changeFailed': 'Failed to change invocation: {error}',

  'list.rename': 'Rename',
  'list.renameConfirm': 'Rename "{name}" to "{newName}"?',
  'list.renameFailed': 'Rename failed: {error}',
  'list.delete': 'Delete',
  'list.deleteConfirm': 'Delete skill "{name}"? It moves into .trash.',
  'list.deleteFailed': 'Delete failed: {error}',
  'list.edit': 'Edit',

  'filter.searchLabel': 'Search',
  'filter.searchPlaceholder': 'Filter by name or description',
  'filter.workspaceLabel': 'Workspace',
  'filter.workspaceAll': 'All',
  'filter.workspaceGlobal': 'Global',
  'filter.empty': 'No skills match "{query}"',
  'filter.emptyWorkspace': 'No skills under the current filter.',

  'create.scope': 'Location',
  'create.scope.global': 'Global (~/.dsh/skills)',
  'create.scope.globalAgents': 'Global (~/.agents/skills)',
  'create.scope.project': 'Current workspace (.dsh/skills)',
  'create.scope.projectAgents': 'Current workspace (.agents/skills)',
  'create.name': 'Skill name (kebab-case, same as directory name)',
  'create.namePlaceholder': 'e.g. my-workflow',
  'create.description': 'Description',
  'create.whenToUse': 'When to use (optional)',
  'create.content': 'Instructions (Markdown)',
  'create.mode': 'Initial invocation mode',
  'create.submit': 'Create skill',
  'create.empty': 'Skill name/description/content must not be empty',
  'create.created': 'Created: {path}',
  'create.failed': 'Create failed: {error}',
  'create.note': 'The skill takes effect immediately (skill-filesystem hot-scans). Its content is injected into the model context as instructions — do not put sensitive information in it.',

  'edit.name': 'Skill name (fixed)',
  'edit.loading': 'Loading the skill…',
  'edit.loadFailed': 'Failed to load: {error}',
  'edit.submit': 'Save changes',
  'edit.back': 'Back to list',
  'edit.failed': 'Save failed: {error}',
  'edit.mode': 'Invocation (can be changed here)',
  'edit.note': 'The edit takes effect immediately (skill-filesystem hot-scans).',

  'rename.title': 'Rename skill',
  'rename.hint': 'Renaming moves the original directory and rewrites the frontmatter `name` field; directory name and frontmatter name must stay aligned.',
  'rename.current': 'Current name',
  'rename.new': 'New name (kebab-case)',
  'rename.submit': 'Rename',
  'rename.back': 'Back to list',
  'rename.failed': 'Rename failed: {error}',
  'rename.empty': 'New name must not be empty',
  'rename.sameAsOld': 'New name must differ from the current one',

  'refresh': 'Refresh',
}

/** Locale key union for the slot map. */
export type SkillManagerKey = keyof typeof zh