# 数模三角色工作流（CUMCM / DSH skill）

> 作者：**Rosynb666**

AI 同时扮演**建模手、编程手、论文手**，从赛题一路产出：可编译的论文初稿、图表、事实台账、《AI 工具使用详情》。

**但它不是"代写交稿器"**：产出物带 AI 标注、带待办、带签字栏，必须经人工审核修改后才谈提交。
这不是道德洁癖——2025 规定要求"核心建模与分析由参赛队独立完成"，并交 PDF 版《AI 工具使用详情》；
全自动交付既不合规，也过不了评委那关。

## 快速开始

```powershell
# 0. 环境预检（必须通过；沙箱里跑用 --dir 指到工作区内）
python scripts/preflight.py

# 1. 建工作区（一题一个，名字用题目关键词，别用年份）
$w = "work/电池寿命预测"
New-Item -ItemType Directory -Force "$w/paper/figs", "$w/code", "$w/ai_log", "$w/problem"
Copy-Item templates/analysis.md "$w/analysis.md"
Copy-Item templates/facts.json  "$w/facts.json"
Copy-Item templates/paper.tex   "$w/paper/paper.tex"

# 2. 按 SKILL.md 的 8 个阶段推进（P0 环境 → P7 合规）

# 3. 附录自动收录源码
python scripts/appendix.py $w

# 4. 三道自检（顺序不能反）
python scripts/render.py $w          # 注入数值，查残留
python scripts/check.py  $w --strict # 一致性 / 溯源 / 合规 / 签字
python scripts/layout.py $w          # 排版体检：页数、图表、编号、身份信息

# 5. 编译（一条命令搞定：render → xelatex ×2 → 报页数与错误）
python scripts/compile.py $w

# 6. 合规材料（必须产出 PDF）
python scripts/ai_report.py $w
```

## 目录

```
SKILL.md                    工作流入口（DSH 加载）
references/
  paper-structure.md        2025 官方格式 + 结构 + 20 页预算
  figures.md                图表与可视化规范
  compliance.md             AI 使用规定与披露材料
  review-checklist.md       评委视角清单
templates/                  analysis / facts / paper.tex
scripts/
  preflight.py              环境预检（试编译中文文档）
  render.py                 facts.json → \res{} 占位符
  check.py                  一致性 / 溯源 / 合规 / 签字
  layout.py                 排版体检
  figstyle.py               图表统一风格（配色/字体/线宽/导出）
  appendix.py               源码与支撑材料清单 → appendix.tex
  compile.py                render + xelatex ×2，报页数与首个错误
  ai_report.py              ai_log →《AI 工具使用详情》PDF
  facts.py                  求解脚本写入 facts 的接口
examples/demo/              链路验证样例（演示数据）
work/                       赛题工作区
```

## 三条不可绕过的机制

### 1. 数字不可手写

正文任何计算结果都是 `\res{key}`，由 `render.py` 从 `facts.json` 注入：

```latex
均方根误差为 \res{rmse}，较基准下降 \res{cost_drop_pct}\%。
```

```python
from facts import FactStore
store = FactStore()
store.add("rmse", 0.0421, fmt=".4f", desc="验证集 RMSE",
          source=__file__, check="低于基线 0.0683")
store.save()
```

`check.py` 会扫正文里的裸小数/百分比并报警（参数设定值可在行尾加 `% nofact` 豁免）。

### 2. AI 必须标注，人必须签字

- 每段 AI 起草的文字结尾 `\aiflag{1}`，参考文献列 AI 工具条目，参考文献后单列「AI 使用声明」。
- `ai_log/changes.md` 至少 5 条实质改动（改假设/改模型/改结论都算，改错别字不算）。
- `ai_log/review_signoff.md` 由队员手填，**AI 不得代签**；`check.py --strict` 会核对签字栏是否为空。

### 3. 排版有硬指标

`layout.py` 直接按 2025 规范查：页边距 ≥2.5cm、不要目录、摘要 1 页、图题在下表题在上、
三线表无竖线、图表必须被引用、附录含源码、**不得出现学校/队号/赛区**、正文 ≤20 页。

