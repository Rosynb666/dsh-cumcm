"""排版体检：按 2025 国赛格式规范检查 paper.tex 的版式与合规硬项。

用法:
    python scripts/layout.py work/2025A
    python scripts/layout.py work/2025A --max-pages 20

它查的是「格式会不会让你直接失分」，不管内容好坏：
页边距、目录、摘要页长度、图表题位置、三线表竖线、编号与引用、
身份信息泄漏、附录完整性、AI 声明、正文字数估算。

退出码: 0 = 无 ERROR；1 = 有 ERROR
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ERR: list[str] = []
WARN: list[str] = []

CN = re.compile(r"[\u4e00-\u9fff]")
# 各级标题
SECTION = re.compile(r"\\(?:section|subsection|subsubsection)\*?\{")


def err(msg: str) -> None:
    ERR.append(msg)


def warn(msg: str) -> None:
    WARN.append(msg)


def strip_comments(text: str) -> str:
    out = []
    for line in text.splitlines():
        keep, i = [], 0
        while i < len(line):
            if line[i] == "%" and (i == 0 or line[i - 1] != "\\"):
                break
            keep.append(line[i])
            i += 1
        out.append("".join(keep))
    return "\n".join(out)


def cn_len(text: str) -> int:
    """中文字数 + 英文词数近似，用于篇幅估算。"""
    text = re.sub(r"\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^{}]*\})?", " ", text)
    return len(CN.findall(text)) + len(re.findall(r"\b[A-Za-z]{2,}\b", text))


def env_blocks(src: str, name: str) -> list[tuple[int, str]]:
    """返回 (起始行号, 环境体) 列表，支持嵌套同名环境（简单计数）。"""
    blocks, start, depth, buf = [], None, 0, []
    for lineno, line in enumerate(src.splitlines(), 1):
        if re.search(rf"\\begin\{{{name}\}}", line):
            if depth == 0:
                start, buf = lineno, []
            depth += 1
        if depth:
            buf.append(line)
        if re.search(rf"\\end\{{{name}\}}", line) and depth:
            depth -= 1
            if depth == 0:
                blocks.append((start or 0, "\n".join(buf)))
    return blocks


def check_margin(src: str) -> None:
    m = re.search(r"margin\s*=\s*([\d.]+)\s*(cm|mm|in)", src)
    if not m:
        warn("未找到 \\geometry{margin=...}，无法确认页边距 ≥2.5cm")
        return
    val, unit = float(m.group(1)), m.group(2)
    cm = {"cm": val, "mm": val / 10, "in": val * 2.54}[unit]
    if cm < 2.499:
        err(f"页边距 {cm:.2f}cm < 2.5cm（官方规范：上下左右各留出至少 2.5cm）")
    else:
        print(f"[OK] 页边距 {cm:.2f}cm")


def check_abstract(src: str) -> None:
    body = src.split(r"\begin{document}", 1)[-1]
    end = SECTION.search(body)
    head = body[: end.start()] if end else body
    n = cn_len(head)
    if n > 1100:
        err(f"摘要页约 {n} 字，超出一页（规范：摘要含标题关键词不得超过一页，建议 ≤ 900 字）")
    elif n > 950:
        warn(f"摘要页约 {n} 字，接近一页上限，建议压到 900 字以内")
    else:
        print(f"[OK] 摘要页约 {n} 字")
    if "关键词" not in head:
        err("摘要页未找到「关键词」——规范要求摘要含标题与关键词")
    if not re.search(r"\\(?:aiflag|res)\{", head):
        warn("摘要页没有任何 \\aiflag{} 标注——AI 起草的摘要必须标注")


def check_layout_commands(src: str) -> None:
    if re.search(r"\\tableofcontents", src):
        err("出现 \\tableofcontents——2025 规范明文「不要目录」")
    if not re.search(r"\\pagenumbering", src):
        warn("未设置 \\pagenumbering——页码需从摘要页开始，页脚居中，阿拉伯数字从 1 起")
    if not re.search(r"\\pagestyle", src):
        warn("未设置 \\pagestyle——确认页码在页脚居中")
    if re.search(r"\\maketitle", src) and not re.search(r"\\begin\{document\}\s*\\begin\{center\}", src):
        warn("使用了 \\maketitle；摘要页格式建议手工排版（标题三号黑体居中 + 摘要四号黑体）")


def check_captions(src: str) -> None:
    # 附录里的表通常不需要编号与引用，从检查范围里排除
    appendix_at = src.find(r"\appendix")
    for name, want_caption_first in (("figure", False), ("table", True)):
        for lineno, block in env_blocks(src, name):
            if appendix_at >= 0 and lineno > src[:appendix_at].count("\n") + 1:
                continue
            cap = block.find(r"\caption")
            body = block.find(r"\includegraphics") if name == "figure" else block.find(r"\begin{tabular}")
            if cap < 0:
                err(f"{name} 环境（第 {lineno} 行起）没有 \\caption")
                continue
            if body < 0:
                continue
            if want_caption_first and cap > body:
                warn(f"第 {lineno} 行的表：表题应在表格上方（规范惯例）")
            if not want_caption_first and cap < body:
                warn(f"第 {lineno} 行的图：图题应在图形下方（规范惯例）")
            if r"\label" not in block:
                warn(f"第 {lineno} 行的 {name} 没有 \\label，无法在正文引用")


def check_tables(src: str) -> None:
    for lineno, line in enumerate(src.splitlines(), 1):
        m = re.search(r"\\begin\{tabular\}\{([^}]*)\}", line)
        if m and "|" in m.group(1):
            err(f"paper.tex:{lineno} 表格列格式含竖线 |——一律三线表，不要竖线")


def check_refs(src: str) -> None:
    labels = set(re.findall(r"\\label\{([^{}]+)\}", src))
    refs = set(re.findall(r"\\(?:ref|eqref)\{([^{}]+)\}", src))
    for kind, prefix in (("图", "fig:"), ("表", "tab:"), ("公式", "eq:")):
        for lab in labels:
            if not lab.startswith(prefix) or lab in refs:
                continue
            # 官方只要求图表必须在正文引用；公式没被引用只提醒，不判错
            (warn if kind == "公式" else err)(
                f"{kind} \\label{{{lab}}} 未在正文被引用"
                + ("（公式可不引用，但编号了就建议指一次）" if kind == "公式" else "")
            )
    for ref in refs:
        if ref not in labels:
            err(f"\\ref{{{ref}}} 没有对应 \\label")


def check_identity(src: str) -> None:
    patterns = [
        # 「全国大学生数学建模竞赛」里的“大学生”不是校名，用负向前瞻排掉
        (r"[\u4e00-\u9fff]{2,8}大学(?!生|数|出)", "疑似学校名"),
        (r"[\u4e00-\u9fff]{2,8}学院(?!生)", "疑似学院名"),
        (r"参赛队号|队号|赛区|指导教师|指导老师", "疑似身份信息"),
    ]
    for lineno, line in enumerate(src.splitlines(), 1):
        for pat, desc in patterns:
            if re.search(pat, line):
                err(f"paper.tex:{lineno} {desc}：{line.strip()[:40]}（规范：任何地方不得出现身份/学校/赛区信息）")


def check_appendix(src: str) -> None:
    if r"\appendix" not in src:
        err("缺少 \\appendix——附录必须含支撑材料文件列表与全部可运行源码")
        return
    tail = src.split(r"\appendix", 1)[1]
    if "支撑材料" not in tail:
        warn("附录里没看到「支撑材料文件列表」——官方要求清单写进附录")
    if not re.search(r"verbatim|lstinputlisting|\\input\{appendix", tail):
        err("附录里没有代码环境——官方要求附全部完整可运行源码")


def check_ai(src: str) -> None:
    n = len(re.findall(r"\\aiflag\{", src))
    if n == 0:
        err("全文没有任何 \\aiflag{}——若使用 AI，必须在正文相应位置标注")
    else:
        print(f"[OK] AI 角标 {n} 处")
    if "AI 使用声明" not in src and "AI使用声明" not in src:
        warn("缺少「AI 使用声明」一节——披露材料建议在参考文献后单列")


def check_extent(src: str, max_pages: int) -> None:
    body = src
    if r"\begin{thebibliography}" in body:
        body = body.split(r"\begin{thebibliography}", 1)[0]
    if r"\appendix" in body:
        body = body.split(r"\appendix", 1)[0]
    chars = cn_len(body)
    figs = len(re.findall(r"\\begin\{figure\}", src))
    tabs = len(re.findall(r"\\begin\{table\}", src))
    pages = chars / 800 + figs * 0.45 + tabs * 0.30
    tag = "[OK]"
    if pages > max_pages:
        err(f"正文估算 {pages:.1f} 页 > {max_pages} 页（{chars} 字、{figs} 图、{tabs} 表）——规范要求尽量控制在 20 页以内")
        tag = "[ERR]"
    elif pages > max_pages - 2:
        warn(f"正文估算 {pages:.1f} 页，接近 {max_pages} 页上限，建议删图或压段")
        tag = "[WARN]"
    print(f"{tag} 正文估算 {pages:.1f} 页（{chars} 字 / {figs} 图 / {tabs} 表）")


def check_images(work: Path, src: str) -> None:
    for m in re.finditer(r"\\includegraphics(?:\[[^\]]*\])?\{([^{}]+)\}", src):
        rel = m.group(1).strip()
        base = work / "paper" / rel
        cands = [base] + [base.with_suffix(s) for s in (".pdf", ".png", ".jpg", ".jpeg")]
        if not any(c.is_file() for c in cands):
            err(f"图片不存在: paper/{rel}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir", nargs="?", default=".")
    ap.add_argument("--max-pages", type=float, default=20.0, help="正文页数上限（规范：尽量 ≤20）")
    args = ap.parse_args()

    work = Path(args.work_dir).resolve()
    tex = work / "paper" / "paper.tex"
    print(f"== 排版体检: {work} ==")
    if not tex.is_file():
        print(f"ERROR: 找不到 {tex}")
        return 1

    raw = tex.read_text(encoding="utf-8-sig")
    src = strip_comments(raw)

    check_margin(src)
    check_abstract(src)
    check_layout_commands(src)
    check_captions(src)
    check_tables(src)
    check_refs(src)
    check_identity(src)
    check_appendix(src)
    check_ai(src)
    check_extent(src, args.max_pages)
    check_images(work, src)

    print()
    for e in ERR:
        print(f"[ERROR] {e}")
    for w in WARN:
        print(f"[WARN ] {w}")
    print(f"\n结果: {len(ERR)} ERROR, {len(WARN)} WARN")
    if not ERR:
        print("PASS" if not WARN else "PASS（有警告，逐条确认后交人审核）")
    return 1 if ERR else 0


if __name__ == "__main__":
    raise SystemExit(main())
