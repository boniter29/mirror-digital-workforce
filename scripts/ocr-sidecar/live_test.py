"""Black-box acceptance test for the frozen OCR executable.

Python is used only to generate deterministic fixtures for the build test. The
executable under test is a standalone process and target computers do not need
Python.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import fitz  # type: ignore
from PIL import Image, ImageDraw, ImageFont  # type: ignore


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (Path("C:/Windows/Fonts/msyh.ttc"), Path("C:/Windows/Fonts/arial.ttf")):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def request(process: subprocess.Popen[str], action: str, **payload: object) -> dict[str, object]:
    request_id = f"live-{action}-{len(payload)}"
    assert process.stdin and process.stdout
    process.stdin.write(json.dumps({"id": request_id, "action": action, **payload}, ensure_ascii=False) + "\n")
    process.stdin.flush()
    line = process.stdout.readline()
    if not line:
        raise AssertionError(f"sidecar ended while waiting for {action}")
    response = json.loads(line)
    if response.get("id") != request_id:
        raise AssertionError(f"response correlation mismatch: {response}")
    return response


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: live_test.py <mirror-ocr.exe>")
    executable = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="mirror-ocr-live-") as directory:
        root = Path(directory)
        image_path = root / "镜我 OCR 对抗样本.png"
        corrupt_path = root / "corrupt.png"
        pdf_path = root / "two-pages.pdf"

        image = Image.new("RGB", (1400, 700), "white")
        draw = ImageDraw.Draw(image)
        draw.text((80, 100), "MIRROR OCR 2026", fill="black", font=font(72))
        draw.text((80, 240), "API KEY REQUIRED: NO", fill="black", font=font(58))
        draw.text((80, 380), "中文识别：镜我本地视觉", fill="black", font=font(58))
        image.save(image_path)
        corrupt_path.write_bytes(b"not-a-real-image")

        with fitz.open() as document:
            raw = image_path.read_bytes()
            for _ in range(2):
                page = document.new_page(width=700, height=350)
                page.insert_image(page.rect, stream=raw)
            document.save(pdf_path)

        process = subprocess.Popen(
            [str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            status = request(process, "status")
            assert status.get("ok") is True
            assert "PP-OCRv6-small" in json.dumps(status, ensure_ascii=False)

            recognized = request(process, "recognize", path=str(image_path))
            text = json.dumps(recognized, ensure_ascii=False)
            assert recognized.get("ok") is True, recognized
            assert "MIRROR" in text and "OCR" in text and "2026" in text, text

            pdf = request(process, "recognize", path=str(pdf_path), page_ranges="2")
            assert pdf.get("ok") is True
            result = pdf.get("result")
            assert isinstance(result, dict) and result.get("pageCount") == 1
            pages = result.get("pages")
            assert isinstance(pages, list) and pages and pages[0].get("page") == 2

            corrupt = request(process, "recognize", path=str(corrupt_path))
            assert corrupt.get("ok") is False
            # A failed document must not poison the long-lived process.
            assert request(process, "status").get("ok") is True
            assert request(process, "shutdown").get("ok") is True
        finally:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        print(json.dumps({
            "success": True,
            "model": "PP-OCRv6-small",
            "image": "PASS",
            "pdfPageRange": "PASS",
            "corruptInputRecovery": "PASS",
            "targetNeedsPython": False,
        }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
