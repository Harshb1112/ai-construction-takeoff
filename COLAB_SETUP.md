# 🚀 Google Colab GPU Training Setup

**Training time:** 2-3 hours (vs 5-7 days on CPU!)  
**Cost:** FREE  
**GPU:** Tesla T4 (16GB VRAM)

---

## 📋 Step-by-Step Instructions:

### **1. Open Google Colab**
- Visit: https://colab.research.google.com/
- Sign in with Google account

---

### **2. Upload Notebook**
- Click **File → Upload notebook**
- Upload: `colab_training.ipynb` (from this folder)

---

### **3. Enable GPU**
- Click: **Runtime → Change runtime type**
- Hardware accelerator: **T4 GPU**
- Click **Save**

---

### **4. Create Project ZIP**

Windows PowerShell me run karo:
```powershell
# Create ZIP of required files
$source = "C:\Users\Bimboss\source\repos\ai-construction-takeoff"
$output = "C:\Users\Bimboss\Desktop\ai-construction-takeoff.zip"

# Create ZIP (exclude large files)
Compress-Archive -Path "$source\models", "$source\data", "$source\*.py" -DestinationPath $output -Force

Write-Host "✅ ZIP created: $output"
Write-Host "Upload this ZIP to Colab!"
```

---

### **5. Run Cells in Colab**

Run each cell one by one:

#### **Cell 1:** Check GPU
```python
!nvidia-smi
```
✅ Tesla T4 dikhna chahiye

#### **Cell 2:** Install packages
```python
!pip install torch torchvision opencv-python pillow numpy scipy scikit-learn tqdm
```

#### **Cell 3:** Upload ZIP
- Click **Choose Files**
- Select `ai-construction-takeoff.zip` from Desktop
- Wait for upload (2-5 minutes)

#### **Cell 4:** Run Training
```python
%cd ai-construction-takeoff
!python models/Model_training.py
```
⏱️ Training start hoga (~2-3 hours)

#### **Cell 5:** Download Model
```python
from google.colab import files
files.download('floor_plan_model.pth')
```

---

## 📊 **Expected Output:**

```
Epoch 1/50: 100%|██████████| Loss: 0.234 | mIoU: 0.521
Epoch 2/50: 100%|██████████| Loss: 0.198 | mIoU: 0.587
...
Best model saved! mIoU: 0.789
```

---

## 💾 **After Training:**

1. Download `floor_plan_model.pth` from Colab
2. Copy to: `C:\Users\Bimboss\source\repos\ai-construction-takeoff\`
3. Test: `py -3.11 scripts/floorplan_server.py`

---

## ⚠️ **Important Notes:**

- **Session timeout:** Colab disconnects after 12 hours or 90 min idle
- **Save often:** Download model checkpoints regularly
- **Keep tab open:** Don't close browser during training
- **Free tier limits:** ~12 hours GPU/day

---

## 🔄 **If Session Disconnects:**

Training automatically saves checkpoints. To resume:

1. Re-upload ZIP
2. Run: `!python models/Model_training.py --resume`

---

## ✅ **Checklist:**

- [ ] Open Colab: https://colab.research.google.com/
- [ ] Upload `colab_training.ipynb`
- [ ] Enable T4 GPU
- [ ] Create ZIP of project
- [ ] Upload ZIP to Colab
- [ ] Run training cell
- [ ] Download trained model
- [ ] Copy model to local project

---

**Ready? Open Colab and upload the notebook!** 🚀
