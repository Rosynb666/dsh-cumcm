"""环境预检：确认本机能真正编译中文 LaTeX 论文。

用法:
    python scripts/preflight.py              # 在当前目录下建临时子目录试编译
    python scripts/preflight.py --dir D:\\tmp  # 指定临时目录（沙箱里跑时用工作区内目录）

它做三件事:
1. 找 xelatex
2. 用临时目录编译一个极小的 ctexart 文档
3. 失败时给出针对性的修复建议，并把日志留在 <dir>/preflight-fail.log

退出码: 0 = 可编译；1 = 需要修环境

注意:
- 默认在工作区内建 `.preflight/` 而不是系统 TEMP：DSH 沙箱下系统临时目录可能不可写，
  用 TEMP 会让预检本身炸掉，报出一堆与排版无关的 PermissionError。
- 编译失败不等于环境坏了：先看日志第一条 `!` 错误，再对照建议。
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

TINY = r"""\documentclass[UTF8,12pt,fontset=windows]{ctexart}
\begin{document}
中文编译测试与公式 $x^2+1$。
\end{document}
"""

ADVICE: list[tuple[str, str]] = [
    (r"expl3.*too old|Support package `expl3' too old|l3-too-old",
     "l3kernel 太旧而 ctex 太新（本机实测就是这个）。到 MiKTeX Console → Updates → 全部更新；"
     "或把 Repository 换成清华 TUNA / 中科大镜像后再更新。更新完重跑本脚本。"),
    (r"xeCJK\.sty.*not found|File `xeCJK|LaTeX Error: File `xeCJK",
     "缺 xeCJK 宏包。MiKTeX Console → Packages 搜 xeCJK 安装；"
     "或命令行 `mpm --install=xeCJK`（注意先关掉 MiKTeX Console，否则包数据库被锁）。"),
    (r"ctexart\.cls.*not found|File `ctex",
     "缺 ctex。安装：`mpm --install=ctex`，或在 MiKTeX Console 里搜 ctex。"),
    (r"font.*not found|Cannot find font|Font .* not loadable",
     "中文字体缺失或 fontset 不对。Windows 下应能用 fontset=windows；检查系统是否装了宋体/黑体。"),
    (r"401|Unauthorized|forbidden",
     "包服务器拒绝访问。MiKTeX Console → Settings → Package Repository 换镜像（清华 TUNA / 中科大）。"),
    (r"package database is locked|exclusively locked",
     "MiKTeX 包数据库被锁：先完全关掉 MiKTeX Console / 其他 mpm、xelatex 进程再试。"),
    (r"Permission denied|PermissionError",
     "沙箱或权限问题：换 `--dir` 到工作区内目录重跑，别用系统 TEMP。"),
]


def find_xelatex() -> str | None:
    exe = shutil.which("xelatex")
    if exe:
        return exe
    for cand in (
        Path.home() / r"AppData\Local\Programs\MiKTeX\miktex\bin\x64\xelatex.exe",
        Path(r"C:\Program Files\MiKTeX\miktex\bin\x64\xelatex.exe"),
        Path(r"C:\Program Files\texlive\2024\bin\windows\xelatex.exe"),
        Path(r"C:\Program Files\texlive\2025\bin\windows\xelatex.exe"),
    ):
        if cand.is_file():
            return str(cand)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=".preflight", help="试编译用的目录（默认工作区内 .preflight）")
    args = ap.parse_args()

    print("== 1. 查找 xelatex ==")
    exe = find_xelatex()
    if not exe:
        print("FAIL: 找不到 xelatex。安装 MiKTeX 或 TeX Live，并把 bin 目录加入 PATH。")
        print("      LaTeX 修不好时的退路：论文改用 Word（DSH office 技能 + python-docx 出 .docx 再转 PDF）。")
        return 1
    print(f"OK: {exe}")

    workdir = Path(args.dir).resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    tex = workdir / "tiny.tex"
    log_path = workdir / "preflight-fail.log"

    # MiKTeX 每次编译都要写自己的诊断日志；目录不存在时会以「包数据库被锁」的
    # 形式报错，误导排查方向。这里尽力先建好（无权限就算了，不阻断）。
    try:
        (Path.home() / "AppData" / "Local" / "MiKTeX" / "miktex" / "log").mkdir(parents=True, exist_ok=True)
    except OSError:
        pass

    print(f"\n== 2. 试编译 ctexart 文档（{workdir}） ==")
    try:
        tex.write_text(TINY, encoding="utf-8")
    except OSError as exc:
        print(f"FAIL: 无法写入 {tex}: {exc}")
        print("      用 --dir 指到一个可写目录再试。")
        return 1

    try:
        proc = subprocess.run(
            [exe, "--enable-installer", "-interaction=nonstopmode", "-halt-on-error", "tiny.tex"],
            cwd=workdir, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=300,
        )
    except subprocess.TimeoutExpired:
        print("FAIL: 编译超过 300 秒。首次编译可能在下载宏包，或网络不可达。")
        return 1

    out = (proc.stdout or "") + (proc.stderr or "")
    pdf = workdir / "tiny.pdf"
    if proc.returncode == 0 and pdf.is_file() and pdf.stat().st_size > 0:
        print(f"OK: 中文 PDF 编译成功（{pdf.stat().st_size} 字节）")
        print("\n环境就绪，可以跑完整流程了。")
        return 0

    print("FAIL: 中文文档编译失败。\n")
    errs = [ln for ln in out.splitlines() if ln.startswith("!") or "Error:" in ln]
    for line in errs[:8]:
        print(f"  {line}")

    log = workdir / "tiny.log"
    log_text = log.read_text(encoding="utf-8", errors="replace") if log.is_file() else out
    try:
        log_path.write_text(out, encoding="utf-8", errors="replace")
        print(f"\n完整输出已存: {log_path}")
    except OSError:
        pass

    hit = False
    for pat, advice in ADVICE:
        if re.search(pat, log_text, re.I):
            print(f"\n建议: {advice}")
            hit = True
    if not hit:
        print("\n未匹配到已知问题。请把日志里第一个 '!' 错误发出来排查。")
    if "not checked for MiKTeX updates" in out:
        print("\n提示: MiKTeX 提示从未检查过更新——这正是版本错配的常见来源，先更新一次。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
