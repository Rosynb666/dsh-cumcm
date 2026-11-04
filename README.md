# 数模台 · 开源发行版

> 作者：**Rosynb666**　版本：skill 2.1 / plugin 0.1.0　许可：MIT

DeepSeek Harness 的数学建模竞赛工作台，两件套：

| 目录 | 是什么 |
|---|---|
| `skill/math-modeling-cumcm/` | 工作流本体：三角色（建模手/编程手/论文手）+ 2025 规范 + 9 个脚本 + LaTeX 模板 |
| `plugin/dsh-cumcm/` | 侧栏面板「数模台」：七阶段、事实台账、过程视图、一键体检与编译、PDF 预览、人工签字卡 |

skill 负责「怎么干」，插件负责「干到哪了、数字对不对、能不能交」。

## 安装

```powershell
# skill
Copy-Item .\skill\math-modeling-cumcm "$env:USERPROFILE\.dsh\skills\" -Recurse

# plugin（DSH 自带 CLI，不在 PATH 里）
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add file:<解压路径>\plugin\dsh-cumcm
```

手工装法见 `plugin/dsh-cumcm/README.md`。装完刷新页面，右侧栏出现「数模台」。

## 内容

- `skill/.../references/`：论文结构、图表可视化、AI 合规、评审清单；
- `skill/.../scripts/`：preflight / render / check / layout / appendix / compile / ai_report / figstyle / facts；
- `plugin/.../test/`：19 条接口测试 + 6 条客户端测试；
- `plugin/.../docs/LESSONS.md`：踩过的坑（编码、沙箱、HMR）。

## 许可

MIT，署名 Rosynb666。可以自由使用、修改、再分发，保留版权声明即可。
