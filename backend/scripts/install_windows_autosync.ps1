$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PythonExe = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$ScriptPath = Join-Path $RepoRoot "backend\scripts\auto_sync_neo.py"

$TaskName = "PORI_NEO_AutoSync"
$Action = New-ScheduledTaskAction -Execute $PythonExe -Argument "`"$ScriptPath`" --once" -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Tu dong dong bo VPBankS NEO + SSI trong gio giao dich HOSE (moi 15 phut)" -Force
Write-Host "Da cai dat lich tu dong '$TaskName' thanh cong! (Chay moi 15 phut trong gio giao dich)." -ForegroundColor Green
