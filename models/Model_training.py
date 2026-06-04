"""
BIMBOSS Floor Plan Segmentation — Training Pipeline v3.1
=========================================================
Masks extracted from manually color-annotated MARKUP images.
Annotation styles: bw_binary | color_full | color_green (auto-detected).

Dataset pairing: MARKUP/001.png ↔ WITHOUT MARKUP/001.png (same filename).
Training input : WITHOUT MARKUP image.
Ground truth   : mask extracted from MARKUP image.

Architecture: ResNet34 (pretrained) + U-Net + ASPP + Deep Supervision

Run:
    python models/Model_training.py

Requirements:
    pip install torch torchvision opencv-python pillow numpy tqdm PyMuPDF
"""

from __future__ import annotations
import os, sys, json, random, logging, io as _io
from datetime import datetime, timedelta
import time as _time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from tqdm import tqdm

os.environ["OPENCV_LOG_LEVEL"] = "ERROR"

# Fix #10 — reproducible results
SEED = 42
random.seed(SEED);  np.random.seed(SEED);  torch.manual_seed(SEED)

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE       = Path(__file__).parent
MARKUP_DIR = BASE / "Dataset" / "MARKUP"
CLEAN_DIR  = BASE / "Dataset" / "WITHOUT MARKUP"
SAVE_DIR   = BASE / "model_output"
CKPT       = SAVE_DIR / "floor_plan_model.pth"
HIST_FILE  = SAVE_DIR / "retrain_history.json"

# Google Drive auto-backup (Colab pe kaam karta hai)
_DRIVE_BACKUP = Path("/content/drive/MyDrive/models/model_output")
DRIVE_BACKUP  = _DRIVE_BACKUP if _DRIVE_BACKUP.parent.parent.exists() else None
LOG_FILE   = BASE.parent / "logs" / "training.log"

SAVE_DIR.mkdir(exist_ok=True)
MASK_CACHE_DIR = SAVE_DIR / "mask_cache"
MASK_CACHE_DIR.mkdir(exist_ok=True)
LOG_FILE.parent.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[
        logging.FileHandler(str(LOG_FILE), mode="w", encoding="utf-8"),
        logging.StreamHandler(_io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")),
    ],
)
log = logging.getLogger()

# ── Hyper-params ──────────────────────────────────────────────────────────────
IMG_SIZE     = 512
N_CLASSES    = 5
CLASS_NAMES  = ["background", "room", "wall", "door", "window"]
FG_CLASSES   = [1, 2, 3, 4]
BATCH        = 4
EPOCHS       = 120
LR           = 3e-4
WEIGHT_DECAY = 1e-4
DEVICE       = "cuda" if torch.cuda.is_available() else "cpu"
VAL_FRAC     = 0.20
MAX_CACHE_MB = 3000   # conservative — actual usage is (3+1)ch × H × W × N

CLASS_WEIGHTS = torch.tensor([0.05, 1.0, 1.5, 5.0, 5.0])  # fallback; auto-computed before training

SUPPORTED_EXTS  = {".png", ".jpg", ".jpeg", ".pdf"}
# Multi-scale training: randomly pick one of these sizes per batch
TRAIN_SCALES    = [384, 512, 640]   # 768 excluded — needs >2GB VRAM


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1: IMAGE LOADING
# ══════════════════════════════════════════════════════════════════════════════

PadInfo = tuple[int, int, int, int]  # (y0, x0, nh, nw)


