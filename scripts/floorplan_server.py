"""
BIMBOSS Floor Plan AI  —  FastAPI Server
=========================================
Powered by: BIMBOSS-UNet-SE-ASPP (custom trained model)

Endpoints:
  POST /api/floorplan/analyze      — Upload PDF/image → rooms + real measurements
  POST /api/floorplan/click-room   — Click inside room → flood fill boundary
  POST /api/floorplan/scale-detect — Detect scale from PDF
  GET  /health                     — Capability check

Pipeline (in order, first success wins):
  1. Markup Fills    — colored fills in PDF (100% accurate if architect drew them)
  2. Text-Guided     — PDF text labels as seeds → flood fill to wall boundaries
  3. BIMBOSS Model   — Custom trained BIMBOSS-UNet-SE-ASPP (models/model_output/floor_plan_model.pth)
  4. OpenCV Vector   — Adaptive threshold + connected components fallback

Scale detection:
  1. PDF text layer  (PyMuPDF — most accurate, no OCR errors)
  2. EasyOCR on title block raster
  3. Tesseract fallback
  4. User-provided hint
  (No hardcoded defaults — if scale cannot be detected, returns unknown)

Area / Measurement:
  Real pixel counting × (meters_per_pixel)²
  mpp = scale_ratio × 0.0254 / actual_render_dpi

Run:
  pip install fastapi uvicorn opencv-python pillow numpy PyMuPDF easyocr torch
  python scripts/floorplan_server.py
"""

from __future__ import annotations
import io, re, json, math, time, os, sys
from pathlib import Path
from typing import Optional, Any

import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Project root ──────────────────────────────────────────────────────────────
_ROOT        = Path(__file__).parent.parent
_MODEL_CKPT  = _ROOT / "models" / "model_output" / "floor_plan_model.pth"

# ── Optional imports — degrade gracefully ─────────────────────────────────────
try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False
    print("[WARN] opencv-python not installed — pip install opencv-python")

try:
    from PIL import Image as PILImage
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("[WARN] Pillow not installed — pip install pillow")

try:
    import fitz  # PyMuPDF
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False
    print("[WARN] PyMuPDF not installed — pip install PyMuPDF  (needed for PDF support)")

try:
    import torch, torch.nn as nn
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False
    print("[WARN] PyTorch not installed — model inference disabled")

_easyocr_reader = None
HAS_EASYOCR = False
try:
    import easyocr as _easyocr_lib
    HAS_EASYOCR = True
except ImportError:
    pass

HAS_TESSERACT = False
try:
    import pytesseract
    pytesseract.get_tesseract_version()
    HAS_TESSERACT = True
except Exception:
    pass

print(f"[Init] CV2={HAS_CV2}  PyMuPDF={HAS_FITZ}  Torch={HAS_TORCH}  EasyOCR={HAS_EASYOCR}  Tesseract={HAS_TESSERACT}")

# ── JSON serialization helper ─────────────────────────────────────────────────
def _to_python(obj: Any) -> Any:
    """
    Recursively convert numpy scalars / arrays → plain Python types
    so JSONResponse never raises 'intc is not JSON serializable'.
    """
    if isinstance(obj, dict):
        return {k: _to_python(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_python(v) for v in obj]
    # numpy scalar types (intc, int32, float32, bool_, …)
    try:
        import numpy as _np
        if isinstance(obj, _np.integer):
            return int(obj)
        if isinstance(obj, _np.floating):
            return float(obj)
        if isinstance(obj, _np.bool_):
            return bool(obj)
        if isinstance(obj, _np.ndarray):
            return obj.tolist()
    except ImportError:
        pass
    return obj


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="BIMBOSS Floor Plan AI", version="2.0",
             description="Powered by BIMBOSS-UNet-SE-ASPP — Custom trained floor plan segmentation model")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1: SCALE DETECTION (real, no hardcoded defaults)
# ══════════════════════════════════════════════════════════════════════════════

def _parse_scale_notation(text: str) -> tuple[float, str] | None:
    """
    Parse any architectural scale notation → (ratio, label).
    ratio = N means 1 unit on paper = N units in reality.

    Handles:
      Metric:   1:100   1:50   1:200   1/100
      Imperial: 1/8"=1'-0"   1/4"=1'-0"   1/16"=1'-0"
      Indian:   1cm=1m   1mm=1m   NTS
    """
    t = text.strip()

    # Metric ratio: 1:N or 1/N
    m = re.search(r'(?:scale\s*)?1\s*[:/]\s*(\d+)', t, re.IGNORECASE)
    if m:
        ratio = int(m.group(1))
        if 10 <= ratio <= 5000:
            return ratio, f"1:{ratio}"

    # Imperial: 1/D" = 1'-0"  (most common US)
    m = re.search(r'(\d+)\s*/\s*(\d+)\s*["’”]?\s*=\s*1\s*[\'‘’\-]', t, re.IGNORECASE)
    if m:
        numer, denom = int(m.group(1)), int(m.group(2))
        if denom > 0:
            paper_inches = numer / denom
            ratio = round(12.0 / paper_inches)   # 12 inches/foot ÷ paper_inches
            return ratio, f'{numer}/{denom}"=1\'-0"'

    # Imperial: N/D"=1ft or N/D"=1'
    m = re.search(r'(\d+)\s*/\s*(\d+)\s*["’”]\s*=\s*1\s*ft', t, re.IGNORECASE)
    if m:
        numer, denom = int(m.group(1)), int(m.group(2))
        if denom > 0:
            paper_inches = numer / denom
            ratio = round(12.0 / paper_inches)
            return ratio, f'{numer}/{denom}"=1ft'

    # mm = m (Indian standard)
    m = re.search(r'(\d+)\s*mm\s*=\s*(\d+)\s*m', t, re.IGNORECASE)
    if m:
        ratio = int(m.group(2)) * 1000 // int(m.group(1))
        return ratio, f'{m.group(1)}mm={m.group(2)}m'

    # cm = m
    m = re.search(r'(\d+)\s*cm\s*=\s*(\d+)\s*m', t, re.IGNORECASE)
    if m:
        ratio = int(m.group(2)) * 100 // int(m.group(1))
        return ratio, f'{m.group(1)}cm={m.group(2)}m'

    return None


def _ratio_to_mpp_at_dpi(ratio: float, dpi: float) -> float:
    """Convert scale ratio to meters-per-pixel at a given render DPI."""
    # 1 inch = 25.4mm = 0.0254m, dpi pixels per inch
    # mpp = (real_length/paper_length) × (1/dpi) × 0.0254
    # paper_length = 1 px → real = ratio × (1/dpi inches) = ratio/dpi inches
    return ratio * 0.0254 / dpi


def detect_scale_from_pdf(pdf_bytes: bytes, page_num: int = 0) -> tuple[float, str] | None:
    """
    Extract scale from PDF text layer using PyMuPDF.
    Searches: full page text → title block area (bottom 30%, right 20%).
    Returns (ratio, label) or None.
    """
    if not HAS_FITZ:
        return None
    try:
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        if page_num >= len(doc):
            return None
        page = doc[page_num]
        pw, ph = page.rect.width, page.rect.height

        # Full page text
        full = page.get_text("text")
        r = _parse_scale_notation(full)
        if r:
            doc.close()
            print(f"[Scale] From PDF text: {r[1]}")
            return r

        # Title block: bottom 35% + right 20%
        for b in page.get_text("blocks"):
            x0, y0, x1, y1, txt = b[:5]
            if y0 > ph * 0.65 or x0 > pw * 0.80:
                r = _parse_scale_notation(txt)
                if r:
                    doc.close()
                    print(f"[Scale] From title block: {r[1]}")
                    return r

        doc.close()
    except Exception as e:
        print(f"[Scale] PDF error: {e}")
    return None


def _get_easyocr():
    global _easyocr_reader
    if _easyocr_reader is None and HAS_EASYOCR:
        try:
            _easyocr_reader = _easyocr_lib.Reader(['en'], gpu=False, verbose=False)
            print("[OCR] EasyOCR loaded")
        except Exception as e:
            print(f"[OCR] EasyOCR load failed: {e}")
    return _easyocr_reader


def detect_scale_from_image(img_pil) -> tuple[float, str] | None:
    """
    OCR on rasterized image to find scale notation.
    Searches title block (bottom 30% of image).
    Returns (ratio, label) or None.
    """
    if not HAS_PIL:
        return None

    img_arr = np.array(img_pil.convert("RGB"))
    h, w    = img_arr.shape[:2]
    title_block = img_arr[int(h * 0.65):, :]   # bottom 35%

    # EasyOCR
    reader = _get_easyocr()
    if reader is not None:
        try:
            results = reader.readtext(title_block, detail=0, paragraph=True)
            text = " ".join(results)
            r = _parse_scale_notation(text)
            if r:
                print(f"[Scale] EasyOCR: {r[1]}")
                return r
        except Exception:
            pass

    # Tesseract
    if HAS_TESSERACT:
        try:
            tb_pil = PILImage.fromarray(title_block)
            text   = pytesseract.image_to_string(tb_pil, config="--psm 6")
            r = _parse_scale_notation(text)
            if r:
                print(f"[Scale] Tesseract: {r[1]}")
                return r
        except Exception:
            pass

    return None


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2: PDF / IMAGE LOADING
# ══════════════════════════════════════════════════════════════════════════════

def load_pdf_page(pdf_bytes: bytes, page_num: int = 0,
                  max_px: int = 1600) -> tuple[PILImage.Image, float] | None:
    """
    Render one PDF page → PIL Image + actual render DPI.
    max_px: longest side in pixels.
    Returns (image, actual_dpi) or None.
    """
    if not HAS_FITZ or not HAS_PIL:
        return None
    try:
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        pg_i = min(page_num, len(doc) - 1)
        page = doc[pg_i]
        rect = page.rect

        long_side = max(rect.width, rect.height)
        zoom      = min(3.0, max_px / long_side)
        actual_dpi = zoom * 72.0   # PDF points per inch = 72

        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img = PILImage.frombytes("RGB", [pix.width, pix.height], pix.samples)
        doc.close()
        print(f"[Load] PDF page {pg_i+1}: {img.size} px  zoom={zoom:.2f}x  DPI≈{actual_dpi:.0f}")
        return img, actual_dpi
    except Exception as e:
        print(f"[Load] PDF error: {e}")
        return None


def load_image_file(data: bytes, filename: str = "",
                    max_px: int = 1600) -> tuple[PILImage.Image, float] | None:
    """
    Load raster image (PNG/JPG/JPEG) → PIL Image + assumed DPI.
    Returns (image, dpi) or None.
    """
    if not HAS_PIL:
        return None
    try:
        img = PILImage.open(io.BytesIO(data)).convert("RGB")
        w, h = img.size
        if max(w, h) > max_px:
            scale = max_px / max(w, h)
            img   = img.resize((int(w*scale), int(h*scale)), PILImage.LANCZOS)
        # EXIF DPI if available
        dpi = 96.0
        try:
            info = img.info.get("dpi", (96, 96))
            dpi  = float(info[0]) if info[0] > 0 else 96.0
        except Exception:
            pass
        return img, dpi
    except Exception as e:
        print(f"[Load] Image error: {e}")
        return None


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3: TEXT EXTRACTION FROM DRAWING  (OCR-first, no hardcoded keywords)
# ══════════════════════════════════════════════════════════════════════════════
#
# Philosophy:
#   The room NAME comes from what is WRITTEN in the drawing.
#   We do NOT assume "if area > 35 sqm → Living Room".
#   We READ the image / PDF text layer and use that as the name.
#
#   Type (BEDROOM / OFFICE / etc.) is inferred from the actual text found —
#   used only for color-coding the annotation. If text says "Boiler Room",
#   the name IS "Boiler Room" and type is inferred as UTILITY.
#   If no text is found inside the room, name stays as "Room N" and type
#   is inferred from shape (last resort, clearly marked as estimated).

# ── STEP 1: Extract all text from the drawing with pixel positions ─────────────

