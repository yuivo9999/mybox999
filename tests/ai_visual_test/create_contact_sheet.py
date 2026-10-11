#!/usr/bin/env python3
"""Create a compact screenshot overview; individual PNG files remain authoritative."""
from __future__ import annotations
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def main() -> int:
    parser = argparse.ArgumentParser(description="Make a screenshot contact sheet for AI visual review")
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--columns", type=int, default=3)
    args = parser.parse_args()
    root = args.artifacts_dir.expanduser().resolve()
    if not root.is_dir():
        parser.error(f"Artifacts directory does not exist: {root}")

    candidates = sorted(p for p in root.glob("*.png") if p.name != "contact-sheet.png")
    preferred = [p for p in candidates if p.name.startswith(("layout-", "visual-", "page-initial", "interaction-"))]
    selected = preferred or [p for p in candidates if p.name.endswith("-final.png")]
    if not selected:
        print("No screenshots found; contact sheet not created.")
        return 0

    columns = max(1, min(5, args.columns))
    cell_width, cell_height, pad, title_height = 340, 500, 14, 34
    thumb_width, thumb_height = cell_width - pad * 2, cell_height - title_height - pad * 2
    prepared = []
    for path in selected:
        try:
            with Image.open(path) as source:
                thumb = source.convert("RGB")
                thumb.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
                prepared.append((path, thumb.copy(), source.size))
        except Exception as exc:
            print(f"Skipping unreadable screenshot {path}: {exc}")

    if not prepared:
        print("No readable PNG screenshots found; contact sheet not created.")
        return 0

    rows = (len(prepared) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), "#e9e4db")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 12)
        small_font = ImageFont.truetype("DejaVuSans.ttf", 10)
    except OSError:
        font = ImageFont.load_default()
        small_font = font

    for index, (path, thumb, original_size) in enumerate(prepared):
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        draw.rounded_rectangle((x + 5, y + 5, x + cell_width - 5, y + cell_height - 5), radius=8, fill="#ffffff", outline="#c7bca9", width=1)
        draw.text((x + pad, y + 10), path.name[:46], fill="#2a2119", font=font)
        draw.text((x + pad, y + 25), f"original: {original_size[0]}x{original_size[1]}", fill="#796751", font=small_font)
        image_x = x + (cell_width - thumb.width) // 2
        image_y = y + title_height + (thumb_height - thumb.height) // 2
        sheet.paste(thumb, (image_x, image_y))

    output = (args.output or (root / "contact-sheet.png")).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, format="PNG", optimize=True)
    print(f"Created screenshot contact sheet: {output} ({len(prepared)} screenshots)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