def load_image(path: Path, size: int = IMG_SIZE) -> tuple[np.ndarray, PadInfo] | tuple[None, None]:
    """Load any image/PDF → (RGB ndarray, pad_info).  Returns (None, None) on failure."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        try:
            import fitz
            doc  = fitz.open(str(path))
            page = doc[0]
            # Fixed zoom=2.0 → always high quality render, then resize_pad handles scaling.
            # Avoids blur on large PDFs where adaptive zoom gives tiny values.
            pix  = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            img  = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
            doc.close()
            return _resize_pad(img, size)
        except Exception as e:
            log.warning(f"[PDF] {path.name}: {e}")
            return None, None
    try:
        raw = cv2.imread(str(path))
        if raw is None:
            return None, None
        return _resize_pad(cv2.cvtColor(raw, cv2.COLOR_BGR2RGB), size)
    except Exception:
        return None, None


def _resize_pad(img: np.ndarray, size: int) -> tuple[np.ndarray, PadInfo]:
    h, w   = img.shape[:2]
    scale  = size / max(h, w)
    nh, nw = int(h * scale), int(w * scale)
    img    = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    out    = np.full((size, size, 3), 255, dtype=np.uint8)
    y0     = (size - nh) // 2
    x0     = (size - nw) // 2
    out[y0:y0+nh, x0:x0+nw] = img
    return out, (y0, x0, nh, nw)


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2: COLOR → MASK EXTRACTION
# ══════════════════════════════════════════════════════════════════════════════

# Fix #1 — markup uses same load_image pipeline as clean image, so no resize mismatch.
# Both are processed through _resize_pad → identical spatial alignment guaranteed.

STYLE_A_COLORS = [
    # (class_id, h_lo, h_hi, s_lo, s_hi, v_lo, v_hi)  OpenCV HSV 0-180/0-255/0-255
    (1,  75,  100,  80, 255,  50, 220),   # teal       → room
    (2,  95,  125,  20, 140, 150, 255),   # light blue → wall
    (3,  20,   38, 140, 255, 140, 255),   # yellow     → door
    (4,  38,   75,  80, 255,  50, 200),   # green      → window
    (3,   8,   20, 150, 255, 140, 255),   # orange     → door
    (3,   0,   10, 100, 255,  80, 255),   # red lo     → door/opening
    (3, 170,  180, 100, 255,  80, 255),   # red hi     → door/opening
]


def _apply_color_ranges(hsv: np.ndarray, table) -> np.ndarray:
    h, w = hsv.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    for cls_id, h_lo, h_hi, s_lo, s_hi, v_lo, v_hi in table:
        hit = (H >= h_lo) & (H <= h_hi) & (S >= s_lo) & (S <= s_hi) & (V >= v_lo) & (V <= v_hi)
        mask[hit] = cls_id
    return mask


def _annotation_style(hsv: np.ndarray) -> str:
    """
    Fix #12 — style detection: check colors before B&W to avoid misclassification
    when a logo/title block has colored pixels in an otherwise B&W image.
    Uses content-region pixels only (centre 60% of image) to avoid border artifacts.
    """
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    h, w    = H.shape
    # Sample from centre region only — avoids logo/watermark in corners
    cy, cx  = slice(h//5, 4*h//5), slice(w//5, 4*w//5)
    Hc, Sc, Vc = H[cy, cx], S[cy, cx], V[cy, cx]
    total   = Hc.size

    # 1. color_full: significant teal in centre (lowered threshold 0.04→0.02)
    non_black = max((Vc > 40).sum(), 1)
    teal = ((Hc >= 75) & (Hc <= 105) & (Sc >= 70) & (Vc >= 40)).sum()
    if teal / non_black > 0.02:
        return 'color_full'

    # 2. color_green: meaningful colored blobs in centre (> 1.5%)
    colored = ((Sc > 45) & (Vc > 60)).sum()
    if colored / total > 0.015:
        return 'color_green'

    # 3. bw_binary: truly monochrome
    low_sat  = (Sc < 25).sum() / total
    bimodal  = ((Vc > 210).sum() + (Vc < 45).sum()) / total
    if low_sat > 0.88 and bimodal > 0.70:
        return 'bw_binary'

    return 'color_green'  # fallback


def extract_mask_from_markup(markup_rgb: np.ndarray,
                              clean_rgb: np.ndarray | None = None,
                              pad_info: PadInfo | None = None) -> np.ndarray:
    h, w  = markup_rgb.shape[:2]
    hsv   = cv2.cvtColor(markup_rgb, cv2.COLOR_RGB2HSV)
    gray  = cv2.cvtColor(markup_rgb, cv2.COLOR_RGB2GRAY)
    style = _annotation_style(hsv)

    if style == 'bw_binary':
        mask = _bw_binary_mask(gray, h, w)
    elif style == 'color_full':
        mask = _apply_color_ranges(hsv, STYLE_A_COLORS)
    else:
        mask = _color_green_mask(hsv, h, w, clean_rgb)

    # Force padding border to background
    if pad_info:
        y0, x0, nh, nw = pad_info
        border = np.ones((h, w), dtype=bool)
        border[y0:y0+nh, x0:x0+nw] = False
        mask[border] = 0
    
    # NEW: Detect and exclude title block / margins / legends
    # This ensures model doesn't try to learn from text/legends as rooms
    
    # Bottom title block (15%)
    title_h = int(h * 0.15)
    mask[h - title_h:, :] = 0
    
    # Top/Left margins (3%)
    margin = int(min(h, w) * 0.03)
    mask[:margin, :] = 0       # Top margin
    mask[:, :margin] = 0       # Left margin
    
    # Right side: Detect if there's a legend/table column (check for high text density)
    # Most architectural drawings have legends on right 15-20% of page
    right_zone_width = int(w * 0.18)  # Check rightmost 18%
    right_zone = gray[:, w - right_zone_width:] if clean_rgb is not None else markup_rgb[:, w - right_zone_width:]
    
    # If right zone has high edge density (text/tables), exclude it
    if clean_rgb is not None:
        right_gray = cv2.cvtColor(clean_rgb[:, w - right_zone_width:], cv2.COLOR_RGB2GRAY)
    else:
        right_gray = cv2.cvtColor(markup_rgb[:, w - right_zone_width:], cv2.COLOR_RGB2GRAY)
    
    edges_right = cv2.Canny(right_gray, 50, 150)
    edge_density = edges_right.sum() / edges_right.size
    
    # If edge density > 0.05 (lots of text/lines), it's likely a legend/table area
    if edge_density > 0.05:
        mask[:, w - right_zone_width:] = 0  # Exclude entire right column
    else:
        mask[:, w - margin:] = 0  # Just exclude 3% margin

    return mask


def _bw_binary_mask(gray: np.ndarray, h: int, w: int) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    _, room_bin = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
    room_bin = cv2.morphologyEx(room_bin, cv2.MORPH_OPEN,
                                cv2.getStructuringElement(cv2.MORPH_RECT, (4, 4)))
    # Fix — remove tiny blobs (< 500px) — text labels, furniture symbols
    n_r, lbl_r, stats_r, _ = cv2.connectedComponentsWithStats(room_bin, connectivity=8)
    room_filtered = np.zeros_like(room_bin)
    for i in range(1, n_r):
        if stats_r[i, cv2.CC_STAT_AREA] >= 500:
            room_filtered[lbl_r == i] = 255
    mask[room_filtered > 0] = 1

    dark     = (gray < 80).astype(np.uint8) * 255
    flood    = dark.copy()
    ext_mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
    for corner in [(0, 0), (0, w-1), (h-1, 0), (h-1, w-1)]:
        if dark[corner] == 255:
            cv2.floodFill(flood, ext_mask, (corner[1], corner[0]), 128)
    exterior = (flood == 128)

    wall_bin = cv2.morphologyEx(
        ((gray < 100) & ~exterior).astype(np.uint8) * 255,
        cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    )
    mask[wall_bin > 0] = 2
    return mask


def _extract_walls_lsd(clean_rgb: np.ndarray, h: int, w: int) -> np.ndarray:
    """
    Extract wall lines using LSD (Line Segment Detector) + probabilistic Hough.
    LSD catches precise geometric segments; Hough catches long straight walls.
    Both filter out short/diagonal text and dimension lines by minimum length.

    Returns binary uint8 mask (255 = wall).
    """
    gray  = cv2.cvtColor(clean_rgb, cv2.COLOR_RGB2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray  = clahe.apply(gray)

    wall = np.zeros((h, w), dtype=np.uint8)
    min_len = max(20, int(min(h, w) * 0.03))   # min wall segment length (~3% of image)

    # ── LSD ──────────────────────────────────────────────────────────────────
    try:
        lsd  = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
        segs = lsd.detect(gray)[0]
        if segs is not None:
            for seg in segs:
                x1, y1, x2, y2 = map(int, seg[0])
                length = ((x2-x1)**2 + (y2-y1)**2) ** 0.5
                if length < min_len:
                    continue
                # Thickness proportional to length — short = thin noise; long = real wall
                thickness = max(2, int(length / max(h, w) * 8))
                cv2.line(wall, (x1, y1), (x2, y2), 255, thickness)
    except Exception:
        pass  # LSD unavailable — fall back to Hough only

    # ── Probabilistic Hough ───────────────────────────────────────────────────
    edges = cv2.Canny(gray, 30, 100)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180,
                             threshold=40,
                             minLineLength=min_len,
                             maxLineGap=max(5, min_len // 4))
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            length = ((x2-x1)**2 + (y2-y1)**2) ** 0.5
            thickness = max(2, int(length / max(h, w) * 8))
            cv2.line(wall, (x1, y1), (x2, y2), 255, thickness)

    # Close gaps between nearby segments, then dilate for thin-wall visibility
    wall = cv2.morphologyEx(wall, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    wall = cv2.dilate(wall, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)
    return wall


def _color_green_mask(hsv: np.ndarray, h: int, w: int,
                      clean_rgb: np.ndarray | None = None) -> np.ndarray:
    """
    Large colored blobs = room.
    Wall extracted from clean image using LSD + Hough.
    
    FIX: This function now ONLY marks explicitly colored regions as rooms.
    Background pixels remain 0 (background), allowing the model to infer
    unannotated rooms during inference. Walls are extracted separately.
    
    IMPORTANT: For best results, ALL rooms should be explicitly annotated
    in the MARKUP image. Partial annotations will result in missing rooms.
    """
    mask    = np.zeros((h, w), dtype=np.uint8)
    S, V    = hsv[:, :, 1], hsv[:, :, 2]
    colored = ((S > 40) & (V > 60)).astype(np.uint8) * 255
    min_px  = max(200, int(h * w * 0.003))
    n, lbl  = cv2.connectedComponents(colored, connectivity=8)
    room    = np.zeros((h, w), dtype=np.uint8)
    for i in range(1, n):
        if (lbl == i).sum() >= min_px:
            room[lbl == i] = 255
    room = cv2.dilate(room, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    mask[room > 0] = 1

    # Wall extraction from clean image
    # Apply wall labels EVERYWHERE walls are detected (not just background)
    # This allows partial room annotations to still have proper wall boundaries
    if clean_rgb is not None:
        wall_clean = _extract_walls_lsd(clean_rgb, h, w)
        # Walls overwrite background, but NOT rooms (room = 1 stays as room)
        mask[(wall_clean > 0) & (mask == 0)] = 2

    return mask


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3: DATASET PAIRING  (fix #13 — PDF markup support via load_image)
# ══════════════════════════════════════════════════════════════════════════════

def collect_pairs() -> list[tuple[Path, Path]]:
    # Check for FIXED annotations first (if user ran fix_annotations.py)
    fixed_dir = BASE / "Dataset" / "MARKUP_FIXED"
    if fixed_dir.exists() and len(list(fixed_dir.glob("*"))) > 0:
        log.info("  ✅ Using FIXED annotations from MARKUP_FIXED/")
        markup_dir = fixed_dir
    else:
        markup_dir = MARKUP_DIR
        log.info("  Using original MARKUP/ (run fix_annotations.py to improve quality)")
    
    markup = {p.stem: p for p in markup_dir.iterdir()
              if p.suffix.lower() in SUPPORTED_EXTS} if markup_dir.exists() else {}
    clean  = {p.stem: p for p in CLEAN_DIR.iterdir()
              if p.suffix.lower() in SUPPORTED_EXTS} if CLEAN_DIR.exists() else {}
    common      = sorted(set(markup) & set(clean))
    only_markup = set(markup) - set(clean)
    only_clean  = set(clean)  - set(markup)
    if only_markup:
        log.warning(f"  {len(only_markup)} MARKUP files have no clean pair — skipped")
    if only_clean:
        log.info(f"  {len(only_clean)} clean files have no MARKUP pair — skipped")
    pairs = [(clean[s], markup[s]) for s in common]
    log.info(f"  Paired: {len(pairs)}  (markup-only: {len(only_markup)}, clean-only: {len(only_clean)})")
    return pairs


def _stratified_split(pairs: list, val_frac: float) -> tuple[list, list]:
    """
    Fix #4 — stratified split by annotation style so each style appears in val.
    Groups pairs by style, samples val_frac from each group independently.
    """
    groups: dict[str, list] = {}
    for clean_p, markup_p in pairs:
        img, pad = load_image(markup_p, IMG_SIZE)
        if img is None:
            style = 'bw_binary'
        else:
            hsv   = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
            style = _annotation_style(hsv)
        groups.setdefault(style, []).append((clean_p, markup_p))

    train_p, val_p = [], []
    log.info("  Annotation style breakdown:")
    for style in ["bw_binary", "color_full", "color_green"]:
        grp = groups.get(style, [])
        if not grp:
            log.info(f"    {style:12s}:    0 total")
            continue
        random.shuffle(grp)
        n_val = max(1, round(len(grp) * val_frac))
        if len(grp) > 1:
            n_val = min(n_val, len(grp) - 1)
        val_p.extend(grp[:n_val])
        train_p.extend(grp[n_val:])
        log.info(f"    {style:12s}: {len(grp):4d} total → {len(grp)-n_val} train / {n_val} val")

    return train_p, val_p


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4: AUGMENTATION  (fix #9 — less aggressive crop)
# ══════════════════════════════════════════════════════════════════════════════

def augment(img: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if random.random() > 0.5:
        img  = np.fliplr(img).copy();   mask = np.fliplr(mask).copy()
    if random.random() > 0.7:
        img  = np.flipud(img).copy();   mask = np.flipud(mask).copy()
    k = random.randint(0, 3)
    if k:
        img  = np.rot90(img,  k).copy(); mask = np.rot90(mask, k).copy()
    # Fix #9: crop 90-100% only — floor plan topology must stay intact
    if random.random() > 0.5:
        h, w = img.shape[:2]
        frac = random.uniform(0.90, 1.0)
        ch, cw = int(h * frac), int(w * frac)
        y0 = random.randint(0, h - ch);  x0 = random.randint(0, w - cw)
        img  = cv2.resize(img [y0:y0+ch, x0:x0+cw], (w, h), interpolation=cv2.INTER_LINEAR)
        mask = cv2.resize(mask[y0:y0+ch, x0:x0+cw], (w, h), interpolation=cv2.INTER_NEAREST)
    if random.random() > 0.3:
        alpha = random.uniform(0.80, 1.20);  beta = random.uniform(-20, 20)
        img = np.clip(alpha * img.astype(np.float32) + beta, 0, 255).astype(np.uint8)
    if random.random() > 0.6:
        noise = np.random.normal(0, random.uniform(2, 6), img.shape).astype(np.float32)
        img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    if random.random() > 0.6:
        img = cv2.GaussianBlur(img, (random.choice([3, 5]),) * 2, 0)
    return img, mask


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5: DATASET
# ══════════════════════════════════════════════════════════════════════════════

class FloorPlanDataset(Dataset):
    def __init__(self, pairs: list[tuple[Path, Path]],
                 training: bool = True, cache: bool = True):
        self.training = training
        self.pairs_data: list = []
        self.n_ok = self.n_fail = self.n_skip = 0

        # image (3ch uint8) + mask (1ch uint8) per pair
        est_mb = len(pairs) * IMG_SIZE * IMG_SIZE * (3 + 1) / 1024 / 1024
        if cache and est_mb > MAX_CACHE_MB:
            log.warning(f"  RAM estimate {est_mb:.0f} MB > {MAX_CACHE_MB} MB — cache disabled")
            cache = False

        label = "train" if training else "val"
        log.info(f"  Loading {label} ({len(pairs)} pairs, cache={'on' if cache else 'off'})...")

        self.path_index: list[Path] = []   # for hard example mining reference

        for clean_path, markup_path in tqdm(pairs, desc=f"  {label}", leave=False):
            clean_img, pad_info = load_image(clean_path,  IMG_SIZE)
            markup_img, _       = load_image(markup_path, IMG_SIZE)
            if clean_img is None or markup_img is None:
                self.n_fail += 1;  continue

            # Mask cache — include markup file mtime in key so annotation changes invalidate cache
            mtime_tag  = int(markup_path.stat().st_mtime)
            cache_key  = MASK_CACHE_DIR / f"{clean_path.stem}_{IMG_SIZE}_{mtime_tag}.npy"
            if cache_key.exists():
                mask = np.load(str(cache_key))
            else:
                mask = extract_mask_from_markup(markup_img, clean_img, pad_info)
                np.save(str(cache_key), mask)
                # Remove stale cache files for same stem
                for old in MASK_CACHE_DIR.glob(f"{clean_path.stem}_{IMG_SIZE}_*.npy"):
                    if old != cache_key:
                        old.unlink(missing_ok=True)

            if not _valid(mask):
                self.n_skip += 1;  continue

            self.pairs_data.append((clean_img, mask) if cache else (clean_path, markup_path))
            self.path_index.append(clean_path)
            self.n_ok += 1

        log.info(f"  → ok={self.n_ok}  fail={self.n_fail}  skip={self.n_skip}")

    def __len__(self): return len(self.pairs_data)

    def __getitem__(self, idx):
        item = self.pairs_data[idx]
        if isinstance(item[0], Path):
            clean_path, markup_path = item
            clean_img, pad_info = load_image(clean_path,  IMG_SIZE)
            markup_img, _       = load_image(markup_path, IMG_SIZE)
            mask = extract_mask_from_markup(markup_img, clean_img, pad_info)
        else:
            clean_img, mask = item

        if self.training:
            clean_img, mask = augment(clean_img, mask)

        mean  = np.array([0.485, 0.456, 0.406], dtype=np.float32) * 255
        std   = np.array([0.229, 0.224, 0.225], dtype=np.float32) * 255
        img_t = torch.from_numpy(
            ((clean_img.astype(np.float32) - mean) / std).transpose(2, 0, 1)
        ).float()
        return img_t, torch.from_numpy(mask.astype(np.int64))


def _valid(mask: np.ndarray) -> bool:
    """
    color_green style creates only room pixels (no wall extraction).
    color_full / bw_binary create both room + wall.
    So require room OR wall — never AND — otherwise color_green pairs all get skipped.
    Only reject truly blank masks.
    """
    has_room = (mask == 1).sum() > mask.size * 0.005
    has_wall = (mask == 2).sum() > mask.size * 0.003
    return has_room or has_wall


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6: MODEL
# ══════════════════════════════════════════════════════════════════════════════

class AttentionGate(nn.Module):
    """
    Attention gate for skip connections.
    Suppresses irrelevant feature regions (furniture, text) in skip connection
    before concatenation — improves wall boundary sharpness.
    g = gating signal (from decoder), x = skip connection (from encoder).
    """
    def __init__(self, f_g: int, f_x: int, f_int: int):
        super().__init__()
        self.W_g = nn.Sequential(nn.Conv2d(f_g, f_int, 1, bias=False), nn.BatchNorm2d(f_int))
        self.W_x = nn.Sequential(nn.Conv2d(f_x, f_int, 1, bias=False), nn.BatchNorm2d(f_int))
        self.psi = nn.Sequential(nn.Conv2d(f_int, 1, 1, bias=False), nn.BatchNorm2d(1), nn.Sigmoid())
        self.relu = nn.ReLU(inplace=True)

    def forward(self, g: torch.Tensor, x: torch.Tensor) -> torch.Tensor:
        if g.shape[2:] != x.shape[2:]:
            g = nn.functional.interpolate(g, x.shape[2:], mode="bilinear", align_corners=False)
        alpha = self.psi(self.relu(self.W_g(g) + self.W_x(x)))
        return x * alpha


class SEBlock(nn.Module):
    def __init__(self, ch, r=8):
        super().__init__()
        self.sq = nn.Sequential(
            nn.AdaptiveAvgPool2d(1), nn.Flatten(),
            nn.Linear(ch, max(1, ch // r)), nn.ReLU(inplace=True),
            nn.Linear(max(1, ch // r), ch), nn.Sigmoid(),
        )
    def forward(self, x): return x * self.sq(x).view(-1, x.shape[1], 1, 1)


class ConvBnRelu(nn.Module):
    def __init__(self, ic, oc, k=3, p=1, d=1):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(ic, oc, k, padding=(d if d > 1 else p), dilation=d, bias=False),
            nn.BatchNorm2d(oc), nn.ReLU(inplace=True),
        )
    def forward(self, x): return self.net(x)


class DoubleConvSE(nn.Module):
    def __init__(self, ic, oc, drop=0.1):
        super().__init__()
        self.net = nn.Sequential(ConvBnRelu(ic, oc), ConvBnRelu(oc, oc),
                                 SEBlock(oc), nn.Dropout2d(drop))
    def forward(self, x): return self.net(x)


class ASPPBlock(nn.Module):
    def __init__(self, ch):
        super().__init__()
        mid = ch // 4
        self.branches = nn.ModuleList([
            ConvBnRelu(ch, mid, k=1, p=0),
            ConvBnRelu(ch, mid, d=3,  p=3),   # 512px: smaller dilations preserve thin walls
            ConvBnRelu(ch, mid, d=6,  p=6),
            ConvBnRelu(ch, mid, d=12, p=12),
        ])
        self.gap  = nn.Sequential(nn.AdaptiveAvgPool2d(1),
                                  nn.Conv2d(ch, mid, 1, bias=False), nn.ReLU(inplace=True))
        self.proj = nn.Sequential(nn.Conv2d(mid * 5, ch, 1, bias=False),
                                  nn.BatchNorm2d(ch), nn.ReLU(inplace=True), nn.Dropout2d(0.1))
    def forward(self, x):
        gap = nn.functional.interpolate(self.gap(x), x.shape[2:], mode="bilinear", align_corners=False)
        return self.proj(torch.cat([b(x) for b in self.branches] + [gap], 1))


class ResNetUNet(nn.Module):
    def __init__(self, n_cls=N_CLASSES):
        super().__init__()
        from torchvision.models import resnet34, ResNet34_Weights
        bb = resnet34(weights=ResNet34_Weights.DEFAULT)
        self.enc0 = nn.Sequential(bb.conv1, bb.bn1, bb.relu)
        self.pool = bb.maxpool
        self.enc1 = bb.layer1;  self.enc2 = bb.layer2
        self.enc3 = bb.layer3;  self.enc4 = bb.layer4
        self.bottleneck = ASPPBlock(512)
        # Attention gates on skip connections (suppress text/furniture noise)
        self.ag4  = AttentionGate(512, 256, 128)
        self.ag3  = AttentionGate(256, 128, 64)
        self.ag2  = AttentionGate(128, 64,  32)
        self.ag1  = AttentionGate(64,  64,  32)
        self.up4  = nn.ConvTranspose2d(512, 256, 2, stride=2);  self.dec4 = DoubleConvSE(512, 256)
        self.up3  = nn.ConvTranspose2d(256, 128, 2, stride=2);  self.dec3 = DoubleConvSE(256, 128)
        self.up2  = nn.ConvTranspose2d(128, 64,  2, stride=2);  self.dec2 = DoubleConvSE(128, 64)
        self.up1  = nn.ConvTranspose2d(64,  64,  2, stride=2);  self.dec1 = DoubleConvSE(128, 64)
        self.up0  = nn.ConvTranspose2d(64,  32,  2, stride=2);  self.dec0 = DoubleConvSE(32, 32)
        self.head      = nn.Conv2d(32, n_cls, 1)
        self.edge_head = nn.Conv2d(32, 1, 1)   # binary edge prediction
        self.ds4       = nn.Conv2d(256, n_cls, 1)
        self.ds3       = nn.Conv2d(128, n_cls, 1)

    @staticmethod
    def _fit(x, ref):
        if x.shape[2:] != ref.shape[2:]:
            x = nn.functional.interpolate(x, ref.shape[2:], mode="bilinear", align_corners=False)
        return x

    def forward(self, x):
        sz = x.shape[2:]
        e0 = self.enc0(x);  e1 = self.enc1(self.pool(e0))
        e2 = self.enc2(e1); e3 = self.enc3(e2); e4 = self.enc4(e3)
        b  = self.bottleneck(e4)
        d4 = self.dec4(torch.cat([self._fit(self.up4(b),  e3), self.ag4(b,  e3)], 1))
        d3 = self.dec3(torch.cat([self._fit(self.up3(d4), e2), self.ag3(d4, e2)], 1))
        d2 = self.dec2(torch.cat([self._fit(self.up2(d3), e1), self.ag2(d3, e1)], 1))
        d1 = self.dec1(torch.cat([self._fit(self.up1(d2), e0), self.ag1(d2, e0)], 1))
        d0 = self.dec0(self._fit(self.up0(d1), x))
        out  = self.head(d0)
        edge = self.edge_head(d0)   # (B,1,H,W) — used in training loss only
        if self.training:
            ds4 = nn.functional.interpolate(self.ds4(d4), sz, mode="bilinear", align_corners=False)
            ds3 = nn.functional.interpolate(self.ds3(d3), sz, mode="bilinear", align_corners=False)
            return out, edge, ds4, ds3
        return out


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7: LOSS & METRICS
# ══════════════════════════════════════════════════════════════════════════════

def focal_loss(logits, targets, gamma=2.0):
    ce = nn.functional.cross_entropy(logits, targets,
                                     weight=CLASS_WEIGHTS.to(logits.device), reduction="none")
    pt = torch.softmax(logits, 1).gather(1, targets.unsqueeze(1)).squeeze(1)
    return ((1 - pt) ** gamma * ce).mean()


def dice_loss(logits, targets):
    """Fix #7 — skip classes absent in this batch to avoid destabilizing loss."""
    probs = torch.softmax(logits, 1)
    loss  = 0.0;  n = 0
    for c in FG_CLASSES:
        t = (targets == c).float()
        if t.sum() == 0:
            continue          # skip absent class
        p   = probs[:, c]
        num = 2 * (p * t).sum() + 1e-6
        den = p.sum() + t.sum() + 1e-6
        loss = loss + (1 - num / den);  n += 1
    return loss / max(n, 1)


