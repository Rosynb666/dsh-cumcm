"""生成 demo 用的技术路线图（Pillow -> PDF）。

真实项目里图表也应该由脚本生成，便于复现和修改。
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 1000
IMG = Image.new("RGB", (W, H), "white")
D = ImageDraw.Draw(IMG)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
                 r"C:\Windows\Fonts\simsun.ttc"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


F_TITLE = load_font(46)
F_BOX = load_font(38)

D.text((70, 50), "技术路线图（Demo）", font=F_TITLE, fill="black")

boxes = [
    ((120, 260, 480, 400), "问题分析"),
    ((620, 260, 980, 400), "数据预处理"),
    ((1120, 260, 1480, 400), "建模与求解"),
    ((620, 620, 980, 760), "检验与灵敏度"),
]
for (x0, y0, x1, y1), label in boxes:
    D.rounded_rectangle((x0, y0, x1, y1), radius=18, outline="black", width=5)
    tb = D.textbbox((0, 0), label, font=F_BOX)
    D.text(((x0 + x1 - (tb[2] - tb[0])) / 2, (y0 + y1 - (tb[3] - tb[1])) / 2 - tb[1]),
           label, font=F_BOX, fill="black")


def arrow(p0, p1):
    D.line([p0, p1], fill="black", width=5)
    x, y = p1
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    if abs(dx) > abs(dy):  # 水平
        s = 1 if dx > 0 else -1
        D.polygon([(x, y), (x - 22 * s, y - 12), (x - 22 * s, y + 12)], fill="black")
    else:  # 垂直
        s = 1 if dy > 0 else -1
        D.polygon([(x, y), (x - 12, y - 22 * s), (x + 12, y - 22 * s)], fill="black")


arrow((480, 330), (620, 330))
arrow((980, 330), (1120, 330))
arrow((1300, 400), (1300, 690))
arrow((1300, 690), (980, 690))

out = Path(__file__).resolve().parent.parent / "paper" / "figs" / "roadmap.pdf"
out.parent.mkdir(parents=True, exist_ok=True)
IMG.save(out, "PDF", resolution=150)
print(f"OK: {out}")
