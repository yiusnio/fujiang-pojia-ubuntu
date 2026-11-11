#!/usr/bin/env bash
# Linux 全量测试入口（WSL / Ubuntu）。
set -uo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." || exit 1

ZIP="${1:-$HOME/work/AboutSecurity.zip}"
TOTAL_FAIL=0

run_shell() {
  printf '\n=== %s ===\n' "$1"
  bash "tests/$1" 2>&1 | grep -E '^(FAIL|[0-9]+ 项通过)' || true
}

run_node() {
  local name="$1"; shift
  printf '\n=== %s ===\n' "$name"
  node "tests/$name" "$@" 2>&1 | grep -E '^(FAIL|NOTE|[0-9]+ 项通过)' || true
}

run_shell install-paths.sh
run_node linux-runtime.mjs
run_node aboutsecurity-extractors.mjs

if [ -f "$ZIP" ]; then
  run_node aboutsecurity-extract.mjs "$ZIP"
  run_node aboutsecurity-real-extract.mjs "$ZIP"
else
  printf '\n跳过真实压缩包测试：未找到 %s\n' "$ZIP"
  printf '可先执行：curl -L -o "%s" https://codeload.github.com/wgpsec/AboutSecurity/zip/refs/heads/master\n' "$ZIP"
fi

printf '\n=== 语法检查 ===\n'
for file in plugin/lib/*.js tests/*.mjs install.sh 点我执行脚本.sh; do
  case "$file" in
    *.js|*.mjs) node --check "$file" || TOTAL_FAIL=$((TOTAL_FAIL + 1)) ;;
    *.sh) bash -n "$file" || TOTAL_FAIL=$((TOTAL_FAIL + 1)) ;;
  esac
done
printf '语法检查完成（无输出即全部通过）\n'
exit "$TOTAL_FAIL"
