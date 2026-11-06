# 本机 Runner 后台启动包

让 GitHub self-hosted runner 在**本机后台静默运行**的一套脚本（Windows）。

## 文件
| 文件 | 作用 |
|---|---|
| `start-runner.cmd` | 双击启动：首次会引导交互配置，之后后台静默挂起 runner |
| `start-runner.vbs` | 隐藏窗口启动器（被 start-runner.cmd 调用，不要单独双击） |
| `stop-runner.cmd` | 一键停止本机 runner 进程 |

## 使用步骤
1. 在仓库网页 `Settings → Actions → Runners → New self-hosted runner` 选 **Windows**，
   下载 runner 压缩包并解压到一个目录（例如 `D:/actions-runner`）。
2. 把本文件夹的 **3 个文件** 复制到该 runner 目录（和 `config.cmd`、`run.cmd` 同级）。
3. **首次**双击 `start-runner.cmd`：会提示交互配置，把网页给的
   `./config.cmd --url https://github.com/zengshanghai520/bookish-potato --token <TOKEN>`
   中的参数填进去，配置完成后会生成 `.runner` 文件。
4. 以后每次开机/想挂 runner，双击 `start-runner.cmd` 即可后台运行，窗口自动隐藏。
5. 想停就双击 `stop-runner.cmd`。

## 注意
- runner 进程需**保持运行**才会按时触发 workflow；本机重启后要重新双击启动。
- 想开机自启可把 `start-runner.cmd` 丢进「启动」文件夹，或注册为 Windows 服务（GitHub 官方 `./svc.cmd install` 亦可）。
- 日志写入同目录 `runner.log`，排错时看它。
- 本脚本只在 **Windows** 验证过；Linux/macOS 用 `./run.sh` 或 `nohup ./run.sh &`。