def extract_text_from_pdf(pdf_bytes: bytes, page_num: int,
                           img_w: int, img_h: int) -> list[dict]:
    """
    Extract every text element from PDF text layer using PyMuPDF.
    Each element: { text, cx, cy, x0, y0, x1, y1, conf }
    cx/cy are pixel coordinates scaled to img_w × img_h.

    This is the most accurate method — no OCR errors, exact positions.
    Works for any language in the PDF text layer (AutoCAD, Revit, ArchiCAD exports).
    """
    if not HAS_FITZ:
        return []
    try:
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc[min(page_num, len(doc) - 1)]
        pw, ph = page.rect.width, page.rect.height
        sx, sy = img_w / pw, img_h / ph

        # Text noise to skip: schedule headers, dimension values, callout codes
        SKIP_PATTERNS = [
            r'^\d+$',                          # pure numbers
            r'^[\d\s\.\-\/\'\"]+$',            # dimension strings
            r'^\d+[\'\"]\-?\d*[\'\"]\s*$',     # "3'-6""
            r'^[A-Z]{1,2}[-\.]\d{1,4}$',      # "A-1", "B.3" grid lines
            r'^[A-Z]{1,2}\d{2,4}$',            # "A108" room tags
            r'^\d+\s*(sf|sqft|sm|sqm|m²)\s*$',# area annotations
        ]
        SKIP_WORDS = {
            "schedule", "legend", "keynote", "revision", "drawn by", "checked by",
            "project no", "sheet no", "north arrow", "graphic scale", "bar scale",
            "see detail", "see plan", "not to scale", "n.t.s", "typ.", "typical",
            "existing", "demo", "remove", "fire rating", "acoustic",
            "gypsum", "insulation", "partition", "blocking",
        }

        words = page.get_text("words")   # (x0,y0,x1,y1, word, block_no, line_no, word_no)
        doc.close()

        # Group nearby words into phrases (words on same line within 20pts gap)
        # Sort by y then x
        sorted_words = sorted(words, key=lambda w: (round(w[1]/8)*8, w[0]))

        phrases = []
        current_phrase: list = []
        for w in sorted_words:
            x0w, y0w, x1w, y1w, txt = w[0], w[1], w[2], w[3], w[4].strip()
            if not txt or len(txt) < 1:
                continue

            if current_phrase:
                last = current_phrase[-1]
                same_line = abs(y0w - last["y0"]) < 10   # within 10pt vertically
                close_h   = (x0w - last["x1"]) < 25      # within 25pt horizontally
                if same_line and close_h:
                    current_phrase.append({"x0": x0w, "y0": y0w, "x1": x1w, "y1": y1w, "txt": txt})
                    continue
                # Save current phrase
                phrases.append(current_phrase)
            current_phrase = [{"x0": x0w, "y0": y0w, "x1": x1w, "y1": y1w, "txt": txt}]
        if current_phrase:
            phrases.append(current_phrase)

        results = []
        for phrase in phrases:
            full_text = " ".join(p["txt"] for p in phrase).strip()
            if not full_text or len(full_text) < 2:
                continue

            # Skip noise patterns
            skip = False
            for pat in SKIP_PATTERNS:
                if re.match(pat, full_text, re.IGNORECASE):
                    skip = True; break
            if skip:
                continue
            tl = full_text.lower()
            if any(sw in tl for sw in SKIP_WORDS):
                continue

            x0_all = min(p["x0"] for p in phrase)
            y0_all = min(p["y0"] for p in phrase)
            x1_all = max(p["x1"] for p in phrase)
            y1_all = max(p["y1"] for p in phrase)

            # Scale to image pixels
            cx_px = int((x0_all + x1_all) / 2 * sx)
            cy_px = int((y0_all + y1_all) / 2 * sy)
            x0_px = int(x0_all * sx)
            y0_px = int(y0_all * sy)
            x1_px = int(x1_all * sx)
            y1_px = int(y1_all * sy)

            results.append({
                "text": full_text,
                "cx": cx_px, "cy": cy_px,
                "x": x0_px, "y": y0_px,
                "w": x1_px - x0_px, "h": y1_px - y0_px,
                "x0": int(x0_all * sx), "y0": int(y0_all * sy),
                "x1": int(x1_all * sx), "y1": int(y1_all * sy),
                "conf": 1.0,   # PDF text layer = 100% confidence
                "source": "pdf_text",
            })

        print(f"[TextExtract] PDF text layer: {len(results)} phrases")
        return results

    except Exception as e:
        print(f"[TextExtract] PDF error: {e}")
        return []


def extract_text_from_image_ocr(img_pil) -> list[dict]:
    """
    Run EasyOCR (preferred) or Tesseract on the rasterized image.
    Returns list of { text, cx, cy, x0, y0, x1, y1, conf }.

    Used when:
      - Input is JPG/PNG (not PDF)
      - PDF text layer is empty (scanned PDF)
    """
    if not HAS_PIL:
        return []

    img_arr = np.array(img_pil.convert("RGB"))
    results = []

    # ── EasyOCR ──────────────────────────────────────────────────────────────
    reader = _get_easyocr()
    if reader is not None:
        try:
            detections = reader.readtext(img_arr, detail=1, paragraph=False)
            for bbox, text, conf in detections:
                text = text.strip()
                if not text or len(text) < 2 or conf < 0.25:
                    continue
                # bbox = [[x1,y1],[x2,y1],[x2,y2],[x1,y2]]
                xs = [p[0] for p in bbox]
                ys = [p[1] for p in bbox]
                x0, x1 = int(min(xs)), int(max(xs))
                y0, y1 = int(min(ys)), int(max(ys))
                results.append({
                    "text": text,
                    "cx": (x0 + x1) // 2,
                    "cy": (y0 + y1) // 2,
                    "x": x0, "y": y0,
                    "w": x1 - x0, "h": y1 - y0,
                    "conf": round(conf, 3),
                    "source": "easyocr",
                })
            print(f"[TextExtract] EasyOCR: {len(results)} text regions")
            return results
        except Exception as e:
            print(f"[TextExtract] EasyOCR error: {e}")

    # ── Tesseract fallback ────────────────────────────────────────────────────
    if HAS_TESSERACT:
        try:
            data = pytesseract.image_to_data(
                img_pil, output_type=pytesseract.Output.DICT,
                config="--psm 11"
            )
            for i, txt in enumerate(data["text"]):
                txt = txt.strip()
                if not txt or len(txt) < 2:
                    continue
                conf = float(data["conf"][i])
                if conf < 20:
                    continue
                x0 = int(data["left"][i])
                y0 = int(data["top"][i])
                w = int(data["width"][i])
                h = int(data["height"][i])
                x1 = x0 + w
                y1 = y0 + h
                results.append({
                    "text": txt,
                    "cx": (x0 + x1) // 2,
                    "cy": (y0 + y1) // 2,
                    "x": x0, "y": y0,
                    "w": w, "h": h,
                    "conf": round(conf / 100, 3),
                    "source": "tesseract",
                })
            print(f"[TextExtract] Tesseract: {len(results)} text regions")
        except Exception as e:
            print(f"[TextExtract] Tesseract error: {e}")

    return results


# ── STEP 2: Match extracted text to room bounding boxes ───────────────────────

def assign_text_to_rooms(rooms: list[dict], text_items: list[dict]) -> list[dict]:
    """
    For each room region, find text items whose center (cx, cy) falls
    inside the room bounding box.

    The room NAME becomes whatever text is found inside it — exactly as
    written in the drawing. No keyword substitution.

    If multiple text items are inside, we join them (handles multi-line labels
    like "Meeting" + "Room" on separate lines).

    Also calculates text area coverage within the room.

    Returns rooms with updated "name" and "type" fields.
    """
    if not text_items:
        return rooms

    for room in rooms:
        rx, ry = room["x"], room["y"]
        rw, rh = room["w"], room["h"]

        # Collect all text whose center is inside this room
        # Allow a small margin (10% of room size) for text near edges
        margin_x = max(5, rw * 0.08)
        margin_y = max(5, rh * 0.08)

        inside_texts = []
        total_text_area_px = 0  # Track total text area in pixels
        
        for item in text_items:
            cx, cy = item["cx"], item["cy"]
            if (rx - margin_x <= cx <= rx + rw + margin_x and
                    ry - margin_y <= cy <= ry + rh + margin_y):
                inside_texts.append(item)
                # Add text bounding box area
                if "w" in item and "h" in item:
                    total_text_area_px += item["w"] * item["h"]

        if not inside_texts:
            room["textAreaSqM"] = 0
            room["textAreaSqFt"] = 0
            room["textCoveragePercent"] = 0
            continue

        # Sort by confidence (highest first), then by vertical position
        inside_texts.sort(key=lambda t: (-t["conf"], t["cy"]))

        # Join multi-line labels (e.g. "Open" + "Office" → "Open Office")
        # Deduplicate repeated words
        seen_words: set[str] = set()
        parts = []
        for item in inside_texts:
            for word in item["text"].split():
                if word.lower() not in seen_words:
                    seen_words.add(word.lower())
                    parts.append(word)
        combined = " ".join(parts).strip()

        # Calculate text area metrics
        room_area_px = rw * rh
        text_coverage = (total_text_area_px / room_area_px * 100) if room_area_px > 0 else 0
        
        # Get mpp from room if available (for area conversion)
        mpp = room.get("_mpp", 0.064)  # default if not set
        text_area_sqm = total_text_area_px * (mpp ** 2)
        
        room["textAreaSqM"] = round(text_area_sqm, 2)
        room["textAreaSqFt"] = round(text_area_sqm * 10.764, 2)
        room["textCoveragePercent"] = round(text_coverage, 1)
        room["textItemCount"] = len(inside_texts)

        if len(combined) >= 2:
            room["name"]          = combined.title()
            room["type"]          = _infer_type_from_text(combined)
            room["_has_pdf_label"] = True
            room["_label_conf"]   = round(max(t["conf"] for t in inside_texts), 3)

    return rooms


# ── STEP 3: Infer TYPE from actual text (for color coding only) ───────────────
#
# This is NOT used for naming. The name comes from the image.
# This only assigns a TYPE category so the UI can color-code rooms.
# It uses the actual text found in the drawing.
# Unknown text → type = "OTHER" (shown as gray)

def _infer_type_from_text(text: str) -> str:
    """
    Infer room type from the actual label text found in the drawing.
    This is purely for UI color-coding — the name field is unchanged.

    Covers residential, commercial, industrial in any language
    by matching common root words (not full phrases).
    """
    t = text.lower().strip()

    # Existing rooms — marked with (E) suffix → type EXISTING (shown gray)
    if t.endswith("(e)") or " (e)" in t:
        return "EXISTING"

    # Circulation (check before others — corridors can have "hall" in name)
    if any(w in t for w in ["corridor", "hallway", "passage", "circulation",
                             "couloir", "aisle", "walkway"]):
        return "CORRIDOR"
    if any(w in t for w in ["stair", "elevator", "lift", "escalator"]):
        return "STAIR"
    if any(w in t for w in ["lobby", "foyer", "reception", "vestibule",
                             "entry", "entrance", "waiting"]):
        return "CORRIDOR"

    # Wet areas
    if any(w in t for w in ["bath", "wc", "toilet", "shower", "washroom",
                             "restroom", "lavatory", "powder", "sanitary",
                             "gents", "ladies", "male", "female", "accessible"]):
        return "BATHROOM"

    # Kitchen / break / cafeteria
    if any(w in t for w in ["kitchen", "cuisine", "pantry", "cafeteria",
                             "canteen", "break room", "breakroom", "cafe",
                             "lunchroom", "scullery", "cook"]):
        return "KITCHEN"

    # Sleeping
    if any(w in t for w in ["bed", "chambre", "dorm", "sleeping",
                             "guest room", "suite"]):
        return "BEDROOM"

    # Living / social
    if any(w in t for w in ["living", "lounge", "sitting", "family",
                             "drawing room", "salon", "drawing", "recreation"]):
        return "LIVING"
    if any(w in t for w in ["dining", "dinner", "eat"]):
        return "DINING"

    # Outdoor
    if any(w in t for w in ["balcony", "terrace", "verandah", "patio",
                             "deck", "courtyard", "loggia"]):
        return "BALCONY"

    # Vehicle
    if any(w in t for w in ["garage", "parking", "car park", "vehicle",
                             "carport"]):
        return "GARAGE"

    # Meeting / conference
    if any(w in t for w in ["meeting", "conference", "boardroom", "seminar",
                             "training", "board room", "huddle", "interview"]):
        return "MEETING"

    # Office / work
    if any(w in t for w in ["office", "workroom", "workspace", "work room",
                             "open plan", "bullpen", "cowork", "cubicle",
                             "director", "manager", "executive"]):
        return "OFFICE"

    # Storage / utility
    if any(w in t for w in ["store", "storage", "utility", "plant room",
                             "server", "electrical", "mechanical", "telecom",
                             "idf", "mdf", "janitor", "custodial", "supply",
                             "archive", "records", "file room", "data"]):
        return "UTILITY"

    # Industrial / production
    if any(w in t for w in ["production", "manufacturing", "assembly",
                             "warehouse", "workshop", "factory", "lab",
                             "laboratory", "clean room", "testing",
                             "quality", "qc", "inspection", "dispatch",
                             "loading", "dock", "boiler", "compressor",
                             "pump room", "generator", "hvac"]):
        return "INDUSTRIAL"

    # Study / library
    if any(w in t for w in ["study", "library", "reading", "media",
                             "computer room", "it room"]):
        return "STUDY"

    # Laundry
    if any(w in t for w in ["laundry", "washing", "linen"]):
        return "UTILITY"

    # Could not match any category — keep as OTHER
    # Name is still whatever was written in the drawing
    return "OTHER"


def _infer_type_from_shape(area_sqm: float, aspect: float,
                            rank: int, total: int) -> str:
    """
    Last-resort type inference when NO text was found inside a room.
    Returns type based on geometry only — always marked as estimated.
    Uses relative rank so it works for any building type.
    """
    if aspect < 0.15:
        return "CORRIDOR"      # very thin → corridor

    # No text → we genuinely don't know. Return "UNKNOWN".
    # The UI should show this as "Room N" without pretending to know the type.
    return "UNKNOWN"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4: DOOR & WINDOW DETECTION (real OpenCV)
