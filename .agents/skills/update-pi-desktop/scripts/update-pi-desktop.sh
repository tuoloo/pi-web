#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

INSTALL_APP=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL_APP=1 ;;
    -h|--help)
      cat <<'USAGE'
Usage: update-pi-desktop.sh [--install]

Synchronizes upstream/main into the customized Pi fork, validates it, runs
checks, and builds the desktop distributable. The merge is aborted when
validation or build fails. --install copies the macOS arm64 app to
~/Applications/Pi.app after a successful build.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区不是干净的，已停止。请先提交或暂存当前修改：" >&2
  git status --short >&2
  exit 2
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "缺少 origin remote（应指向你的 GitHub Fork）。" >&2
  exit 2
fi
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "缺少 upstream remote（应指向 https://github.com/agegr/pi-web.git）。" >&2
  exit 2
fi

CURRENT_BRANCH=$(git branch --show-current)
if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "当前处于 detached HEAD，已停止。请先切换到 main。" >&2
  exit 2
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_BRANCH="backup/pi-desktop-${TIMESTAMP}"
git branch "$BACKUP_BRANCH" HEAD

echo "已创建回滚分支：$BACKUP_BRANCH"
echo "正在获取官方更新……"
git fetch upstream main

echo "正在合并 upstream/main（不会强制覆盖本地修改）……"

MERGE_STARTED=0
if ! git merge --no-commit --no-ff upstream/main; then
  echo >&2
  echo "官方更新与本地定制发生冲突，已停止，未继续安装或构建。" >&2
  echo "请先处理冲突；如果想恢复合并前状态，可执行：" >&2
  echo "  git merge --abort" >&2
  echo "回滚分支仍保留：$BACKUP_BRANCH" >&2
  exit 3
fi
MERGE_STARTED=1

abort_merge() {
  local code=$?
  if [[ "$MERGE_STARTED" == 1 ]] && git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    echo "检查或构建失败，正在恢复到更新前状态……" >&2
    git merge --abort || true
  fi
  echo "更新前快照保留在：$BACKUP_BRANCH" >&2
  exit "$code"
}
trap abort_merge ERR

if [[ "$(node -p "require('./package.json').build?.productName || ''")" != "Pi" ]]; then
  echo "桌面产品名不是 Pi，已停止以避免覆盖品牌定制。" >&2
  exit 4
fi
if [[ ! -f assets/icon.icns || ! -f assets/icon.png || "$(node -p "require('./package.json').build?.appId || ''")" != "com.agegr.pi" ]]; then
  echo "Pi 桌面图标或 Bundle ID 定制缺失，已停止以避免构建错误版本。" >&2
  exit 4
fi

# Keep the npm lockfile consistent with the merged package.json without
# running lifecycle scripts during this metadata-only reconciliation.
npm install --package-lock-only --ignore-scripts
npm install --ignore-scripts
npm run lint
npx tsc --noEmit
npm test
npm run desktop:dist

if git diff --quiet && git diff --cached --quiet; then
  echo "合并没有产生文件变化。"
else
  git add -A
  git commit -m "Sync upstream Pi Web and rebuild desktop app"
  git push origin "$CURRENT_BRANCH"
fi

if [[ "$INSTALL_APP" == 1 ]]; then
  if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
    echo "--install 当前只支持 Apple Silicon macOS；构建产物仍已生成。" >&2
    exit 5
  fi
  APP_SOURCE="$REPO_ROOT/dist/mac-arm64/Pi.app"
  APP_TARGET="$HOME/Applications/Pi.app"
  mkdir -p "$HOME/Applications"
  rm -rf "$APP_TARGET"
  ditto "$APP_SOURCE" "$APP_TARGET"
  open "$APP_TARGET"
  echo "已安装并启动：$APP_TARGET"
fi

echo
echo "更新完成。"
echo "回滚分支：$BACKUP_BRANCH"
echo "构建产物：$REPO_ROOT/dist/"
