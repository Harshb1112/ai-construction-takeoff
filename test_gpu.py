import torch

print("=" * 60)
print("🔥 GPU DETECTION TEST")
print("=" * 60)

cuda_available = torch.cuda.is_available()
print(f"CUDA Available: {cuda_available}")

if cuda_available:
    print(f"GPU Device: {torch.cuda.get_device_name(0)}")
    print(f"CUDA Version: {torch.version.cuda}")
    print(f"GPU Count: {torch.cuda.device_count()}")
    print(f"Current Device: cuda:{torch.cuda.current_device()}")
    
    # Memory info
    total_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"GPU Memory: {total_memory:.2f} GB")
    
    # Quick test
    x = torch.randn(1000, 1000).cuda()
    y = torch.randn(1000, 1000).cuda()
    z = x @ y
    print(f"\n✅ GPU Tensor Test: PASSED")
    print(f"   Created tensors on: {z.device}")
else:
    print("❌ GPU NOT AVAILABLE - will use CPU")

print("=" * 60)