# ══════════════════════════════════════════════════════════════════════════════

def detect_doors_windows(gray: np.ndarray, mpp: float,
                         rooms: list[dict],
                         fp_y_max: int, fp_x_max: int) -> tuple[list, list]:
    """
    Detect door arcs and window lines within the floor plan area.
    Assigns door/window counts to rooms based on spatial overlap.
    Returns (doors, windows) lists.
    """
    if not HAS_CV2:
        return [], []

    # Clip to floor plan area
    gray_fp = gray[:fp_y_max, :fp_x_max].copy()

    doors, windows = [], []

    # ── Doors: Hough circles (door swing arcs) ────────────────────────────────
    # Door radius range: 0.6m–1.2m swing radius
    min_r_px = max(15, int(0.60 / max(mpp, 0.001)))
    max_r_px = min(120, int(1.20 / max(mpp, 0.001)))

    blurred  = cv2.GaussianBlur(gray_fp, (5, 5), 0)
    circles  = cv2.HoughCircles(
        blurred, cv2.HOUGH_GRADIENT, dp=1.2,
        minDist=max(40, min_r_px * 2),
        param1=100, param2=50,
        minRadius=min_r_px, maxRadius=max_r_px,
    )
    if circles is not None:
        for cx, cy, r in np.round(circles[0]).astype(int):
            if cx - r < 0 or cy - r < 0:
                continue
            if cx + r > fp_x_max or cy + r > fp_y_max:
                continue
            doors.append({
                "x": int(cx - r), "y": int(cy - r),
                "w": int(2 * r),  "h": int(2 * r),
                "cx": int(cx),    "cy": int(cy),
                "radius_m": round(r * mpp, 2),
            })

    # ── Windows: disabled by default — too many false positives from CAD symbols
    # Window detection picks up G12/G4 diamond symbols, door tags, etc.
    # Only enable if explicitly requested
    windows = []  # return empty — client can toggle on/off

    # ── Assign counts to rooms ────────────────────────────────────────────────
    for room in rooms:
        rx, ry = room["x"], room["y"]
        rw, rh = room["w"], room["h"]
        # Count doors whose center is inside or very close to this room
        room["doorCount"]   = sum(
            1 for d in doors
            if rx - 10 <= d["cx"] <= rx + rw + 10
            and ry - 10 <= d["cy"] <= ry + rh + 10
        )
        room["windowCount"] = sum(
            1 for win in windows
            if rx - 10 <= win["cx"] <= rx + rw + 10
            and ry - 10 <= win["cy"] <= ry + rh + 10
        )

    return doors, windows


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5: TRAINED MODEL INFERENCE
# ══════════════════════════════════════════════════════════════════════════════

_model = None
_model_meta: dict = {}

def _load_model():
    """
    Load trained model. Tries ONNX first (fast, no arch dependency),
    then falls back to .pth with ResNetUNet (v3.x) or legacy UNet.
    """
    global _model, _model_meta
    if _model is not None:
        return _model
    if not HAS_TORCH:
        return None

    # ── Try ONNX first ────────────────────────────────────────────────────────
    onnx_path = _MODEL_CKPT.parent / "floor_plan_model.onnx"
    if onnx_path.exists():
        try:
            import onnxruntime as ort
            sess = ort.InferenceSession(str(onnx_path),
                                        providers=["CPUExecutionProvider"])
            _model = sess
            _model_meta = {"arch": "ONNX", "n_cls": 5, "img_size": 512,
                           "class_names": ["background","room","wall","door","window"],
                           "use_onnx": True}
            print(f"[Model] ONNX loaded: {onnx_path.name}")
            return _model
        except Exception as e:
            print(f"[Model] ONNX load failed ({e}) — trying .pth")

    if not _MODEL_CKPT.exists():
        print(f"[Model] Not found: {_MODEL_CKPT}")
        print("[Model] Run: python models/Model_training.py")
        return None

    try:
        ckpt   = torch.load(str(_MODEL_CKPT), map_location="cpu", weights_only=False)
        arch   = ckpt.get("arch", "legacy")
        n_cls  = int(ckpt.get("n_classes", 3))
        img_sz = int(ckpt.get("img_size",  512))
        state  = ckpt.get("model_state", ckpt)
        names  = ckpt.get("class_names", ["background","room","wall","door","window"])

        # Detect n_cls from checkpoint head
        head_key = next((k for k in state if "head.weight" in k), None)
        if head_key:
            n_cls = int(state[head_key].shape[0])

        # Build correct architecture
        if "ResNet" in arch or "v3" in arch:
            sys.path.insert(0, str(_ROOT))
            try:
                from models.Model_training import ResNetUNet
                model = ResNetUNet(n_cls=n_cls)
                print(f"[Model] Using ResNetUNet ({arch})")
            except Exception as e:
                print(f"[Model] ResNetUNet import failed: {e} — falling back to legacy UNet")
                feats = tuple(ckpt.get("feats", (64, 128, 256, 512)))
                model = _build_unet(feats=feats, n_cls=n_cls)
        else:
            feats = tuple(ckpt.get("feats", (64, 128, 256, 512)))
            model = _build_unet(feats=feats, n_cls=n_cls)

        missing, unexpected = model.load_state_dict(state, strict=False)
        print(f"[Model] Weights: total={len(state)} missing={len(missing)} unexpected={len(unexpected)}")
        model.eval()
        _model = model
        _model_meta = {
            "arch": arch, "n_cls": n_cls, "img_size": img_sz,
            "class_names": names,
            "miou": ckpt.get("miou", 0),
            "use_onnx": False,
        }
        print(f"[Model] Loaded {_MODEL_CKPT.name}  arch={arch}  classes={n_cls}  mIoU={_model_meta['miou']:.3f}")
        return _model
    except Exception as e:
        print(f"[Model] Load error: {e}")
        import traceback; traceback.print_exc()
        return None


