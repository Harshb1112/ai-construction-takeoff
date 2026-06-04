"""Debug: show raw softmax probabilities per class to understand what model actually outputs"""
import sys
from pathlib import Path
import cv2
import numpy as np
import torch

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from Model_training import ResNetUNet, load_image

CKPT = BASE / "model_output" / "floor_plan_model.pth"
IMG_SIZE = 512
NAMES = ["background", "room", "wall", "door", "window"]

ckpt  = torch.load(str(CKPT), map_location="cpu")
model = ResNetUNet(5)
model.load_state_dict(ckpt.get("model_state", ckpt), strict=False)
model.eval()

mean = np.array([0.485, 0.456, 0.406], dtype=np.float32) * 255
std  = np.array([0.229, 0.224, 0.225], dtype=np.float32) * 255

img_dir = BASE / "Dataset" / "WITHOUT MARKUP"
imgs = sorted(img_dir.glob("*.jpg"))[:3] + sorted(img_dir.glob("*.png"))[:3]
imgs = [x for x in imgs if x.exists()][:3]

for img_path in imgs:
    img_rgb, _ = load_image(img_path, IMG_SIZE)
    if img_rgb is None: continue

    inp = ((img_rgb.astype(np.float32) - mean) / std).transpose(2, 0, 1)
    inp_t = torch.from_numpy(inp).unsqueeze(0).float()

    with torch.no_grad():
        out = model(inp_t)  # (1, 5, H, W)

    probs = torch.softmax(out, dim=1)[0]  # (5, H, W)
    pred  = out.argmax(1)[0]              # (H, W)

    total = pred.numel()
    print(f"\n{img_path.name}:")
    print(f"  argmax class distribution:")
    for c, name in enumerate(NAMES):
        pct = (pred == c).sum().item() / total * 100
        avg_prob = probs[c].mean().item() * 100
        print(f"    {name:12s}: argmax={pct:5.1f}%   avg_prob={avg_prob:5.1f}%")

    # Show per-pixel confidence of winning class
    max_probs = probs.max(dim=0).values  # confidence of argmax
    print(f"  Mean confidence of prediction: {max_probs.mean().item()*100:.1f}%")
    print(f"  Pixels with conf < 50%: {(max_probs < 0.5).sum().item() / total * 100:.1f}%")
    print(f"  → Model is {'UNCERTAIN (early training)' if max_probs.mean().item() < 0.7 else 'confident'}")
