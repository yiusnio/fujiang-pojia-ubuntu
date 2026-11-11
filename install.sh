#!/usr/bin/env bash
# dsh-prompt-custom 安装器（Ubuntu / Linux 版）
#
# 与 Windows 版 install.ps1 行为对齐：
#   1. 找到 DeepSeek Harness 自带的 dsh 命令行工具；
#   2. 把 plugin/ 复制到 $DSH_HOME/local-plugins/dsh-prompt-custom；
#   3. 把 prompt-custom.json 复制到 $DSH_HOME/prompt-custom.json（不同则先备份）；
#   4. 调用 dsh plugin --profile <profile> add <path> 注册。
#
# 用法：
#   ./install.sh                      # 自动识别你正在用的配置（web / desktop / …）
#   ./install.sh --profile web        # 明确指定配置
#   ./install.sh --dry-run            # 只看计划，不改任何文件
#   ./install.sh --dsh-command /opt/DeepSeek\ Harness
#   ./install.sh --dsh-command dsh --profile desktop --dsh-home ~/.dsh
#   ./install.sh --prompt-from ./my-prompt.json
#
# 配置（profile）选择顺序，先命中先算：
#   1. --profile 显式指定；
#   2. 环境变量 DSH_PROFILE（dsh 启动的 shell 里会带上）；
#   3. 正在运行的 dsh 进程命令行（/proc/*/cmdline）；
#   4. $DSH_HOME/dsh-process.json 记录的启动参数；
#   5. profiles/ 下真的装过依赖（有 node_modules / pnpm-lock.yaml）的配置；
#   6. profiles/ 下最近被修改过的配置；
#   7. desktop 或 web（存在哪个用哪个）。
set -euo pipefail
export LC_ALL="${LC_ALL:-C.UTF-8}"

PROFILE=""
PROFILE_SOURCE=""
DSH_COMMAND="${DSH_CLI:-}"
DSH_HOME_ARG=""
DRY_RUN=0
PROMPT_FROM=""
PROMPT_MODE="merge"   # merge = 仅在内容不同时覆盖并备份；keep = 保留现有配置

BUNDLE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PLUGIN="$BUNDLE_ROOT/plugin"
SOURCE_PROMPT="$BUNDLE_ROOT/prompt-custom.json"
LOG_PATH="$BUNDLE_ROOT/install.log"

say() { printf '[dsh-prompt-custom] %s\n' "$*"; }
warn() { printf '[dsh-prompt-custom] %s\n' "$*" >&2; }

usage() {
  # 只回显文件头的注释块，遇到第一行普通代码即停止。
  awk 'NR > 1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "${BASH_SOURCE[0]}"
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile|-p)      PROFILE="${2:?--profile 需要一个值}"; shift 2 ;;
    --dsh-command|-c)  DSH_COMMAND="${2:?--dsh-command 需要一个值}"; shift 2 ;;
    --dsh-home)        DSH_HOME_ARG="${2:?--dsh-home 需要一个值}"; shift 2 ;;
    --prompt-from)     PROMPT_FROM="${2:?--prompt-from 需要一个值}"; shift 2 ;;
    --keep-prompt)     PROMPT_MODE="keep"; shift ;;
    --dry-run|-n)      DRY_RUN=1; shift ;;
    --help|-h)         usage ;;
    *) warn "未知参数：$1（用 --help 查看用法）"; exit 2 ;;
  esac
done

