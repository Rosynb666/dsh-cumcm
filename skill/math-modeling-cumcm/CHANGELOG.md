# 变更记录

## v2.1（2026-11-04）· LaTeX 修好 + 一键编译

- 本机 MiKTeX 从 24.1 升到 26.5，`miktex packages update` 解决 ctex/expl3 版本错配；
  补装 `xeCJK` 及 Oberdiek 系列（kvsetkeys 等）。
- 新增 `scripts/compile.py`：render → xelatex ×2 → 报页数与首个错误；内置 `--enable-installer`
  让缺包在建时自动安装。
- `preflight.py` 改用 `--enable-installer`，并尽力预建 MiKTeX 日志目录
  （目录缺失会被 MiKTeX 误报成「包数据库被锁」）。
- **验证**：模板在示例工作区编译成功，7 页 / 161 KB；摘要页版式、页码、`\res{}` 注入、
  AI 角标 `[AI1]` 均肉眼确认。

## v2.0（2026-11-04）· 三角色 + 2025 合规 + 排版体检

按 2025 官方文件重做了定位与工具链。依据：

- 《2025 年全国大学生数学建模竞赛论文格式规范（2025 年修订稿）》
  https://www.cmathc.org.cn/mcm/tz/303.html
- 《全国大学生数学建模竞赛人工智能工具使用规定（2025 年试行）》
  https://dxs.moe.gov.cn/zx/a/hd_sxjm_gsyw/250904/2017973.shtml

### 定位变化

- 从「协作器（只辅助）」改为「**三角色代笔 + 人工审核签字**」：
  AI 承担建模手 / 编程手 / 论文手，人承担审核官。
- 铁律从 5 条增到 6 条，新增「AI 必须标注、人工必须实质修改并签字」这一条硬约束。

### 新增

- `references/figures.md`：图表与可视化规范（选图型、版式、配色、三线表、高频扣分点）。
- `scripts/layout.py`：排版体检（页边距、目录、摘要页长度、图表题位置、三线表竖线、
  编号引用、身份信息、附录完整性、AI 声明、正文页数估算）。
- `scripts/figstyle.py`：统一图表风格（中文字体、黑白可辨配色、线型/标记成套、PDF+PNG 导出）。
- `scripts/appendix.py`：自动把 `code/` 全部源码与支撑材料清单生成 `paper/appendix.tex`。
- `templates/paper.tex`：`\pagestyle{plain}` + `\pagenumbering{arabic}`（页码从摘要页起）、
  AI 使用声明一节、附录条件引入、`\setCJKmonofont` 防代码中文掉字。

### 修正（对照官方规范）

| 旧 | 新 |
|---|---|
| 目录「常见」 | **不要目录**（规范明文） |
| 正文 20–25 页 | **≤20 页** |
| 承诺书/编号页列在结构里 | 电子版**不含**，第一页必须是摘要页 |
| AI 材料交 `.md` | 必须 **PDF**，文件名《AI 工具使用详情》 |
| 缺附录源码要求 | 附录必须含**支撑材料文件列表 + 全部可运行源码** |
| 无签字机制 | `review_signoff.md` 人工签字，`--strict` 校验 |

### 修复

- `preflight.py`：改为在工作区内建临时目录（DSH 沙箱下系统 TEMP 不可写，会把预检本身跑崩）；
  新增 xeCJK 缺失、包库被锁、expl3 过旧等诊断建议；失败时保留日志。
- `check.py`：裸数字扫描跳过参考文献与代码块；支持表格形式的 `changes.md`；
  `--strict` 增加 PDF 合规材料与签字校验。
- `ai_report.py`：输出 `.tex` 并编译 PDF；四要素缺失时明确报错；不再把 verbatim 塞进宏参数。

### 验证状态

| 项 | 结果 |
|---|---|
| `render.py` / `check.py` / `layout.py` / `appendix.py` | ✅ 在 `examples/demo` 与临时工作区跑通 |
| `examples/demo` 排版体检 | ✅ 0 ERROR 0 WARN |
| `figstyle.py` | ⚠️ 本机无 matplotlib，按设计报错退出（含替代方案） |
| LaTeX 编译 | ❌ 本机 ctex 2026 / expl3 2023 错配 + 缺 xeCJK，见 README |

## v1.0

初版：五条铁律、七阶段、`facts.json` 占位符机制、合规材料骨架。
