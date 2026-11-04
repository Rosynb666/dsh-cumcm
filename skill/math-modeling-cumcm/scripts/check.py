"""论文自检：一致性、可追溯性、格式与合规。

用法:
    python scripts/check.py work/2025A
    python scripts/check.py work/2025A --strict   # 交付前：缺件也算 ERROR

退出码: 0 = 无 ERROR；1 = 有 ERROR
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ERRORS: list[str] = []
WARNS: list[str] = []


def err(msg: str) -> None:
    ERRORS.append(msg)


def warn(msg: str) -> None:
    WARNS.append(msg)


# ---------- 文本工具 ----------

def strip_comments(text: str) -> str:
    out = []
    for line in text.splitlines():
        if line.lstrip().startswith("%"):
            continue
        # 去掉未转义的 % 之后的内容（保留 \%, 即前面是反斜杠的百分号）
        keep = []
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == "%" and (i == 0 or line[i - 1] != "\\"):
                break
            keep.append(ch)
            i += 1
        out.append("".join(keep))
    return "\n".join(out)


def strip_math(text: str) -> str:
    text = re.sub(r"\\begin\{(equation|align|gather|eqnarray)\*?\}.*?\\end\{\1\*?\}",
                  " ", text, flags=re.S)
    text = re.sub(r"\\\[.*?\\\]", " ", text, flags=re.S)
    text = re.sub(r"\\\(.*?\\\)", " ", text, flags=re.S)
    text = re.sub(r"\$[^$]*\$", " ", text)
    return text


SKIP_CMD = re.compile(
    r"\\(includegraphics|zihao|linespread|vspace|hspace|captionsetup|setlist|"
    r"documentclass|usepackage|geometry|res|aiflag|todomark|label|ref|cite|"
    r"bibitem|section|subsection|subsubsection|caption|title|maketitle|newpage|"
    r"tableofcontents|appendix|begin|end|toprule|midrule|bottomrule|item|"
    r"noindent|textbf|heiti|quad|qquad|centering|small|footnotesize)\s*(\[[^\]]*\])?\{[^{}]*\}"
)

CN = re.compile(r"[\u4e00-\u9fff]")
DECIMAL = re.compile(r"(?<![\d.])\d+\.\d+(?![\d])")
PERCENT = re.compile(r"(?<![\d.])\d+(?:\.\d+)?\s*\\%")


def count_change_entries(text: str) -> int:
    """数 changes.md 的实质改动条数：支持列表与表格两种写法，跳过 HTML 注释。

    模板里给的示例写在 <!-- --> 里，不能被算成「人已经改过」。
    """
    bullets = table_rows = 0
    in_comment = False
    for raw in text.splitlines():
        s = raw.strip()
        if in_comment:
            if "-->" in s:
                in_comment = False
            continue
        if "<!--" in s and "-->" not in s.split("<!--", 1)[1]:
            in_comment = True
            continue
        if not s:
            continue
        if re.match(r"^([-*]|\d+\.)\s+\S", s):
            if len(re.sub(r"^([-*]|\d+\.)\s+", "", s)) >= 8:
                bullets += 1
        elif s.startswith("|") and s.count("|") >= 3:
            if re.fullmatch(r"\|[\s:|-]+\|?", s):   # 表格分隔行
                continue
            table_rows += 1
    return bullets + max(0, table_rows - 1)          # 表格去掉表头


def scan_bare_numbers(src: str) -> list[tuple[int, str]]:
    """正文中文上下文里出现的小数/百分比 -> 疑似手写结果。

    跳过：注释掉的 nofact 行、参考文献条目（版本号如 V3.2）、代码块（verbatim）。
    """
    hits: list[tuple[int, str]] = []
    in_verbatim = False
    for lineno, line in enumerate(src.splitlines(), 1):
        head = line.strip()
        if re.match(r"\\begin\{(verbatim|lstlisting|Verbatim)\}", head):
            in_verbatim = True
            continue
        if re.match(r"\\end\{(verbatim|lstlisting|Verbatim)\}", head):
            in_verbatim = False
            continue
        if in_verbatim or head.startswith(r"\bibitem") or "nofact" in line:
            continue
        cleaned = SKIP_CMD.sub(" ", line)
        cleaned = strip_math(cleaned)
        stripped = strip_comments(cleaned).strip()
        if not stripped:
            continue
        for m in DECIMAL.finditer(stripped):
            if CN.search(stripped):
                hits.append((lineno, m.group(0)))
                break
        for m in PERCENT.finditer(stripped):
            if CN.search(stripped):
                hits.append((lineno, m.group(0)))
                break
    return hits


# ---------- 主流程 ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir", nargs="?", default=".")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    work = Path(args.work_dir).resolve()
    tex = work / "paper" / "paper.tex"
    facts_path = work / "facts.json"

    # 1. 必备文件
    required = {
        "analysis.md": "破题笔记（唯一真值源）",
        "facts.json": "数值登记表",
        "paper/paper.tex": "论文源文件",
        "ai_log/session.md": "AI 交互记录",
        "ai_log/changes.md": "人工修改记录",
        "ai_log/env.md": "工具版本记录",
    }
    optional_strict = {
        "review.md": "评审模拟结论",
        "支撑材料/AI 工具使用详情.pdf": "合规材料（规定要求 PDF，交 .md 视同缺件）",
        "ai_log/review_signoff.md": "人工审核签字（AI 不得代签）",
    }
    for rel, desc in required.items():
        if not (work / rel).is_file():
            (err if args.strict else warn)(f"缺少 {rel}（{desc}）")
    if args.strict:
        for rel, desc in optional_strict.items():
            if not (work / rel).is_file():
                err(f"交付前缺少 {rel}（{desc}）")

    if not tex.is_file():
        err(f"缺少论文源文件 {tex}")
        report()
        return 1

    src = tex.read_text(encoding="utf-8-sig")
    code_src = strip_comments(src)  # 注释不参与结构检查

    # 2. facts.json 合法性
    values: dict[str, dict] = {}
    if facts_path.is_file():
        try:
            data = json.loads(facts_path.read_text(encoding="utf-8"))
            values = data.get("values", {})
        except json.JSONDecodeError as exc:
            err(f"facts.json 不是合法 JSON: {exc}")
        for key, spec in values.items():
            if not isinstance(spec, dict) or "value" not in spec:
                err(f"facts.json 条目 {key} 缺少 value")
                continue
            if not spec.get("desc"):
                warn(f"facts.json 条目 {key} 缺少 desc")
            if not spec.get("source"):
                warn(f"facts.json 条目 {key} 缺少 source（无法追溯）")

    # 3. 占位符
    res_keys = re.findall(r"\\res\{([A-Za-z0-9_]+)\}", code_src)
    unknown = sorted(set(res_keys) - set(values))
    if unknown:
        err("正文引用了 facts.json 中不存在的 key: " + ", ".join(unknown))
    unused = sorted(set(values) - set(res_keys))
    if unused:
        warn("facts.json 中未被正文引用: " + ", ".join(unused))
    if not res_keys and values:
        warn("正文没有任何 \\res{} 占位符，但 facts.json 有数据——数字可能是手写的")

    rendered = work / "paper" / "paper.rendered.tex"
    if rendered.is_file():
        rsrc = strip_comments(rendered.read_text(encoding="utf-8-sig"))
        if re.search(r"\\res\{", rsrc):
            err("渲染产物中仍有 \\res{} 占位符——请重跑 render.py")
        if re.search(r"\?\?[A-Za-z0-9_]+\?\?", rsrc):
            err("渲染产物中出现 ??key??，说明数值未注入")

    # 4. TODO 与 AI 标注
    todos = re.findall(r"TODO\(人工\)[：:]?\s*(.*)", src)
    if todos:
        warn(f"仍有 {len(todos)} 处人工 TODO（交付前必须清零）")
    ai_flags = len(re.findall(r"\\aiflag\{", code_src))
    if ai_flags == 0:
        warn("正文没有任何 \\aiflag{} 标注——若内容由 AI 辅助，违反披露要求")

    # 5. 图表文件
    for m in re.finditer(r"\\includegraphics(?:\[[^\]]*\])?\{([^{}]+)\}", code_src):
        rel = m.group(1).strip()
        base = work / "paper" / rel
        candidates = [base] + [base.with_suffix(s) for s in (".pdf", ".png", ".jpg", ".jpeg")]
        if not any(c.is_file() for c in candidates):
            err(f"图片不存在: paper/{rel}")

    # 6. 交叉引用
    labels = set(re.findall(r"\\label\{([^{}]+)\}", code_src))
    for ref in set(re.findall(r"\\ref\{([^{}]+)\}", code_src)):
        if ref not in labels:
            err(f"\\ref{{{ref}}} 没有对应 \\label")
    bibs = set(re.findall(r"\\bibitem(?:\[[^\]]*\])?\{([^{}]+)\}", code_src))
    for cite in set(re.findall(r"\\cite\{([^{}]+)\}", code_src)):
        for c in cite.split(","):
            if c.strip() not in bibs:
                err(f"\\cite{{{c.strip()}}} 没有对应 \\bibitem")

    # 7. 合规：AI 工具条目
    if ai_flags > 0:
        bib_block = "\n".join(re.findall(r"\\bibitem.*", code_src))
        has_ai_entry = any(
            k in bib_block for k in ("DeepSeek", "deepseek", "GPT", "Claude", "Kimi", "通义", "智谱")
        )
        if not has_ai_entry:
            err("正文有 AI 标注，但参考文献里没有 AI 工具条目（合规必备）")
        if "AI 使用声明" not in src and "AI使用声明" not in src:
            warn("缺少「AI 使用声明」一节——披露材料建议在参考文献后单列")

    # 7b. 人工实质修改与签字（这是与"代写器"的分界线）
    changes_path = work / "ai_log" / "changes.md"
    if changes_path.is_file():
        changes_text = changes_path.read_text(encoding="utf-8-sig", errors="replace")
        entries = count_change_entries(changes_text)
        if entries < 5:
            (err if args.strict else warn)(
                f"ai_log/changes.md 只找到 {entries} 条实质改动（建议 ≥5）——"
                "人工修改不足时，'核心建模由参赛队完成'的披露站不住"
            )
    signoff = work / "ai_log" / "review_signoff.md"
    if args.strict and signoff.is_file():
        text = signoff.read_text(encoding="utf-8-sig", errors="replace")
        if not re.search(r"审核人\s*[:：]\s*\S", text) or "____" in text:
            err("ai_log/review_signoff.md 签字栏未填写（姓名/日期必须人工手填）")

    # 8. 裸数字
    for lineno, num in scan_bare_numbers(src):
        warn(f"paper.tex:{lineno} 出现疑似手写数值 {num}（应改为 \\res{{}} 或行尾加 % nofact）")

    # 9. 体量统计
    head = src.split(r"\appendix", 1)[0]
    body = strip_comments(strip_math(head))
    cn_chars = len(CN.findall(body))
    print(f"\n统计: 中文字符约 {cn_chars}，图表 {len(re.findall(r'begin\{figure\}', src))}，"
          f"表格 {len(re.findall(r'begin\{table\}', src))}，"
          f"数值占位符 {len(res_keys)}，AI 标注 {ai_flags}，TODO {len(todos)}")
    if cn_chars > 18000:
        warn(f"正文约 {cn_chars} 中文字符，估算已超 20 页——规范要求正文尽量控制在 20 页以内")

    report()
    return 1 if ERRORS else 0


def report() -> None:
    print()
    for e in ERRORS:
        print(f"[ERROR] {e}")
    for w in WARNS:
        print(f"[WARN ] {w}")
    print(f"\n结果: {len(ERRORS)} ERROR, {len(WARNS)} WARN")
    if not ERRORS:
        print("PASS" if not WARNS else "PASS（有警告，交付前逐条确认）")


if __name__ == "__main__":
    raise SystemExit(main())
