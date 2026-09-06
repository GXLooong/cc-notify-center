' cc-notify-center launcher (no console window flash)
Set sh = CreateObject("WScript.Shell")
On Error Resume Next
' SYSTEM env ELECTRON_RUN_AS_NODE=1 would force electron.exe into pure-node mode - clear it for this process tree
sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
On Error Goto 0
sh.CurrentDirectory = "D:\app\cc-notify-center"
sh.Run """D:\app\cc-notify-center\node_modules\electron\dist\electron.exe"" .", 0, False
