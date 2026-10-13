#!/usr/bin/env bash
# ============================================================
# 临里校园 - 云函数批量部署脚本（迁移至新小程序账号）
# ------------------------------------------------------------
# 用法（macOS）：
#   bash scripts/deploy-all-functions.sh
#   bash scripts/deploy-all-functions.sh /path/to/project   # 自定义项目路径
#
# 前置条件：
#   1. 已安装微信开发者工具，且已用新账号登录过一次
#   2. 新云开发环境已开通
#   3. 开发者工具「设置-安全设置」已开启「服务端口」
# ============================================================

set -u

# ---- 配置区（按需修改）----
ENV_ID="cloudbase-d3gavr3qt88b7c734"
CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
PROJECT_PATH="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# 实际云函数清单（20 个，以 cloudfunctions/ 目录为准）
FUNCTIONS=(
  block
  chat
  comment
  common
  delivery
  favorite
  food
  initAdmin
  initDB
  like
  lostfound
  migrate
  missing
  moderation
  notify
  order
  post
  report
  user
  verify
)

echo "=========================================="
echo " 环境 ID   : $ENV_ID"
echo " 项目路径  : $PROJECT_PATH"
echo " 函数数量  : ${#FUNCTIONS[@]}"
echo "=========================================="

if [ ! -x "$CLI" ]; then
  echo "❌ 未找到微信开发者工具 CLI：$CLI"
  echo "   请确认安装路径，或修改脚本顶部的 CLI 变量。"
  exit 1
fi

FAILED=()
for fn in "${FUNCTIONS[@]}"; do
  echo ""
  echo ">>> 部署 $fn ..."
  # --r = 云端安装依赖（不上传 node_modules）
  if "$CLI" cloud functions deploy \
      --env "$ENV_ID" \
      --name "$fn" \
      --remote-npm-install \
      --project "$PROJECT_PATH"; then
    echo "    ✅ $fn 部署成功"
  else
    echo "    ❌ $fn 部署失败"
    FAILED+=("$fn")
  fi
done

echo ""
echo "=========================================="
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✅ 全部 ${#FUNCTIONS[@]} 个函数部署完成"
else
  echo "⚠️  以下函数部署失败，请重试："
  printf '   - %s\n' "${FAILED[@]}"
fi
echo "=========================================="
echo ""
echo "部署后必做复查（详见 迁移手册.md）："
echo "  1. 确认 common 的定时触发器 archiveLikesTimer（0 0 3 * * * *）已生效"
echo "  2. 确认各函数超时：post=30s comment=15s delivery/lostfound/verify=20s"
echo "     moderation=15s initDB/migrate=30s 其余=10s"
echo "     chat/food/missing/order 无 config.json，默认 3s，需手工上调"
echo "  3. 重新申请开放接口权限：security.msgSecCheck / security.imgSecCheck"
echo "     / subscribeMessage.send"
