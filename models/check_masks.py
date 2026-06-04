"""Check ground truth masks to diagnose why model predicts too much 'room'"""
import numpy as np
from pathlib import Path

cache_dir = Path(__file__).parent / "model_output" / "mask_cache"
files = sorted(cache_dir.glob("*.npy"))

print(f"Total cached masks: {len(files)}")
print()

room_pcts, wall_pcts, bg_pcts = [], [], []

for f in files[:100]:
    m = np.load(str(f))
    total = m.size
    bg   = (m==0).sum() / total * 100
    room = (m==1).sum() / total * 100
    wall = (m==2).sum() / total * 100
    room_pcts.append(room)
    wall_pcts.append(wall)
    bg_pcts.append(bg)

print(f"Avg background : {sum(bg_pcts)/len(bg_pcts):.1f}%")
print(f"Avg room       : {sum(room_pcts)/len(room_pcts):.1f}%")
print(f"Avg wall       : {sum(wall_pcts)/len(wall_pcts):.1f}%")
print()

# Show extreme cases
room_high = [(r, f) for r, f in zip(room_pcts, files[:100]) if r > 60]
print(f"Masks with room > 60%: {len(room_high)}")
for r, f in sorted(room_high, reverse=True)[:5]:
    print(f"  {f.name[:40]}  room={r:.0f}%")

print()
print("Sample masks (first 10):")
for f, r, w, b in zip(files[:10], room_pcts[:10], wall_pcts[:10], bg_pcts[:10]):
    print(f"  {f.name[:35]:35s}  bg={b:.0f}%  room={r:.0f}%  wall={w:.0f}%")
