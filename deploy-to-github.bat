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
::
::  This version adds an automatic app_version bump (stored in Supabase's
::  app_settings table) before each deploy. It needs your Supabase
::  service-role key the first time — that key is saved locally to
::  .deploy-service-key.txt (auto-added to .gitignore) and is never
::  committed or pushed.
:: ============================================================================

set "REPO_DIR=%~dp0"
cd /d "%REPO_DIR%"

set "SB_URL=https://gtcrmqbmlvtlyiwnshma.supabase.co"
set "SB_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Y3JtcWJtbHZ0bHlpd25zaG1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTk5MDYsImV4cCI6MjA5NDIzNTkwNn0.NO2OPT5q-xH6SexYIKCZkSlOxjptHu7FyClsp1HdbQc"
set "SERVICE_KEY_FILE=%REPO_DIR%.deploy-service-key.txt"
set "BUMP_SCRIPT=%REPO_DIR%bump-version.ps1"

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

:: ── Make sure the service-role key file is never committed ──────────────
if not exist "%REPO_DIR%.gitignore" (
    echo .deploy-service-key.txt> "%REPO_DIR%.gitignore"
) else (
    findstr /x /c:".deploy-service-key.txt" "%REPO_DIR%.gitignore" >nul 2>&1
    if errorlevel 1 echo .deploy-service-key.txt>> "%REPO_DIR%.gitignore"
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

:: ── App version bump ──────────────────────────────────────────────────
echo.
if not exist "%SERVICE_KEY_FILE%" (
    echo No saved Supabase service-role key found ^(needed to bump the app version^).
    echo This is only asked once — it's saved locally and never committed.
    set /p SERVICE_KEY="Paste your Supabase service-role key (or leave blank to skip version bump): "
    if not "!SERVICE_KEY!"=="" (
        >"%SERVICE_KEY_FILE%" echo !SERVICE_KEY!
    )
)

if exist "%SERVICE_KEY_FILE%" (
    set /p SERVICE_KEY=<"%SERVICE_KEY_FILE%"
    if exist "%BUMP_SCRIPT%" (
        echo.
        echo Checking app version...
        powershell -NoProfile -ExecutionPolicy Bypass -File "%BUMP_SCRIPT%" -SbUrl "%SB_URL%" -AnonKey "%SB_ANON_KEY%" -ServiceKey "!SERVICE_KEY!"
        if errorlevel 1 (
            echo WARNING: Version bump failed — continuing with deploy anyway.
        )
    ) else (
        echo WARNING: bump-version.ps1 not found next to this script — skipping version bump.
    )
) else (
    echo Skipping version bump ^(no service-role key provided^).
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
