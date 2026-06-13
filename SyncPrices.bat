@echo off
title NSE Price Sync - North Wealth
echo.
echo ==========================================
echo  North Wealth - NSE Price Sync
echo ==========================================
echo.
echo Downloading today's NSE Bhavcopy and
echo writing prices to Firebase...
echo.

python "%~dp0scripts\sync_bhavcopy.py"

echo.
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS! Prices updated in Firebase.
    echo Now click "Refresh Prices" on the website.
) else (
    echo ERROR: Sync failed. Check the output above.
)
echo.
pause
