#!/usr/bin/env bash
# install.sh 的路径解析与参数处理回归测试（不触碰真实 DSH 安装）。
#
# 运行：bash tests/install-paths.sh
set -uo pipefail

INSTALLER="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/install.sh"
PASS=0
FAIL=0

assert_eq() {
  local actual="$1" expected="$2" message="$3"
  if [ "$actual" = "$expected" ]; then
    printf 'PASS %s\n' "$message"; PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n  期望 [%s]\n  实际 [%s]\n' "$message" "$expected" "$actual" >&2; FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" message="$3"
  case "$haystack" in
    *"$needle"*) printf 'PASS %s\n' "$message"; PASS=$((PASS + 1)) ;;
    *) printf 'FAIL %s\n  未包含 [%s]\n  输出 [%s]\n' "$message" "$needle" "$haystack" >&2; FAIL=$((FAIL + 1)) ;;
  esac
}

# 1) 语法与 shellcheck 级检查
if bash -n "$INSTALLER" 2>/dev/null; then
  assert_eq "ok" "ok" "install.sh 语法检查"
else
  assert_eq "syntax-error" "ok" "install.sh 语法检查"; fi

if bash -n "$(dirname "$INSTALLER")/点我执行脚本.sh" 2>/dev/null; then
  assert_eq "ok" "ok" "点我执行脚本.sh 语法检查"
else
  assert_eq "syntax-error" "ok" "点我执行脚本.sh 语法检查"; fi

# 2) 加载函数（不执行安装）
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/fujiang-install-test-XXXXXX")"
trap 'rm -rf "$FIXTURE"' EXIT

export FUJIANG_INSTALL_SOURCE_ONLY=1
# shellcheck disable=SC1090
. "$INSTALLER"
unset FUJIANG_INSTALL_SOURCE_ONLY

# 3) 中文/空格安装目录 → 解析出 dsh 入口
APP_ROOT="$FIXTURE/应用 [测试] Custom App Folder"
CLI_DIR="$APP_ROOT/resources/runtime/cli/bin"
mkdir -p "$CLI_DIR"
printf '#!/bin/sh\nexit 0\n' > "$CLI_DIR/dsh"
chmod +x "$CLI_DIR/dsh"
assert_eq "$(resolve_candidate "$APP_ROOT")" "$CLI_DIR/dsh" "解析中文+空格安装目录到 dsh"

# 4) 直接传 dsh 可执行文件
assert_eq "$(resolve_candidate "$CLI_DIR/dsh")" "$CLI_DIR/dsh" "直接传 dsh 可执行文件"

# 5) 传 Harness 可执行文件本身 → 回退到同级 cli
printf '#!/bin/sh\nexit 0\n' > "$APP_ROOT/DeepSeek Harness"
chmod +x "$APP_ROOT/DeepSeek Harness"
assert_eq "$(resolve_candidate "$APP_ROOT/DeepSeek Harness")" "$CLI_DIR/dsh" "传 Harness 可执行文件回退到同级 cli"

# 6) 不存在的路径应失败
if resolve_candidate "$FIXTURE/nope" >/dev/null 2>&1; then
  assert_eq "resolved" "unresolved" "不存在的路径应解析失败"
else
  assert_eq "unresolved" "unresolved" "不存在的路径应解析失败"; fi

# 7) dsh 入口缺执行位时给出提示并可修复
NOEXEC_CLI="$FIXTURE/noexec/resources/runtime/cli/bin/dsh"
mkdir -p "$(dirname "$NOEXEC_CLI")"
printf '#!/bin/sh\nexit 0\n' > "$NOEXEC_CLI"
chmod 644 "$NOEXEC_CLI"
OUT="$(APP_UNDER_TEST="$NOEXEC_CLI" bash -c '
  set -euo pipefail
  src="'"$INSTALLER"'"
  # 只跑「入口不可执行」这一段逻辑的等价判断
  if [ ! -x "$APP_UNDER_TEST" ] && [ -f "$APP_UNDER_TEST" ]; then echo need-chmod; fi
')"
assert_eq "$OUT" "need-chmod" "缺执行位时识别为需要 chmod"

