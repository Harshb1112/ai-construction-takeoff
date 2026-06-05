"""
Dataset Augmentation — 65 images se 3000 realistic images
==========================================================
Run: python models/augment_dataset.py
"""
import cv2
import numpy as np
from pathlib import Path
import random
import shutil

random.seed(42)
np.random.seed(42)

BASE       = Path(__file__).parent / "Dataset"
CLEAN_DIR  = BASE / "WITHOUT MARKUP"
MARKUP_DIR = BASE / "MARKUP"
OUT_CLEAN  = BASE / "WITHOUT MARKUP"   # same folder mein save
OUT_MARKUP = BASE / "MARKUP"
TARGET     = 3000

SUPPORTED = {'.jpg', '.jpeg', '.png'}


def get_pairs():
    clean  = {p.stem: p for p in CLEAN_DIR.iterdir()  if p.suffix.lower() in SUPPORTED}
    markup = {p.stem: p for p in MARKUP_DIR.iterdir() if p.suffix.lower() in SUPPORTED}
    common = set(clean) & set(markup)
    return [(clean[s], markup[s]) for s in sorted(common)]


def augment_pair(clean_img, markup_img, idx: int):
    """One pair se ek unique augmented pair banao."""
    h, w = clean_img.shape[:2]

    aug_clean  = clean_img.copy()
    aug_markup = markup_img.copy()

    ops = list(range(12))
    random.shuffle(ops)
    chosen = ops[:random.randint(3, 6)]   # 3-6 random ops apply karo

    for op in chosen:

        # ── 1. Horizontal Flip ──
        if op == 0:
            aug_clean  = cv2.flip(aug_clean,  1)
            aug_markup = cv2.flip(aug_markup, 1)

        # ── 2. Vertical Flip ──
        elif op == 1:
            aug_clean  = cv2.flip(aug_clean,  0)
            aug_markup = cv2.flip(aug_markup, 0)

        # ── 3. Rotate 90/180/270 ──
        elif op == 2:
            k = random.choice([1, 2, 3])
            aug_clean  = np.rot90(aug_clean,  k)
            aug_markup = np.rot90(aug_markup, k)

        # ── 4. Random Crop (80-95% of image) ──
        elif op == 3:
            ch, cw = aug_clean.shape[:2]
            scale  = random.uniform(0.80, 0.95)
            nh, nw = int(ch * scale), int(cw * scale)
            y0 = random.randint(0, ch - nh)
            x0 = random.randint(0, cw - nw)
            aug_clean  = aug_clean [y0:y0+nh, x0:x0+nw]
            aug_markup = aug_markup[y0:y0+nh, x0:x0+nw]
            aug_clean  = cv2.resize(aug_clean,  (cw, ch), interpolation=cv2.INTER_LINEAR)
            aug_markup = cv2.resize(aug_markup, (cw, ch), interpolation=cv2.INTER_NEAREST)

        # ── 5. Brightness adjust ──
        elif op == 4:
            beta = random.randint(-30, 30)
            aug_clean = cv2.convertScaleAbs(aug_clean, alpha=1.0, beta=beta)

        # ── 6. Contrast adjust ──
        elif op == 5:
            alpha = random.uniform(0.8, 1.2)
            aug_clean = cv2.convertScaleAbs(aug_clean, alpha=alpha, beta=0)

        # ── 7. Gaussian Blur (slight) ──
        elif op == 6:
            k = random.choice([3, 5])
            aug_clean = cv2.GaussianBlur(aug_clean, (k, k), 0)

        # ── 8. Small rotation (-15 to +15 degrees) ──
        elif op == 7:
            angle = random.uniform(-15, 15)
            ch, cw = aug_clean.shape[:2]
            M = cv2.getRotationMatrix2D((cw//2, ch//2), angle, 1.0)
            aug_clean  = cv2.warpAffine(aug_clean,  M, (cw, ch),
                                        flags=cv2.INTER_LINEAR,
                                        borderMode=cv2.BORDER_REFLECT)
            aug_markup = cv2.warpAffine(aug_markup, M, (cw, ch),
                                        flags=cv2.INTER_NEAREST,
                                        borderMode=cv2.BORDER_REFLECT)

        # ── 9. Scale zoom in (1.1x - 1.3x) ──
        elif op == 8:
            zoom = random.uniform(1.1, 1.3)
            ch, cw = aug_clean.shape[:2]
            nw2, nh2 = int(cw * zoom), int(ch * zoom)
            tmp_c = cv2.resize(aug_clean,  (nw2, nh2), interpolation=cv2.INTER_LINEAR)
            tmp_m = cv2.resize(aug_markup, (nw2, nh2), interpolation=cv2.INTER_NEAREST)
            # Center crop back to original size
            y0 = (nh2 - ch) // 2
            x0 = (nw2 - cw) // 2
            aug_clean  = tmp_c[y0:y0+ch, x0:x0+cw]
            aug_markup = tmp_m[y0:y0+ch, x0:x0+cw]

        # ── 10. JPEG noise (realistic scan artifacts) ──
        elif op == 9:
            quality = random.randint(60, 90)
            _, buf = cv2.imencode('.jpg', aug_clean, [cv2.IMWRITE_JPEG_QUALITY, quality])
            aug_clean = cv2.imdecode(buf, cv2.IMREAD_COLOR)

        # ── 11. Salt & pepper noise (scan dots) ──
        elif op == 10:
            noise_pct = random.uniform(0.001, 0.005)
            num_pixels = int(aug_clean.shape[0] * aug_clean.shape[1] * noise_pct)
            ch2, cw2 = aug_clean.shape[:2]
            # Salt
            ys = np.random.randint(0, ch2, num_pixels)
            xs = np.random.randint(0, cw2, num_pixels)
            aug_clean[ys, xs] = 255
            # Pepper
            ys = np.random.randint(0, ch2, num_pixels)
            xs = np.random.randint(0, cw2, num_pixels)
            aug_clean[ys, xs] = 0

        # ── 12. Elastic distortion (slight warping) ──
        elif op == 11:
            ch2, cw2 = aug_clean.shape[:2]
            strength = random.uniform(3, 8)
            dx = cv2.GaussianBlur(
                np.random.uniform(-1, 1, (ch2, cw2)).astype(np.float32),
                (0, 0), strength) * strength * 10
            dy = cv2.GaussianBlur(
                np.random.uniform(-1, 1, (ch2, cw2)).astype(np.float32),
                (0, 0), strength) * strength * 10
            x_map = (np.tile(np.arange(cw2), (ch2, 1)) + dx).astype(np.float32)
            y_map = (np.tile(np.arange(ch2), (cw2, 1)).T + dy).astype(np.float32)
            aug_clean  = cv2.remap(aug_clean,  x_map, y_map, cv2.INTER_LINEAR,
                                   borderMode=cv2.BORDER_REFLECT)
            aug_markup = cv2.remap(aug_markup, x_map, y_map, cv2.INTER_NEAREST,
                                   borderMode=cv2.BORDER_REFLECT)

    return aug_clean, aug_markup


def main():
    pairs = get_pairs()
    if not pairs:
        print("[ERROR] No paired images found!")
        return

    n_orig = len(pairs)
    per_image = TARGET // n_orig + 1

    print(f"[Augment] {n_orig} original pairs -> generating {TARGET} augmented pairs")
    print(f"[Augment] ~{per_image} augmentations per image")

    count = 0
    aug_idx = 10000   # start from 10000 to avoid conflicts with originals

    while count < TARGET:
        for clean_path, markup_path in pairs:
            if count >= TARGET:
                break

            clean_img  = cv2.imread(str(clean_path))
            markup_img = cv2.imread(str(markup_path))
            if clean_img is None or markup_img is None:
                continue

            # Same size ensure karo
            mh, mw = markup_img.shape[:2]
            ch, cw = clean_img.shape[:2]
            if (mh, mw) != (ch, cw):
                markup_img = cv2.resize(markup_img, (cw, ch), interpolation=cv2.INTER_NEAREST)

            aug_c, aug_m = augment_pair(clean_img, markup_img, aug_idx)

            out_name = f"aug_{aug_idx}.jpg"
            cv2.imwrite(str(OUT_CLEAN  / out_name), aug_c,
                        [cv2.IMWRITE_JPEG_QUALITY, 92])
            cv2.imwrite(str(OUT_MARKUP / out_name), aug_m,
                        [cv2.IMWRITE_JPEG_QUALITY, 95])

            count   += 1
            aug_idx += 1

            if count % 100 == 0:
                print(f"  {count}/{TARGET} generated...")

    print(f"\n[Augment] Done! {count} new pairs saved.")
    print(f"  WITHOUT MARKUP: {len(list(OUT_CLEAN.iterdir()))} total")
    print(f"  MARKUP:         {len(list(OUT_MARKUP.iterdir()))} total")


if __name__ == "__main__":
    main()
