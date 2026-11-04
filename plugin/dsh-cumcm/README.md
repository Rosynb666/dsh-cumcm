# dsh-cumcm · 数模台

> 作者：**Rosynb666** · DeepSeek Harness 插件

给 [math-modeling-cumcm](https://github.com/) skill 配一个**看得见的工作台**：在 DeepSeek Harness 右侧栏里看七阶段进度、事实台账，一键跑体检、编译论文 PDF。

配套 skill 负责「怎么干」，这个插件负责「干到哪了、数字对不对、能不能交」。

## 它显示什么

- **七阶段进度**：环境 → 破题 → 建模 → 求解 → 写作 → 图表 → 自检 → 合规，靠磁盘上的产物判断，不靠对话记忆。
- **新建工作区**：面板里输入名字（用题目关键词，不绑年份），自动建 `work/<名字>/` 并拷模板。
- **事实台账**：`facts.json` 每条 key / 数值 / 单位 / 来源脚本，点开看对照检验。
- **体检数字**：`\res{}` 占位符数、缺失 key、`\aiflag{}` 标注数、TODO 数、图表数。
- **一键操作**：注入数值、合规自检、排版体检、收附录、编译 PDF、生成《AI 工具使用详情》。
- **过程视图**：产物时间线（谁先谁后）、代码清单（行数/体积）、论文章节（字数条）。
- **人工签字卡**：填审核人、日期、审核范围与改动清单，直接落成 `review_signoff.md` 与 `changes.md`。
- **直接看 PDF**：论文与合规材料都在面板里点开。

## 安装

### 1. 装 skill

```powershell
Copy-Item .\math-modeling-cumcm "$env:USERPROFILE\.dsh\skills\" -Recurse
```

（skill 目录里含 `scripts/`，插件靠它干活。）

### 2. 装插件

DSH 自带 CLI（没在 PATH 里，用全路径）：

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add file:C:\path\to\dsh-cumcm
```

**手工装法**（本机当前就是这种，等价可用）：把 `dsh-cumcm` 目录放进
`<profile>/node_modules/`，再往 `<profile>/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: dsh-cumcm
      name: dsh-cumcm
```

> 注意：手工复制的目录在下次 `pnpm install` 时可能被清掉；要长期使用请走 `dsh plugin add`。

装完刷新页面；右侧栏出现「数模台」即成功（宿主侧走 loader 热组合，通常不用重启）。

## 配置

在 profile 补丁层里覆写：

```yaml
- id: dsh-cumcm
  name: dsh-cumcm
  config:
    skillDir: ~/.dsh/skills/math-modeling-cumcm   # 缺这套脚本它没法干活
    projectsRoot: ~/Desktop/DeepSeek/work          # 只允许打开这下面的目录
    pythonPath: C:\...\python.exe                  # 缺省自动探测 DSH 自带 runtime
    allowAnyDir: false                             # 想开任意目录再设 true
    taskTimeoutMs: 180000
```

## 接口（宿主侧）

前缀 `/dsh-cumcm/api`，与市场、鱼篓一样是**免鉴权的插件路由**，因此自带同源校验。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/ping` | 自检：版本、skill 目录、projects 根 |
| GET | `/projects` | 列出 projectsRoot 下像数模工作区的目录 |
| POST | `/new` | `{name}` 新建工作区（建骨架 + 拷模板），重名 409、非法名 422 |
| GET | `/status?dir=` | 七阶段 + 台账 + 计数 + PDF 状态 |
| GET | `/text?dir=&path=` | 读白名单文本（facts.json / paper.tex / ai_log 等） |
| GET | `/pdf?dir=&which=paper\|ai` | 流式返回 PDF |
| POST | `/run` | `{dir, task}`，task ∈ render/check/layout/appendix/compile/ai |

## 安全模型

威胁不是同机进程，而是**浏览器里的第三方页面借用户身份打 loopback**：

1. `Sec-Fetch-Site: cross-site` → 403；`Origin` 与 `Host` 不一致 → 403。
2. 写接口只接受 `application/json`（跨站表单发不出该 content-type）。
3. `dir` 必须真实存在、且含 `facts.json` / `paper/paper.tex` / `analysis.md` 之一，并默认限制在 `projectsRoot` 内。
4. `/text` 走**白名单**，不做「传什么读什么」。
5. 所有子进程都是 `spawn` + 参数数组，不拼 shell 字符串；超时自动杀。

## 开发

```powershell
node --check lib/index.js
node --check lib/client.js
node test/api.test.js        # 16 条宿主接口测试（起真 http server，不依赖 DSH）
node test/client.test.js     # 6 条客户端测试（注册契约 + 真实 React 首屏渲染）
```

测试覆盖：路由、状态统计（含 LaTeX 注释剔除）、同源/内容类型/白名单三道闸、PDF 缺件。
不覆盖子进程执行——沙箱里管道 stdio 会被 EPERM 拦掉，那部分走真机手测（见 PUBLISH.md）。

宿主半边只 `inject: ['webServer']`，其余一概不要——宿主小版本漂移时最坏是功能降级，不会炸掉整棵插件树。
浏览器半边零构建、只 `require('react')`，注册全走 `ctx.effect`，卸载即释放。

## 许可

MIT
