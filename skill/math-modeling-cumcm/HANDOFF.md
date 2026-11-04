# 交接说明 & 下一阶段提示词

> 给另一台电脑上的你 / 你的 agent 看。解压后先读这份，再读 `README.md` 和 `SKILL.md`。

## 一、这个项目是什么

`math-modeling-cumcm` 是一个 DSH skill，做**国赛数学建模论文的全流程初稿**：

- AI 同时扮演**建模手 / 编程手 / 论文手**，人扮演**审核官**（必须实质修改并签字）。
- 不是代写交稿器：产出带 AI 标注、带 TODO、带签字栏，不签不得称"可提交"。
- 核心机制：论文里任何计算结果只能写 `\res{key}`，由 `render.py` 从 `facts.json` 注入，杜绝幻觉数字。
- 合规：按国赛 2025 试行规定，正文角标 + 参考文献 AI 条目 + 《AI 工具使用详情》PDF。

## 二、现状快照（2026-11-04）

| 项 | 状态 | 说明 |
|---|---|---|
| SKILL.md 工作流 | ✅ 完成 | 6 条铁律 + 8 阶段 + 三角色 + 人工签字 |
| references 规范 | ✅ 完成 | 论文结构 / 图表可视化 / AI 合规 / 评审清单 |
| templates | ✅ 完成 | analysis、facts schema、LaTeX 模板（含声明与附录） |
| `render.py` | ✅ 已验证 | demo 上占位符正常注入，注释正确跳过 |
| `check.py` | ✅ 已验证 | 支持 `--strict`：合规 PDF、签字、改动条数 |
| `layout.py` | ✅ 新增并验证 | demo 上 0 ERROR / 0 WARN |
| `appendix.py` | ✅ 新增并验证 | 自动收录源码与支撑材料清单 |
| `figstyle.py` | ✅ 新增 | 本机无 matplotlib，按设计报错并给替代方案 |
| `ai_report.py` | ✅ 能出 .md/.tex | PDF 依赖可用的 xelatex |
| `preflight.py` | ✅ 已修复 | 沙箱下改用工作区临时目录，诊断更细 |
| LaTeX 模板编译 | ❌ **未验证** | ctex 2026 与 expl3 2023 错配，且缺 xeCJK |
| DSH 安装 | ✅ 已装 | `~/.dsh/skills/math-modeling-cumcm/` |

**原机器上的具体故障**（新机器若遇到类似情况按同样思路修）：

```
Class ctexart Error: Support package `expl3' too old.
```

ctex 是 2026 版（要求新 expl3），l3kernel 停在 2023-11；xeCJK 也缺；包服务器返回 401 且本机无网络直连。
→ 解决方向：更新 MiKTeX 全部宏包（或换镜像），确保 `preflight.py` 输出 `OK: 中文 PDF 编译成功`。

## 三、在另一台电脑上开始

```powershell
# 1. 解压后进入目录
cd math-modeling-cumcm

# 2. 环境预检（必须先通过）
python scripts/preflight.py

# 3. 装进 DSH（可选，装完新开会话生效）
$dst = "$env:USERPROFILE\.dsh\skills\math-modeling-cumcm"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item .\* $dst -Recurse -Force
```

依赖：Python ≥ 3.10；MiKTeX 或 TeX Live（xelatex + ctex + xeCJK）；画图建议装 matplotlib。

---

## Prompt 1 · 环境修复与链路验证（先跑这个）

```text
我在继续做"数模论文协作 agent"项目：math-modeling-cumcm（当前目录就是它）。

背景：这是一个给 DSH 用的 skill，用于辅助生成国赛数学建模论文初稿。
核心设计是"论文数字只能来自 facts.json、由脚本注入"，并带人工确认关卡和 AI 合规材料导出。
完整设计见 SKILL.md，用法见 README.md。

现在做第一阶段：环境修复与链路验证。

1. 读 README.md 的"环境要求"和"常见坑"两节。
2. 运行 python scripts/preflight.py。
3. 如果失败，按输出建议修复本机 TeX 环境（常见：ctex 与 expl3 版本不匹配、缺 xeCJK、包仓库镜像不通）。
   修到 preflight 输出 "OK: 中文 PDF 编译成功"。
4. 进入 examples/demo 跑通链路：
   python ../../scripts/render.py .
   python ../../scripts/check.py .
   cd paper
   xelatex -interaction=nonstopmode paper.rendered.tex   （连跑两遍）
