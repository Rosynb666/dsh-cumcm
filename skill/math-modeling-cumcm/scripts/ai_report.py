"""从 ai_log/ 汇总生成《AI 工具使用详情》，并编译成 PDF。

用法:
    python scripts/ai_report.py work/2025A

输入（缺一不可，缺了会报错）:
    ai_log/env.md            工具清单与版本
    ai_log/session.md        各阶段提示词与关键结论
    ai_log/changes.md        人工修改记录（实质改动 ≥5 条）
    ai_log/decisions.md      跳关/路线决策（可空）

输出:
    work/2025A/支撑材料/AI 工具使用详情.md
    work/2025A/支撑材料/AI 工具使用详情.tex
    work/2025A/支撑材料/AI 工具使用详情.pdf   ← 官方要求 PDF，文件名必须一致

说明: 本脚本只做结构拼装与合规检查，不加工内容。内容质量取决于 ai_log 是否真实记录。
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

TITLE = "AI 工具使用详情"

MD_TEMPLATE = """# {title}

> 依据《全国大学生数学建模竞赛人工智能工具使用规定（2025 年试行）》生成。
> 本题：{problem}
> 生成时间：{now}

## 一、工具清单

{env}

## 二、使用目的与环节

{summary}

## 三、关键交互记录

{session}

## 四、采纳与人工修改情况

{changes}

## 五、路线决策记录（如有）

{decisions}

## 六、人工确认

审核人：____________    日期：____________
结论：□ 已实质审核并修改  □ 修改后再审

---
本文件由 `scripts/ai_report.py` 从 `ai_log/` 原样拼装，未做二次加工。
"""

TEX_TEMPLATE = r"""% 由 scripts/ai_report.py 自动生成，勿手改
\documentclass[UTF8,11pt,fontset=windows]{ctexart}
\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage{booktabs,array}
\usepackage{xcolor}
\linespread{1.35}
\setCJKmonofont{SimSun}
\pagestyle{plain}
\begin{document}
\begin{center}
{\zihao{3}\heiti AI 工具使用详情}
\end{center}
\vspace{0.5em}
\noindent 依据《全国大学生数学建模竞赛人工智能工具使用规定（2025 年试行）》。\\
赛题：{{PROBLEM}} \quad 生成时间：{{NOW}}

\section{工具清单}
{{ENV}}

\section{使用目的与环节}
{{SUMMARY}}

\section{关键交互记录}
{{SESSION}}

\section{采纳与人工修改情况}
{{CHANGES}}

\section{路线决策记录}
{{DECISIONS}}

\section{人工确认}
\noindent 审核人：\underline{\hspace{4cm}} \quad 日期：\underline{\hspace{3cm}}