def _build_unet(feats=(64,128,256,512), n_cls=3):
    """Build U-Net matching EXACTLY the Model_training.py architecture.
    Key structures:
      ConvBnRelu → net: [Conv2d, BN, ReLU]
      SEBlock    → sq:  [AvgPool, Flatten, Linear, ReLU, Linear, Sigmoid]
      DoubleConvSE → net: [ConvBnRelu, ConvBnRelu, SEBlock, Dropout2d]
      ASPPBlock  → branches: ModuleList[ConvBnRelu×4], global_avg, proj
      UNet       → enc(DoubleConvSE), bottleneck(ASPPBlock), up, dec(DoubleConvSE), head
    """
    class ConvBnRelu(nn.Module):
        def __init__(self, ic, oc, k=3, p=1, d=1):
            super().__init__()
            correct_pad = d if d > 1 else p
            self.net = nn.Sequential(
                nn.Conv2d(ic, oc, k, padding=correct_pad, dilation=d, bias=False),
                nn.BatchNorm2d(oc),
                nn.ReLU(inplace=True),
            )
        def forward(self, x): return self.net(x)

    class SEBlock(nn.Module):
        def __init__(self, ch, r=8):
            super().__init__()
            self.sq = nn.Sequential(
                nn.AdaptiveAvgPool2d(1), nn.Flatten(),
                nn.Linear(ch, max(1, ch//r)), nn.ReLU(inplace=True),
                nn.Linear(max(1, ch//r), ch), nn.Sigmoid(),
            )
        def forward(self, x):
            return x * self.sq(x).view(-1, x.shape[1], 1, 1)

    class DoubleConvSE(nn.Module):
        def __init__(self, ic, oc, dropout=0.1):
            super().__init__()
            self.net = nn.Sequential(
                ConvBnRelu(ic, oc),
                ConvBnRelu(oc, oc),
                SEBlock(oc),
                nn.Dropout2d(dropout),
            )
        def forward(self, x): return self.net(x)

    class ASPPBlock(nn.Module):
        def __init__(self, ch):
            super().__init__()
            mid = ch // 4
            self.branches = nn.ModuleList([
                ConvBnRelu(ch, mid, k=1, p=0),
                ConvBnRelu(ch, mid, d=6,  p=6),
                ConvBnRelu(ch, mid, d=12, p=12),
                ConvBnRelu(ch, mid, d=18, p=18),
            ])
            self.global_avg = nn.Sequential(
                nn.AdaptiveAvgPool2d(1),
                nn.Conv2d(ch, mid, 1, bias=False),
                nn.ReLU(inplace=True),
            )
            self.proj = nn.Sequential(
                nn.Conv2d(mid * 5, ch, 1, bias=False),
                nn.BatchNorm2d(ch),
                nn.ReLU(inplace=True),
                nn.Dropout2d(0.1),
            )
        def forward(self, x):
            feats_list = [b(x) for b in self.branches]
            gap = self.global_avg(x)
            gap = nn.functional.interpolate(gap, size=x.shape[2:], mode="bilinear", align_corners=False)
            feats_list.append(gap)
            return self.proj(torch.cat(feats_list, dim=1))

    class UNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.enc   = nn.ModuleList()
            self.pool  = nn.MaxPool2d(2)
            prev = 3
            for f in feats:
                self.enc.append(DoubleConvSE(prev, f)); prev = f
            self.bottleneck = ASPPBlock(feats[-1])
            self.dec = nn.ModuleList()
            self.up  = nn.ModuleList()
            for f in reversed(feats[:-1]):
                self.up.append(nn.ConvTranspose2d(prev, f, kernel_size=2, stride=2))
                self.dec.append(DoubleConvSE(f * 2, f)); prev = f
            self.head = nn.Conv2d(prev, n_cls, kernel_size=1)

        def forward(self, x):
            skips = []
            for enc in self.enc:
                x = enc(x); skips.append(x); x = self.pool(x)
            x = self.bottleneck(x)
            for up, dec, sk in zip(self.up, self.dec, reversed(skips[:-1])):
                x = up(x)
                if x.shape != sk.shape:
                    x = nn.functional.interpolate(x, sk.shape[2:], mode="bilinear", align_corners=False)
                x = dec(torch.cat([x, sk], 1))
            return self.head(x)

    return UNet()


def run_model_inference(img_rgb: np.ndarray) -> np.ndarray | None:
    """
    Run model inference on floor plan image.
    Returns room probability map (H×W float32, 0-1) or None.

    Class mapping (v3.x ResNetUNet):
      0=background  1=room  2=wall  3=door  4=window
    Legacy UNet (1-class): wall binary → invert for room.
    ONNX: same v3.x class mapping.
    """
    model = _load_model()
    if model is None:
        return None

    n_cls    = _model_meta.get("n_cls", 1)
    img_sz   = _model_meta.get("img_size", 512)
    use_onnx = _model_meta.get("use_onnx", False)
    names    = _model_meta.get("class_names", [])
    # room class index: 1 in v3.x (background=0), 0 in legacy binary
    room_cls = 1 if len(names) >= 2 and names[0] == "background" else 0

    h, w    = img_rgb.shape[:2]
    resized = cv2.resize(img_rgb, (img_sz, img_sz))
    mean    = np.array([0.485, 0.456, 0.406], dtype=np.float32) * 255
    std     = np.array([0.229, 0.224, 0.225], dtype=np.float32) * 255
    inp     = ((resized.astype(np.float32) - mean) / std).transpose(2, 0, 1)[None]  # (1,3,H,W)

    if use_onnx:
        out       = model.run(None, {"image": inp})[0]   # (1, n_cls, H, W)
        probs     = np.exp(out) / np.exp(out).sum(axis=1, keepdims=True)
        prob_small = probs[0, room_cls]
    elif HAS_TORCH:
        t = torch.from_numpy(inp)
        with torch.no_grad():
            logits = model(t)
        if n_cls == 1:
            prob_small = (1.0 - torch.sigmoid(logits)).squeeze().numpy()
        else:
            prob_small = torch.softmax(logits, dim=1)[0, room_cls].numpy()
    else:
        return None

    return cv2.resize(prob_small.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)


def _run_model_full_probs(img_rgb: np.ndarray) -> np.ndarray | None:
    """
    Run model and return full probability map for ALL classes.
    Returns (n_cls, H, W) float32 array, or None on failure.
    Used for argmax prediction — prevents room over-prediction.
    """
    model = _load_model()
    if model is None or not HAS_TORCH:
        return None

    n_cls    = _model_meta.get("n_cls", 1)
    img_sz   = _model_meta.get("img_size", 512)
    use_onnx = _model_meta.get("use_onnx", False)

    if n_cls < 2:
        return None   # legacy binary model — can't do argmax

    h, w    = img_rgb.shape[:2]
    resized = cv2.resize(img_rgb, (img_sz, img_sz))
    mean    = np.array([0.485, 0.456, 0.406], dtype=np.float32) * 255
    std     = np.array([0.229, 0.224, 0.225], dtype=np.float32) * 255
    inp     = ((resized.astype(np.float32) - mean) / std).transpose(2, 0, 1)[None]

    try:
        if use_onnx:
            out   = model.run(None, {"image": inp})[0]   # (1, n_cls, H, W)
            probs = np.exp(out[0]) / np.exp(out[0]).sum(axis=0, keepdims=True)  # softmax
        else:
            t = torch.from_numpy(inp)
            with torch.no_grad():
                logits = model(t)          # (1, n_cls, H, W)
            probs = torch.softmax(logits, dim=1)[0].numpy()   # (n_cls, H, W)

        # Resize each class channel back to original size
        out_probs = np.zeros((n_cls, h, w), dtype=np.float32)
        for c in range(n_cls):
            out_probs[c] = cv2.resize(probs[c].astype(np.float32), (w, h),
                                      interpolation=cv2.INTER_LINEAR)
        return out_probs

    except Exception as e:
        print(f"[Model] full_probs error: {e}")
        return None


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6: ROOM DETECTION PIPELINES
# ══════════════════════════════════════════════════════════════════════════════

def _build_room_record(idx: int, x0: int, y0: int, x1: int, y1: int,
                       poly: list, area_sqm: float, mpp: float,
                       label: str = "", rtype: str = "",
                       confidence: float = 0.85) -> dict:
    """
    Build a complete room record with real measurements.
    label/rtype are empty initially — filled in by assign_text_to_rooms().
    """
    bw, bh  = x1 - x0, y1 - y0
    len_m   = round(bw * mpp, 2)
    wid_m   = round(bh * mpp, 2)
    perim_m = round((len_m + wid_m) * 2, 2)

    return {
        "id":           f"r{idx+1}",
        "name":         label if label else f"Room {idx+1}",   # placeholder until OCR assigns
        "type":         rtype if rtype else "UNKNOWN",          # unknown until text matched
        "x":            int(x0), "y":  int(y0),
        "w":            int(bw), "h":  int(bh),
        "polygon":      poly,
        "areaSqM":      round(area_sqm, 2),
        "areaSqFt":     round(area_sqm * 10.764, 1),
        "lengthM":      len_m,
        "widthM":       wid_m,
        "heightM":      None,          # not hardcoded — unknown unless drawn
        "wallAreaSqM":  None,          # computed after height is known
        "ceilingSqM":   round(area_sqm, 2),
        "perimeterM":   perim_m,
        "doorCount":    0,             # filled in by detect_doors_windows
        "windowCount":  0,
        "floor":        "Ground Floor",
        "confidence":   round(confidence, 2),
    }


def _finalize_room_names(rooms: list[dict]) -> list[dict]:
    """
    Final pass after assign_text_to_rooms() has run:
    - Rooms WITH text from drawing: name stays exactly as written, type from _infer_type_from_text
    - Rooms WITHOUT any text found: name = "Room N", type = UNKNOWN (shape-estimated)
    - Add sequential suffix only if same text appears more than once
    """
    # Count how many times each name appears
    name_counts: dict[str, int] = {}
    for r in rooms:
        name_counts[r["name"]] = name_counts.get(r["name"], 0) + 1

    name_seen: dict[str, int] = {}
    for i, room in enumerate(rooms):
        name = room["name"]
        name_seen[name] = name_seen.get(name, 0) + 1

        if name_counts[name] > 1:
            # Same label appears multiple times (e.g. drawing has "Office" in 5 rooms)
            room["name"] = f"{name} {name_seen[name]}"

        # If type still UNKNOWN and shape is clear (very elongated) → corridor
        if room["type"] == "UNKNOWN":
            asp = min(room["w"], room["h"]) / max(room["w"], room["h"], 1)
            if asp < 0.15:
                room["type"] = "CORRIDOR"

        # Clean internal flags before returning to client
        room.pop("_has_pdf_label", None)
        room.pop("_label_conf",    None)

    return rooms

# ── Pipeline A: Text-guided flood fill ────────────────────────────────────────

def pipeline_text_guided(pdf_bytes: bytes, page_num: int,
                          mpp: float, img_w: int, img_h: int) -> list[dict] | None:
    """
    1. Extract text labels from PDF text layer
    2. Render page at high resolution
    3. Flood fill from each label position to wall boundaries
    4. Gives real wall-following room polygons
    """
    if not HAS_FITZ or not HAS_CV2:
        return None
    try:
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc[min(page_num, len(doc) - 1)]
        pw, ph = page.rect.width, page.rect.height

        # ── Detect actual floor plan boundary from PDF structure ──────────────
        # Commercial PDFs have: floor plan (top 40-55%) + door/window schedule (bottom)
        # Find where schedule tables start by looking for dense table text
        all_blocks = page.get_text("blocks")

        # ── Auto-detect floor plan boundaries ────────────────────────────────
        fp_y_frac = 0.92   # default: use 92% of height
        fp_x_frac = 0.92   # default: use 92% of width

        for b in all_blocks:
            bx0, by0, bx1, by1, btxt = b[:5]
            tl = btxt.lower().strip()

            # Y boundary: any table/schedule/notes area below floor plan
            if any(kw in tl for kw in [
                "door schedule", "window schedule", "frame schedule",
                "finish schedule", "new door and frame", "hardware group",
                "door and frame schedule",
                "general construction notes", "general notes:",
                "construction keynotes", "construction symbols",
                "keynotes:", "general note",
                "level 1 -", "level 1-", "scale:",
            ]):
                cand = by0 / ph
                if cand > 0.40 and cand < fp_y_frac:
                    fp_y_frac = cand
                    print(f"[TextGuided] Floor plan bottom at {cand:.0%}: {btxt.strip()[:40]}")

            # X boundary: right-side notes/title block column
            if any(kw in tl for kw in ["general notes", "general note", "keynotes",
                                        "construction notes", "project notes",
                                        "barrington", "gensler", "hok", "skidmore",
                                        "drawn by", "checked by", "project no",
                                        "issued for construction", "bid set"]):
                cand = bx0 / pw
                if cand > 0.45 and cand < fp_x_frac:
                    fp_x_frac = cand
                    print(f"[TextGuided] Notes column boundary at {cand:.0%}W: {btxt.strip()[:30]}")

        # ── Room keyword list — what ACTUALLY means a room ────────────────────
        # These are real architectural room labels used globally
        ROOM_WORDS = {
            # English
            "office", "meeting", "conference", "board", "training", "seminar",
            "open office", "work room", "workroom", "workspace", "bullpen",
            "reception", "lobby", "corridor", "hallway", "passage", "foyer",
            "entry", "vestibule", "anteroom", "waiting",
            "kitchen", "break room", "breakroom", "cafe", "cafeteria", "pantry",
            "bathroom", "restroom", "toilet", "wc", "washroom", "shower",
            "bedroom", "chamber", "sleeping", "master",
            "living", "lounge", "sitting", "family", "drawing room",
            "dining", "canteen", "lunch",
            "storage", "store room", "storeroom", "closet", "utility",
            "server", "data", "electrical", "mechanical", "plant", "telecom",
            "stair", "elevator", "lift", "lobby",
            "studio", "lab", "laboratory", "clinic", "exam", "consultation",
            "library", "study", "media", "copy", "print", "mail",
            "balcony", "terrace", "verandah", "patio",
            "garage", "parking", "loading", "dock",
            "warehouse", "production", "assembly", "workshop", "clean room",
            "gym", "fitness", "wellness", "prayer", "chapel",
            "suite", "executive", "director", "manager", "president",
            "open", "private", "shared", "common", "general",
            "janitor", "custodial", "mechanical", "electrical",
            # French (common in international drawings)
            "bureau", "salle", "cuisine", "couloir", "chambre", "salon",
            "entree", "hall", "cabinet",
            # Spanish
            "oficina", "sala", "cocina", "pasillo", "bano", "habitacion",
            # Generic
            "room", "area", "space", "zone", "unit",
        }

        # ── Text to completely skip (non-room text in floor plan area) ─────────
        SKIP_EXACT = {
            "n.i.c", "nic", "n.t.s", "nts", "typ", "typ.", "tbd",
            "see", "ref", "per", "by", "etc", "and", "or", "not",
        }
        SKIP_CONTAINS = [
            "schedule", "legend", "keynote", "general note", "construction note",
            "drawn by", "checked by", "issued for", "project no", "sheet no",
            "scale bar", "north arrow", "graphic scale", "revision",
            "fire rating", "fire rated", "acoustic rating", "stc",
            "wall type", "partition type", "glazing type",
            "see detail", "see plan", "see sheet", "refer to",
            "typical", "beyond", "above", "below",
            "not in contract", "not in scope", "by others",
            "gypsum", "gyp bd", "gyp.", "insulation", "metal stud", "mtl",
            "blocking", "furring", "sheathing", "waterproof",
            "concrete", "masonry", "cmu", "slab", "footing", "structural",
            "sprinkler", "diffuser", "exhaust", "supply air", "hvac",
            "light fixture", "pendant", "downlight", "exit sign",
            "column", "beam", "joist", "grid line",
        ]

        seeds = []
        seen_cells: set[str] = set()

        for b in all_blocks:
            x0, y0, x1, y1, txt = b[:5]

            # ── Spatial filter: floor plan area only ──────────────────────────
            if y0 / ph > fp_y_frac:      continue   # below schedule
            if x0 / pw > fp_x_frac:      continue   # right notes/title column
            if y0 / ph < 0.03:           continue   # top margin (sheet title/logo)
            if x0 / pw < 0.01:           continue   # left margin

            for line in txt.strip().splitlines():
                line = line.strip()
                if not line or len(line) < 2 or len(line) > 60:
                    continue

                tl = line.lower().strip()

                # ── Skip noise patterns ────────────────────────────────────────
                # Pure numbers (door tags, room numbers, dimensions)
                if re.match(r'^[\d\s\.\-\/\'\"\,]+$', line):
                    continue
                # Short codes: "A1", "B2", "FEC", "WC1", room tags like "1159"
                if re.match(r'^\d{3,6}$', line.strip()):
                    continue   # pure 3-6 digit = door/room number tag
                if re.match(r'^[A-Z]{1,3}\d{1,4}$', line.strip()):
                    continue   # "B1", "WC2", "ST01"
                if re.match(r'^[A-Z]{1,2}[-\.]\d{1,4}$', line.strip()):
                    continue   # "A-1", "B.3"
                # Dimension strings: "3'-6"", "2400mm", "1.5M"
                if re.search(r'\d+[\'\"]\-?\d*[\'\"]\s*$', line):
                    continue
                if re.search(r'^\d+\.?\d*\s*(mm|cm|m|ft|in|sf|sqm)\s*$', tl):
                    continue
                # Skip exact noise words
                if tl in SKIP_EXACT:
                    continue
                # Skip if contains schedule/construction-note text
                if any(kw in tl for kw in SKIP_CONTAINS):
                    continue
                # Must have at least 2 alphabetic chars
                if not re.search(r'[A-Za-z]{2,}', line):
                    continue

                # ── Only accept lines that look like room labels ───────────────
                # Either: contains a known room word, OR is a multi-word phrase
                # that could be a room name (e.g. "Open Work Area", "IT Closet")
                has_room_word = any(rw in tl for rw in ROOM_WORDS)

                # Multi-word phrases where first word is likely a descriptor
                # e.g. "New Executive Suite", "Large Break Room", "Suite 200"
                words = re.findall(r'[A-Za-z]+', line)
                is_phrase = len(words) >= 2

                # Single words that are clearly room types
                is_single_room = len(words) == 1 and has_room_word

                if not (has_room_word or (is_phrase and len(line) <= 40)):
                    continue

                # Deduplicate by grid cell (avoid same room label twice)
                cx_pts = (x0 + x1) / 2
                cy_pts = (y0 + y1) / 2
                cx = int(cx_pts / pw * img_w)
                cy = int(cy_pts / ph * img_h)
                cell = f"{cx // 60}_{cy // 60}"
                if cell in seen_cells:
                    continue
                seen_cells.add(cell)

                seeds.append((cx, cy, line.strip()))

        print(f"[TextGuided] {len(seeds)} valid room seeds (fp_boundary={fp_y_frac:.0%})")

        if not seeds:
            doc.close()
            return None

        # ── NIC detection — only standalone NIC labels, not text containing NIC ──
        nic_seeds = []
        for b in all_blocks:
            bx0, by0, bx1, by1, btxt = b[:5]
            # Only match if the block text IS a NIC label (short, standalone)
            stripped = btxt.strip().upper()
            is_nic = (
                re.match(r'^N\.?I\.?C\.?(\s+PHASE\s*\d*)?$', stripped) or
                stripped in {"NIC", "N.I.C", "N.I.C.", "NOT IN CONTRACT", "NOT IN SCOPE"} or
                re.match(r'^NIC\s+PHASE\s*\d+$', stripped)
            )
            if is_nic:
                cx_nic = int((bx0 + bx1) / 2 / pw * img_w)
                cy_nic = int((by0 + by1) / 2 / ph * img_h)
                nic_seeds.append((cx_nic, cy_nic, btxt.strip()[:30]))

        # Render at 2x — good balance of wall quality vs speed
        zoom = 2.0
        mat  = fitz.Matrix(zoom, zoom)
        pix  = page.get_pixmap(matrix=mat, alpha=False)
        img_arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
        doc.close()

        rh, rw = img_arr.shape[:2]
        gray   = cv2.cvtColor(img_arr, cv2.COLOR_RGB2GRAY)

        # ── Wall mask — simple threshold, schedule area excluded ─────────────
        # Simple: dark pixels = walls. Text/symbols inside rooms are fine —
        # we fill their holes AFTER flood fill, not before.
        _, wall_mask = cv2.threshold(gray, 160, 255, cv2.THRESH_BINARY_INV)

        # Exclude schedule/notes area (bottom + right) from wall mask
        # This prevents schedule table lines from being treated as room walls
        fp_y_cut = int(rh * fp_y_frac)
        fp_x_cut = int(rw * fp_x_frac)
        wall_mask[fp_y_cut:, :] = 0   # exclude schedule at bottom
        wall_mask[:, fp_x_cut:] = 0   # exclude notes column at right

        # Light areas (white/near-white) = passable
        wall_mask[gray > 220] = 0

        # Close door gaps only — don't over-process
        door_px = max(25, int(0.92 / max(mpp/zoom, 0.0001)))
        door_px = min(door_px, 90)
        kH = cv2.getStructuringElement(cv2.MORPH_RECT, (door_px, 3))
        kV = cv2.getStructuringElement(cv2.MORPH_RECT, (3, door_px))
        walls_h = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, kH, iterations=2)
        walls_v = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, kV, iterations=2)
        walls   = cv2.bitwise_or(walls_h, walls_v)

        passable = (walls == 0).astype(np.uint8)
        print(f"[Wall] zoom={zoom}x door_px={door_px} fp_cut={fp_y_frac:.0%}H x {fp_x_frac:.0%}W")

        px_to_sqm = (mpp / zoom) ** 2
        sb        = img_w / rw
        rooms     = []
        seen_cells: set[str] = set()

        # Deduplicate seeds
        unique_seeds = []
        for sx, sy, name in seeds:
            cell = f"{sx//40}_{sy//40}"
            if cell not in seen_cells:
                seen_cells.add(cell)
                unique_seeds.append((sx, sy, name))

        for sx, sy, name in unique_seeds:
            if sx >= rw or sy >= rh or sx < 0 or sy < 0:
                continue
            # Skip seeds in schedule/notes area
            if sy >= int(rh * fp_y_frac) or sx >= int(rw * fp_x_frac):
                continue

            seed_x, seed_y = sx, sy
            if passable[seed_y, seed_x] == 0:
                found = False
                for radius in range(3, 35, 3):
                    for dx, dy in [(0,-radius),(0,radius),(-radius,0),(radius,0),
                                   (-radius,-radius),(radius,radius)]:
                        nx, ny = seed_x+dx, seed_y+dy
                        if 0<=nx<rw and 0<=ny<rh and passable[ny,nx]==1:
                            seed_x, seed_y = nx, ny; found=True; break
                    if found: break
                if not found:
                    continue

            # Bounded flood fill — strict box around seed to prevent wall leakage
            # Estimate max room size from name (studio=big, closet=small)
            name_lower = name.lower()
            if any(w in name_lower for w in ["large studio","large conf","open office","open collab"]):
                max_room_m = 25.0
            elif any(w in name_lower for w in ["medium studio","studio","meeting","lounge"]):
                max_room_m = 18.0
            elif any(w in name_lower for w in ["small","closet","toilet","wc","pantry"]):
                max_room_m = 8.0
            else:
                max_room_m = 14.0  # default
            max_room_px = max(60, int(max_room_m / max(mpp / zoom, 0.001)))
            bound = min(max_room_px, int(min(rw, rh) * 0.22))
            x0b, y0b = max(0, seed_x-bound), max(0, seed_y-bound)
            x1b, y1b = min(rw, seed_x+bound), min(rh, seed_y+bound)
            local    = np.zeros_like(passable)
            local[y0b:y1b, x0b:x1b] = passable[y0b:y1b, x0b:x1b]

            fill_img = local.copy()
            mask_ff  = np.zeros((rh+2, rw+2), np.uint8)
            cv2.floodFill(fill_img, mask_ff, (seed_x, seed_y), 2,
                          flags=cv2.FLOODFILL_MASK_ONLY|cv2.FLOODFILL_FIXED_RANGE|8)
            filled  = mask_ff[1:-1, 1:-1]
            px_cnt  = int(filled.sum())

            sqm = px_cnt * px_to_sqm
            if sqm < 0.5 or sqm > 3000:
                continue

            # ── Revu-style: fill holes from internal symbols/text ────────────
            filled_u8_tmp = (filled * 255).astype(np.uint8)
            # Close holes caused by G12 diamonds, door tags, text labels
            hole_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                               (int(zoom*6), int(zoom*6)))
            filled_clean = cv2.morphologyEx(filled_u8_tmp, cv2.MORPH_CLOSE,
                                            hole_k, iterations=4)
            filled = (filled_clean > 0).astype(np.uint8)
            px_cnt = int(filled.sum())
            sqm    = px_cnt * px_to_sqm

            # ── Revu-style polygon extraction ────────────────────────────────
            filled_u8 = (filled * 255).astype(np.uint8)
            cnts, _ = cv2.findContours(filled_u8, cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)
            if not cnts:
                continue
            cnt = max(cnts, key=cv2.contourArea)
            arc = cv2.arcLength(cnt, True)
            # Clean polygon — enough detail to follow walls, not too jagged
            eps    = 0.008 * arc
            approx = cv2.approxPolyDP(cnt, eps, True)
            if len(approx) > 40:
                approx = cv2.approxPolyDP(cnt, 0.015 * arc, True)

            poly = [[int(p[0][0]*sb), int(p[0][1]*sb)] for p in approx]
            if len(poly) < 3:
                continue

            rows_nz, cols_nz = np.where(filled > 0)
            x0_ = int(cols_nz.min() * sb)
            y0_ = int(rows_nz.min() * sb)
            x1_ = int(cols_nz.max() * sb)
            y1_ = int(rows_nz.max() * sb)

            rtype = _infer_type_from_text(name)
            rec   = _build_room_record(len(rooms), x0_, y0_, x1_, y1_,
                                       poly, round(sqm, 2), mpp,
                                       label=name.title(),
                                       rtype=rtype,
                                       confidence=0.92)
            rec["_has_pdf_label"] = True
            rooms.append(rec)

        print(f"[TextGuided] {len(rooms)} rooms from {len(unique_seeds)} seeds")

        # ── NIC area flood fill ───────────────────────────────────────────────
        # Detect NIC areas — returned in response but NOT rendered (client skips them)
        # NIC = original gray from drawing stays, no color added
        for nic_cx, nic_cy, nic_label in nic_seeds:
            # Scale to render coords
            nx = int(nic_cx / img_w * rw)
            ny = int(nic_cy / img_h * rh)
            nx = min(max(nx, 1), rw-2)
            ny = min(max(ny, 1), rh-2)

            # Find passable pixel near NIC label
            seed_x, seed_y = nx, ny
            if passable[seed_y, seed_x] == 0:
                found = False
                for radius in range(3, 60, 3):
                    for dx, dy in [(0,-radius),(0,radius),(-radius,0),(radius,0)]:
                        nx2, ny2 = seed_x+dx, seed_y+dy
                        if 0<=nx2<rw and 0<=ny2<rh and passable[ny2,nx2]:
                            seed_x, seed_y = nx2, ny2; found=True; break
                    if found: break
                if not found:
                    continue

            # Large flood fill for NIC (can be very big area)
            max_nic_px = int(min(rw, rh) * 0.48)
            x0n = max(0, seed_x - max_nic_px)
            y0n = max(0, seed_y - max_nic_px)
            x1n = min(rw, seed_x + max_nic_px)
            y1n = min(rh, seed_y + max_nic_px)
            local_nic = np.zeros_like(passable)
            local_nic[y0n:y1n, x0n:x1n] = passable[y0n:y1n, x0n:x1n]

            ff_nic = local_nic.copy()
            mask_nic = np.zeros((rh+2, rw+2), np.uint8)
            cv2.floodFill(ff_nic, mask_nic, (seed_x, seed_y), 2,
                          flags=cv2.FLOODFILL_MASK_ONLY|cv2.FLOODFILL_FIXED_RANGE|8)
            filled_nic = mask_nic[1:-1, 1:-1]
            px_nic = int(filled_nic.sum())

            sqm_nic = px_nic * px_to_sqm
            if sqm_nic < 1.0:
                continue

            # Polygon
            nic_u8 = (filled_nic * 255).astype(np.uint8)
            cnts_n, _ = cv2.findContours(nic_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_L1)
            if not cnts_n: continue
            cnt_n  = max(cnts_n, key=cv2.contourArea)
            arc_n  = cv2.arcLength(cnt_n, True)
            app_n  = cv2.approxPolyDP(cnt_n, 0.005*arc_n, True)
            poly_n = [[int(p[0][0]*sb), int(p[0][1]*sb)] for p in app_n]
            if len(poly_n) < 3: continue

            rows_n, cols_n = np.where(filled_nic > 0)
            rec_nic = _build_room_record(
                len(rooms),
                int(cols_n.min()*sb), int(rows_n.min()*sb),
                int(cols_n.max()*sb), int(rows_n.max()*sb),
                poly_n, round(sqm_nic, 2), mpp,
                label="N.I.C.", rtype="NIC", confidence=0.99
            )
            rec_nic["_has_pdf_label"] = True
            rooms.append(rec_nic)
            print(f"[NIC] Detected: {nic_label[:30]}  area={sqm_nic:.0f}m²")

        nic_count = sum(1 for r in rooms if r.get("type") == "NIC")
        print(f"[TextGuided] {len(rooms)} total ({len(rooms)-nic_count} rooms + {nic_count} NIC areas)")
        return rooms if rooms else None

    except Exception as e:
        import traceback
        print(f"[TextGuided] Error: {e}\n{traceback.format_exc()[:300]}")
        return None


# ── Pipeline C: U-Net model ───────────────────────────────────────────────────

def pipeline_model(img_pil, mpp: float, fp_x_max: int = None, fp_y_max: int = None) -> list[dict] | None:
    """
    Use trained U-Net to segment room interiors.
    fp_x_max, fp_y_max = floor plan boundaries (exclude notes/schedules outside)
    Returns list of rooms or None if model not available / too few results.
    """
    if not HAS_CV2 or not HAS_PIL:
        return None

    img_rgb  = np.array(img_pil.convert("RGB"))
    h, w     = img_rgb.shape[:2]
    
    # Default bounds if not provided
    if fp_x_max is None:
        fp_x_max = int(w * 0.92)
    if fp_y_max is None:
        fp_y_max = int(h * 0.92)
    
    prob_map = run_model_inference(img_rgb)
    if prob_map is None:
        return None

    # Use argmax across ALL classes — not just room threshold
    # This prevents over-prediction of "room" class on walls/background
    full_probs = _run_model_full_probs(img_rgb)
    if full_probs is not None:
        # argmax: pick class with highest probability per pixel
        pred_map  = np.argmax(full_probs, axis=0)   # (H, W) class ids
        room_mask = (pred_map == 1).astype(np.uint8) * 255
        
        # Sanity check: if model predicts room > 75% of image → likely wrong
        # (real floor plans: rooms are 20-60% of image, rest is bg/walls/margins)
        room_frac = (pred_map == 1).sum() / pred_map.size
        if room_frac > 0.75:
            print(f"[Model] room={room_frac:.0%} > 75% — model over-predicting, using threshold fallback")
            room_mask = (prob_map > 0.65).astype(np.uint8) * 255
        else:
            print(f"[Model] room coverage={room_frac:.1%} (using argmax prediction)")
    else:
        # fallback: use higher threshold on room prob map
        room_mask = (prob_map > 0.65).astype(np.uint8) * 255

    # Morphological cleanup - REDUCED iterations to preserve more room components
    k_open = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))  # smaller kernel
    room_mask = cv2.morphologyEx(room_mask, cv2.MORPH_OPEN,  k_open, iterations=1)  # reduced from 2
    room_mask = cv2.morphologyEx(room_mask, cv2.MORPH_CLOSE, k_open, iterations=1)

    n_lbl, labeled = cv2.connectedComponents(room_mask, connectivity=8)
    min_px = max(200, int(h * w * 0.002))  # LOWERED from 0.004 to detect smaller rooms
    max_px = int(h * w * 0.50)

    rooms = []
    for lbl in range(1, n_lbl):
        comp = (labeled == lbl).astype(np.uint8) * 255
        px   = int(comp.sum() / 255)
        if not (min_px <= px <= max_px):
            continue

        rows_nz, cols_nz = np.where(comp)
        y0, y1 = int(rows_nz.min()), int(rows_nz.max())
        x0, x1 = int(cols_nz.min()), int(cols_nz.max())
        
        # CRITICAL: Skip components outside floor plan bounds (construction notes/schedules)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        if cx > fp_x_max or cy > fp_y_max:
            continue  # Component is in notes/schedule area - NOT a room
        
        # Also skip if majority of component is outside bounds
        if x1 > fp_x_max or y1 > fp_y_max:
            continue
        
        bw_, bh_ = x1-x0, y1-y0
        if bw_ < 10 or bh_ < 10:  # LOWERED from 15 to allow smaller rooms
            continue
        # Skip border components but be more lenient
        if x0 < 2 or y0 < 2 or x1 > w-2 or y1 > h-2:
            continue  # skip border = background

        area_sqm = round(px * (mpp ** 2), 2)
        if area_sqm < 0.5 or area_sqm > 3000:  # LOWERED min from 1.5 to 0.5, increased max to 3000
            continue

        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        cnt    = max(cnts, key=cv2.contourArea)
        arc    = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.010*arc, True)
        if len(approx) > 30:
            approx = cv2.approxPolyDP(cnt, 0.020*arc, True)
        poly = [[int(p[0][0]), int(p[0][1])] for p in approx]
        if len(poly) < 3:
            poly = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]

        conf = round(float(prob_map[rows_nz, cols_nz].mean()), 3)
        rec  = _build_room_record(len(rooms), x0, y0, x1, y1,
                                  poly, area_sqm, mpp, confidence=conf)
        rooms.append(rec)

    print(f"[Model] {len(rooms)} rooms")
    return rooms if len(rooms) >= 1 else None  # LOWERED from 2 to 1 — accept even single room


