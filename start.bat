@echo off
rem cc-notify-center launcher.
rem NOTE: ELECTRON_RUN_AS_NODE=1 in system env makes electron.exe run as pure node - must clear it.
set ELECTRON_RUN_AS_NODE=
cd /d D:\app\cc-notify-center
start "" "D:\app\cc-notify-center\node_modules\electron\dist\electron.exe" .
