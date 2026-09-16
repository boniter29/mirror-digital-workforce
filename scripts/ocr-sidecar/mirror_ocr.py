"""Self-contained PP-OCRv6 sidecar for Mirror.

Protocol: one UTF-8 JSON object per stdin line, one response per stdout line.
All diagnostics go to stderr so model/library logs cannot corrupt the protocol.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROTOCOL_OUT = sys.stdout
sys.stdout = sys.stderr
import fitz  # type: ignore  # noqa: E402
import numpy as np  # type: ignore  # noqa: E402
from rapidocr import RapidOCR  # type: ignore  # noqa: E402
sys.stdout = PROTOCOL_OUT

MODEL = "PP-OCRv6-small"
MAX_FILE_BYTES = 80 * 1024 * 1024
MAX_PDF_PAGES = 200
MAX_OUTPUT_CHARS = 600_000
SUPPORTED = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}

_engine: RapidOCR | None = None


def emit(payload: dict[str, Any]) -> None:
    PROTOCOL_OUT.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    PROTOCOL_OUT.flush()


def engine() -> RapidOCR:
    global _engine
    if _engine is None:
        threads = max(1, min(4, (os.cpu_count() or 2) // 2 or 1))
        _engine = RapidOCR(params={
            "Global.log_level": "error",
            "EngineConfig.onnxruntime.intra_op_num_threads": threads,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
        })
    return _engine


def parse_page_ranges(value: str | None, count: int) -> list[int]:
    if count < 1:
        return []
    if not value:
        return list(range(min(count, MAX_PDF_PAGES)))
    pages: set[int] = set()
    for raw_part in value.split(","):
        part = raw_part.strip()
        if not part:
            continue
        if "-" in part:
            left, right = part.split("-", 1)
            start, end = int(left), int(right)
            if start > end:
                raise ValueError(f"页码范围无效：{part}")
            pages.update(range(start - 1, end))
        else:
            pages.add(int(part) - 1)
    if any(page < 0 or page >= count for page in pages):
        raise ValueError(f"页码超出范围，文档共 {count} 页。")
    ordered = sorted(pages)
    if len(ordered) > MAX_PDF_PAGES:
        raise ValueError(f"单次最多识别 {MAX_PDF_PAGES} 页，请使用 page_ranges 分批处理。")
    return ordered


def normalize_result(result: Any, page_number: int) -> dict[str, Any]:
    texts = list(result.txts) if result.txts is not None else []
    raw_scores = list(result.scores) if result.scores is not None else []
    scores = [round(float(value), 5) for value in raw_scores]
    boxes = []
    raw_boxes = list(result.boxes) if result.boxes is not None else []
    for box in raw_boxes:
        boxes.append([[round(float(point[0]), 2), round(float(point[1]), 2)] for point in box])
    lines = []
    for index, text in enumerate(texts):
        lines.append({
            "text": str(text),
            "score": scores[index] if index < len(scores) else None,
            "box": boxes[index] if index < len(boxes) else None,
        })
    markdown = "\n".join(str(text) for text in texts).strip()
    return {
        "page": page_number,
        "markdown": markdown[:MAX_OUTPUT_CHARS],
        "lines": lines,
        "meanConfidence": round(sum(scores) / len(scores), 5) if scores else 0,
    }


def recognize_image(path: Path) -> list[dict[str, Any]]:
    return [normalize_result(engine()(path), 1)]


def recognize_pdf(path: Path, page_ranges: str | None) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    with fitz.open(path) as document:
        selected = parse_page_ranges(page_ranges, document.page_count)
        for page_index in selected:
            page = document.load_page(page_index)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
            if pixmap.n == 4:
                image = image[:, :, :3]
            # PyMuPDF yields RGB; RapidOCR/OpenCV accepts the ndarray and handles
            # preprocessing consistently with file inputs.
            pages.append(normalize_result(engine()(image), page_index + 1))
    return pages


def recognize(request: dict[str, Any]) -> dict[str, Any]:
    raw_path = request.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError("path 必须是非空字符串。")
    path = Path(raw_path).resolve(strict=True)
    if not path.is_file():
        raise ValueError("OCR 输入必须是普通文件。")
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED:
        raise ValueError(f"不支持 {suffix or '无扩展名'}；请选择 PDF 或图片。")
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise ValueError("单文件上限为 80 MB。")
    started = time.perf_counter()
    pages = recognize_pdf(path, request.get("page_ranges")) if suffix == ".pdf" else recognize_image(path)
    return {
        "success": True,
        "provider": "rapidocr_onnxruntime",
        "model": MODEL,
        "pageCount": len(pages),
        "pages": pages,
        "durationMs": round((time.perf_counter() - started) * 1000),
        "runtime": {"pythonBundled": bool(getattr(sys, "frozen", False)), "cpuThreads": max(1, min(4, (os.cpu_count() or 2) // 2 or 1))},
    }


def handle(request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action")
    if action == "status":
        return {
            "available": True,
            "provider": "rapidocr_onnxruntime",
            "model": MODEL,
            "localFirst": True,
            "offline": True,
            "supported": sorted(SUPPORTED),
            "pid": os.getpid(),
            "pythonBundled": bool(getattr(sys, "frozen", False)),
        }
    if action == "recognize":
        return recognize(request)
    if action == "shutdown":
        return {"stopping": True}
    raise ValueError(f"未知 action：{action}")


def main() -> int:
    for line in sys.stdin:
        request_id: Any = None
        try:
            if len(line) > 1_000_000:
                raise ValueError("请求过大。")
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("请求必须是 JSON 对象。")
            request_id = request.get("id")
            result = handle(request)
            emit({"id": request_id, "ok": True, "result": result})
            if request.get("action") == "shutdown":
                return 0
        except Exception as error:  # Keep the sidecar alive after a bad file/request.
            print(traceback.format_exc(), file=sys.stderr, flush=True)
            emit({"id": request_id, "ok": False, "error": str(error)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
