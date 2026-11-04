"""把 facts.json 的数值注入论文源文件的 \\res{key} 占位符。

用法:
    python scripts/render.py work/2025A
    python scripts/render.py work/2025A --check   # 只检查，不写文件

输出:
    work/2025A/paper/paper.rendered.tex

规则:
- 源文件只允许 \\res{key}，不允许手写计算结果
- 注释里的 \\res{key} 视为说明文字，不参与替换
- 未定义的 key -> ERROR（拼写错误或忘记登记）
- facts 中未被引用的 key -> WARN（可能是死数据，或正文漏用）
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

RES_PATTERN = re.compile(r"\\res\{([A-Za-z0-9_]+)\}")


def split_comment(line: str) -> tuple[str, str]:
    """按未转义的 % 切成 (代码, 注释)。"""
    i = 0
    while i < len(line):
        if line[i] == "%" and (i == 0 or line[i - 1] != "\\"):
            return line[:i], line[i:]
        i += 1
    return line, ""


def fail(msg: str) -> int:
    print(f"ERROR: {msg}", file=sys.stderr)
    return 1


def format_value(spec: dict) -> str:
    value = spec["value"]
    fmt = spec.get("format") or ""
    if not fmt:
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    return format(value, fmt)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir", nargs="?", default=".", help="含 facts.json 与 paper/ 的工作目录")
    ap.add_argument("--src", default=None, help="源 tex（默认 paper/paper.tex）")
    ap.add_argument("--out", default=None, help="输出 tex（默认 paper/paper.rendered.tex）")
    ap.add_argument("--check", action="store_true", help="只检查，不写输出")
    args = ap.parse_args()

    work = Path(args.work_dir).resolve()
    facts_path = work / "facts.json"
    src = Path(args.src) if args.src else work / "paper" / "paper.tex"
    out = Path(args.out) if args.out else work / "paper" / "paper.rendered.tex"

    if not facts_path.is_file():
        return fail(f"缺少 {facts_path}")
    if not src.is_file():
        return fail(f"缺少源文件 {src}")

    data = json.loads(facts_path.read_text(encoding="utf-8-sig"))
    values: dict[str, dict] = data.get("values", {})
    original = src.read_text(encoding="utf-8-sig")
    lines = original.splitlines()

    used: set[str] = set()
    unknown: set[str] = set()
    out_lines: list[str] = []

    for line in lines:
        code, comment = split_comment(line)

        def repl(m: re.Match[str]) -> str:
            key = m.group(1)
            if key not in values:
                unknown.add(key)
                return m.group(0)
            used.add(key)
            return format_value(values[key])

        out_lines.append(RES_PATTERN.sub(repl, code) + comment)

    if unknown:
        print("ERROR: 引用了 facts.json 中不存在的 key:", file=sys.stderr)
        for k in sorted(unknown):
            print(f"  - {k}", file=sys.stderr)
        return 1

    rendered = "\n".join(out_lines) + ("\n" if original.endswith("\n") else "")

    # 残留检查（忽略注释）
    leftover = []
    for line in out_lines:
        leftover += RES_PATTERN.findall(split_comment(line)[0])
    if leftover:
        return fail(f"渲染后仍有占位符残留: {leftover}")

    unused = sorted(set(values) - used)
    if unused:
        print("WARN: facts.json 中以下 key 未被正文引用:", file=sys.stderr)
        for k in unused:
            print(f"  - {k}", file=sys.stderr)

    if args.check:
        print(f"OK: {len(used)} 个占位符可正常渲染（未写文件）")
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "% 由 render.py 自动生成，请勿手改——改 paper.tex 或 facts.json 后重跑。\n"
        f"% source: {src}\n\n"
    )
    out.write_text(header + rendered, encoding="utf-8")
    print(f"OK: 已渲染 {len(used)} 个数值 -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
