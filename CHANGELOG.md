# 更新记录

## 0.20.13-linux.1（2026-11-11）

Ubuntu / Linux 移植版。插件程序与 Windows 版共用，新增 Linux 安装器并修掉两个只在 Linux 上暴露的问题。

- 新增 `install.sh` 与 `点我执行脚本.sh`：等价于 Windows 版的 bash 安装器。支持 `--profile`、`--dsh-command`、`--dsh-home`、`--prompt-from`、`--keep-prompt`、`--dry-run`、`--help`，环境变量 `DSH_CLI` / `DSH_HOME`。
- 安装目录发现改为 Linux 路径：`~/.local/share/DeepSeek Harness`、`/opt/DeepSeek Harness`、`/opt/deepseek-harness`、`/opt/dsh`、`/snap/deepseek-harness/current`，并从 `/proc/*/cmdline` 与 `.desktop` 的 `Exec` 反查。
- 修复 AboutSecurity 技能库在 Ubuntu 上装不上：GNU tar 读不了 ZIP，原实现直接 `tar -xf` 会报 `tar: This does not look like a tar archive`。改为降级链：`FUJIANG_UNZIP` → `unzip` → `python3`（zipfile）→ `bsdtar` → 内置解析器；Windows 与 macOS 上自动改用自带的 `tar`（本身就是 libarchive，能读 ZIP）。
- 修复各解压后端落地路径不一致导致误判失败：`unzip` 与 `python3` 会重建压缩包内的完整路径（`<输出>/AboutSecurity-master/skills`），过去只检查 `<输出>/skills`，会把成功解压当成失败并连带清掉已解出的内容。现在统一归位到 `<输出>/skills` 再校验技能数量，并在失败时清空暂存目录再试下一个后端。
- 新增 `plugin/lib/zip.js`：零依赖 ZIP 读取器（store/deflate、UTF-8 名、ZIP64、data descriptor），仅解所需子树，保留权限位，拒绝绝对路径与 `../` 逃逸。不引入任何 npm 依赖。
- 技能卡片显示实际使用的解压后端与可用后端列表；解压失败时的报错会逐条列出每个后端的失败原因、当前可用后端和安装建议。
- `skills.js` 的 Node 查找重写为跨平台：新增 nvm / fnm / volta / `/usr/local/bin` / `/usr/bin` / `/snap/bin` / `/opt/node` 等候选，按版本高低择优，并支持 `FUJIANG_NODE` / `FUJIANG_NPM` 覆盖；不满足 REA 版本门槛时给出 apt / nvm 安装指引。
- 修掉界面上“托盘 / 任务管理器”这类 Windows 专属文案，Linux 下改用 `pgrep` 提示。
- 新增 Linux 测试：`tests/install-paths.sh`、`tests/linux-runtime.mjs`、`tests/aboutsecurity-extractors.mjs`、`tests/aboutsecurity-extract.mjs`、`tests/aboutsecurity-real-extract.mjs`，以及入口 `tests/run-all-linux.sh`。

验证结果（Ubuntu 26.04 / WSL，Node v22.22.3，python3 3.14.4，未安装 unzip 与 bsdtar）：`bash tests/run-all-linux.sh` 全部 92 项断言通过——安装路径 18 项、运行时与 ZIP 解析 23 项、解压降级链 21 项、真实压缩包端到端 16 项、真实系统命令解压 14 项，另加全部 JS/Shell 语法检查。真实上游包为 18.8 MB / 2784 个条目，内置解析器 0.2 秒解出 803 个文件、扫描到 249 个 `SKILL.md`；同时复现了 GNU tar 读取失败的原始报错，并验证了在 unzip / bsdtar 全缺的情况下仅靠 `python3` 或仅靠内置解析器都能完成完整安装。上述结果不代表所有发行版、全部技能或自动流程均已完成实际运行验证。

升级方法（Linux）：完全退出 DeepSeek Harness，解压新版文件后运行 `bash ./install.sh`，安装完成再重新启动 Harness。

## 0.20.13（2026-11-11）

- 修复关闭免责声明后，Enter 发送、Shift+Enter 换行及 Esc 快捷键仍被拦截的问题。弹窗隐藏时不再注册键盘监听。
- 忽略输入法正在组合文字的键盘事件，避免中文候选词确认键误触发弹窗。
- 安装器通过运行进程、注册表、开始菜单或桌面快捷方式、默认目录及 PATH 查找 DSH，支持非 C 盘安装。
- 支持用 `-DshCommand` 指定安装目录、桌面程序或命令行脚本；双击安装时，自动查找失败后可粘贴实际路径。程序安装目录与 `.dsh` 数据目录分别处理。
- 新增键盘与安装路径回归测试。

验证结果：键盘生命周期测试 10/10 通过；安装路径测试 20/20 分别在 Windows PowerShell 5.1 和 PowerShell 7 下通过。浏览器隔离测试页验证了发送、换行、Esc、已同意后重新进入，以及输入法合成事件。

验证范围：浏览器测试提取真实插件组件并使用最小生命周期模拟；其他盘符通过临时 PSDrive 模拟，完整安装流程使用隔离的模拟 CLI。上述结果不代表所有用户的实际安装环境或全部插件功能均已验证。

升级方法：完全退出 DeepSeek Harness（包括托盘进程），解压新版文件后运行 `点我执行脚本.cmd`，安装完成再重新启动 Harness。若仍未识别到程序，按提示粘贴实际安装文件夹路径。
