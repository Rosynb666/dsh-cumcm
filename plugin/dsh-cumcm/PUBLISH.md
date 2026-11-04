# 发布清单 · dsh-cumcm 数模台

> 目标：发到 GitHub → 提 PR 进 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
> → 自动出现在 [dshmarket](https://github.com/dsh-market/dsh-market) 与目录站。

## 一、仓库信息（直接抄）

- **仓库名**：`dsh-cumcm`
- **一句话**：给国赛（CUMCM）论文配一块看得见的工作台——P0–P7 进度、facts 事实台账、一键体检与编译 PDF。
- **README 首段**：配套 `math-modeling-cumcm` skill，把「数字可追溯 + AI 使用合规 + 排版硬指标」做进面板。
- **Topics**：`dsh` `dsh-plugin` `deepseek-harness` `cordis` `cumcm` `math-modeling` `latex` `chinese`

## 二、发布前检查

- [ ] `package.json` 版本 `0.1.0`，`files` 只含 `lib` / patch / README / LICENSE
- [ ] `README.md` 有安装、配置、接口、安全模型（已写）
- [ ] LICENSE = MIT（已写）
- [ ] 不放 `node_modules`（`.gitignore` 已排除）
- [ ] 截图/GIF：右栏面板 + 一次编译（建议 2 张，README 顶部）
- [ ] 兼容性声明：`engines.dsh` 或 peer 范围；至少写明「在 dsh 0.2.1-rc.3 实测通过」
- [ ] `cordis.patch.yml` 里只插一条 entry，`config` 全走注释示例
- [ ] 真实环境验证记录（见下）

## 三、已在真机验证的项目

| 项 | 结果 |
|---|---|
| 宿主路由 | `/ping` `/projects` `/status` `/text` `/pdf` `/run` 全部通过 |
| 一次编译 | `render → xelatex ×2`，2272 ms / 7 页 161 KB |
| 冷启动项目 | 从空目录建 `work/2025B`，appendix→render→check→layout→compile→ai 全链路通过 |
| 合规材料 | `AI 工具使用详情.pdf` 42 KB，1.86 s |
| 客户端模块 | 已进入 `__DSH_BOOT__` 模块图，改文件后 rev 热更新（`/plugins/events`） |
| 面板渲染 | 真实 React SSR 渲染通过（标题/空态/刷新按钮） |
| 环境 | Windows 11 · DSH 0.2.1-rc.3 · MiKTeX 26.5 · Python 3.14 |

## 四、awesome-dsh-plugin PR 文案

```markdown
- [dsh-cumcm](https://github.com/<you>/dsh-cumcm) — 数模台：国赛论文工作台。
  右栏看七阶段进度与 facts 事实台账，一键 render / check / layout / 编译 PDF，
  配套 math-modeling-cumcm skill。
```

分类建议：`工具` / `文档`。

## 五、发布命令

```powershell
git init
git add .
git commit -m "feat: dsh-cumcm 0.1.0 — 数模台（七阶段 + 事实台账 + 一键编译）"
git branch -M main
git remote add origin https://github.com/<you>/dsh-cumcm.git
git push -u origin main
```

装给别人：

```powershell
dsh plugin --profile desktop add github:<you>/dsh-cumcm
```

## 六、还没做（说清楚，别吹）

- 仅 Windows 实测；macOS/Linux 的字体与 LaTeX 探测未验证。
- 面板只做了只读台账 + 六个动作，没有编辑器内预览 diff。
- 依赖 skill 目录里的脚本；skill 与插件版本需要一起发。
- 宿主接口有 16 条测试 + 客户端 6 条（`npm test`）；子进程执行路径未覆盖自动化测试，
  因为沙箱下 spawn 的 stdio 管道会被 EPERM 拦掉，只能真机手测。
