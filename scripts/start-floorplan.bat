@echo off
title Floor Plan Analyzer — Port 8001
color 0B
echo.
echo  ============================================
echo   Floor Plan Analyzer (Kreo-style pipeline)
echo   OpenCV + OCR + CubiCasa5k (optional)
echo  ============================================
echo.

:: Go to project root
cd /d "%~dp0.."

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.11+ from python.org
    pause & exit /b 1
)

:: Install dependencies
echo [1/2] Installing floor plan dependencies...
pip install -r scripts/requirements-floorplan.txt -q --no-warn-script-location
if errorlevel 1 (
    echo [WARN] Some packages failed — continuing anyway
)

:: Check Tesseract (for OCR scale detection)
tesseract --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [WARN] Tesseract OCR not found — scale will default to 1:100
    echo         Download: https://github.com/tesseract-ocr/tesseract/releases
    echo.
)

:: Start server
echo [2/2] Starting Floor Plan Analyzer on http://localhost:8001 ...
echo.
echo   Docs: http://localhost:8001/api/docs
echo   Analyze: POST http://localhost:8001/api/floorplan/analyze
echo.
python scripts/floorplan_server.py

pause
