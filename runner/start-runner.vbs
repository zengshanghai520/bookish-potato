' GitHub self-hosted runner 隐藏窗口启动器
' 由 start-runner.cmd 调用，在同一目录下后台运行 run.cmd，不显示任何窗口。
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
' 0 = 隐藏窗口, True = 不等待其结束（后台常驻）
WshShell.Run "cmd.exe /c ""run.cmd > runner.log 2>&1""", 0, False
