#!/usr/bin/env bash
# ============================================================
# 临里校园 - 云函数批量部署脚本（Windows / Git Bash 版）
# ------------------------------------------------------------
# 用法（Git Bash）：
#   bash scripts/deploy-all-functions-win.sh
#   bash scripts/deploy-all-functions-win.sh "D:/path/to/project"
#
# 前置条件：
#   1. 已安装微信开发者工具，且已用新账号登录过一次
#   2. 新云开发环境已开通
#   3. 开发者工具「设置-安全设置」已开启「服务端口」
# ============================================================

set -u

# ---- 配置区（按需修改）----
ENV_ID="cloudbase-d3gavr3qt88b7c734"
# Windows 默认安装路径（按实际安装位置修改）
CLI="/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
[ -f "$CLI" ] || CLI="/c/Program Files/Tencent/微信web开发者工具/cli.bat"
PROJECT_PATH="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

FUNCTIONS=(
  block chat comment common delivery favorite food initAdmin initDB like
  lostfound migrate missing moderation notify order post report user verify
)

echo "=========================================="
echo " 环境 ID   : $ENV_ID"
echo " 项目路径  : $PROJECT_PATH"
echo " 函数数量  : ${#FUNCTIONS[@]}"
echo "=========================================="

if [ ! -f "$CLI" ]; then
  echo "❌ 未找到开发者工具 CLI，请修改脚本顶部 CLI 变量。"
  exit 1
fi

FAILED=()
for fn in "${FUNCTIONS[@]}"; do
  echo ""
  echo ">>> 部署 $fn ..."
  if "$CLI" cloud functions deploy \
      --env "$ENV_ID" \
      --name "$fn" \
      --remote-npm-install \
      --project "$PROJECT_PATH"; then
    echo "    ✅ $fn 成功"
  else
    echo "    ❌ $fn 失败"
    FAILED+=("$fn")
  fi
done

echo ""
echo "=========================================="
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✅ 全部 ${#FUNCTIONS[@]} 个函数部署完成"
else
  echo "⚠️  失败函数：${FAILED[*]}"
fi
echo "=========================================="
