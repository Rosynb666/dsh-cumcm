"""一键编译论文：render → xelatex ×2 → 报告页数与错误。

用法:
    python scripts/compile.py work/2025A
    python scripts/compile.py work/2025A --open          # 编译后在资源管理器里选中 PDF
    python scripts/compile.py work/2025A --src paper/paper.tex

为什么需要它:
- 国赛要求 PDF，手工敲两遍 xelatex + 找日志里的第一个错误太费时间；
- MiKTeX 缺宏包时要用 --enable-installer 才会自动装，否则报一堆 "File xxx.sty not found"；
- 插件面板要一个稳定的入口拿到「成功/失败 + 页数 + 前几条错误」。

输出: work/<题号>/paper/paper.rendered.pdf
退出码: 0 = 出 PDF；1 = 失败
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def find_xelatex() -> str | None:
    exe = shutil.which("xelatex")
    if exe:
        return exe
    for cand in (
        Path.home() / r"AppData\Local\Programs\MiKTeX\miktex\bin\x64\xelatex.exe",
        Path(r"C:\Program Files\MiKTeX\miktex\bin\x64\xelatex.exe"),
        Path(r"C:\Program Files\texlive\2025\bin\windows\xelatex.exe"),
        Path(r"C:\Program Files\texlive\2024\bin\windows\xelatex.exe"),
    ):
        if cand.is_file():
            return str(cand)
    return None


def run(cmd: list[str], cwd: Path, timeout: int = 600) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir", nargs="?", default=".")
    ap.add_argument("--src", default="paper.rendered.tex", help="要编译的 tex（相对 paper/）")
    ap.add_argument("--keep-going", action="store_true", help="出错也继续出 PDF（调试用）")
    ap.add_argument("--open", action="store_true", help="编译后打开所在文件夹")
    args = ap.parse_args()

    work = Path(args.work_dir).resolve()
    paper_dir = work / "paper"
    src = paper_dir / args.src
    if not src.is_file():
        print(f"ERROR: 找不到 {src}（先跑 scripts/render.py）", file=sys.stderr)
        return 1

    exe = find_xelatex()
    if not exe:
        print("ERROR: 找不到 xelatex（先跑 scripts/preflight.py）", file=sys.stderr)
        return 1

    # 第一遍：生成 aux；第二遍：交叉引用/页码稳定
    flags = ["--enable-installer", "-interaction=nonstopmode"]
    if not args.keep_going:
        flags.append("-halt-on-error")

    for pass_no in (1, 2):
        code, out = run([exe, *flags, src.name], paper_dir)
        if code != 0:
            print(f"ERROR: 第 {pass_no} 遍编译失败", file=sys.stderr)
            errs = [ln for ln in out.splitlines() if ln.startswith("!") or "not found" in ln]
            for line in errs[:6]:
                print(f"  {line}", file=sys.stderr)
            log = src.with_suffix(".log")
            if log.is_file():
                text = log.read_text(encoding="utf-8", errors="replace")
                # 形如 "l.123 ..." 的错误定位
                for m in list(re.finditer(r"^l\.(\d+)\s?(.*)$", text, re.M))[:3]:
                    print(f"  → 第 {m.group(1)} 行附近: {m.group(2)[:80]}", file=sys.stderr)
            return 1

    pdf = src.with_suffix(".pdf")
    if not pdf.is_file():
        print("ERROR: xelatex 成功退出但没有产出 PDF", file=sys.stderr)
        return 1

    pages = "?"
    log = src.with_suffix(".log")
    if log.is_file():
        text = log.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"Output written on .*?\((\d+) pages?", text)
        if m:
            pages = m.group(1)
        warns = len(re.findall(r"LaTeX Warning:", text))
        if warns:
            print(f"WARN: 编译日志里有 {warns} 条 LaTeX Warning（交叉引用/字体等，建议过一遍）", file=sys.stderr)

    print(f"OK: {pdf}  （{pages} 页，{pdf.stat().st_size // 1024} KB）")
    if pages.isdigit() and int(pages) > 22:
        print(f"WARN: 共 {pages} 页；正文（不含附录）应 ≤20 页，用 layout.py 核对", file=sys.stderr)

    if args.open and sys.platform == "win32":
        subprocess.run(["explorer", "/select,", str(pdf)], check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
