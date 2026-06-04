@echo off
echo Creating ZIP for Google Colab...
powershell -Command "Compress-Archive -Path 'models', 'scripts', 'test_gpu.py' -DestinationPath '%USERPROFILE%\Desktop\ai-construction-takeoff.zip' -Force"
echo.
echo ZIP created at: %USERPROFILE%\Desktop\ai-construction-takeoff.zip
echo.
echo Next steps:
echo 1. Open: https://colab.research.google.com/
echo 2. Upload: colab_training.ipynb
echo 3. Enable GPU: Runtime -^> Change runtime -^> T4 GPU
echo 4. Upload the ZIP file when prompted
pause
