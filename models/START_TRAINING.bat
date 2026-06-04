@echo off
echo ======================================================================
echo  BIMBOSS AI FLOOR PLAN MODEL - TRAINING LAUNCHER
echo ======================================================================
echo.
echo Dataset: 1,793 image pairs
echo Model: ResNet34 + U-Net + ASPP + Attention Gates
echo Device: CPU
echo Expected time: 8-12 hours
echo.
echo ======================================================================
echo.

cd /d "%~dp0"

echo Checking setup...
python check_training_setup.py
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Setup check failed!
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo  STARTING TRAINING
echo ======================================================================
echo.
echo Training will run for approximately 8-12 hours.
echo You can safely minimize this window - training will continue.
echo.
echo To stop training: Press Ctrl+C
echo.
echo Progress will be saved every 10 epochs to:
echo   model_output/floor_plan_model.pth
echo.
echo Logs will be written to:
echo   ../logs/training.log
echo.
echo ======================================================================
echo.
timeout /t 5

python Model_training.py

echo.
echo ======================================================================
echo  TRAINING COMPLETE
echo ======================================================================
echo.

if exist "model_output\floor_plan_model.pth" (
    echo SUCCESS: Model trained successfully!
    echo.
    echo Model file: model_output\floor_plan_model.pth
    echo.
    echo Next steps:
    echo   1. Test the model: python test_single_image.py "Dataset/WITHOUT MARKUP/4.jpg"
    echo   2. Validate results: python validate_training.py
    echo   3. Start server: cd ../scripts ^&^& python floorplan_server.py
) else (
    echo WARNING: Model file not found!
    echo Check logs/training.log for errors.
)

echo.
pause
