"""Run verify on ALL paired images and save results."""
from pathlib import Path
import sys
import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from models.Model_training import (
    load_image, extract_mask_from_markup, _annotation_style,
    CLASS_NAMES, N_CLASSES, IMG_SIZE,
    MARKUP_DIR, CLEAN_DIR, SUPPORTED_EXTS
)

OUT_DIR = Path(__file__).parent / "model_output" / "verify_all"
OUT_DIR.mkdir(parents=True, exist_ok=True)

COLORS = {0:(30,30,30), 1:(0,180,90), 2:(200,120,40), 3:(0,220,220), 4:(0,100,255)}

markup_files = {p.stem: p for p in MARKUP_DIR.iterdir() if p.suffix.lower() in SUPPORTED_EXTS}
clean_files  = {p.stem: p for p in CLEAN_DIR.iterdir()  if p.suffix.lower() in SUPPORTED_EXTS}
common = sorted(set(markup_files) & set(clean_files))
print(f"Total pairs: {len(common)}")

style_counts = {}
bad = []

for i, stem in enumerate(common):
    # Both use load_image — same pipeline, no mismatch
    clean_img,  pad_info = load_image(clean_files[stem],  IMG_SIZE)
    markup_img, _        = load_image(markup_files[stem], IMG_SIZE)

    if clean_img is None:
        bad.append((stem, "clean load failed"));  continue
    if markup_img is None:
        bad.append((stem, "markup load failed")); continue

    mask  = extract_mask_from_markup(markup_img, clean_img, pad_info)
    hsv   = cv2.cvtColor(markup_img, cv2.COLOR_RGB2HSV)
    style = _annotation_style(hsv)
    style_counts[style] = style_counts.get(style, 0) + 1

    room_pct = (mask == 1).sum() * 100 / mask.size
    wall_pct = (mask == 2).sum() * 100 / mask.size

    colored = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
    for c, color in COLORS.items():
        colored[mask == c] = color

    clean_bgr  = cv2.cvtColor(clean_img,  cv2.COLOR_RGB2BGR)
    markup_bgr = cv2.cvtColor(markup_img, cv2.COLOR_RGB2BGR)
    row = np.hstack([clean_bgr, markup_bgr, colored])

    stats = f"{stem} [{style}] room:{room_pct:.0f}% wall:{wall_pct:.0f}%"
    cv2.putText(row, stats, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255,255,255), 2)
    cv2.putText(row, stats, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0,0,0), 1)

    cv2.imwrite(str(OUT_DIR / f"{stem}.jpg"), row, [cv2.IMWRITE_JPEG_QUALITY, 80])

    if (i+1) % 50 == 0:
        print(f"  {i+1}/{len(common)} done...")

print(f"\nStyle breakdown: {style_counts}")
print(f"Bad pairs: {len(bad)}")
if bad:
    for b in bad[:10]: print(f"  {b}")
print(f"\nSaved to: {OUT_DIR}")