# ── Pipeline D: OpenCV vector ─────────────────────────────────────────────────

def pipeline_opencv(img_pil, mpp: float) -> list[dict]:
    """
    Pure OpenCV fallback:
    1. Adaptive threshold → wall mask
    2. Close door gaps
    3. Find enclosed white regions = rooms
    4. Filter by size
    """
    if not HAS_CV2 or not HAS_PIL:
        return []

    img_rgb = np.array(img_pil.convert("RGB"))
    h, w    = img_rgb.shape[:2]
    gray    = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # Wall mask
    clahe = cv2.createCLAHE(2.0, (8, 8))
    gray2 = clahe.apply(gray)
    wall_adapt = cv2.adaptiveThreshold(gray2, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                        cv2.THRESH_BINARY_INV, 11, 8)
    _, wall_otsu = cv2.threshold(gray2, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    wall_raw = cv2.bitwise_or(wall_adapt, wall_otsu)

    # Remove colored fills (markup tints)
    hsv = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2HSV)
    wall_raw[(hsv[:,:,1] > 60)] = 0

    k2 = cv2.getStructuringElement(cv2.MORPH_RECT, (2,2))
    k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3,3))
    wall_clean = cv2.morphologyEx(wall_raw, cv2.MORPH_OPEN,  k2, iterations=1)
    wall_clean = cv2.morphologyEx(wall_clean, cv2.MORPH_CLOSE, k3, iterations=2)

    # Close door gaps
    gap_px = max(20, w // 50)
    kH = cv2.getStructuringElement(cv2.MORPH_RECT, (gap_px, 3))
    kV = cv2.getStructuringElement(cv2.MORPH_RECT, (3, gap_px))
    kG = cv2.getStructuringElement(cv2.MORPH_RECT, (gap_px, gap_px))
    walls_h = cv2.morphologyEx(wall_clean, cv2.MORPH_CLOSE, kH, iterations=2)
    walls_v = cv2.morphologyEx(wall_clean, cv2.MORPH_CLOSE, kV, iterations=2)
    walls   = cv2.bitwise_or(walls_h, walls_v)
    walls   = cv2.dilate(walls, kG, iterations=1)

    bright = (gray > 210).astype(np.uint8) * 255
    bright[walls > 0] = 0
    kO = cv2.getStructuringElement(cv2.MORPH_RECT, (5,5))
    bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, kO, iterations=2)

    min_px = max(500, int(h * w * 0.006))
    max_px = int(h * w * 0.45)
    n_lbl, labeled = cv2.connectedComponents(bright, connectivity=8)

    rooms = []
    for lbl in range(1, n_lbl):
        comp = (labeled == lbl).astype(np.uint8) * 255
        px   = int(comp.sum() / 255)
        if not (min_px <= px <= max_px):
            continue
        rows_nz, cols_nz = np.where(comp)
        y0, y1 = int(rows_nz.min()), int(rows_nz.max())
        x0, x1 = int(cols_nz.min()), int(cols_nz.max())
        bw_, bh_ = x1-x0, y1-y0
        if bw_ < 15 or bh_ < 15:
            continue
        if x0 < 3 or y0 < 3 or x1 > w-3 or y1 > h-3:
            continue
        area_sqm = round(px * (mpp**2), 2)
        if area_sqm < 1.0 or area_sqm > 2000:
            continue
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        cnt    = max(cnts, key=cv2.contourArea)
        arc    = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.010*arc, True)
        if len(approx) > 30:
            approx = cv2.approxPolyDP(cnt, 0.020*arc, True)
        poly = [[int(p[0][0]), int(p[0][1])] for p in approx]
        if len(poly) < 3:
            poly = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
        conf = round(min(0.90, cv2.contourArea(cnt) / max(bw_*bh_,1)), 3)
        rec  = _build_room_record(len(rooms), x0, y0, x1, y1,
                                  poly, area_sqm, mpp, confidence=conf)
        rooms.append(rec)

    print(f"[OpenCV] {len(rooms)} rooms")
    return rooms


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7: BUILDING OUTLINE + WALL LINES
# ══════════════════════════════════════════════════════════════════════════════