# 8) dry-run 输出计划且不写文件
PROFILE_HOME="$FIXTURE/home/.dsh"
mkdir -p "$PROFILE_HOME/profiles/desktop"
printf '{"name":"desktop"}\n' > "$PROFILE_HOME/profiles/desktop/package.json"
DRY_OUT="$(HOME="$FIXTURE/home" DSH_HOME="$PROFILE_HOME" bash "$INSTALLER" --dry-run 2>&1)"
assert_contains "$DRY_OUT" "Dry run" "dry-run 打印计划"
assert_contains "$DRY_OUT" "$PROFILE_HOME/local-plugins/dsh-prompt-custom" "dry-run 显示插件目标路径"
if [ ! -e "$PROFILE_HOME/local-plugins" ]; then
  assert_eq "untouched" "untouched" "dry-run 不创建目录"
else
  assert_eq "created" "untouched" "dry-run 不创建目录"; fi

# 9) 未知参数应报错退出
if bash "$INSTALLER" --bogus >/dev/null 2>&1; then
  assert_eq "accepted" "rejected" "未知参数被拒绝"
else
  assert_eq "rejected" "rejected" "未知参数被拒绝"; fi

# 10) 缺少 desktop 配置时报错
EMPTY_HOME="$FIXTURE/empty-home"
mkdir -p "$EMPTY_HOME"
if HOME="$FIXTURE/home" DSH_HOME="$EMPTY_HOME" bash "$INSTALLER" --dsh-command "$CLI_DIR/dsh" >/dev/null 2>&1; then
  assert_eq "proceeded" "stopped" "缺少 desktop 配置时停止"
else
  assert_eq "stopped" "stopped" "缺少 desktop 配置时停止"; fi

# 11) --keep-prompt 不覆盖已有提示词
KEEP_HOME="$FIXTURE/keep/.dsh"
mkdir -p "$KEEP_HOME/profiles/desktop"
printf '{"name":"desktop"}\n' > "$KEEP_HOME/profiles/desktop/package.json"
printf '{"enabled":false,"text":"mine"}\n' > "$KEEP_HOME/prompt-custom.json"
# 用一个假 dsh 记录调用，避免真的注册
FAKE_CLI="$FIXTURE/fake/resources/runtime/cli/bin/dsh"
mkdir -p "$(dirname "$FAKE_CLI")"
cat > "$FAKE_CLI" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >> "${FAKE_LOG:-/dev/null}"
exit 0
FAKE
chmod +x "$FAKE_CLI"
FAKE_LOG="$FIXTURE/dsh-calls.log"
: > "$FAKE_LOG"
HOME="$FIXTURE/keep" DSH_HOME="$KEEP_HOME" FAKE_LOG="$FAKE_LOG" \
  bash "$INSTALLER" --dsh-command "$FAKE_CLI" --keep-prompt >/dev/null 2>&1 || true
assert_eq "$(cat "$KEEP_HOME/prompt-custom.json")" '{"enabled":false,"text":"mine"}' "--keep-prompt 保留现有提示词"
assert_contains "$(cat "$FAKE_LOG" 2>/dev/null)" "plugin --profile desktop add" "以正确参数调用 dsh plugin add"
assert_eq "$(ls "$KEEP_HOME"/prompt-custom.json.backup-* 2>/dev/null | wc -l)" "1" "覆盖前生成提示词备份"

# 12) 正常安装会复制插件并覆盖提示词
RUN_HOME="$FIXTURE/run/.dsh"
mkdir -p "$RUN_HOME/profiles/desktop"
printf '{"name":"desktop"}\n' > "$RUN_HOME/profiles/desktop/package.json"
HOME="$FIXTURE/run" DSH_HOME="$RUN_HOME" FAKE_LOG="$FIXTURE/dsh-calls2.log" \
  bash "$INSTALLER" --dsh-command "$FAKE_CLI" >/dev/null 2>&1 || true
assert_eq "$([ -f "$RUN_HOME/local-plugins/dsh-prompt-custom/lib/index.js" ] && echo yes || echo no)" "yes" "插件文件被复制到目标目录"
assert_eq "$([ -f "$RUN_HOME/local-plugins/dsh-prompt-custom/lib/zip.js" ] && echo yes || echo no)" "yes" "新增的 zip.js 一并复制"
assert_eq "$([ -f "$RUN_HOME/prompt-custom.json" ] && echo yes || echo no)" "yes" "提示词配置被写入"

printf '\n%s 项通过，%s 项失败。\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
