@echo off
title PORI Auto-Sync (VPBankS NEO API + SSI v3)
cd /d "%~dp0"
echo ============================================================
echo   PORI AUTO-SYNC ENGINE (VPBankS NEO API + SSI FastConnect)
echo   Dang chay tu dong cap nhat du lieu trong gio giao dich...
echo   (Nhan Ctrl + C de dung bat cu luc nao)
echo ============================================================
".venv\Scripts\python.exe" backend\scripts\auto_sync_neo.py --force --interval 60 --git-interval 900
pause
