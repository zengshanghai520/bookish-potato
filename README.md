# workbuddy-backup

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
git remote add origin git@github.com:zengshanghai520/workbuddy-backup.git
git push -u origin main

# 或 HTTPS 方式（用 Personal Access Token 代替密码）
git remote add origin https://github.com/zengshanghai520/workbuddy-backup.git
git push -u origin main
```

## 安全注意
- ❌ 不要提交密钥、token、`.env`、敏感持仓明细
- ❌ 大二进制（图片 / 视频 / PDF）默认已忽略，见 `.gitignore`
- ✅ 只存文本类配置与笔记，仓库轻量、可长期维护
