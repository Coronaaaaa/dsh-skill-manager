# @coronaaaaa/dsh-skill-manager

[English](README.md) | 中文

DSH Web GUI 的**技能管理**：按**工作区**分组浏览已加载的全部 skill
（每个 workspaceRegistry 行一组 + 末尾一个「全局」组覆盖
`~/.dsh/skills` / `~/.agents/skills` / 自定义目录 / 内置 / 运行时注册）；
每组再按子来源（`.dsh/skills` / `.agents/skills` / 自定义 / 内置 /
运行时）细分。管理 4 状态生命周期（`on` / `name-only` /
`user-invocable-only` / `off`）、编辑描述 / 适用场景 / 正文、重命名
（移动目录 + 同步 name 字段）、删除（移入 .trash）。

Fork 自 `@linxin666/dsh-client-ui-skill-explorer`。

## 功能

- 侧边栏「技能管理」一行（位于 shell 自己的面板列表，与插件、定时、
  任务看板并列），打开的是**原生中栏页面**，带页签栏与「返回会话」
  控件。
- **技能 tab**：顶层按**工作区分组**——从 `ctx.workspaceRegistry.list()`
  拿到的工作区逐个成一组，末尾追加一个**全局组**覆盖
  `~/.dsh/skills` / `~/.agents/skills` / `customSkillDirs` /
  bundled / runtime。每个工作区组内再按子来源（`.dsh/skills` /
  `.agents/skills`）细分。当前活跃工作区带「当前」标签，方便定位。
  顶部搜索框按技能名或描述即时过滤（名称命中排在前面，Esc 清空），
  并与工作区选择器（全部 / 某个具体工作区 / 全局）叠加生效。
- **每行 4 状态调用下拉框**：canonical 字段是 frontmatter 的
  `invocation-mode`：
  - `on` — 模型在上下文中看到「名称 + 描述 + 正文」，出现在
    `/skills` 菜单。
  - `name-only` — 模型只看到名称（节省 token），描述与正文隐藏；
    仍出现在 `/skills` 菜单。
  - `user-invocable-only`（在 `/skills` 菜单里渲染为 **user-only**）—
    对模型不可见，仅用户可手动触发；出现在 `/skills` 菜单。
  - `off` — 对模型与 `/skills` 菜单都不可见；调用会报错。
- **编辑 / 重命名 / 删除**入口。编辑就地改写描述、适用场景、正文，
  也可在同一表单里翻转调用状态；重命名移动目录并同步更新
  frontmatter 的 `name:` 字段；删除把文件移入 `.trash`（可恢复）。
- **创建 tab**：表单创建新技能，位置可选：全局
  `~/.dsh/skills`、全局 `~/.agents/skills`、当前工作区
  `.dsh/skills`、当前工作区 `.agents/skills`，并带初始调用状态下拉
  框。
- 数据来自按官方 dsh-skill-filesystem 根约定的文件系统扫描，并与
  `ctx.skills` 注册表（bundled / runtime 条目）合并。本插件不改变
  skill 的加载/注入语义——纯 GUI 管理层。

## Frontmatter 契约

canonical 字段是 `invocation-mode`，合法四个值：

```yaml
---
name: code-review
description: 审阅代码改动，关注风格与正确性。
invocation-mode: name-only      # canonical 4-state
disable-model-invocation: false  # 由 mode 镜像（旧版 core 只读这两个）
user-invocable: true             # 由 mode 镜像
---

# skill 正文…
```

| Mode                   | 模型上下文 | `/skills` 菜单 | modelInvocable | userInvocable |
| ---------------------- | ---------- | --------------- | -------------- | ------------- |
| `on`                   | 名 + 描 + 正文 | ✓           | true           | true          |
| `name-only`            | 仅名称     | ✓               | true           | true          |
| `user-invocable-only`  | 隐藏       | ✓               | false          | true          |
| `off`                  | 隐藏       | ✗               | false          | false         |

读取时优先 `invocation-mode`；缺省时按旧版
`disable-model-invocation` / `user-invocable` 对反向推导
（`{modelInvocable=true, userInvocable=true}` → `on`，
`{false, true}` → `user-invocable-only`，其它 → `off`）。写入时同步
写三字段，保证只识别旧字段对的官方 core 也能正确解释。

## 安装

### 从 npm（推荐）

```sh
dsh plugin --profile web add @coronaaaaa/dsh-skill-manager@latest
```

