@echo off
title PORI Real-Time Sync (VPBankS NEO API + SSI v3)
cd /d "%~dp0"
echo ============================================================
echo   PORI REAL-TIME ENGINE (VPBankS NEO API + SSI FastConnect)
echo   Dang chay cap nhat moi 15 giay (Supabase) / 15 phut (Git)
echo   (Nhan Ctrl + C de dung bat cu luc nao)
echo ============================================================
".venv\Scripts\python.exe" backend\scripts\auto_sync_neo.py --force --interval 15 --git-interval 900
pause
