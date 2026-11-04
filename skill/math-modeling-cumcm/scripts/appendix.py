"""把 work/code/ 下的全部源码与支撑材料清单生成到论文附录。

用法:
    python scripts/appendix.py work/2025A

输出:
    work/2025A/paper/appendix.tex    （模板里用 \\IfFileExists 自动引入）

为什么需要它:
官方规范要求附录必须包含「支撑材料文件列表」和「全部完整可运行源程序」，
缺源码/源码跑不通是一票否决项。手工粘贴既容易漏，也会让 .tex 变成一坨。

排版约定（踩过坑）:
- 用 listings 而不是 verbatim：代码要有语法着色，白底、细边框；
- 长行在 Python 侧**先折行**（listings 的 breaklines 对无空格长串不生效），
  折行后的续行以 "↪ " 起头，缩进保持不变；
- 行号省略：折行会打乱「一行一个编号」的对应关系，加编号反而误导。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CODE_EXTS = (".py", ".m", ".r", ".jl")
WRAP_WIDTH = 88          # 折行宽度（中文按 2 列计），比版心略窄，留一点余量
LANG = {".py": "Python", ".m": "Matlab", ".r": "R", ".jl": "Julia"}

RUN_HINT = r"""\section{运行环境与复现方式}

\noindent 解释器 Python 3.10+；依赖见 \texttt{code/requirements.txt}（若有）。
按问题顺序运行脚本即可复现正文全部数值：随机种子固定为 42。
所有正文数字由 \texttt{facts.json} 记录、\texttt{scripts/render.py} 注入论文，
因此改动代码后必须重跑求解脚本与渲染脚本。

"""


def esc_title(name: str) -> str:
    r"""文件名进 \subsection*{} 需要转义 _ 和 &。"""
    return name.replace("\\", "/").replace("_", r"\_").replace("&", r"\&").replace("#", r"\#")


def _width(text: str) -> int:
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in text)


def wrap_code(src: str, width: int = WRAP_WIDTH) -> tuple[str, int]:
    """按显示宽度折行，保留缩进；续行以 "... " 起头。

    优先在空格或运算符处断开（避免把标识符劈成两半），找不到合适断点才硬切。
    续行标记用 ASCII 的 "..."——CJK 箭头（↪）在等宽字体里常常没有字形，会渲染成空白。
    """
    BREAKS = " ,=+-*/:()[]<>"
    out: list[str] = []
    folded = 0
    for raw in src.splitlines():
        if not raw.strip():
            out.append("")
            continue
        indent = raw[: len(raw) - len(raw.lstrip())]
        body = raw.strip()
        while _width(indent + body) > width:
            cut = -1
            used = _width(indent)
            for i, ch in enumerate(body):
                used += 2 if ord(ch) > 0x2E80 else 1
                if used > width:
                    break
                if ch in BREAKS:
                    cut = i
            if cut < len(body) * 0.5:          # 断点太靠前就硬切
                cut = len(body) - 1
                used = _width(indent)
                for i, ch in enumerate(body):
                    used += 2 if ord(ch) > 0x2E80 else 1
                    if used > width:
                        cut = i
                        break
            out.append((indent + body[: cut + 1]).rstrip())
            body = body[cut + 1:].lstrip()
            indent = "    ... "
            folded += 1
        out.append(indent + body)
    return "\n".join(out), folded


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir", nargs="?", default=".")
    ap.add_argument("--out", default=None, help="输出 tex（默认 paper/appendix.tex）")
    args = ap.parse_args()

    work = Path(args.work_dir).resolve()
    code_dir = work / "code"
    out = Path(args.out) if args.out else work / "paper" / "appendix.tex"
    out.parent.mkdir(parents=True, exist_ok=True)

    files = sorted(
        p for p in code_dir.glob("*") if p.is_file() and p.suffix.lower() in CODE_EXTS
    ) if code_dir.is_dir() else []

    if not files:
        print(f"WARN: {code_dir} 里没有可收录的源码（{', '.join(CODE_EXTS)}）——"
              "官方要求附录附全部可运行源程序，缺了可能被取消评奖资格", file=sys.stderr)

    support = []
    if (work / "facts.json").is_file():
        support.append(("facts.json", "正文全部数值的来源台账", "全文"))
    for p in files:
        support.append((f"code/{p.name}", "求解 / 绘图脚本", "对应章节"))
    if (work / "支撑材料/AI 工具使用详情.pdf").is_file():
        support.append(("支撑材料/AI 工具使用详情.pdf", "AI 使用合规材料", "——"))

    lines: list[str] = ["% 由 scripts/appendix.py 自动生成，勿手改——改代码后重跑本脚本", ""]

    lines += [
        r"\section{支撑材料文件列表}",
        "",
        r"\begin{table}[H]\centering",
        r"\caption{支撑材料文件列表}",
        r"\begin{tabular}{lll}",
        r"\toprule",
        r"文件名 & 说明 & 对应正文 \\",
        r"\midrule",
    ]
    for name, desc, where in support:
        lines.append(f"{esc_title(name)} & {desc} & {where} \\\\")
    lines += [r"\bottomrule", r"\end{tabular}", r"\end{table}", ""]

    lines.append(RUN_HINT.rstrip())
    lines.append("")
    lines.append(r"\section{程序代码}")
    lines.append("")

    problems: list[str] = []
    fatal = False
    total_folded = 0
    for p in files:
        src = p.read_text(encoding="utf-8-sig", errors="replace")
        if r"\end{lstlisting}" in src:
            fatal = True
            problems.append(f"{p.name} 含 \\end{lstlisting} 字样，会让附录排版崩掉")
        body, folded = wrap_code(src.rstrip("\n"))
        total_folded += folded

        lines += [
            rf"\subsection*{{code/{esc_title(p.name)}}}",
            rf"\begin{{lstlisting}}[language={LANG.get(p.suffix.lower(), 'Python')},"
            rf"caption={{{esc_title(p.name)}}}]",
            body,
            r"\end{lstlisting}",
            "",
        ]

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK: 已收录 {len(files)} 个源码文件 → {out}")
    if total_folded:
        print(f"INFO: 折行 {total_folded} 处（续行以 ... 标记），避免超出版心")
    for prob in problems:
        print(f"WARN: {prob}", file=sys.stderr)
    return 1 if fatal else 0


if __name__ == "__main__":
    raise SystemExit(main())
