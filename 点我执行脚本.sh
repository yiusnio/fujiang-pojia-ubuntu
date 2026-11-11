#!/usr/bin/env bash
# 双击/粘贴执行入口（Ubuntu）。等价于 Windows 的 点我执行脚本.cmd。
#
# 用法：
#   ./点我执行脚本.sh              # 图形化双击时走这里
#   bash 点我执行脚本.sh --dry-run
#
# 行为：切到脚本所在目录 → 调用 install.sh → 结束后暂停（图形环境）
set -uo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit 1

printf '================================================\n'
printf '  dsh-prompt-custom 安装器（Ubuntu 版）\n'
printf '  请先完全退出 DeepSeek Harness，再运行本文件。\n'
printf '================================================\n\n'

if [ ! -f ./install.sh ]; then
  printf '缺少 install.sh，无法继续。\n' >&2
  exit 1
fi
chmod +x ./install.sh 2>/dev/null || true

# 优先 bash：本脚本自身依赖 bash 数组/进程替换等特性。
BASH_BIN="$(command -v bash || true)"
[ -n "$BASH_BIN" ] || { printf '未找到 bash。\n' >&2; exit 1; }
"$BASH_BIN" ./install.sh "$@"
RC=$?

printf '\n'
if [ "$RC" -eq 0 ]; then
  printf '完成。现在可以启动 DeepSeek Harness。\n'
else
  printf '安装未完成（退出码 %s）。请查看上面的提示。\n' "$RC"
fi

# 只有连着终端（图形双击不会带 tty）才暂停，避免 CI/管道里卡住。
if [ -t 0 ]; then
  printf '\n按 Enter 关闭…'
  read -r _ || true
fi
exit "$RC"