5. 报告：
   - preflight 的最终输出
   - PDF 是否生成、共几页
   - check.py 的 ERROR / WARN 数
   - 过程中修了什么

约束：
- 不要修改 templates/paper.tex 的结构或内容来绕过编译错误；先判断是环境问题还是模板问题。
- 如果 30 分钟内修不好环境，停下来把具体报错贴出来，不要跳过验证谎报通过。
```

---

## Prompt 2 · 真题回测（主任务）

```text
我要跑一道国赛真题，题目和数据在：<把赛题目录或文件路径填在这里>。

请按 math-modeling-cumcm 的 SKILL.md 执行，工作区建在 work/<题号或短名>/。
先读 SKILL.md 全文，严格按其中的阶段和铁律执行。

本次任务到 Phase 3 为止（不做全文写作）：
- Phase 0：建目录，原题放 problem/，记录环境到 ai_log/env.md。
- Phase 1：完成破题笔记 analysis.md（问题拆解、数据体检、洞察、候选模型），
  然后停下来把 analysis.md 给我看，等我确认。不要提前进入下一阶段。
- Phase 2：按确认后的方向写模型方案（假设、符号表、模型形式、求解计划），
  再停下来等我确认。
- Phase 3：写求解脚本、跑出结果、写入 facts.json，并做合理性检验。

铁律：
- 论文/笔记里的计算数字只能来自 facts.json，不许手写。
- 核心建模路线由我拍板，不要自行决定。
- 结果不合理就如实记录，不要为了好看调数字。
- 每阶段的 AI 交互写进 ai_log/session.md。

完成后报告：analysis.md 要点、facts.json 条目数、跑通了几条检验、剩余风险。
```

---

## Prompt 3 · 补 reviewer 与美赛线（可选，回测跑顺再做）

```text
基于 math-modeling-cumcm 现有骨架，做两件事：

A. 把 reviewer 能力做实
   - 现在 references/review-checklist.md 是清单，SKILL.md 里 reviewer 只是角色名。
   - 补一个可直接派活的 reviewer prompt 模板（放 references/reviewer-prompt.md），
     要求它：按评分维度打分、列出最可能被扣分的 5 处、输出 review.md 格式，
     且只出意见不改稿。
   - 在 SKILL.md 的 Phase 6 里引用它。

B. 复制出美赛线 skill（math-modeling-mcm）
   - 英文产物、Summary Sheet 一页、页数上限、AI use report 格式与国赛不同。
   - 先写 SKILL.md 和 references，不要做 LaTeX 模板（等英文排版需求明确了再说）。

约束：
- 不要把国赛和美赛合进一个 skill，评分逻辑不同。
- 美赛规则以当年 COMAP Contest Instructions 为准，不要把旧年份条款写死。
- 改完给出文件清单和改动理由。
```

---

## 四、验收标准

| 阶段 | 通过条件 |
|---|---|
| 环境 | `preflight.py` 输出 `OK: 中文 PDF 编译成功`，demo 能出 PDF |
| 链路 | `render.py` 零残留、`check.py` 零 ERROR |
| 真题 | 能给出破题笔记且人认可；facts 中每条有 source；结果通过合理性检验 |
| 质量 | 熟练队员 4 小时内能把初稿改到可提交；事实错误 0 |

## 五、已知坑（省你时间）

- **BOM**：手工编辑 .tex 保存成"UTF-8 无 BOM"，否则 xelatex 报 `Missing \begin{document}`。
- **首次编译慢**：MiKTeX 按需下载宏包，网络差时像卡死；先跑 `preflight.py` 暴露问题。
- **字体**：模板用 `fontset=windows`，换 Mac/Linux 要改。
- **matplotlib 中文**：需设 `plt.rcParams['font.sans-serif'] = ['SimHei']`，否则方框。
- **demo 数据是假的**：`examples/demo/` 里的数字为演示链路，不要用于真实论文。

## 六、文件索引

```
SKILL.md                 工作流（agent 入口）
README.md                上手说明
HANDOFF.md               本文件
references/              论文结构 / AI 合规 / 评审清单
templates/               analysis、facts schema、paper.tex
scripts/                 preflight / facts / render / check / ai_report
examples/demo/           链路验证样例
work/                    赛题工作区（空）
```
