@echo off
setlocal enabledelayedexpansion

:: ============================================================================
::  El Martillo Helpdesk — commit & push to GitHub Pages
::
::  This script lives in your repo folder:
::    K:\My Drive\Docs\professional\Software development\helpdesk software\v2
::
::  Workflow: save/overwrite your updated files in this same folder, then
::  just double-click this .bat file. No paths to edit, no copying needed.
:: ============================================================================

set "REPO_DIR=%~dp0"
cd /d "%REPO_DIR%"

echo.
echo ===============================================================
echo  El Martillo Helpdesk - Deploy to GitHub Pages
echo  Folder: %REPO_DIR%
echo ===============================================================
echo.

if not exist "%REPO_DIR%.git" (
    echo ERROR: This folder doesn't look like a git repo ^(no .git folder found^).
    echo   %REPO_DIR%
    echo.
    echo Make sure this .bat file sits directly inside your cloned repo folder.
    pause
    exit /b 1
)

echo -----------------------------------------------------------------
echo Git status ^(review before anything is committed^):
echo -----------------------------------------------------------------
git status
echo -----------------------------------------------------------------
echo.

set /p CONFIRM="Commit and push these changes to GitHub? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo.
    echo Nothing committed. Run this script again when you're ready.
    pause
    exit /b 0
)

set /p COMMITMSG="Commit message (leave blank for a default message): "
if "%COMMITMSG%"=="" set "COMMITMSG=Update helpdesk files"

git add -A
git commit -m "%COMMITMSG%"
if errorlevel 1 (
    echo.
    echo Nothing new to commit ^(files may be unchanged^), or commit failed.
    pause
    exit /b 0
)

git push
if errorlevel 1 (
    echo.
    echo ERROR: git push failed. Check your internet connection and that
    echo you're authenticated with GitHub, then try running from this
    echo folder manually:
    echo   git push
    pause
    exit /b 1
)

echo.
echo ===============================================================
echo  Done! Changes pushed to GitHub.
echo  GitHub Pages usually takes 30-90 seconds to update the live site.
echo ===============================================================
pause
