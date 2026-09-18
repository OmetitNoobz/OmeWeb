@echo off
title OmeRyth Web Studio - Serveur
cd /d "%~dp0"
echo ========================================================
echo       Lancement d'OmeRyth Web Studio (Multi-appareils)
echo ========================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    python server.py
    pause
    exit /b
)

where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    py server.py
    pause
    exit /b
)

echo [Erreur] Python n'a pas ete detecte dans le PATH.
echo Veuillez installer Python ou executer server.py manuellement.
pause