[ -d "$SOURCE_PLUGIN" ] || { warn "缺少 plugin/ 目录：$SOURCE_PLUGIN"; exit 1; }
if [ -n "$PROMPT_FROM" ]; then
  [ -f "$PROMPT_FROM" ] || { warn "指定的提示词文件不存在：$PROMPT_FROM"; exit 1; }
  case "$PROMPT_FROM" in
    /*) SOURCE_PROMPT="$PROMPT_FROM" ;;
    *)  SOURCE_PROMPT="$(cd -- "$(dirname -- "$PROMPT_FROM")" && pwd)/$(basename -- "$PROMPT_FROM")" ;;
  esac
fi

# ---------- 数据目录 ----------
if [ -n "$DSH_HOME_ARG" ]; then
  TARGET_HOME="$DSH_HOME_ARG"
elif [ -n "${DSH_HOME:-}" ]; then
  TARGET_HOME="$DSH_HOME"
else
  TARGET_HOME="$HOME/.dsh"
fi
# 展开 ~ 并转成绝对路径（目录允许暂时不存在）
case "$TARGET_HOME" in
  '~'|'~/'*) TARGET_HOME="$HOME${TARGET_HOME#\~}" ;;
esac
TARGET_HOME="$(realpath -m -- "$TARGET_HOME")"
export DSH_HOME="$TARGET_HOME"

PLUGIN_TARGET="$TARGET_HOME/local-plugins/dsh-prompt-custom"
PROMPT_TARGET="$TARGET_HOME/prompt-custom.json"

# ---------- 配置（profile）识别 ----------
# 只列出真正的配置目录：profiles/ 下还可能有 node_modules 之类的平级目录。
list_profiles() {
  local dir
  [ -d "$TARGET_HOME/profiles" ] || return 0
  for dir in "$TARGET_HOME/profiles"/*; do
    [ -f "$dir/package.json" ] || continue
    basename -- "$dir"
  done
}

# 配置名的合法字符集与 dsh 自身要求一致，避免把其他内容当成参数传下去。
valid_profile_name() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  return 0
}

profile_exists() {
  [ -f "$TARGET_HOME/profiles/$1/package.json" ]
}

# 从一串命令行词里取配置名：先找 --profile <name> / --profile=<name>，
# 再找跟在 dsh / dsh.cmd / bin.js 之后的第一个非选项词（dsh web --no-open）。
profile_from_words() {
  local prev='' token
  for token in $*; do
    case "$token" in
      --profile) prev='__want__'; continue ;;
      --profile=*) printf '%s\n' "${token#--profile=}"; return 0 ;;
    esac
    if [ "$prev" = '__want__' ]; then printf '%s\n' "$token"; return 0; fi
    case "$prev" in
      *dsh|*dsh.js|*dsh.cmd|*dsh.sh|*dsh.exe|*bin.js|*bin.cjs|*bin.mjs)
        case "$token" in
          -*) ;;
          *) printf '%s\n' "$token"; return 0 ;;
        esac ;;
    esac
    prev="$token"
  done
  return 0
}

# 已装过依赖的配置最可能是用户真正在用的那个。
profile_installed() {
  [ -d "$TARGET_HOME/profiles/$1/node_modules" ] && return 0
  [ -f "$TARGET_HOME/profiles/$1/pnpm-lock.yaml" ] && return 0
  [ -f "$TARGET_HOME/profiles/$1/cordis.yml" ] && return 0
  return 1
}

# 最近修改过的配置（ls -dt 在 GNU 与 BSD 上都可用）。
profile_newest() {
  local base="$TARGET_HOME/profiles" dir name
  [ -d "$base" ] || return 0
  for dir in $(ls -dt "$base"/*/ 2>/dev/null); do
    [ -f "$dir/package.json" ] || continue
    name="$(basename -- "$dir")"
    valid_profile_name "$name" && printf '%s\n' "$name"
    return 0
  done
  return 0
}

