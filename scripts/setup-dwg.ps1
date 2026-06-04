# Download LibreDWG binary for Windows (dwg2dxf.exe)
# Run: powershell -ExecutionPolicy Bypass -File scripts\setup-dwg.ps1

$ErrorActionPreference = "Stop"
$binDir = "$PSScriptRoot\..\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$release = "0.12.5"
$url = "https://github.com/LibreDWG/libredwg/releases/download/$release/libredwg-$release-win64.zip"
$zip  = "$env:TEMP\libredwg.zip"
$tmp  = "$env:TEMP\libredwg-extract"

Write-Host "Downloading LibreDWG $release for Windows..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host "Extracting..." -ForegroundColor Cyan
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp

$exe = Get-ChildItem -Recurse -Filter "dwg2dxf.exe" -Path $tmp | Select-Object -First 1
if ($exe) {
    Copy-Item $exe.FullName -Destination "$binDir\dwg2dxf.exe" -Force
    Write-Host "dwg2dxf.exe installed to $binDir" -ForegroundColor Green
    Write-Host "DWG auto-conversion is now enabled!" -ForegroundColor Green
} else {
    Write-Host "dwg2dxf.exe not found in release. Try manual install." -ForegroundColor Yellow
    Write-Host "Download from: https://github.com/LibreDWG/libredwg/releases" -ForegroundColor Yellow
}

Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
