@echo off
chcp 65001 >nul
REM 停止本机 GitHub self-hosted runner（结束 run 进程）
echo [信息] 正在停止 GitHub runner 进程 ...
taskkill /f /im run.exe >nul 2>&1
if %errorlevel%==0 (
    echo [完成] runner 已停止。
) else (
    echo [提示] 未找到运行中的 runner 进程（可能本来没在跑）。
)
timeout /t 2 >nul