detect_profile() {
  local cand line
  if [ -n "$PROFILE" ]; then PROFILE_SOURCE="--profile"; return 0; fi
  if [ -n "${DSH_PROFILE:-}" ]; then
    PROFILE="$DSH_PROFILE"; PROFILE_SOURCE="DSH_PROFILE 环境变量"; return 0
  fi
  # 运行中的 dsh 进程（--dry-run 时 Harness 还开着，这条最准）
  for cand in /proc/[0-9]*/cmdline; do
    [ -r "$cand" ] || continue
    line="$(tr '\0' ' ' < "$cand" 2>/dev/null)"
    case "$line" in *dsh*) ;; *) continue ;; esac
    cand="$(profile_from_words $line)"
    if valid_profile_name "$cand" && profile_exists "$cand"; then
      PROFILE="$cand"; PROFILE_SOURCE="运行中的 dsh 进程"; return 0
    fi
  done
  # dsh 每次启动都会写 dsh-process.json，里面记着启动参数。
  # 这个文件是多行缩进的 JSON，所以要先把换行压掉再抓 argv 数组。
  if [ -f "$TARGET_HOME/dsh-process.json" ]; then
    line="$(tr -d '\n\r' < "$TARGET_HOME/dsh-process.json" \
      | sed -n 's/.*"argv"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' \
      | tr -d '"' | tr ',' ' ')"
    cand="$(profile_from_words $line)"
    if valid_profile_name "$cand" && profile_exists "$cand"; then
      PROFILE="$cand"; PROFILE_SOURCE="dsh-process.json"; return 0
    fi
    # argv 里没有配置名时，从 commandLine 字段里再找一次
    line="$(tr -d '\n\r' < "$TARGET_HOME/dsh-process.json" \
      | sed -n 's/.*"commandLine"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | tr '\\\\' ' ')"
    cand="$(profile_from_words $line)"
    if valid_profile_name "$cand" && profile_exists "$cand"; then
      PROFILE="$cand"; PROFILE_SOURCE="dsh-process.json"; return 0
    fi
  fi
  # 装过依赖的配置
  for cand in $(list_profiles); do
    if profile_installed "$cand"; then PROFILE="$cand"; PROFILE_SOURCE="已安装依赖的配置"; return 0; fi
  done
  # 最近修改的配置
  cand="$(profile_newest)"
  if valid_profile_name "$cand" && profile_exists "$cand"; then
    PROFILE="$cand"; PROFILE_SOURCE="最近修改的配置"; return 0
  fi
  # 只有一个配置时直接用它；否则按 desktop → web 找一个存在的
  cand="$(list_profiles)"
  if [ "$(printf '%s\n' "$cand" | grep -c .)" -eq 1 ] && valid_profile_name "$cand"; then
    PROFILE="$cand"; PROFILE_SOURCE="唯一的配置"; return 0
  fi
  for cand in desktop web; do
    if profile_exists "$cand"; then PROFILE="$cand"; PROFILE_SOURCE="默认"; return 0; fi
  done
  PROFILE="desktop"; PROFILE_SOURCE="默认"
}

