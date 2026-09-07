---
name: update-pi-desktop
description: 安全同步官方 agegr/pi-web 更新到当前 Pi 桌面 Fork，保留 Electron 桌面壳、Pi 品牌和自定义图标，运行检查并重新构建桌面安装包。当用户说“更新 Pi”“同步 Pi Web”“更新桌面版”或需要重新构建 Pi.app 时使用。
compatibility: 需要在 Pi Web Git 仓库中执行，安装 Node.js 22.19.0 或更高版本、npm 和 Git；发布或安装 macOS 应用还需要 macOS。
---

# 更新 Pi Desktop

项目仓库应配置两个 Git remote：

```text
origin   → 个人 Fork（例如 https://github.com/tuoloo/pi-web.git）
upstream → https://github.com/agegr/pi-web.git
```

## 执行方式

先向用户说明将要同步官方代码、安装依赖、执行测试和构建；如果用户明确要求安装到 macOS 用户应用程序目录，再使用 `--install`：

```bash
./.agents/skills/update-pi-desktop/scripts/update-pi-desktop.sh
./.agents/skills/update-pi-desktop/scripts/update-pi-desktop.sh --install
```

脚本默认只构建并推送到个人 Fork，不会自动替换已安装的应用。`--install` 仅在构建成功后把 Apple Silicon macOS 应用复制到 `~/Applications/Pi.app` 并启动。

## 安全规则

- 工作区有未提交或未暂存修改时立即停止；不要自动 stash、reset 或删除用户修改。
- 同步前自动创建 `backup/pi-desktop-YYYYMMDD-HHMMSS` 回滚分支。
- 合并使用普通 `git merge`，不使用 `git push --force`。
- 合并冲突时停止并保留冲突现场；不要选择 `ours` 或 `theirs` 全量覆盖。
- 合并后检查 `productName` 必须是 `Pi`，`appId` 必须是 `com.agegr.pi`，并确认 `assets/icon.icns` 和 `assets/icon.png` 存在。
- 依赖和锁文件同步后运行 lint、TypeScript 检查、测试及桌面构建；任一失败都停止。
- 用户会话和配置在 `~/.pi/agent`，不能删除或重置。

## 完成后报告

报告：

- 官方同步到的版本或 commit
- 构建使用的 Pi Web 和 Pi SDK 版本
- 测试结果
- `dist/` 中的安装包路径
- 回滚分支名称
- 如果执行了 `--install`，报告 `~/Applications/Pi.app` 已更新