### 从仓库（开发）

```sh
git clone https://github.com/Coronaaaaa/dsh-skill-manager.git
cd dsh-skill-manager
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)
```

安装后重启 `dsh web`，侧边栏出现「技能管理」入口。

## 路由

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsh-skill-manager/list` | GET | 工作区分组的技能列表 |
| `/api/dsh-skill-manager/read` | GET | 单个技能的可编辑字段与正文（`?name=&path=`） |
| `/api/dsh-skill-manager/set-mode` | POST | 设置 canonical 4 状态模式（`{ name, path, mode }`） |
| `/api/dsh-skill-manager/set-enabled` | POST | 旧版 on/off 开关；映射到 `on` 或 `off` |
| `/api/dsh-skill-manager/create` | POST | 创建技能（`{ scope, name, description, whenToUse?, content, mode, cwd }`） |
| `/api/dsh-skill-manager/update` | POST | 原地修改已有技能（可同时翻转调用状态） |
| `/api/dsh-skill-manager/rename` | POST | 重命名（移动目录 + 同步 frontmatter 的 `name:`） |
| `/api/dsh-skill-manager/delete` | POST | 删除（移入 .trash） |
| `/api/dsh-skill-manager/health` | GET | 健康检查 |

`scope` 可选：`user-dsh`、`user-agents`、`project-dsh`、
`project-agents`（以及兼容旧版的别名 `global` / `workspace`）。

## 安全模型

- 全部 `/api/dsh-skill-manager/*` 路由默认仅限 loopback（插件家族共享
  围栏：loopback 套接字 + Host 头 + 浏览器同源标记）：未配对的局域网
  客户端在任何技能文件访问前即收到 `403 forbidden: loopback-only`。
  同时装了 `dsh-remote-web-ui` 时，有效的已配对设备 cookie 是额外放行
  路径；未配对与已撤销设备仍 403。技能管理不硬依赖远程插件。
- 写路由仅把面板展示的路径作为身份声明；执行修改前，最新文件系统扫描
  必须解析到同名且路径完全一致的技能。任意路径与过期的同名回退都会被
  拒绝，因此项目技能消失后，尚未执行的操作不会改到同名的用户级或自定
  义技能。read 路由走同一套解析，因此也无法用来读取任意路径。
- update 路由原地改写已有 SKILL.md，不改技能名与位置，并原样保留当前
  的 `invocation-mode`，因此编辑不会静默翻转已设置的调用状态。rename
  路由会移动目录；create / update / set-mode / set-enabled / delete 路
  由都不会移动目录。
- 技能内容是用户自写的 markdown；创建与更新表单限制内容 64KB。
- 面板用文本节点渲染技能描述（无 HTML 注入）。
- 扫描跟随符号链接：skill 根里的符号链接目录 / `.md` 单文件链接会被
  当作普通技能列出。链接属于用户的挂载意图，因此不校验链接目标是否
  落在某个 skill 根内；项目根（可能来自 clone 的仓库）里的符号链接被
  视为该项目内容，其指向目录中的 `SKILL.md` 会被读取并展示——这是预
  期信任边界。**链接技能可列出、可翻调用状态（改写目标自身的
  frontmatter），但不可删除、不可重命名、也不可编辑**：删除 / 重命名
  / 编辑都会让目标 `SKILL.md` 越出当前 skill 根，因此对链接技能隐藏
  删除 / 重命名 / 编辑按钮，并在 delete / rename / update 路由上拒
  绝（400）。写操作仍受 loopback 围栏与「仅信任最新扫描路径」约束。

## 已知限制

- 工作区检测通过 `ctx.workspaceRegistry.list()` 拿全量；当前活跃工作区
  取注册表顺序的首行（注册表对实时会话保留 canonical-cwd 头索引，但
  没有同步暴露给列出的 API）。
- frontmatter 解析为零依赖轻量实现（块标量、布尔、input 嵌套块）；
  不支持的生僻 YAML 特性以官方 dsh-skill-filesystem 提供方为准。
- 链接技能不可删除 / 不可重命名 / 不可编辑（见安全模型）；翻调用状态
  对链接技能正常（改写目标 `SKILL.md` frontmatter）。目录型与「单文
  件」链接都能正常列出；「单文件」符号链接（指向单个 `.md`）在原子
  改写（flip mode）时会被替换为一个普通文件（链接不再保留），目标
  文件本身不受影响。

## License

BSD-3-Clause.