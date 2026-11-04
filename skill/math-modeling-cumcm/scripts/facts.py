"""facts.json 写入接口 —— 求解脚本专用。

论文里所有计算结果都必须先登记到这里，再由 render.py 注入正文。
手写数字一律视为不可信。

用法（在 code/solve_q1.py 里）:

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))
    from facts import FactStore

    store = FactStore()          # 自动向上查找 facts.json
    store.add("rmse", 0.0421, fmt=".4f", desc="问题一验证集 RMSE",
              source=__file__, check="低于基线 0.0683")
    store.save()

不想用本模块也可以按 templates/facts.json 的 schema 直接写 JSON。
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path


class FactError(Exception):
    pass


def find_facts_file(start: str | os.PathLike | None = None) -> Path:
    """从 start（默认 cwd）向上找 facts.json。"""
    p = Path(start or Path.cwd()).resolve()
    for parent in [p, *p.parents]:
        candidate = parent / "facts.json"
        if candidate.is_file():
            return candidate
    raise FactError("找不到 facts.json；请从工作目录内运行，或显式传 facts_path")


class FactStore:
    def __init__(self, work_dir: str | os.PathLike | None = None,
                 problem: str = "", seed: int | None = None):
        self.path = find_facts_file(work_dir)
        raw = json.loads(self.path.read_text(encoding="utf-8-sig"))
        raw.setdefault("meta", {})
        raw.setdefault("values", {})
        self.data = raw
        if problem:
            self.data["meta"]["problem"] = problem
        if seed is not None:
            self.data["meta"]["seed"] = seed

    def add(self, key: str, value: float | int, *, unit: str = "",
            fmt: str = "", desc: str, source: str = "", check: str = "",
            overwrite: bool = False) -> None:
        if not isinstance(key, str) or not key.strip():
            raise FactError("key 必须是非空字符串")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise FactError(f"{key}: value 必须是数字，实际是 {type(value).__name__}")
        if key in self.data["values"] and not overwrite:
            raise FactError(
                f"{key}: 已存在。若为有意更新，传 overwrite=True 并在 check 里说明原因"
            )
        self.data["values"][key] = {
            "value": value,
            "unit": unit,
            "format": fmt,
            "desc": desc,
            "source": str(source or "unknown"),
            "check": check,
        }
        self.data["meta"]["generated_at"] = datetime.now().astimezone().isoformat(
            timespec="seconds"
        )

    def save(self) -> Path:
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return self.path


if __name__ == "__main__":
    # 冒烟自检：python scripts/facts.py
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "facts.json"
        p.write_text('{"meta": {}, "values": {}}', encoding="utf-8")
        s = FactStore(td, problem="smoke", seed=42)
        s.add("x", 1.5, unit="m", fmt=".1f", desc="测试", source="smoke")
        s.save()
        got = json.loads(p.read_text(encoding="utf-8"))
        assert got["values"]["x"]["value"] == 1.5
        print("facts.py OK:", json.dumps(got, ensure_ascii=False))