\noindent 结论：□ 已实质审核并修改 \quad □ 修改后再审
\end{document}
"""


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig", errors="replace").strip() if path.is_file() else ""


def tex_escape(text: str) -> str:
    """只用于短文本（赛题名、时间），不用于大段正文。"""
    repl = {
        "\\": r"\textbackslash{}", "%": r"\%", "&": r"\&", "#": r"\#",
        "_": r"\_", "{": r"\{", "}": r"\}", "$": r"\$",
    }
    return "".join(repl.get(ch, ch) for ch in text)


def _display_width(text: str) -> int:
    """中文算 2 列、西文算 1 列。"""
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in text)


def wrap_verbatim(text: str, width: int = 84) -> str:
    """按显示宽度硬折行。

    verbatim 不自动换行，而《AI 工具使用详情》里全是中文长句——
    不折行就会冲出页面右边，交上去很难看。这里按「中文 2 列」折算，
    顺便去掉 markdown 的 # 标记，让排版像正式文档而不是源码。
    """
    out: list[str] = []
    for raw in text.splitlines():
        line = re.sub(r"^#{1,6}\s*", "", raw).rstrip()
        if not line:
            out.append("")
            continue
        buf, used = "", 0
        for ch in line:
            w = 2 if ord(ch) > 0x2E80 else 1
            if used + w > width:
                # 优先在最近的空格处断，别把 "250.29 km" 劈成两半
                cut = buf.rfind(" ")
                if cut > 0 and _display_width(buf[:cut]) >= width * 0.5:
                    out.append(buf[:cut])
                    buf = buf[cut + 1:]
                    used = _display_width(buf)
                else:
                    out.append(buf)
                    buf, used = "", 0
                if ch == " ":
                    continue
            buf += ch
            used += w
        if buf:
            out.append(buf)
    return "\n".join(out)


def verbatim(text: str, title: str) -> str:
    """把一段 markdown 折行后塞进 verbatim（verbatim 不能放进宏参数）。"""
    body = wrap_verbatim(text.strip()) or f"[缺少 {title}：请补齐 ai_log 后重新生成]"
    return "{\\small\n\\begin{verbatim}\n" + body + "\n\\end{verbatim}\n}"


def find_xelatex() -> str | None:
    exe = shutil.which("xelatex")
    if exe:
        return exe
    for cand in (
        Path.home() / r"AppData\Local\Programs\MiKTeX\miktex\bin\x64\xelatex.exe",
        Path(r"C:\Program Files\MiKTeX\miktex\bin\x64\xelatex.exe"),
    ):
        if cand.is_file():
            return str(cand)
    return None


def compile_pdf(tex: Path) -> tuple[bool, str]:
    exe = find_xelatex()
    if not exe:
        return False, "找不到 xelatex（先跑 scripts/preflight.py）"
    for _ in range(2):  # 两遍保证页码/中文断行稳定
        proc = subprocess.run(
            [exe, "-interaction=nonstopmode", "-halt-on-error", tex.name],
            cwd=tex.parent, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=300,
        )
        if proc.returncode != 0:
            tail = "\n".join(
                ln for ln in ((proc.stdout or "") + (proc.stderr or "")).splitlines()
                if ln.startswith("!") or "Error" in ln
            )[:800]
            return False, f"xelatex 失败：{tail or '见同名 .log'}"
    pdf = tex.with_suffix(".pdf")
    if pdf.is_file() and pdf.stat().st_size > 0:
        return True, f"PDF {pdf.stat().st_size // 1024} KB"
    return False, "xelatex 返回 0 但没有产出 PDF"


def count_entries(md: str) -> int:
    """数 additions 的实质条目：支持列表与 markdown 表格两种写法。"""
    bullets = table_rows = 0
    for raw in md.splitlines():
        s = raw.strip()
        if not s:
            continue
        if re.match(r"^([-*]|\d+\.)\s+\S", s):
            if len(re.sub(r"^([-*]|\d+\.)\s+", "", s)) >= 8:
                bullets += 1
        elif s.startswith("|") and s.count("|") >= 3:
            if re.fullmatch(r"\|[\s:|-]+\|?", s):
                continue
            table_rows += 1
    return bullets + max(0, table_rows - 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir", nargs="?", default=".")
    ap.add_argument("--no-pdf", action="store_true", help="只出 .md/.tex，不编译 PDF（调试用）")
    args = ap.parse_args()

    work = Path(args.work_dir).resolve()
    log = work / "ai_log"
    outdir = work / "支撑材料"
    outdir.mkdir(parents=True, exist_ok=True)

    env = read_text(log / "env.md")
    session = read_text(log / "session.md")
    changes = read_text(log / "changes.md")
    decisions = read_text(log / "decisions.md")
    signoff = read_text(log / "review_signoff.md")

    problem = "未填写"
    facts_file = work / "facts.json"
    if facts_file.is_file():
        m = re.search(r'"problem"\s*:\s*"([^"]*)"', facts_file.read_text(encoding="utf-8-sig", errors="replace"))
        if m:
            problem = m.group(1) or problem

    now = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")

    # 环节摘要：取 session.md 的 "## " 小标题
    heads = [ln.lstrip("# ").strip() for ln in session.splitlines() if ln.startswith("## ")]
    summary = "\n".join(f"{i}. {h}" for i, h in enumerate(heads, 1)) if heads else ""

    md = MD_TEMPLATE.format(
        title=TITLE, problem=problem, now=now,
        env=env or "_缺少 ai_log/env.md_",
        summary=summary or "_缺少 ai_log/session.md 的阶段小标题_",
        session=session or "_缺少 ai_log/session.md_",
        changes=changes or "_缺少 ai_log/changes.md_",
        decisions=decisions or "_（无）_",
    )
    if signoff:
        md += f"\n\n## 七、签字记录\n\n{signoff}\n"

    md_path = outdir / f"{TITLE}.md"
    md_path.write_text(md, encoding="utf-8")
    print(f"OK: {md_path}")

    tex = (TEX_TEMPLATE
           .replace("{{PROBLEM}}", tex_escape(problem))
           .replace("{{NOW}}", tex_escape(now))
           .replace("{{ENV}}", verbatim(env, "工具清单"))
           .replace("{{SUMMARY}}", verbatim(summary, "使用目的与环节"))
           .replace("{{SESSION}}", verbatim(session, "关键交互记录"))
           .replace("{{CHANGES}}", verbatim(changes, "人工修改记录"))
           .replace("{{DECISIONS}}", verbatim(decisions, "路线决策记录")))
    # 注意：verbatim 不能作为宏参数，所以这里直接展开成环境，不用 \newcommand 包装
    tex_path = outdir / f"{TITLE}.tex"
    tex_path.write_text(tex, encoding="utf-8")
    print(f"OK: {tex_path}")

    problems: list[str] = []
    if not env:
        problems.append("缺 ai_log/env.md（工具名称与版本是规定四要素之一）")
    if not session:
        problems.append("缺 ai_log/session.md（关键交互记录是四要素之一）")
    entries = count_entries(changes)
    if entries < 5:
        problems.append(f"ai_log/changes.md 实质改动只有 {entries} 条（建议 ≥5，否则'人工实质修改'站不住）")
    if not signoff:
        problems.append("缺 ai_log/review_signoff.md（人工签字，AI 不得代签）")

    if args.no_pdf:
        pdf_path = outdir / f"{TITLE}.pdf"
        print("跳过 PDF 编译（--no-pdf）")
    else:
        ok, msg = compile_pdf(tex_path)
        pdf_path = outdir / f"{TITLE}.pdf"
        if ok:
            print(f"OK: {pdf_path}（{msg}）")
            # 支撑材料要打包交上去，别留编译中间产物
            for junk in outdir.glob(f"{TITLE}.*"):
                if junk.suffix.lower() in (".aux", ".log", ".out", ".toc"):
                    try:
                        junk.unlink()
                    except OSError:
                        pass
        else:
            print(f"ERROR: PDF 未生成：{msg}", file=sys.stderr)
            print("       修好 LaTeX（python scripts/preflight.py）后重跑本脚本；"
                  "规定要求交 PDF，交 .md 视同缺件。", file=sys.stderr)

    if problems:
        print("\nWARN: 以下问题会让这份材料不合格：", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)

    missing_pdf = not pdf_path.is_file()
    return 1 if (problems or missing_pdf) else 0


if __name__ == "__main__":
    raise SystemExit(main())