def boundary_loss(logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
    """
    Soft boundary loss — uses continuous gradient magnitude instead of hard threshold.
    Thin walls get higher weight because their gradient magnitude is concentrated.
    loss += (boundary_weight * ce).mean()  — not .sum()/boundary, avoids sparse bias.
    """
    probs   = torch.softmax(logits, 1)
    n_cls   = logits.shape[1]
    loss    = 0.0;  n = 0
    sobel_x = torch.tensor([[-1,0,1],[-2,0,2],[-1,0,1]], dtype=torch.float32,
                            device=logits.device).view(1,1,3,3)
    sobel_y = sobel_x.transpose(2, 3)

    for c in range(1, n_cls):
        t_c = (targets == c).float().unsqueeze(1)
        if t_c.sum() < 1:
            continue
        gx = nn.functional.conv2d(t_c, sobel_x, padding=1)
        gy = nn.functional.conv2d(t_c, sobel_y, padding=1)
        # Soft continuous boundary weight — no hard threshold
        boundary = torch.clamp(gx.abs() + gy.abs(), 0, 1).squeeze(1)
        p   = probs[:, c]
        ce  = -torch.log(p + 1e-6)
        loss = loss + (boundary * ce).mean()
        n   += 1

    return loss / max(n, 1)


def edge_bce_loss(edge_pred: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
    """
    Binary cross-entropy on predicted edges vs ground-truth class boundaries.
    edge_pred: (B,1,H,W) raw logits from edge_head.
    Builds GT edge map from Sobel on combined foreground mask.
    """
    sobel_x = torch.tensor([[-1,0,1],[-2,0,2],[-1,0,1]], dtype=torch.float32,
                            device=targets.device).view(1,1,3,3)
    sobel_y = sobel_x.transpose(2, 3)
    fg  = (targets > 0).float().unsqueeze(1)
    gx  = nn.functional.conv2d(fg, sobel_x, padding=1)
    gy  = nn.functional.conv2d(fg, sobel_y, padding=1)
    gt_edge = torch.clamp(gx.abs() + gy.abs(), 0, 1)
    return nn.functional.binary_cross_entropy_with_logits(edge_pred, gt_edge)


def combined_loss(logits, targets, edge=None, aux=None):
    main = (0.4 * focal_loss(logits, targets)
            + 0.4 * dice_loss(logits, targets)
            + 0.2 * boundary_loss(logits, targets))
    if edge is not None:
        main = main + 0.2 * edge_bce_loss(edge, targets)
    if aux:
        for w, a in aux:
            main = main + w * (0.5 * focal_loss(a, targets) + 0.5 * dice_loss(a, targets))
    return main


def compute_iou(logits, targets) -> dict[str, float]:
    """Fix #8 — skip classes absent in both pred and target (union=0)."""
    preds = logits.argmax(1)
    ious  = {}
    for c, name in enumerate(CLASS_NAMES):
        p = preds == c;  t = targets == c
        union = (p | t).sum().item()
        ious[name] = (p & t).sum().item() / union if union > 0 else float('nan')
    fg_vals = [ious[CLASS_NAMES[c]] for c in FG_CLASSES if not np.isnan(ious[CLASS_NAMES[c]])]
    ious["mean"] = sum(fg_vals) / len(fg_vals) if fg_vals else 0.0
    return ious


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8: CLASS WEIGHTS  (fix #3 — zero-count classes handled)
# ══════════════════════════════════════════════════════════════════════════════

def compute_class_weights(dataset: FloorPlanDataset) -> torch.Tensor:
    log.info("  Computing class weights from dataset...")
    counts = np.zeros(N_CLASSES, dtype=np.float64)
    for item in dataset.pairs_data:
        mask = item[1] if isinstance(item[0], np.ndarray) else None
        if mask is None:
            continue
        for c in range(N_CLASSES):
            counts[c] += (mask == c).sum()

    total = counts.sum()
    freq  = counts / (total + 1e-9)

    # Fix #3 — if a class has < 100 pixels in entire dataset, set weight = 0
    # (no examples → can't learn it, don't penalise for missing it)
    MIN_PIXELS = 100
    weights = np.ones(N_CLASSES, dtype=np.float64)
    fg_freqs = []
    for c in FG_CLASSES:
        if counts[c] < MIN_PIXELS:
            weights[c] = 0.0
            log.info(f"  Class {CLASS_NAMES[c]} has < {MIN_PIXELS} pixels — weight set to 0")
        else:
            fg_freqs.append(freq[c])

    if fg_freqs:
        med_freq = np.median(fg_freqs)
        for c in FG_CLASSES:
            if counts[c] >= MIN_PIXELS:
                weights[c] = med_freq / freq[c]

    # Normalise so room = 1.0; fallback to max if room absent
    ref = weights[1] if weights[1] > 0 else max(weights.max(), 1.0)
    weights = weights / ref
    weights = np.clip(weights, 0.0, 8.0)   # raised cap — rare classes need higher weight
    weights[0] = 0.05  # background always low

    log.info("  Pixel freq : " + "  ".join(f"{CLASS_NAMES[c]}={freq[c]*100:.1f}%" for c in range(N_CLASSES)))
    log.info("  Weights    : " + "  ".join(f"{CLASS_NAMES[c]}={weights[c]:.2f}"   for c in range(N_CLASSES)))
    return torch.tensor(weights, dtype=torch.float32)


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 9: TRAINING LOOP
# ══════════════════════════════════════════════════════════════════════════════

def train_epoch(model, loader, opt, sched, device, scaler=None):
    model.train()
    total_loss = 0.0
    agg = {k: 0.0 for k in CLASS_NAMES + ["mean"]}
    cnt = {k: 0   for k in CLASS_NAMES + ["mean"]}
    n   = 0
    use_amp = scaler is not None and device == "cuda"
    total_batches = len(loader)

    for batch_idx, (imgs, masks) in enumerate(loader, 1):
        imgs, masks = imgs.to(device), masks.to(device)
        opt.zero_grad()
        ctx = torch.autocast("cuda", enabled=True) if use_amp else torch.autocast("cpu", enabled=False)
        with ctx:
            out = model(imgs)
            if isinstance(out, tuple):
                logits, edge, ds4, ds3 = out
                loss = combined_loss(logits, masks, edge=edge, aux=[(0.25, ds4), (0.10, ds3)])
            else:
                logits = out
                loss   = combined_loss(logits, masks)
        if use_amp:
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt);  scaler.update()
        else:
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        if sched: sched.step()
        total_loss += loss.item()
        with torch.no_grad():
            for k, v in compute_iou(logits.detach(), masks).items():
                if not np.isnan(v):
                    agg[k] += v;  cnt[k] += 1
        n += 1
        
        # Print progress every 50 batches to show training is alive
        if batch_idx % 50 == 0 or batch_idx == total_batches:
            avg_loss = total_loss / n
            print(f"    Batch {batch_idx}/{total_batches} — loss={avg_loss:.4f}", flush=True)

    for k in agg:
        agg[k] = agg[k] / cnt[k] if cnt[k] > 0 else float('nan')
    return total_loss / max(n, 1), agg


@torch.no_grad()
def val_epoch(model, loader, device):
    """Validation with TTA: average original + horizontal flip predictions."""
    model.eval()
    total_loss = 0.0
    agg = {k: 0.0 for k in CLASS_NAMES + ["mean"]}
    cnt = {k: 0   for k in CLASS_NAMES + ["mean"]}
    n   = 0
    for imgs, masks in loader:
        imgs, masks = imgs.to(device), masks.to(device)
        orig_sz = imgs.shape[2:]

        # Multi-scale TTA: 0.75x, 1.0x, 1.25x + horizontal flip at each scale
        tta_probs = []
        for scale in [0.75, 1.0, 1.25]:
            sz  = (int(orig_sz[0]*scale), int(orig_sz[1]*scale))
            inp = nn.functional.interpolate(imgs, sz, mode="bilinear", align_corners=False)
            # Original orientation
            p   = torch.softmax(model(inp), 1)
            p   = nn.functional.interpolate(p, orig_sz, mode="bilinear", align_corners=False)
            tta_probs.append(p)
            # Horizontal flip
            pf  = torch.softmax(model(torch.flip(inp, [3])), 1)
            pf  = nn.functional.interpolate(pf, orig_sz, mode="bilinear", align_corners=False)
            tta_probs.append(torch.flip(pf, [3]))

        logits1 = model(imgs)   # original pass for loss
        logits  = sum(tta_probs) / len(tta_probs)
        loss    = combined_loss(logits1, masks)
        total_loss += loss.item()
        for k, v in compute_iou(logits, masks).items():
            if not np.isnan(v):
                agg[k] += v;  cnt[k] += 1
        n += 1
    for k in agg:
        agg[k] = agg[k] / cnt[k] if cnt[k] > 0 else float('nan')
    return total_loss / max(n, 1), agg


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 10: MAIN
# ══════════════════════════════════════════════════════════════════════════════

@torch.no_grad()
def _compute_sample_weights(model, dataset, device) -> np.ndarray:
    """
    Hard Example Mining: run model on every training sample, compute mean IoU.
    Samples with low IoU get higher weight → sampled more often next N epochs.
    Weight = 1 + (1 - sample_iou)  →  range [1, 2].
    """
    model.eval()
    weights = np.ones(len(dataset), dtype=np.float32)
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32) * 255
    std  = np.array([0.229, 0.224, 0.225], dtype=np.float32) * 255

    for i, item in enumerate(dataset.pairs_data):
        if isinstance(item[0], np.ndarray):
            img, mask = item
        else:
            clean_p, markup_p = item
            img, pad = load_image(clean_p, IMG_SIZE)
            mimg, _  = load_image(markup_p, IMG_SIZE)
            mask     = extract_mask_from_markup(mimg, img, pad)

        img_t  = torch.from_numpy(
            ((img.astype(np.float32) - mean) / std).transpose(2, 0, 1)
        ).float().unsqueeze(0).to(device)
        mask_t = torch.from_numpy(mask.astype(np.int64)).unsqueeze(0).to(device)
        logits = model(img_t)
        iou    = compute_iou(logits, mask_t)
        miou   = iou["mean"] if not np.isnan(iou["mean"]) else 0.5
        weights[i] = 1.0 + (1.0 - miou)   # hard samples: weight up to 2.0

    model.train()
    return weights


def main():
    log.info("=" * 65)
    log.info("  ██████╗ ██╗███╗   ███╗██████╗  ██████╗ ███████╗███████╗")
    log.info("  ██╔══██╗██║████╗ ████║██╔══██╗██╔═══██╗██╔════╝██╔════╝")
    log.info("  ██████╔╝██║██╔████╔██║██████╔╝██║   ██║███████╗███████╗")
    log.info("  ██╔══██╗██║██║╚██╔╝██║██╔══██╗██║   ██║╚════██║╚════██║")
    log.info("  ██████╔╝██║██║ ╚═╝ ██║██████╔╝╚██████╔╝███████║███████║")
    log.info("=" * 65)
    log.info("  Floor Plan Segmentation  v3.1  —  Color-Annotated Masks")
    log.info(f"  Device   : {DEVICE}  |  IMG_SIZE : {IMG_SIZE}  |  Batch : {BATCH}")
    log.info(f"  Classes  : {', '.join(CLASS_NAMES)}")
    log.info(f"  Epochs   : {EPOCHS}  |  LR : {LR}  |  Seed : {SEED}")
    log.info("=" * 65)

    all_pairs = collect_pairs()
    if len(all_pairs) < 4:
        log.error("Not enough paired images.")
        sys.exit(1)

    # Fix #4 — stratified split by annotation style
    train_p, val_p = _stratified_split(all_pairs, VAL_FRAC)
    log.info(f"  Train : {len(train_p)}  |  Val : {len(val_p)}")

    train_ds = FloorPlanDataset(train_p, training=True,  cache=True)
    val_ds   = FloorPlanDataset(val_p,   training=False, cache=True)

    if len(train_ds) < 2:
        log.error("Too few valid pairs. Check annotation colors.")
        sys.exit(1)

    # Door/Window pixel count warning
    counts = np.zeros(N_CLASSES, dtype=np.int64)
    for item in train_ds.pairs_data:
        if isinstance(item[0], np.ndarray):
            for c in range(N_CLASSES):
                counts[c] += (item[1] == c).sum()
    MIN_WARN = 5000
    for c in [3, 4]:
        if counts[c] < MIN_WARN:
            log.warning(f"  ⚠ {CLASS_NAMES[c]} has only {counts[c]:,} pixels in train set "
                        f"(< {MIN_WARN:,}) — IoU will be near 0. "
                        f"Add more color_full annotated images to improve.")

    def multiscale_collate(batch):
        """Randomly resize entire batch to one of TRAIN_SCALES."""
        imgs, masks = zip(*batch)
        size = random.choice(TRAIN_SCALES)
        imgs_r  = torch.stack([
            nn.functional.interpolate(i.unsqueeze(0), size=(size, size),
                                      mode="bilinear", align_corners=False).squeeze(0)
            for i in imgs
        ])
        masks_r = torch.stack([
            nn.functional.interpolate(m.float().unsqueeze(0).unsqueeze(0),
                                      size=(size, size), mode="nearest").squeeze().long()
            for m in masks
        ])
        return imgs_r, masks_r

    train_dl = DataLoader(train_ds, batch_size=BATCH, shuffle=True,
                          num_workers=0, pin_memory=(DEVICE == "cuda"),
                          collate_fn=multiscale_collate)
    val_dl   = DataLoader(val_ds,   batch_size=1,     shuffle=False,
                          num_workers=0, pin_memory=(DEVICE == "cuda"))

    model    = ResNetUNet(n_cls=N_CLASSES).to(DEVICE)
    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    log.info(f"  Model params : {n_params/1e6:.2f}M  (ResNet34 pretrained)")

    best_miou   = 0.0
    start_epoch = 1
    history     = []

    if CKPT.exists():
        try:
            ckpt = torch.load(str(CKPT), map_location=DEVICE, weights_only=False)
            model.load_state_dict(ckpt.get("model_state", ckpt), strict=False)
            best_miou = ckpt.get("miou", 0.0)
            # Fix #5 — epochs_done tells us how many are complete; remaining = EPOCHS - epochs_done
            epochs_done = ckpt.get("epoch", 0)
            if epochs_done >= EPOCHS:
                log.info(f"  Training already completed ({EPOCHS} epochs done). Delete checkpoint to retrain.")
                return
            start_epoch = epochs_done + 1
            remaining   = EPOCHS - epochs_done
            log.info(f"  Resumed epoch {start_epoch}  best mIoU {best_miou*100:.1f}%  "
                     f"remaining: {remaining} epochs")
        except RuntimeError:
            CKPT.unlink(missing_ok=True)
            log.info("  Checkpoint incompatible — starting fresh")
    else:
        log.info("  Training from scratch")
        remaining = EPOCHS

    if HIST_FILE.exists():
        history = json.loads(HIST_FILE.read_text())

    global CLASS_WEIGHTS
    CLASS_WEIGHTS = compute_class_weights(train_ds)

    opt   = optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    sched = optim.lr_scheduler.OneCycleLR(
        opt, max_lr=LR, steps_per_epoch=len(train_dl), epochs=remaining,
        pct_start=0.1, anneal_strategy="cos", div_factor=10, final_div_factor=100,
    )
    scaler = torch.amp.GradScaler("cuda", enabled=(DEVICE == "cuda"))
    log.info(f"  AMP : {'on' if DEVICE == 'cuda' else 'off (CPU)'}  |  Remaining epochs: {remaining}")

    hdr = (f"  {'Ep':>4} | {'TLoss':>7} | {'VLoss':>7} | "
           f"{'room':>5} | {'wall':>5} | {'door':>5} | {'win':>5} | "
           f"{'mIoU*':>6} | {'Time':>8} | ETA")
    log.info(hdr)
    log.info("  * mIoU = foreground (room+wall+door+window), background excluded")
    log.info("  " + "-" * 100)

    PATIENCE = 25;  no_improve = 0;  epoch_times = [];  t_start = _time.time()
    # Hard example mining: track sample-level IoU; low-IoU samples get 2x weight
    sample_weights = np.ones(len(train_ds), dtype=np.float32)
    HEM_EVERY = 20   # update hard examples every N epochs (10 was too expensive)

    for epoch in range(start_epoch, start_epoch + remaining):
        t0 = _time.time()

        # Hard Example Mining: every HEM_EVERY epochs, recompute per-sample IoU
        # and create a weighted sampler so hard samples appear 2x more often
        if epoch > start_epoch and (epoch - start_epoch) % HEM_EVERY == 0:
            sample_weights = _compute_sample_weights(model, train_ds, DEVICE)
            from torch.utils.data import WeightedRandomSampler
            sampler   = WeightedRandomSampler(sample_weights, len(sample_weights))
            train_dl  = DataLoader(train_ds, batch_size=BATCH, sampler=sampler,
                                   num_workers=0, pin_memory=(DEVICE=="cuda"),
                                   collate_fn=multiscale_collate)

        t_loss, _     = train_epoch(model, train_dl, opt, sched, DEVICE, scaler)
        v_loss, v_iou = val_epoch(model, val_dl, DEVICE)
        elapsed = _time.time() - t0
        epoch_times.append(elapsed)

        epochs_left = (start_epoch + remaining) - epoch - 1
        eta = str(timedelta(seconds=int((sum(epoch_times) / len(epoch_times)) * epochs_left)))
        miou     = v_iou["mean"]      if not np.isnan(v_iou["mean"])      else 0.0
        wall_iou = v_iou["wall"]      if not np.isnan(v_iou.get("wall", float('nan'))) else 0.0
        # Score = 50% mIoU + 50% wall_iou — wall is most important for floor plans
        score = 0.5 * miou + 0.5 * wall_iou
        saved = ""

        if score > best_miou:
            best_miou = score;  no_improve = 0
            torch.save({
                "model_state": model.state_dict(), "epoch": epoch,
                "miou": miou, "wall_iou": wall_iou, "score": score,
                "arch": "BIMBOSS-ResNet34-UNet-v3.2", "img_size": IMG_SIZE,
                "n_classes": N_CLASSES, "class_names": CLASS_NAMES, "iou_per_cls": v_iou,
            }, str(CKPT))
            # Auto-backup to Google Drive (Colab disconnect se bachao)
            if DRIVE_BACKUP is not None:
                try:
                    import shutil
                    DRIVE_BACKUP.mkdir(parents=True, exist_ok=True)
                    shutil.copy(str(CKPT), str(DRIVE_BACKUP / "floor_plan_model.pth"))
                    shutil.copy(str(HIST_FILE), str(DRIVE_BACKUP / "retrain_history.json")) if HIST_FILE.exists() else None
                except Exception:
                    pass
            saved = "  ✓ (Drive backup)"
        else:
            no_improve += 1

        def _fmt(v): return f"{v:5.3f}" if not np.isnan(v) else "  n/a"

        log.info(
            f"  {epoch:4d} | {t_loss:7.4f} | {v_loss:7.4f} | "
            f"{_fmt(v_iou['room'])} | {_fmt(v_iou['wall'])} | "
            f"{_fmt(v_iou['door'])} | {_fmt(v_iou['window'])} | "
            f"{miou:6.3f} | {str(timedelta(seconds=int(elapsed))):>8} | {eta}{saved}"
        )
        history.append({
            "epoch": epoch, "t_loss": round(t_loss, 6), "v_loss": round(v_loss, 6),
            "miou": round(miou, 6),
            **{f"{k}_iou": round(v, 6) if not np.isnan(v) else 0.0
               for k, v in v_iou.items() if k != "mean"},
        })
        HIST_FILE.write_text(json.dumps(history, indent=2))

        if no_improve >= PATIENCE:
            log.info(f"\n  Early stop — no improvement for {PATIENCE} epochs")
            break

    log.info(f"\n  Total time : {str(timedelta(seconds=int(_time.time() - t_start)))}")
    log.info("=" * 65)
    log.info(f"  DONE  |  Best mIoU : {best_miou:.4f}  |  Model : {CKPT}")
    log.info("=" * 65)

    # ONNX export for production deployment
    onnx_path = SAVE_DIR / "floor_plan_model.onnx"
    try:
        if CKPT.exists():
            ckpt = torch.load(str(CKPT), map_location="cpu", weights_only=False)
            export_model = ResNetUNet(n_cls=N_CLASSES)
            export_model.load_state_dict(ckpt["model_state"], strict=False)
            export_model.eval()
            dummy = torch.zeros(1, 3, IMG_SIZE, IMG_SIZE)
            torch.onnx.export(
                export_model, dummy, str(onnx_path),
                input_names=["image"], output_names=["segmentation"],
                opset_version=17,
                dynamic_axes={"image": {0: "batch", 2: "height", 3: "width"},
                              "segmentation": {0: "batch", 2: "height", 3: "width"}},
            )
            log.info(f"  ONNX exported → {onnx_path}")
    except Exception as e:
        log.warning(f"  ONNX export failed (non-critical): {e}")


if __name__ == "__main__":
    main()
