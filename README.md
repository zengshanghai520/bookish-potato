# bookish-potato

个人 **WorkBuddy 工作区产物与配置的私有备份仓库**（private）。

## 用途
- 备份 WorkBuddy 的自动化任务配置、笔记、脚本、代码片段、配置文件
- 跨设备同步（GitHub 私有仓，仅本人可见）
- 版本管理，可追溯每次改动

## 目录结构
| 目录 | 放什么 |
|---|---|
| `automations/` | 自动化任务配置导出（JSON / 说明文档） |
| `notes/` | 读书笔记、研究笔记（如《庄子諵譁》笔记、投资框架笔记） |
| `scripts/` | 自定义脚本（如 fund-framework 相关工具） |
| `snippets/` | 代码片段、prompt 片段、常用模板 |
| `configs/` | 需要保留的配置文件 |
| `archive/` | 历史工作区产物归档 |

## 本地已就绪
- 已 `git init`，默认分支 `main`
- 提交身份：`zengshanghai520 <zengshanghai520@users.noreply.github.com>`

## 关联远程并推送（GitHub 建好同名私有仓后）
```bash
# SSH 方式（推荐，先按说明把公钥加到 GitHub）
git remote add origin git@github.com:zengshanghai520/bookish-potato.git
git push -u origin main

# 或 HTTPS 方式（用 Personal Access Token 代替密码）
git remote add origin https://github.com/zengshanghai520/bookish-potato.git
git push -u origin main
```

## 自动化：每日 ETF 扫描（GitHub Actions）
仓库自带两个 workflow，二选一启用：

| 文件 | runner | 适用场景 |
|---|---|---|
| `.github/workflows/etf-scan.yml` | 云端 `ubuntu-latest` | 仅海外可访问的数据；**抓 A股行情易超时** |
| `.github/workflows/etf-scan-self-hosted.yml` | 本机 `self-hosted` | **推荐**：在本机跑，网络与本地一致，东财数据稳 |

**推荐用法（self-hosted）：**
1. 本机装好 git + Node.js(≥18) + Python(≥3.10)，加入 PATH。
2. 仓库网页：`Settings → Actions → Runners → New self-hosted runner` → 选系统 → 复制页面给出的命令执行（含 `--token`）：
   ```bash
   # Windows
   ./config.cmd --url https://github.com/zengshanghai520/bookish-potato --token <页面给的TOKEN>
   ./run.cmd
   # Linux / macOS
   ./config.sh  --url https://github.com/zengshanghai520/bookish-potato --token <页面给的TOKEN>
   ./run.sh
   ```
   runner 注册后保持前台/后台运行，本机需常开才会按时触发。
3. `Actions` 页 → 启用 `ETF 每日扫描（self-hosted 本机版）`。
4. **禁用云端版**：`Actions` 页把 `ETF 每日扫描（收盘后）`(云端) Disable，避免两个同时挂 schedule 触发两次。

触发时间：北京时间 **15:30**（UTC 07:30）周一至周五；也可在 Actions 页手动 `Run workflow`。报告作为 Artifact 留存 30 天（私有仓不公开）。

## 安全注意
- ❌ 不要提交密钥、token、`.env`、敏感持仓明细
- ❌ 大二进制（图片 / 视频 / PDF）默认已忽略，见 `.gitignore`
- ✅ 只存文本类配置与笔记，仓库轻量、可长期维护
