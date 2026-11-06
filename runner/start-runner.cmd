@echo off
chcp 65001 >nul
REM ============================================================
REM GitHub self-hosted runner 后台静默启动器
REM 用法：
REM   1) 先把本文件夹里的 start-runner.cmd / start-runner.vbs / stop-runner.cmd
REM      复制到「GitHub runner 目录」（即含 config.cmd、run.cmd 的那个目录）。
REM   2) 首次使用需先在仓库网页拿到 token 并交互配置（见下）。
REM   3) 之后双击 start-runner.cmd 即可后台挂起 runner，窗口自动隐藏。
REM ============================================================

cd /d "%~dp0"

REM 1) 若尚未配置（没有 .runner 标记文件），进入交互配置
if not exist ".runner" (
    echo [提示] 未检测到 .runner 配置，将启动一次性交互配置。
    echo        请到仓库 Settings → Actions → Runners → New self-hosted runner
    echo        复制页面给的 ./config.cmd --url ... --token ... 命令在此执行，或按提示输入。
    echo.
    call config.cmd
    if not exist ".runner" (
        echo [错误] 配置未完成（找不到 .runner），请检查后重试。
        pause
        exit /b 1
    )
)

REM 2) 后台静默启动 run.cmd（窗口隐藏，日志写入 runner.log）
echo [信息] 正在后台启动 GitHub runner ...（日志见 runner.log）
wscript.exe "%~dp0start-runner.vbs"
echo [完成] 已尝试启动。可用 stop-runner.cmd 停止，或看 runner.log 确认连接。
timeout /t 3 >nul