# ---------- 找 dsh ----------
# 候选来源：显式指定 → 运行中的 Harness 进程 → 桌面入口 → 常见安装目录 → PATH。
candidate_dirs() {
  local cmd
  for cmd in /proc/[0-9]*/cmdline; do
    [ -r "$cmd" ] || continue
    tr '\0' '\n' < "$cmd" 2>/dev/null | grep -iE 'deepseek.?harness|dsh' | head -n 3
  done 2>/dev/null | sed 's#/[^/]*$##' | sort -u
  for dir in \
    "$HOME/.local/share/DeepSeek Harness" \
    "$HOME/.local/share/deepseek-harness" \
    "$HOME/Applications" \
    "/opt/DeepSeek Harness" /opt/deepseek-harness /opt/dsh \
    "/usr/local/lib/deepseek-harness" "/usr/lib/deepseek-harness" \
    /snap/deepseek-harness/current; do
    [ -d "$dir" ] && echo "$dir"
  done
  # 桌面入口里写的 Exec 路径
  for desktop in "$HOME/.local/share/applications" /usr/share/applications "/var/lib/flatpak/exports/share/applications"; do
    [ -d "$desktop" ] || continue
    grep -lhiE 'deepseek|harness' "$desktop"/*.desktop 2>/dev/null | while read -r file; do
      sed -n 's/^Exec=//p' "$file" | awk '{print $1}' | grep -v '^%'
    done
  done
}

# 把候选（目录 / .desktop 目标 / 可执行文件）解析成真实可用的 dsh 入口。
resolve_candidate() {
  local path="$1" cli name
  [ -n "$path" ] || return 1
  path="${path%\"}"; path="${path#\"}"
  if [ -d "$path" ]; then
    for cli in \
      "$path/resources/runtime/cli/bin/dsh" \
      "$path/resources/runtime/cli/bin/dsh.sh" \
      "$path/resources/runtime/cli/bin/dsh.cmd" \
      "$path/resources/app.asar.unpacked/runtime/cli/bin/dsh" \
      "$path/bin/dsh" "$path/dsh"; do
      if [ -f "$cli" ]; then printf '%s\n' "$cli"; return 0; fi
    done
    # AppImage 解包目录形如 /tmp/.mount_XXXX，里面同样有 resources/
    return 1
  fi
  if [ -f "$path" ]; then
    name="$(basename -- "$path")"
    case "$name" in
      dsh|dsh.sh|dsh.cmd|dsh.js) printf '%s\n' "$(realpath -m -- "$path")"; return 0 ;;
    esac
    # 传进来的是 DeepSeek Harness 可执行文件本身，尝试推断同级 cli
    if resolve_candidate "$(dirname -- "$path")" >/dev/null 2>&1; then
      resolve_candidate "$(dirname -- "$path")"; return 0
    fi
  fi
  return 1
}

find_dsh() {
  local candidate resolved
  if [ -n "$DSH_COMMAND" ]; then
    if resolved="$(resolve_candidate "$DSH_COMMAND")"; then printf '%s\n' "$resolved"; return 0; fi
    if command -v "$DSH_COMMAND" >/dev/null 2>&1; then command -v "$DSH_COMMAND"; return 0; fi
    warn "无法从指定的 --dsh-command 解析出 dsh 入口：$DSH_COMMAND"
    return 1
  fi
  while IFS= read -r candidate; do
    if resolved="$(resolve_candidate "$candidate")"; then printf '%s\n' "$resolved"; return 0; fi
  done < <(candidate_dirs)
  if command -v dsh >/dev/null 2>&1; then command -v dsh; return 0; fi
  return 1
}

# ---------- 阻止在 Harness 运行时改动 ----------
harness_pids() {
  pgrep -f -i 'DeepSeek[ _-]*Harness' 2>/dev/null | grep -v "^$$\$" || true
}

# 供 tests/install-paths.sh 引用函数做单元测试：只加载函数，不执行安装。
if [ "${FUJIANG_INSTALL_SOURCE_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

DSH_BIN="$(find_dsh || true)"

detect_profile

if [ "$DRY_RUN" -eq 1 ]; then
  say 'Dry run；不会改动任何文件。'
  say "bundle    : $BUNDLE_ROOT"
  say "profile   : $PROFILE（来自：$PROFILE_SOURCE）"
  say "plugin to : $PLUGIN_TARGET"
  say "prompt to : $PROMPT_TARGET"
  say "dsh cli   : ${DSH_BIN:-（未找到）}"
  say "harness   : $(if [ -n "$(harness_pids)" ]; then printf 'running (%s 个进程)' "$(harness_pids | wc -l)"; else printf 'not running'; fi)"
  exit 0
fi

[ -n "$DSH_BIN" ] || {
  warn '未找到 DSH 命令行工具。可先确认 Harness 安装目录，再运行：'
  warn '  ./install.sh --dsh-command "/opt/DeepSeek Harness"'
  warn '若数据目录也不在 ~/.dsh，另加 --dsh-home "/path/to/.dsh"。'
  exit 1
}

RUNNING="$(harness_pids)"
if [ -n "$RUNNING" ]; then
  warn ''
  warn "检测到 DeepSeek Harness 正在运行（$(printf '%s\n' "$RUNNING" | wc -l) 个进程）。"
  warn '请先完全退出 DeepSeek Harness（关闭主窗口后确认进程已退出，必要时 pkill -f "DeepSeek Harness"），再重新运行本脚本。'
  warn '这次没有改动任何文件。'
  warn ''
  exit 1
fi

if [ ! -f "$TARGET_HOME/profiles/$PROFILE/package.json" ]; then
  warn "未找到配置 “$PROFILE”：$TARGET_HOME/profiles/$PROFILE"
  AVAILABLE="$(list_profiles | tr '\n' ' ')"
  if [ -n "$AVAILABLE" ]; then
    warn "这个数据目录里可用的配置：$AVAILABLE"
    warn "请用 --profile <名称> 指定，或先启动一次对应的 DeepSeek Harness 完成初始化。"
  else
    warn '这个数据目录里还没有任何配置，请先启动一次 DeepSeek Harness 完成初始化。'
  fi
  warn '若数据目录已移动，请用 --dsh-home 指定 .dsh 数据目录（不是程序安装目录）。'
  exit 1
fi

if [ ! -x "$DSH_BIN" ]; then
  if [ -f "$DSH_BIN" ]; then
    say "dsh 入口没有执行权限，正在补上：$DSH_BIN"
    chmod +x "$DSH_BIN" || { warn "无法为 $DSH_BIN 添加执行权限。"; exit 1; }
  else
    warn "dsh 入口不可用：$DSH_BIN"; exit 1
  fi
fi

# ---------- 复制文件 ----------
PROMPT_BACKUP=""
SOURCE_HASH=""
[ -f "$SOURCE_PROMPT" ] && SOURCE_HASH="$(sha256sum "$SOURCE_PROMPT" | awk '{print $1}')"
TARGET_MATCHES=0

if [ -f "$PROMPT_TARGET" ] && [ -n "$SOURCE_HASH" ]; then
  TARGET_HASH="$(sha256sum "$PROMPT_TARGET" | awk '{print $1}')"
  [ "$SOURCE_HASH" = "$TARGET_HASH" ] && TARGET_MATCHES=1
  if [ "$TARGET_MATCHES" -eq 0 ]; then
    PROMPT_BACKUP="$PROMPT_TARGET.backup-$(date +%Y%m%d-%H%M%S-%3N)"
    cp -p "$PROMPT_TARGET" "$PROMPT_BACKUP"
    say "原有提示词配置已备份: $PROMPT_BACKUP"
  fi
fi

mkdir -p "$PLUGIN_TARGET"
# 用 tar 管道复制，保留目录层级与权限（dsh 入口需要可执行位）。
( cd "$SOURCE_PLUGIN" && tar -cf - . ) | ( cd "$PLUGIN_TARGET" && tar -xf - )
find "$PLUGIN_TARGET" -type d -exec chmod 755 {} + 2>/dev/null || true
say "文件已复制到 $PLUGIN_TARGET"

if [ -n "$SOURCE_HASH" ] && [ "$TARGET_MATCHES" -eq 0 ] && [ "$PROMPT_MODE" != "keep" ]; then
  install -m 600 "$SOURCE_PROMPT" "$PROMPT_TARGET"
elif [ "$PROMPT_MODE" = "keep" ]; then
  say '按 --keep-prompt 保留现有提示词配置。'
fi

# ---------- 注册插件 ----------
restore_prompt_on_failure() {
  local code=$?
  if [ "$code" -ne 0 ] && [ -n "$PROMPT_BACKUP" ] && [ -f "$PROMPT_BACKUP" ]; then
    install -m 600 "$PROMPT_BACKUP" "$PROMPT_TARGET"
    say '安装失败，已还原原提示词配置。'
  fi
  return "$code"
}
trap restore_prompt_on_failure EXIT

say "注册到配置：$PROFILE（来源：$PROFILE_SOURCE）"
if ! "$DSH_BIN" plugin --profile "$PROFILE" add "$PLUGIN_TARGET"; then
  warn "DSH 插件注册失败（$DSH_BIN plugin --profile $PROFILE add）。"
  exit 1
fi

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SOURCE_PLUGIN/package.json" | head -n 1)"
say "安装完成：@deepseek-ai/dsh-prompt-custom ${VERSION:-（未知版本）}（profile: $PROFILE）"
printf '%s installed version %s\n' "$(date -Iseconds)" "${VERSION:-unknown}" >> "$LOG_PATH" 2>/dev/null || true
say '现在启动 DeepSeek Harness 即可加载新版本。'
