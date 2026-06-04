"""
Quick test — epoch 1 model pe 5 images run karo, output save karo
Usage: python models/quick_test.py
"""
import sys, os
from pathlib import Path

import cv2
import numpy as np
import torch

BASE      = Path(__file__).parent
sys.path.insert(0, str(BASE))

CKPT      = BASE / "model_output" / "floor_plan_model.pth"
IMG_DIR   = BASE / "Dataset" / "WITHOUT MARKUP"
OUT_DIR   = BASE / "model_output" / "quick_test_output"
OUT_DIR.mkdir(exist_ok=True)

IMG_SIZE  = 512
N_CLASSES = 5
DEVICE    = "cuda" if torch.cuda.is_available() else "cpu"

# Class colors (BGR for cv2)  background=white, room=teal, wall=gray, door=yellow, window=green
COLORS = {
    0: (255, 255, 255),   # background — white
    1: (180, 200,  80),   # room       — teal
    2: (130, 130, 130),   # wall       — gray
    3: (  0, 220, 255),   # door       — yellow
    4: (  0, 200,  80),   # window     — green
}
NAMES = ["background", "room", "wall", "door", "window"]

# ── Load model ────────────────────────────────────────────────────────────────
print(f"Device: {DEVICE}")
print(f"Loading checkpoint: {CKPT}")

# Import model arch from training script
from Model_training import ResNetUNet, load_image

ckpt = torch.load(str(CKPT), map_location=DEVICE)
model = ResNetUNet(N_CLASSES).to(DEVICE)
state = ckpt.get("model_state", ckpt)
model.load_state_dict(state, strict=False)
model.eval()
print("Model loaded OK\n")

# ── Pick 5 test images ────────────────────────────────────────────────────────
imgs = sorted(IMG_DIR.glob("*.png"))[:5]
if not imgs:
    imgs = sorted(IMG_DIR.glob("*.jpg"))[:5]
if not imgs:
    print("No images found in WITHOUT MARKUP/")
    sys.exit(1)

mean = np.array([0.485, 0.456, 0.406], dtype=np.float32) * 255
std  = np.array([0.229, 0.224, 0.225], dtype=np.float32) * 255

for img_path in imgs:
    print(f"Running: {img_path.name}")
    img_rgb, pad_info = load_image(img_path, IMG_SIZE)
    if img_rgb is None:
        print(f"  SKIP — load failed")
        continue

    # Preprocess
    inp = ((img_rgb.astype(np.float32) - mean) / std).transpose(2, 0, 1)
    inp_t = torch.from_numpy(inp).unsqueeze(0).float().to(DEVICE)

    with torch.no_grad():
        out = model(inp_t)           # (1, 5, H, W)
    pred = out.argmax(1).squeeze(0).cpu().numpy()   # (H, W) — argmax across all classes

    # Build color mask
    color_mask = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
    for cls_id, color in COLORS.items():
        color_mask[pred == cls_id] = color

    # Blend: original (60%) + mask (40%)
    orig_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    blended  = cv2.addWeighted(orig_bgr, 0.55, color_mask, 0.45, 0)

    # Stats
    total = pred.size
    print(f"  Prediction breakdown:")
    for c in range(N_CLASSES):
        pct = (pred == c).sum() / total * 100
        print(f"    {NAMES[c]:12s}: {pct:5.1f}%")

    # Add legend to image
    legend_h = 30 * N_CLASSES + 10
    legend = np.ones((legend_h, IMG_SIZE, 3), dtype=np.uint8) * 40
    for i, (name, (b, g, r)) in enumerate(zip(NAMES, [COLORS[c] for c in range(N_CLASSES)])):
        pct = (pred == i).sum() / total * 100
        cv2.rectangle(legend, (5, i*30+5), (25, i*30+25), (b, g, r), -1)
        cv2.putText(legend, f"{name}: {pct:.1f}%", (32, i*30+21),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1)

    final = np.vstack([blended, legend])

    out_path = OUT_DIR / f"pred_{img_path.stem}.jpg"
    cv2.imwrite(str(out_path), final)
    print(f"  Saved → {out_path}\n")

print(f"Done. Output in: {OUT_DIR}")
