# AGENTS.md — skill-manager

DSH Web GUI 的**技能管理**插件：侧边栏「技能管理」入口打开面板，按工作区
分组浏览已加载 skill（每个 workspace registry 行一组 + 1 个全局组覆盖
~/.dsh/skills、~/.agents/skills、自定义目录与运行时注册）；每组再按
子来源（`.dsh/skills` / `.agents/skills` / 自定义 / 内置 / 运行时）细
分。支持 4 状态生命周期（`on` / `name-only` / `user-invocable-only` /
`off`，写 frontmatter `invocation-mode` 并镜像到旧版
`disable-model-invocation` / `user-invocable` 字段）、创建、编辑（描述 /
适用场景 / 正文 / 模式）、重命名（移动目录 + 同步 name 字段）、删除
（移入 .trash）。

包级规则：只写本包特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的
全局/包级规则。

## 本包要点

- **4 状态生命周期**：canonical 字段是 frontmatter 的 `invocation-mode`
  （合法值 `on` / `name-only` / `user-invocable-only` / `off`）。读取时
  优先 `invocation-mode`，缺省时从旧版 `disable-model-invocation` /
  `user-invocable` 推导；写入时同时写三字段，保证只识别旧字段对的官方
  core 也能正确解释。映射见 `src/frontmatter.ts` 的 `invocationPolicy`
  与 `resolveInvocationMode`。
- **工作区分组**：路由族从 `ctx.workspaceRegistry.list()` 拿全部工作区，
  按其注册顺序逐个扫描对应目录的 `.dsh/skills` 与 `.agents/skills`；
  全局组固定位于末尾，覆盖 `~/.dsh/skills`、`~/.agents/skills`、
  `customSkillDirs` 配置目录以及 `bundled` / `runtime` 注册表条目。
  面板以「工作区组 → 子来源 → skill 行」三级结构渲染；工作区选择器同
  时支持 `all` / 单个 global、某个工作区 path。
- **host 半区**（`src/index.ts` + `src/routes.ts` + `src/access.ts` +
  `src/collect.ts` + `src/frontmatter.ts`）提供
  `/api/dsh-skill-manager/*` 路由族（list / read / set-mode /
  set-enabled（兼容）/ create / update / rename / delete / health），
  默认 loopback 围栏，已配对设备 cookie 为额外放行路径（不硬依赖
  remote-web-ui）；写路由只信任新扫描路径，删除 / 重命名额外拒绝
  linked（软链接）技能，避免目标文件逃出 skill root。
- **client 半区**（`src/client/`）经官方槽位注册**原生中栏面板**：
  `native-panel.tsx` 往 shell 自己的面板列表（`sidebar.panellist`）
  贡献一行、往布局的 keyed `main` 槽贡献页面（`src/client/panel/`，
  `SkillPanel.tsx` 壳 + 技能 / 创建 / 编辑 / 重命名页签），并驱动
  `ctx.layout.selectPanel`——与任务看板同一形态，行盒 / 标签 / 高亮 /
  折叠轨道归 shell。页签与编辑 / 重命名目标存在 `panel/controller.ts`，
  因为布局只在该面板被选中时挂载页面，组件本地 state 会在切面板时丢
  失；页面只读 controller 快照。占位完全由布局的 keyed `main` 槽决定，
  本包不再参与任何家族互斥协议。
- 纯逻辑（扫描 / 分组 / frontmatter 解析 / 4 状态推导）在 host 侧单测
  锁定行为（`tests/collect.spec.ts`、`tests/frontmatter.spec.ts`、
  `tests/routes.spec.ts`、`tests/access.spec.ts`）；路由围栏与错误路径
  必须带测试。新增测试覆盖：
  - 4 状态写入与镜像：写一个 mode → 三个字段都正确；
  - rename 路由：路径移动 + name 同步 + linked 拒绝；
  - 旧版 frontmatter 兼容：只有 legacy pair 时正确推导 mode。
- 安全语义（loopback 围栏、已配对 cookie 额外放行、写路由只信任扫描路
  径）见 README「安全模型」节，修改安全语义时必须同步更新 README 与测
  试。
- 样式纪律（`src/client/panel/panel.module.css`）：面板不持有自己的调
  色板——颜色 / 表面 / 边框 / 阴影 / 字体一律取自官方主题 token
  （`--dsw-alias-*`、`--dsw-specific-*`、`--dsw-shadow-*`、
  `--dsw-font-*`），不写 hex/rgb 字面量、不给 `var()` 写颜色兜底、不
  写 `[data-ds-dark-theme]` 覆写块。明暗由主题负责；填充主按钮用
  `button-primary-fill` + `label-primary-foreground` 配对。4 状态选择
  器的颜色通过 `data-mode` 属性挂到 4 个主题 token（success /
  business / warn / error）上，亮色与暗色皆由主题负责。

## 提交前检查

本包是独立仓库（不是 monorepo workspace），提交前在仓库根目录运行：

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` 包含 host 半区（`lib/index.{mjs,d.mts}`）与 client 半区（`lib/client.{mjs,d.mts}` + `lib/style.css`）两个 bundle，按顺序先后构建；如果 CSS 模块产物缺失，install `@tsdown/css`（`pnpm add -D @tsdown/css`）。