## 环境要求

| 项 | 要求 | 本机实测（2026-11-04 修好） |
|---|---|---|
| Python | ≥3.10 | DSH runtime 3.14 ✓（numpy/pandas/Pillow 齐全） |
| LaTeX | xelatex + ctex + xeCJK | **✓ 已修复**（MiKTeX 26.5，模板 7 页 PDF 编译通过） |
| 画图 | matplotlib（推荐）或 Pillow | 无 matplotlib；Pillow 可用 |

### LaTeX 修复记录（本机踩过的坑，别的机器可能同样遇到）

原故障：`Class ctexart Error: Support package 'expl3' too old.`（ctex 2026 要新 expl3，l3kernel 停在 2023-11，且缺 xeCJK）。

实际修法（三步，全部命令行）：

```powershell
$bin = "C:\Users\ROG\AppData\Local\Programs\MiKTeX\miktex\bin\x64"
# 1. 更新全部宏包（会把 l3kernel 一起升上去，MiKTeX 同时升到 26.5）
& "$bin\miktex.exe" packages update
# 2. 补装缺的宏包
& "$bin\miktex.exe" packages require xeCJK kvsetkeys kvdefinekeys etexcmds infwarerr kvoptions ltxcmds refcount intcalc xstring
# 3. 编译时允许按需自动装包（compile.py / preflight.py 已内置 --enable-installer）
```

**一个容易误诊的点**：如果 `%LOCALAPPDATA%\MiKTeX\miktex\log` 不存在或不可写，
MiKTeX 会报「包数据库被锁 / 拒绝访问」，看起来像权限问题，其实先建好这个目录就正常了。
`preflight.py` 会尽力帮你建。

> 编译仍然失败时的退路：论文走 Word（`office-docx` + LibreOffice），公式排版会吃亏。

### matplotlib 缺失

`figstyle.py` 会明确报错并给替代路径（Pillow 手绘，见 `examples/demo/code/make_roadmap.py`），不静默降级。
要装：`python -m pip install matplotlib`（注意装进 DSH 用的那个解释器）。

## 常见坑

- **BOM**：Windows 保存 `.tex` 带 UTF-8 BOM → xelatex 报 `Missing \begin{document}`。脚本已按 `utf-8-sig` 读、无 BOM 写。
- **沙箱里的 TEMP 不可写**：`preflight.py` 默认在工作区内建 `.preflight/`；别用系统临时目录，否则报一堆 PermissionError。
- **首次编译慢**：MiKTeX 按需下载宏包，网络差时像卡死。先跑预检暴露问题。
- **中文字体**：模板用 `fontset=windows`，换 Mac/Linux 要改 `fontset`。
- **verbatim 不折行**：附录代码单行别超 100 字符，`appendix.py` 会检查。
- **页数**：正文 ≤20 页（2025 规范），附录不计。`layout.py` 会按字数+图表估算。

## 验收标准

不是"看起来像论文"，而是：

1. `check.py --strict` 与 `layout.py` 双 PASS；
2. 从 `facts.json` 随机抽 3 个数，正文/附录代码/PDF 三处一致；
3. 队员能在 4 小时内改到可提交（`review.md` 里 5 处最该改的都有明确改法）；
4. 签字齐全，`支撑材料/AI 工具使用详情.pdf` 存在且四要素完整。

## 装进 DSH

```powershell
$dst = "$env:USERPROFILE\.dsh\skills\math-modeling-cumcm"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item .\* $dst -Recurse -Force
```

装完**新开一个会话**，skill 才会出现在目录里。之后直接给赛题即可。

## 合规声明

- 遵守《全国大学生数学建模竞赛人工智能工具使用规定（2025 年试行）》：正文标注、参考文献列工具、提交 PDF 版《AI 工具使用详情》。
- 不提供"降 AI 率/绕过检测"功能——新规是披露制，如实披露即合规。
- 使用者对提交内容负全部责任；核心建模与分析必须由参赛队实质完成并留痕。