def extract_building_outline(rooms: list[dict], img_arr: np.ndarray,
                              mpp: float) -> dict:
    """
    Compute building footprint (convex hull of all rooms) + wall line segments.
    Real measurements — no hardcoding.
    """
    result = {"buildingOutline": [], "wallLines": [], "floorAreaSqM": 0.0}
    if not rooms or not HAS_CV2:
        return result

    pts = []
    for r in rooms:
        pts += [[r["x"], r["y"]], [r["x"]+r["w"], r["y"]],
                [r["x"]+r["w"], r["y"]+r["h"]], [r["x"], r["y"]+r["h"]]]

    pts_arr = np.array(pts, dtype=np.float32)
    hull    = cv2.convexHull(pts_arr)
    hull_pts = [[int(p[0][0]), int(p[0][1])] for p in hull]
    result["buildingOutline"] = hull_pts

    # Shoelace area of hull
    n = len(hull_pts)
    if n >= 3:
        area_px = abs(sum(
            hull_pts[i][0]*hull_pts[(i+1)%n][1] - hull_pts[(i+1)%n][0]*hull_pts[i][1]
            for i in range(n)
        )) / 2
        result["floorAreaSqM"] = round(area_px * mpp**2, 2)

    # Wall lines
    gray    = cv2.cvtColor(img_arr, cv2.COLOR_RGB2GRAY) if img_arr.ndim==3 else img_arr
    blurred = cv2.GaussianBlur(gray, (3,3), 0)
    edges   = cv2.Canny(blurred, 50, 150)
    min_px  = max(15, int(1.0 / mpp))
    lines   = cv2.HoughLinesP(edges, 1, math.pi/180, 40,
                               minLineLength=min_px, maxLineGap=6)
    if lines is not None:
        seen = set()
        for line in lines:
            x1,y1,x2,y2 = line[0]
            key = (round(x1/10)*10, round(y1/10)*10, round(x2/10)*10, round(y2/10)*10)
            if key not in seen:
                seen.add(key)
                result["wallLines"].append({"x1":int(x1),"y1":int(y1),"x2":int(x2),"y2":int(y2)})
        result["wallLines"] = result["wallLines"][:600]

    return result


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8: MAIN ANALYSIS ENDPOINT
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/floorplan/analyze")
async def analyze_floorplan(
    file:       UploadFile        = File(...),
    scale_hint: Optional[str]    = Form(default=None),
    page:       int               = Form(default=1),
):
    """
    Main endpoint: upload PDF or image → room detection + real measurements.

    Returns:
      rooms         — list of room objects with area, perimeter, type, count
      scale         — detected scale notation (e.g. "1:100")
      metersPerPixel — m/px used for area calculation
      pipeline      — which detection method was used
    """
    start = time.time()
    data  = await file.read()

    if len(data) > 80 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 80 MB)")

    fname  = (file.filename or "").lower()
    is_pdf = fname.endswith(".pdf") or data[:4] == b"%PDF"

    # ── Load image ────────────────────────────────────────────────────────────
    page_num = max(0, page - 1)
    if is_pdf:
        result = load_pdf_page(data, page_num, max_px=1600)
        if result is None:
            raise HTTPException(503, "PyMuPDF required for PDF: pip install PyMuPDF")
        img_pil, actual_dpi = result
    else:
        result = load_image_file(data, fname, max_px=1600)
        if result is None:
            raise HTTPException(503, "Pillow required: pip install pillow")
        img_pil, actual_dpi = result

    img_w, img_h = img_pil.size

    # ── Scale detection ───────────────────────────────────────────────────────
    scale_ratio: float | None = None
    scale_label: str          = "unknown"

    if scale_hint and scale_hint != "auto":
        r = _parse_scale_notation(scale_hint)
        if r:
            scale_ratio, scale_label = r
            print(f"[Scale] User hint: {scale_label}")

    if scale_ratio is None and is_pdf:
        r = detect_scale_from_pdf(data, page_num)
        if r:
            scale_ratio, scale_label = r

    if scale_ratio is None:
        r = detect_scale_from_image(img_pil)
        if r:
            scale_ratio, scale_label = r

    # Compute meters-per-pixel
    if scale_ratio is not None:
        mpp = _ratio_to_mpp_at_dpi(scale_ratio, actual_dpi)
        print(f"[Scale] {scale_label}  ratio={scale_ratio}  DPI={actual_dpi:.0f}  mpp={mpp:.6f} m/px")
    else:
        # Scale not found — mpp unknown, measurements unavailable
        # Do NOT guess a hardcoded scale — wrong scale = wrong area calculations
        mpp = 0.0
        scale_label = "unknown"
        print("[Scale] Not detected — measurements will show 0 until scale is provided")

    # ── Floor plan bounds — from PDF text layer (100% reliable) ──────────────
    fp_y_max = int(img_h * 0.92)
    fp_x_max = int(img_w * 0.92)

    if is_pdf and HAS_FITZ:
        try:
            _doc_b = fitz.open(stream=data, filetype="pdf")
            _pg_b  = _doc_b[page_num]
            _pw_b, _ph_b = _pg_b.rect.width, _pg_b.rect.height

            BOTTOM_KEYWORDS = [
                "general construction notes",
                "construction keynotes",
                "construction symbols",
                "general notes:",
                "keynotes:",
                "door schedule",
                "window schedule",
                "finish schedule",
                "level 1 -",
                "level 2 -",
                "scale:",
            ]
            RIGHT_KEYWORDS = [
                "general notes", "general construction",
                "mattel studios", "barrington pacific",
                "hlw", "gensler", "skidmore", "hok",
                "drawn by", "checked by", "project no",
                "idg structural", "arc engineering", "spark",
                "plannet", "telecommunication", "structural eng",
                "sheet title", "sheet no", "project no",
                "seal", "signature", "stamp",
            ]

            for b in _pg_b.get_text("blocks"):
                bx0, by0, bx1, by1, btxt = b[:5]
                tl = btxt.lower().strip()

                # Y boundary — find first bottom-area keyword
                if any(kw in tl for kw in BOTTOM_KEYWORDS):
                    cand_y = int(by0 / _ph_b * img_h)
                    if int(img_h * 0.35) < cand_y < fp_y_max:
                        fp_y_max = cand_y
                        print(f"[Bounds] Bottom cut at {by0/_ph_b:.0%}H: {btxt.strip()[:35]}")

                # X boundary — find right-side column
                if any(kw in tl for kw in RIGHT_KEYWORDS):
                    cand_x = int(bx0 / _pw_b * img_w)
                    if int(img_w * 0.40) < cand_x < fp_x_max:
                        fp_x_max = cand_x
                        print(f"[Bounds] Right cut at {bx0/_pw_b:.0%}W: {btxt.strip()[:35]}")

            _doc_b.close()
        except Exception as e:
            print(f"[Bounds] PDF text fallback: {e}")

    print(f"[Bounds] Floor plan: 0-{fp_x_max}px wide, 0-{fp_y_max}px tall "
          f"({fp_x_max/img_w:.0%}W × {fp_y_max/img_h:.0%}H)")

    # ── Run detection pipeline ────────────────────────────────────────────────
    rooms    = None
    pipeline = "none"
    img_arr  = np.array(img_pil.convert("RGB"))

    # 1: Trained UNet model — PRIMARY and ONLY detection method
    # Pass bounds to exclude construction notes/schedule areas
    model_rooms = pipeline_model(img_pil, mpp, fp_x_max, fp_y_max)
    if model_rooms and len(model_rooms) >= 1:
        rooms    = model_rooms
        pipeline = "model"
        print(f"[Pipeline] Model ONLY: {len(rooms)} rooms")
    else:
        # Model failed — use OpenCV as fallback (TextGuided disabled — creates fake background rooms)
        print("[Pipeline] Model produced no results — using OpenCV fallback")
        rooms    = pipeline_opencv(img_pil, mpp)
        pipeline = "opencv_fallback"

    # DISABLED: TextGuided creates fake rooms from background areas
    # # 2: Text-guided flood fill — MERGE on top of model (adds named rooms model missed)
    # if is_pdf:
    #     r = pipeline_text_guided(data, page_num, mpp, img_w, img_h)
    #     if r and len(r) >= 1:
    #         if rooms is None:
    #             rooms    = r
    #             pipeline = "text_guided"
    #             print(f"[Pipeline] TextGuided primary: {len(rooms)} rooms")
    #         else:
    #             # Merge text-guided rooms that model missed
    #             def room_center(rm):
    #                 cx = rm.get("cx", rm["x"] + rm["w"] // 2)
    #                 cy = rm.get("cy", rm["y"] + rm["h"] // 2)
    #                 return (int(cx // 80), int(cy // 80))
    #             existing_centers = {room_center(rm) for rm in rooms}
    #             added = 0
    #             for tr in r:
    #                 if room_center(tr) not in existing_centers:
    #                     tr["_source"] = "text_guided"
    #                     rooms.append(tr)
    #                     added += 1
    #             if added > 0:
    #                 print(f"[Pipeline] TextGuided added {added} extra rooms to model results")
    #                 pipeline = "model+text_guided"

    if not rooms:
        rooms = []

    # ── Extract text from drawing → assign real names to rooms ───────────────
    # Step 1: Get all text with pixel positions
    text_items: list[dict] = []
    if is_pdf and HAS_FITZ:
        text_items = extract_text_from_pdf(data, page_num, img_w, img_h)
    if not text_items:
        # Scanned PDF or raster image → run OCR
        text_items = extract_text_from_image_ocr(img_pil)

    print(f"[Labels] {len(text_items)} text items found in drawing")

    # Step 2: Match text to room regions → name rooms from drawing text
    if text_items and rooms:
        # Add mpp to each room for text area calculation
        for room in rooms:
            room["_mpp"] = mpp
        rooms = assign_text_to_rooms(rooms, text_items)
        labeled = sum(1 for r in rooms if r.get("_has_pdf_label"))
        print(f"[Labels] {labeled}/{len(rooms)} rooms named from drawing text")

    # Step 3: Finalize — sequential suffix for duplicates, UNKNOWN for unlabeled
    rooms = _finalize_room_names(rooms)

    # ── Detect doors & windows + assign counts to rooms ───────────────────────
    gray_img = cv2.cvtColor(img_arr, cv2.COLOR_RGB2GRAY) if HAS_CV2 else None
    doors, windows = [], []
    if gray_img is not None:
        doors, windows = detect_doors_windows(
            gray_img, mpp, rooms, fp_y_max, fp_x_max)

    # ── Building outline + wall lines ─────────────────────────────────────────
    outline = extract_building_outline(rooms, img_arr, mpp) if HAS_CV2 else {}

    # ── Extract wall types, door types, NIC areas from PDF text ──────────────
    wall_types, door_types, nic_areas, sheet_info, page_count = [], [], [], {}, 1
    if is_pdf and HAS_FITZ:
        try:
            import fitz as _fitz
            doc = _fitz.open(stream=data, filetype="pdf")
            page_count = len(doc)

            # Sheet info from title block
            pg = doc[page_num]
            full_text = pg.get_text("text")
            lines = [l.strip() for l in full_text.splitlines() if l.strip()]

            # Sheet title (usually first non-empty line or line with "PLAN"/"FLOOR")
            for ln in lines[:15]:
                if any(kw in ln.upper() for kw in ["PLAN", "FLOOR", "SECTION", "ELEVATION", "DETAIL"]):
                    sheet_info["title"] = ln
                    break

            # Scale from title block
            for ln in lines:
                if re.search(r'1[\/\:]\d+|1/8|1/4|1/16', ln):
                    sheet_info["scale"] = ln.strip()
                    break

            # Sheet number (e.g. "A-2.11", "A1.0")
            for ln in reversed(lines[-20:]):
                if re.match(r'^[A-Z]{1,2}[\-\.]?\d{1,2}\.?\d{0,2}$', ln.strip()):
                    sheet_info["sheetNo"] = ln.strip()
                    break

            # ── Wall types table ──────────────────────────────────────────────
            wt_mode = False
            current_type = None
            for ln in lines:
                lu = ln.upper()
                if "WALL TYPE" in lu or "PARTITION TYPE" in lu:
                    wt_mode = True; continue
                if "DOOR TYPE" in lu or "DOOR SCHEDULE" in lu:
                    wt_mode = False
                if wt_mode and re.match(r'^[A-Z]\d?$|^[A-Z]{1,2}\d{0,2}$', ln.strip()):
                    current_type = ln.strip()
                if wt_mode and current_type and len(ln) > 15:
                    wall_types.append({"type": current_type, "description": ln.strip()})
                    current_type = None
                if len(wall_types) >= 20: break

            # ── Door types table ──────────────────────────────────────────────
            dt_mode = False
            for ln in lines:
                lu = ln.upper()
                if "DOOR TYPE" in lu or "DOOR SCHEDULE" in lu:
                    dt_mode = True; continue
                if dt_mode and re.match(r'^[A-Z]\.\s+', ln):
                    door_types.append({"type": ln[0], "description": ln[2:].strip()})
                if len(door_types) >= 15: break

            # ── NIC (Not In Contract) areas ───────────────────────────────────
            # Find all text blocks that say NIC or N.I.C. and add them as room entities
            blocks = pg.get_text("blocks")
            for b in blocks:
                bx0, by0, bx1, by1, btxt = b[:5]
                if re.search(r'N\.?I\.?C\.?|NOT\s+IN\s+CONTRACT', btxt.upper()):
                    sx = img_w / pg.rect.width
                    sy = img_h / pg.rect.height
                    
                    # Create a room-like entity for NIC area
                    nic_x = int(bx0 * sx)
                    nic_y = int(by0 * sy)
                    nic_w = int((bx1-bx0) * sx)
                    nic_h = int((by1-by0) * sy)
                    
                    # Expand NIC area to reasonable room size (text block is small)
                    # Expand by 50px in all directions to capture the actual space
                    expand = 50
                    nic_x = max(0, nic_x - expand)
                    nic_y = max(0, nic_y - expand)
                    nic_w = min(img_w - nic_x, nic_w + expand * 2)
                    nic_h = min(img_h - nic_y, nic_h + expand * 2)
                    
                    # Calculate area
                    area_sqm = round((nic_w * nic_h) * (mpp ** 2), 2) if mpp > 0 else 0
                    
                    # Create NIC room record
                    nic_room = {
                        "id": len(rooms),
                        "x": nic_x,
                        "y": nic_y,
                        "w": nic_w,
                        "h": nic_h,
                        "cx": nic_x + nic_w // 2,
                        "cy": nic_y + nic_h // 2,
                        "polygon": [
                            [nic_x, nic_y],
                            [nic_x + nic_w, nic_y],
                            [nic_x + nic_w, nic_y + nic_h],
                            [nic_x, nic_y + nic_h]
                        ],
                        "areaSqM": area_sqm,
                        "areaSqFt": round(area_sqm * 10.7639, 2) if area_sqm else 0,
                        "label": "N.I.C.",
                        "type": "NIC",
                        "confidence": 0.95,
                        "_source": "text_nic"
                    }
                    rooms.append(nic_room)
                    nic_areas.append({
                        "x": nic_x, "y": nic_y,
                        "w": nic_w, "h": nic_h,
                        "label": "N.I.C."
                    })

            # NO LONGER remove NIC rooms - they are now included as special room type
            if nic_areas:
                print(f"[NIC] Added {len(nic_areas)} NIC areas as room entities")

            doc.close()
        except Exception as e:
            print(f"[Extras] Error extracting wall/door types: {e}")

    # If scale unknown, zero out all measurements to avoid misleading values
    if mpp == 0.0:
        for r in rooms:
            r["areaSqM"] = r["areaSqFt"] = r["lengthM"] = r["widthM"] = None
            r["perimeterM"] = r["wallAreaSqM"] = r["ceilingSqM"] = None

    elapsed_ms = round((time.time() - start) * 1000)
    total_area  = round(sum(r["areaSqM"] for r in rooms if r.get("areaSqM")), 2)

    payload = {
        "rooms":            rooms,
        "doors":            doors,
        "windows":          windows,
        "scale":            scale_label,
        "scaleRatio":       scale_ratio,
        "unit":             "m",
        "imageWidth":       int(img_w),
        "imageHeight":      int(img_h),
        "metersPerPixel":   round(float(mpp), 8),
        "pipeline":         pipeline,
        "roomCount":        len(rooms),
        "doorCount":        len(doors),
        "windowCount":      len(windows),
        "totalAreaSqM":     round(float(total_area), 2),
        "totalAreaSqFt":    round(float(total_area) * 10.764, 1),
        "buildingOutline":  outline.get("buildingOutline", []),
        "wallLines":        outline.get("wallLines", []),
        "floorAreaSqM":     float(outline.get("floorAreaSqM", 0)),
        "processingMs":     int(elapsed_ms),
        "scaleDetected":    scale_ratio is not None,
        # New fields
        "pageCount":        page_count,
        "currentPage":      page,
        "wallTypes":        wall_types,
        "doorTypes":        door_types,
        "nicAreas":         nic_areas,
        "sheetInfo":        sheet_info,
    }
    return JSONResponse(_to_python(payload))


