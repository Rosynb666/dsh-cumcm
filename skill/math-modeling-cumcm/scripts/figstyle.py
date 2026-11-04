"""图表统一风格：中文字体、配色、线型、导出。

用法:
    import sys; sys.path.insert(0, "scripts")
    from figstyle import apply, save, PALETTE, despine

    apply()
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    ax.plot(t, y, color=PALETTE[0], lw=1.4, label="方案 A")
    ax.set_xlabel("时间 t / h"); ax.set_ylabel("负荷 / MW")
    ax.legend(frameon=False); despine(ax)
    save(fig, "paper/figs/load_curve.pdf")

设计约束:
- 黑白打印仍可区分（PALETTE 明度拉开，LINE_STYLES 与 MARKERS 成套使用）
- 矢量优先（PDF），同时出一张 300dpi PNG 方便在面板里预览
- 缺 matplotlib 时**明确报错**，不静默降级
"""

from __future__ import annotations

import sys
from pathlib import Path

# 低饱和、明度拉开的 6 色（黑白复印后仍能靠深浅区分）
PALETTE = ["#2F6F9F", "#C2553B", "#4C8C5A", "#B08A3E", "#6B5B95", "#7F7F7F"]
# 与 PALETTE 对齐的线型/标记：色盲或黑白时靠形状区分
LINE_STYLES = ["-", "--", "-.", ":", (0, (3, 1, 1, 1)), (0, (5, 1))]
MARKERS = ["o", "s", "^", "D", "v", "P"]

# Windows 中文常见字体，按可用性依次尝试
CJK_FONTS = ["Microsoft YaHei", "SimHei", "SimSun", "Noto Sans CJK SC", "Source Han Sans SC"]


def _mpl():
    try:
        import matplotlib
        return matplotlib
    except ImportError:
        print(
            "ERROR: 未安装 matplotlib，无法使用 figstyle。\n"
            "  安装：python -m pip install matplotlib\n"
            "  没有 matplotlib 时的替代：用 Pillow 手绘（见 examples/demo/code/make_roadmap.py），\n"
            "  或把图交给有 matplotlib 的环境生成后拷进 paper/figs/。",
            file=sys.stderr,
        )
        raise SystemExit(2)


def apply(font_size: float = 10.5, dpi: int = 300, usetex: bool = False) -> None:
    """一次设好全局样式。figsize 单位是英寸，稿纸版心宽约 16 cm。"""
    matplotlib = _mpl()
    from matplotlib import font_manager

    available = {f.name for f in font_manager.fontManager.ttflist}
    picked = [name for name in CJK_FONTS if name in available]
    if not picked:
        print("WARN: 没找到中文字体（SimHei/微软雅黑/宋体），图中中文会变方块。", file=sys.stderr)

    matplotlib.rcParams.update({
        "font.sans-serif": picked + ["DejaVu Sans"],
        "font.family": "sans-serif",
        "axes.unicode_minus": False,      # 负号乱码的老坑
        "font.size": font_size,
        "axes.titlesize": font_size + 0.5,
        "axes.labelsize": font_size,
        "xtick.labelsize": font_size - 1,
        "ytick.labelsize": font_size - 1,
        "legend.fontsize": font_size - 1,
        "figure.dpi": 120,                # 屏幕预览
        "savefig.dpi": dpi,               # 位图导出
        "savefig.bbox": "tight",          # 不留大片白边
        "savefig.pad_inches": 0.02,
        "axes.linewidth": 0.9,
        "lines.linewidth": 1.4,
        "lines.markersize": 4.5,
        "grid.color": "#DDDDDD",
        "grid.linewidth": 0.6,
        "legend.frameon": False,
        "pdf.fonttype": 42,               # TrueType 子集，防字体嵌入报错
        "ps.fonttype": 42,
        "text.usetex": usetex,
    })


def despine(ax, keep: tuple[str, ...] = ("left", "bottom")) -> None:
    """去掉上/右/多余边框——三线图的基本修养。"""
    for side in ("top", "right", "left", "bottom"):
        ax.spines[side].set_visible(side in keep)
    ax.tick_params(direction="out", length=3, width=0.8)


def grid(ax, axis: str = "y") -> None:
    """只留主网格，压在数据下面。"""
    ax.grid(True, axis=axis, linestyle="--", linewidth=0.6, color="#DDDDDD", alpha=0.9)
    ax.set_axisbelow(True)


def series(i: int) -> dict:
    """第 i 条线的稳定样式：颜色/线型/标记同进同出，黑白打印也不糊。"""
    return {
        "color": PALETTE[i % len(PALETTE)],
        "linestyle": LINE_STYLES[i % len(LINE_STYLES)],
        "marker": MARKERS[i % len(MARKERS)],
    }


def save(fig, path, also_png: bool = True, dpi: int = 300) -> list[Path]:
    """保存图。.pdf 为交付物，同名 .png 仅供面板/README 预览。"""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    written = [out]
    fig.savefig(out)
    if also_png and out.suffix.lower() == ".pdf":
        png = out.with_suffix(".png")
        fig.savefig(png, dpi=dpi)
        written.append(png)
    print("OK: 已保存 " + " + ".join(str(p) for p in written))
    return written


if __name__ == "__main__":
    apply()
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    for i, name in enumerate(["方案 A", "方案 B", "方案 C"]):
        ax.plot(range(10), [i + v * 0.5 for v in range(10)], label=name, **series(i))
    ax.set_xlabel("时间 t / h")
    ax.set_ylabel("负荷 / MW")
    grid(ax)
    ax.legend()
    despine(ax)
    save(fig, "figs/_figstyle_selftest.pdf")
    print("OK: figstyle 自检通过")