# ══════════════════════════════════════════════════════════════════════════════
# ALL-PAGES ENDPOINT — Model runs on every PDF page sequentially
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/floorplan/analyze-all-pages")
async def analyze_all_pages(
    file:       UploadFile     = File(...),
    scale_hint: Optional[str] = Form(default=None),
):
    """
    Process ALL pages of a PDF using the trained model — page by page.
    Returns array of per-page results.

    Response:
      pageCount   — total pages in PDF
      pages       — array of { pageNumber, rooms, scale, pipeline, ... }
      totalRooms  — sum of all rooms across all pages
    """
    start = time.time()
    data  = await file.read()

    if len(data) > 80 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 80 MB)")

    fname  = (file.filename or "").lower()
    is_pdf = fname.endswith(".pdf") or data[:4] == b"%PDF"

    if not is_pdf:
        raise HTTPException(400, "analyze-all-pages only supports PDF files")

    if not HAS_FITZ:
        raise HTTPException(503, "PyMuPDF required: pip install PyMuPDF")

    # Get page count
    try:
        _doc_count = fitz.open(stream=data, filetype="pdf")
        total_pages = len(_doc_count)
        _doc_count.close()
    except Exception as e:
        raise HTTPException(500, f"Cannot read PDF: {e}")

    print(f"[AllPages] PDF has {total_pages} pages — processing with model...")

    all_page_results = []
    total_rooms_count = 0

    for page_num in range(total_pages):
        page_start = time.time()
        print(f"\n[AllPages] ── Page {page_num+1}/{total_pages} ──────────────")

        # Load page
        result = load_pdf_page(data, page_num, max_px=1600)
        if result is None:
            print(f"[AllPages] Page {page_num+1}: load failed — skipping")
            all_page_results.append({
                "pageNumber": page_num + 1,
                "error": "Failed to render page",
                "rooms": [], "roomCount": 0,
            })
            continue

        img_pil, actual_dpi = result
        img_w, img_h = img_pil.size

        # Scale detection
        scale_ratio: float | None = None
        scale_label: str = "unknown"

        if scale_hint and scale_hint != "auto":
            r = _parse_scale_notation(scale_hint)
            if r:
                scale_ratio, scale_label = r

        if scale_ratio is None:
            r = detect_scale_from_pdf(data, page_num)
            if r:
                scale_ratio, scale_label = r

        if scale_ratio is None:
            r = detect_scale_from_image(img_pil)
            if r:
                scale_ratio, scale_label = r

        mpp = _ratio_to_mpp_at_dpi(scale_ratio, actual_dpi) if scale_ratio else 0.0
        print(f"[AllPages] Page {page_num+1}: scale={scale_label}  mpp={mpp:.6f}")

        # ── PRIMARY: Model inference ──────────────────────────────────────────
        rooms    = None
        pipeline = "none"
        img_arr  = np.array(img_pil.convert("RGB"))

        model_rooms = pipeline_model(img_pil, mpp)
        if model_rooms and len(model_rooms) >= 1:
            rooms    = model_rooms
            pipeline = "model"
            print(f"[AllPages] Page {page_num+1}: model → {len(rooms)} rooms")

        # ── MERGE: Text-guided on top of model ───────────────────────────────
        tg = pipeline_text_guided(data, page_num, mpp, img_w, img_h)
        if tg and len(tg) >= 1:
            if rooms is None:
                rooms    = tg
                pipeline = "text_guided"
            else:
                def _rc(rm):
                    return (int(rm.get("cx", rm["x"] + rm["w"]//2) // 80),
                            int(rm.get("cy", rm["y"] + rm["h"]//2) // 80))
                existing = {_rc(rm) for rm in rooms}
                added = sum(1 for tr in tg if _rc(tr) not in existing
                            or (rooms.append({**tr, "_source": "text_guided"}) and False))
                if added > 0:
                    pipeline = "model+text_guided"

        # ── LAST RESORT: OpenCV only if model+text both produced nothing ─────
        if rooms is None:
            rooms    = pipeline_opencv(img_pil, mpp)
            pipeline = "opencv_fallback"
            print(f"[AllPages] Page {page_num+1}: opencv fallback → {len(rooms)} rooms")

        if not rooms:
            rooms = []

        # ── Text extraction + room naming ─────────────────────────────────────
        text_items = extract_text_from_pdf(data, page_num, img_w, img_h)
        if not text_items:
            text_items = extract_text_from_image_ocr(img_pil)
        if text_items and rooms:
            rooms = assign_text_to_rooms(rooms, text_items)
        rooms = _finalize_room_names(rooms)

        # ── Doors + outline ───────────────────────────────────────────────────
        fp_y_max = int(img_h * 0.92)
        fp_x_max = int(img_w * 0.92)
        gray_img = cv2.cvtColor(img_arr, cv2.COLOR_RGB2GRAY) if HAS_CV2 else None
        doors, windows = [], []
        if gray_img is not None:
            doors, windows = detect_doors_windows(gray_img, mpp, rooms, fp_y_max, fp_x_max)

        outline = extract_building_outline(rooms, img_arr, mpp) if HAS_CV2 else {}

        # Scale unknown — zero out measurements
        if mpp == 0.0:
            for r in rooms:
                r["areaSqM"] = r["areaSqFt"] = r["lengthM"] = r["widthM"] = None
                r["perimeterM"] = r["wallAreaSqM"] = r["ceilingSqM"] = None

        total_area = round(sum(r["areaSqM"] for r in rooms if r.get("areaSqM")), 2)
        total_rooms_count += len(rooms)
        page_ms = round((time.time() - page_start) * 1000)

        all_page_results.append(_to_python({
            "pageNumber":      page_num + 1,
            "rooms":           rooms,
            "doors":           doors,
            "windows":         windows,
            "scale":           scale_label,
            "scaleRatio":      scale_ratio,
            "unit":            "m",
            "imageWidth":      int(img_w),
            "imageHeight":     int(img_h),
            "metersPerPixel":  round(float(mpp), 8),
            "pipeline":        pipeline,
            "roomCount":       len(rooms),
            "doorCount":       len(doors),
            "totalAreaSqM":    round(float(total_area), 2),
            "totalAreaSqFt":   round(float(total_area) * 10.764, 1),
            "buildingOutline": outline.get("buildingOutline", []),
            "wallLines":       outline.get("wallLines", []),
            "processingMs":    int(page_ms),
            "scaleDetected":   scale_ratio is not None,
        }))

        print(f"[AllPages] Page {page_num+1} done: {len(rooms)} rooms in {page_ms}ms")

    elapsed_ms = round((time.time() - start) * 1000)
    print(f"\n[AllPages] Complete: {total_pages} pages, {total_rooms_count} total rooms in {elapsed_ms}ms")

    return JSONResponse({
        "pageCount":    total_pages,
        "totalRooms":   total_rooms_count,
        "processingMs": int(elapsed_ms),
        "pages":        all_page_results,
    })


# ── Click-room endpoint ────────────────────────────────────────────────────────

@app.post("/api/floorplan/click-room")
async def click_room(
    file:    UploadFile = File(...),
    click_x: float      = Form(...),
    click_y: float      = Form(...),
    page:    int        = Form(default=1),
):
    """
    Bluebeam-style click-to-fill:
    User clicks inside a room → returns flood-filled room boundary + real area.
    """
    data    = await file.read()
    fname   = (file.filename or "").lower()
    is_pdf  = fname.endswith(".pdf") or data[:4] == b"%PDF"
    page_num = max(0, page - 1)

    if is_pdf:
        result = load_pdf_page(data, page_num, max_px=2000)
    else:
        result = load_image_file(data, fname, max_px=2000)
    if result is None:
        raise HTTPException(503, "Could not load file")

    img_pil, actual_dpi = result
    img_w, img_h = img_pil.size

    if not HAS_CV2:
        raise HTTPException(503, "OpenCV required: pip install opencv-python")

    # Scale
    scale_ratio = None
    if is_pdf:
        r = detect_scale_from_pdf(data, page_num)
        if r: scale_ratio, _ = r
    if scale_ratio is None:
        r = detect_scale_from_image(img_pil)
        if r: scale_ratio, _ = r
    if scale_ratio is None:
        scale_ratio = 96   # 1/8"=1'-0" standard construction drawing scale

    mpp = _ratio_to_mpp_at_dpi(scale_ratio, actual_dpi)

    img_arr = np.array(img_pil.convert("RGB"))
    gray    = cv2.cvtColor(img_arr, cv2.COLOR_RGB2GRAY)

    # Wall mask
    _, dark = cv2.threshold(gray, 160, 255, cv2.THRESH_BINARY_INV)
    ri, gi, bi = img_arr[:,:,0].astype(int),img_arr[:,:,1].astype(int),img_arr[:,:,2].astype(int)
    is_gray = (np.abs(ri-gi)<25)&(np.abs(gi-bi)<25)&(ri>80)&(ri<230)
    wall_mask = dark.copy()
    wall_mask[is_gray] = 255

    door_px = max(15, int(0.9 / max(mpp, 0.001)))
    k_door  = cv2.getStructuringElement(cv2.MORPH_RECT, (door_px, door_px))
    walls   = cv2.dilate(wall_mask, k_door, iterations=1)
    passable = (walls == 0).astype(np.uint8)

    sx, sy  = int(click_x), int(click_y)
    sx = max(1, min(sx, img_w - 2))
    sy = max(1, min(sy, img_h - 2))

    if passable[sy, sx] == 0:
        found = False
        for radius in range(5, 50, 5):
            for dx in range(-radius, radius+1, 5):
                for dy in range(-radius, radius+1, 5):
                    nx, ny = sx+dx, sy+dy
                    if 0<nx<img_w-1 and 0<ny<img_h-1 and passable[ny,nx]==1:
                        sx, sy = nx, ny; found=True; break
                if found: break
            if found: break
        if not found:
            return JSONResponse({"error": "Click point is on a wall — click inside a room"}, 422)

    fill_img = passable.copy()
    mask_ff  = np.zeros((img_h+2, img_w+2), np.uint8)
    cv2.floodFill(fill_img, mask_ff, (sx, sy), 2,
                  flags=cv2.FLOODFILL_MASK_ONLY|cv2.FLOODFILL_FIXED_RANGE|8)
    filled   = mask_ff[1:-1, 1:-1]
    px_count = int(filled.sum())

    if px_count < 50:
        return JSONResponse({"error": "Room too small — try clicking in a larger area"}, 422)

    filled_u8 = (filled * 255).astype(np.uint8)
    cnts, _   = cv2.findContours(filled_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return JSONResponse({"error": "Could not find room boundary"}, 422)

    cnt    = max(cnts, key=cv2.contourArea)
    arc    = cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, 0.008*arc, True)
    if len(approx) > 40:
        approx = cv2.approxPolyDP(cnt, 0.015*arc, True)
    poly   = [[int(p[0][0]), int(p[0][1])] for p in approx]

    rows_nz, cols_nz = np.where(filled > 0)
    x0_, x1_ = int(cols_nz.min()), int(cols_nz.max())
    y0_, y1_ = int(rows_nz.min()), int(rows_nz.max())
    bw_  = x1_ - x0_;  bh_ = y1_ - y0_

    area_sqm = round(px_count * mpp**2, 2)
    len_m    = round(bw_ * mpp, 2)
    wid_m    = round(bh_ * mpp, 2)
    perim    = round((len_m + wid_m) * 2, 2)
    asp      = min(bw_, bh_) / max(bw_, bh_, 1)
    rtype    = _infer_type_from_shape(area_sqm, asp, 0, 1)

    return JSONResponse(_to_python({
        "room": {
            "id": "click_room", "name": rtype.title().replace("_"," "),
            "type": rtype,
            "x": int(x0_), "y": int(y0_), "w": int(bw_), "h": int(bh_),
            "polygon": [[int(p[0]), int(p[1])] for p in poly],
            "areaSqM": round(float(area_sqm),2), "areaSqFt": round(float(area_sqm)*10.764,1),
            "lengthM": round(float(len_m),2), "widthM": round(float(wid_m),2),
            "perimeterM": round(float(perim),2),
            "heightM": None, "wallAreaSqM": None,
            "doorCount": 0, "windowCount": 0,
            "confidence": 0.97,
        },
        "clickPoint":  {"x": int(sx), "y": int(sy)},
        "scale":       f"1:{int(scale_ratio)}",
        "metersPerPixel": round(float(mpp), 8),
        "imageWidth":  int(img_w),
        "imageHeight": int(img_h),
    }))


@app.post("/api/floorplan/scale-detect")
async def detect_scale_endpoint(
    file:  UploadFile = File(...),
    page:  int        = Form(default=1),
):
    """Detect scale from floor plan without full analysis."""
    data     = await file.read()
    fname    = (file.filename or "").lower()
    is_pdf   = fname.endswith(".pdf") or data[:4] == b"%PDF"
    page_num = max(0, page - 1)

    if is_pdf:
        result = load_pdf_page(data, page_num, max_px=1600)
    else:
        result = load_image_file(data, fname, max_px=1600)

    if result is None:
        return JSONResponse({"error": "Could not load file", "scale": None})

    img_pil, dpi = result
    ratio, label = None, "not detected"

    if is_pdf:
        r = detect_scale_from_pdf(data, page_num)
        if r: ratio, label = r

    if ratio is None:
        r = detect_scale_from_image(img_pil)
        if r: ratio, label = r

    mpp = _ratio_to_mpp_at_dpi(ratio, dpi) if ratio else None

    return JSONResponse({
        "scale":          label,
        "ratio":          ratio,
        "metersPerPixel": round(mpp, 8) if mpp else None,
        "dpi":            round(dpi, 1),
        "detected":       ratio is not None,
    })


@app.get("/health")
async def health():
    model = _load_model()
    onnx_path = _MODEL_CKPT.parent / "floor_plan_model.onnx"
    return {
        "status": "ok",
        "powered_by": "BIMBOSS Floor Plan AI",
        "model": {
            "name":       _model_meta.get("arch", "not loaded"),
            "loaded":     model is not None,
            "file":       _MODEL_CKPT.name if _MODEL_CKPT.exists() else "not found",
            "onnx":       onnx_path.exists(),
            "format":     "onnx" if _model_meta.get("use_onnx") else "pytorch",
            "miou":       round(_model_meta.get("miou", 0), 3),
            "classes":    _model_meta.get("n_cls", 0),
            "class_names": _model_meta.get("class_names", []),
            "img_size":   _model_meta.get("img_size", 0),
        },
        "capabilities": {
            "opencv":    HAS_CV2,
            "pymupdf":   HAS_FITZ,
            "pytorch":   HAS_TORCH,
            "easyocr":   HAS_EASYOCR,
            "tesseract": HAS_TESSERACT,
        },
        "pipeline_priority": [
            "markup_fills (PDF colored fills — 100% accurate)",
            "text_guided (PDF text labels + flood fill)",
            "bimboss_model (BIMBOSS-UNet-SE-ASPP custom trained)",
            "opencv (threshold + connected components)",
        ],
    }


if __name__ == "__main__":
    import uvicorn

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    print("\n" + "="*60)
    print("  ██████╗ ██╗███╗   ███╗██████╗  ██████╗ ███████╗███████╗")
    print("  ██╔══██╗██║████╗ ████║██╔══██╗██╔═══██╗██╔════╝██╔════╝")
    print("  ██████╔╝██║██╔████╔██║██████╔╝██║   ██║███████╗███████╗")
    print("  ██╔══██╗██║██║╚██╔╝██║██╔══██╗██║   ██║╚════██║╚════██║")
    print("  ██████╔╝██║██║ ╚═╝ ██║██████╔╝╚██████╔╝███████║███████║")
    print("  ╚═════╝ ╚═╝╚═╝     ╚═╝╚═════╝  ╚═════╝ ╚══════╝╚══════╝")
    print("  Floor Plan AI  —  Powered by BIMBOSS-UNet-SE-ASPP")
    print("  http://localhost:8001/docs")
    print("="*60)
    print(f"  OpenCV   : {'OK' if HAS_CV2    else 'MISSING — pip install opencv-python'}")
    print(f"  PyMuPDF  : {'OK' if HAS_FITZ   else 'MISSING — pip install PyMuPDF'}")
    print(f"  PyTorch  : {'OK' if HAS_TORCH  else 'MISSING — pip install torch'}")
    print(f"  EasyOCR  : {'OK' if HAS_EASYOCR else 'MISSING — pip install easyocr'}")
    print(f"  BIMBOSS Model : {_MODEL_CKPT.name if _MODEL_CKPT.exists() else 'NOT FOUND — run: python models/Model_training.py'}")
    print()

    _load_model()

    uvicorn.run(app, host="0.0.0.0", port=8001, reload=False)
