**[点击加入频道：https://t.me/DeepSeek22](https://t.me/DeepSeek22)**

欢迎加入频道，关注富江破甲。

<a href="https://t.me/DeepSeek22"><img src="./telegram-channel.png" alt="富江破甲频道二维码，点击加入频道" width="320"></a>

# 富江破甲（破甲）

富江破甲（破甲）：DeepSeek Harness破甲插件，激活词富江，所有东西直接大白话问，内含技能库skill下载与调用、漏洞知识库poc利用、漏洞报告更新和全自动授权渗透。当前版本：0.20.13，附免责声明。插件图片看最下面

本项目将 `@deepseek-ai/dsh-prompt-custom` 安装到 DeepSeek Harness 的配置目录。插件程序位于 `plugin/`，提示词配置单独保存在 `prompt-custom.json`。插件与 Windows、Ubuntu（及其他 Linux 发行版）、macOS 通用，安装脚本分平台提供。

## 下载与安装

在仓库页面点击 **Code → Download ZIP**（代码 → 下载压缩包），解压后安装；也可以使用 Git 克隆本仓库。

1. 先启动一次官方 DeepSeek Harness，完成你要用的配置初始化（`web` 或 `desktop`）。
2. 完全退出 Harness，包括右下角托盘图标中的“退出”。
3. 双击解压目录中的 **`点我执行脚本.cmd`**。
4. 安装完成后自行重新打开 Harness。

如果检测到 Harness 仍在运行，安装器会提示退出并停止，本次不会修改文件。**安装器不会自动关闭或重启 Harness，也不支持 `-NoRestart` 参数。**

```powershell
# 完全退出 Harness 后执行安装
.\点我执行脚本.cmd

# 仅查看安装计划，不修改文件
.\install.ps1 -DryRun
```

安装器默认自动识别你正在使用的配置（`web`、`desktop` 或自定义配置），会从运行路径、默认安装位置、注册表和开始菜单或桌面快捷方式查找 DSH 命令行工具，再尝试系统 PATH，支持安装到 D、E 等其他盘符。双击安装脚本仍未找到时，可按提示粘贴实际安装文件夹或可执行文件路径。

也可以手动指定安装目录；程序目录与 `.dsh` 数据目录是两个不同位置：

```powershell
# 指定程序安装目录，支持中文和空格
.\install.ps1 -DshCommand "D:\应用\DeepSeek Harness"

# 仅当 .dsh 数据目录也移动过时，额外指定数据目录
.\install.ps1 -DshCommand "D:\应用\DeepSeek Harness" -DshHome "E:\数据\.dsh"

# 仅预览，不执行安装或弹出路径输入
.\install.ps1 -DryRun -DshCommand "D:\应用\DeepSeek Harness"
```

`-DshCommand` 也接受 `DeepSeek Harness.exe` 或 `dsh.cmd` 的完整路径；`-Profile` 可指定配置名称，不传时自动识别（见「安装到哪个配置」），未传 `-DshHome` 时继续遵循已有的 `DSH_HOME` 设置。

安装时，脚本将插件复制到 `$DSH_HOME\local-plugins\dsh-prompt-custom`，通过 `dsh plugin --profile <profile> add <path>` 注册，并将附带的提示词配置复制到 `$DSH_HOME\prompt-custom.json`。如果已有配置与新配置不同，会先在原文件旁备份；注册失败且存在备份时，会恢复原提示词配置。未设置 `DSH_HOME` 时，默认使用 `$env:USERPROFILE\.dsh`。

安装成功后，脚本会尝试在旁边的 `install.log` 中记录时间和版本；该文件不是完整的运行日志。

### 脚本被拦截时

安装器是可阅读的 PowerShell 脚本，主要负责复制文件并调用 DSH 命令行工具。脚本不包含隐藏窗口启动、强制结束进程、计划任务或通过 WMI 创建进程的行为，启动参数使用 `-ExecutionPolicy RemoteSigned`。这些信息不等于任何安全软件的检测结论。

如果 Windows 因下载来源标记阻止脚本运行，可以先核实下载来源和脚本内容，再通过文件“属性”中的“解除锁定”处理。可用下面的命令计算脚本校验值，与发布者提供的对应值核对：

```powershell
Get-FileHash .\install.ps1 -Algorithm SHA256
```

也可以完全退出 Harness 后手动复制和注册插件。下面的示例使用默认数据目录：

```powershell
# 创建目标目录并复制插件文件
$pluginTarget = Join-Path $env:USERPROFILE '.dsh\local-plugins\dsh-prompt-custom'
New-Item -ItemType Directory -Force -Path $pluginTarget | Out-Null
Get-ChildItem -LiteralPath .\plugin -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $pluginTarget -Recurse -Force
}

# 使用 Desktop 自带的命令行工具注册插件（把 web 换成你实际在用的配置名）
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile web add $pluginTarget
```

手动安装如需采用附带的 `prompt-custom.json`，请先备份已有同名配置，再将其复制到 `$env:USERPROFILE\.dsh\prompt-custom.json`。完成后自行启动 Harness。

## 安装到哪个配置（profile）

DSH 把每套配置放在 `$DSH_HOME/profiles/<名称>` 下，常见的是 `web`（浏览器界面，`dsh web`）和 `desktop`（桌面端，`dsh desktop`），也可以是任何自定义名称。插件必须注册到**你实际在用的那一个**，否则界面上不会出现富江破甲入口。

安装器不再写死 `desktop`，默认按下面的顺序自动判断：

| 顺序 | 依据 | 说明 |
| --- | --- | --- |
| 1 | `--profile` / `-Profile` | 显式指定，优先级最高。 |
| 2 | `DSH_PROFILE` 环境变量 | 在 `dsh` 启动的 shell 里会自动带上。 |
| 3 | 正在运行的 dsh 进程 | 从进程命令行里读 `--profile <名称>` 或 `dsh <名称> ...`。 |
| 4 | `$DSH_HOME/dsh-process.json` | dsh 每次启动都会写，记录里含 `argv` 与 `commandLine`。 |
| 5 | 装过依赖的配置 | `profiles/<名称>` 下存在 `node_modules`、`pnpm-lock.yaml` 或 `cordis.yml`。 |
| 6 | 最近修改的配置 | 上面都没命中时按目录修改时间取最新。 |
| 7 | 唯一的配置 / `desktop`、`web` | 只有一个配置就直接用；否则依次找存在的 `desktop`、`web`。 |

判断出的配置名会在安装时打印出来并注明来源，例如：

```
[dsh-prompt-custom] profile   : web（来自：dsh-process.json）
```

想确认会装到哪里，用 `install.ps1 -DryRun` 或 `install.sh --dry-run` 看一眼即可，不会改动文件。指定的配置不存在时，安装器会停止并列出该数据目录里实际可用的配置名。

> 注意：`profiles/` 目录下还可能有 `node_modules` 这样的平级目录，它们不是配置，安装器只认含 `package.json` 的目录。

## Linux / Ubuntu 安装

同一份仓库同时提供 Windows 与 Linux 安装器，插件程序本身是跨平台的，不需要为 Ubuntu 单独准备一份插件。Windows 用户继续用 `install.ps1` / `点我执行脚本.cmd`，Ubuntu 用户用 `install.sh` / `点我执行脚本.sh`。

1. 先启动一次官方 DeepSeek Harness（用哪个界面就启动哪个，`web` 或 `desktop`），完成对应配置初始化。
2. **完全退出 Harness**（不要只关窗口，确认进程已退出）。
3. 在解压目录中执行安装脚本。

```bash
# 完全退出 Harness 后执行安装（自动识别配置）
bash ./install.sh

# 或者使用入口脚本（自动切换工作目录并透传参数）
./点我执行脚本.sh

# 仅查看安装计划，不修改任何文件（会显示识别到的配置名与来源）
bash ./install.sh --dry-run

# 明确指定配置名称与数据目录
bash ./install.sh --profile web --dsh-home ~/.local/share/dsh
```

确认 Harness 是否已经退出：

```bash
pgrep -f -i 'DeepSeek[ _-]*Harness'   # 有输出说明仍在运行，安装器会拒绝继续
```

安装器参数：

| 参数 | 说明 |
| --- | --- |
| `-p, --profile <name>` | 配置名称。不传时自动识别（见「安装到哪个配置」）。 |
| `-c, --dsh-command <path>` | 手动指定 DSH 命令行工具或 Harness 安装目录，支持中文与空格；也可指向 Harness 可执行文件，脚本会回退到同级 `resources/runtime/cli/bin/dsh`。 |
| `--dsh-home <dir>` | 手动指定数据目录，默认 `$DSH_HOME`，未设置时为 `~/.dsh`。 |
| `--prompt-from <file>` | 使用其他位置的提示词配置，而不是仓库自带的 `prompt-custom.json`。 |
| `--keep-prompt` | 不覆盖已有的提示词配置，只安装插件。 |
| `-n, --dry-run` | 只打印计划，不写文件、不调用 DSH。 |
| `-h, --help` | 查看帮助。 |

也可以用环境变量替代参数：`DSH_CLI`（等价 `--dsh-command`）、`DSH_HOME`（等价 `--dsh-home`）。

脚本会从 `~/.local/share/DeepSeek Harness`、`/opt/DeepSeek Harness`、`/opt/deepseek-harness`、`/opt/dsh`、`/snap/deepseek-harness/current` 等位置查找安装目录，也会解析正在运行的进程和 `.desktop` 文件里的启动路径，最后回退到系统 `PATH`。找到目录后自动使用其中的 `resources/runtime/cli/bin/dsh`。

安装流程与 Windows 版一致：先确定要装到哪个配置（不传 `--profile` 时自动识别，见「安装到哪个配置」），把 `plugin/` 复制到 `$DSH_HOME/local-plugins/dsh-prompt-custom`，通过 `dsh plugin --profile <profile> add <path>` 注册，并把提示词配置写到 `$DSH_HOME/prompt-custom.json`。已有配置不同时会先备份为 `prompt-custom.json.backup-<时间戳>`；若后续注册失败，脚本会自动还原提示词备份。运行记录写入同目录的 `install.log`。

> Ubuntu 上多数发行版把 Harness 装在用户目录下，`dsh` 命令行不在 `PATH` 里。安装器会自己解析路径，通常无需手动指定；只有在自定义位置安装时才需要 `--dsh-command`。

### Linux 上的解压差异（与 Windows 的关键区别）

技能库下载的是 GitHub 的 ZIP 压缩包，而 **Ubuntu 默认的 GNU tar 读不了 ZIP**（只有 `bsdtar`/libarchive 可以）。原实现直接调用 `tar -xf`，在 Ubuntu 上会报 `tar: This does not look like a tar archive`。现在解压按可靠性依次降级：

1. `FUJIANG_UNZIP` 指定的命令；
2. `unzip`；
3. `python3`（内置 `zipfile` 脚本，Ubuntu 通常自带）；
4. `bsdtar`（Windows 与 macOS 上自动改用自带的 `tar`，它们本身就是 libarchive）；
5. 插件自带的零依赖 ZIP 解析器（`plugin/lib/zip.js`）——**永远可用**，所以即使上面几个全都没装也能装好。

各后端落地路径不同：`unzip` 与 `python3` 会在输出目录里重建压缩包内的完整路径（`<输出>/AboutSecurity-master/skills`），而 `bsdtar` 与内置解析器用 `--strip-components` 直接得到 `<输出>/skills`。插件在每段解压后统一归位到 `<输出>/skills` 再校验技能数量，因此不会出现“解压成功却被判失败”。

想省掉降级开销可以装标准工具：

```bash
sudo apt install -y unzip python3
```

或强制指定后端：

```bash
FUJIANG_UNZIP=bsdtar bash ./install.sh
```

安装界面会显示实际使用的解压后端（技能卡片上的“解压：…”提示）以及当前可用后端列表。

### Linux 上的 Node.js 要求

REA 技能库需要 `^22.23.4 || ^24.22.1 || >=26.12.1`。插件会按顺序检查版本管理器目录（`~/.nvm`、`~/.local/share/fnm`、`~/.volta`、`~/.local/bin`）、`/usr/local/bin`、`/usr/bin`、`/snap/bin`、`/opt/node` 和 `PATH`，选取版本最高的可用 Node；Ubuntu apt 源里的 Node 往往偏低，此时插件的界面会给出安装提示。可用 nvm 或 NodeSource 安装：

```bash
nvm install 22 && nvm alias default 22
# 或
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

也可以用 `FUJIANG_NODE` / `FUJIANG_NPM` 指定具体的可执行文件路径。

## 插件界面与提示词配置

插件在输入框附近提供“富江破甲”状态开关和设置入口，可以启用或关闭提示词注入。设置面板提供以下功能：

- **漏洞报告**：持久化保存人工智能写入的漏洞记录，按严重、高危、中危、低危、信息等等级查看。
- **自定义提示词**：编辑提示词配置。
- **技能库**：下载、启用或关闭 REA 与 AboutSecurity。
- **知识库**：查看和使用内置 CVE / PoC 条目。
- **渗透作业链**：管理任务、资产、验证步骤、阶段和后续建议。

状态入口使用官方 `conversation.input.overlay` 扩展位置，避免占用输入区原有布局。启用自定义提示词注入时，插件以空段替代官方 `harness:identity` 开头；关闭后恢复官方开头，用户自己的提示词正文保持原样。

## 技能库下载与人工智能调用

技能库包含两个上游项目：

- **REA 逆向分析工具**：[morluto/rea](https://github.com/morluto/rea)。
- **AboutSecurity 安全评估技能库**：[wgpsec/AboutSecurity](https://github.com/wgpsec/AboutSecurity)。

AboutSecurity 从 GitHub 下载当前 `master` 分支压缩包，仅提取 `skills/` 目录，启用后注册发现的技能。下载过程显示进度并支持取消；启用和关闭会增加或移除技能提供方，删除操作仅针对插件管理的下载文件。技能数量可能随上游更新而变化。

本仓库通过上游链接按需下载技能库和 REA 安装文件，不附带其完整安装副本；使用第三方项目时适用各自的许可条件。

REA 需要兼容的 Node.js 版本：`^22.23.4 || ^24.22.1 || >=26.12.1`。插件通过 npm 安装时关闭生命周期脚本，因此这种安装方式不会构建 Frida 的可选原生绑定。具体工具能否使用，还取决于相应运行环境和分析引擎是否具备。AboutSecurity 主要由 Markdown 技能文档组成，无需额外的原生运行组件。

技能注册后，人工智能可以在可用技能目录中发现并按需读取相关内容。是否实际调用某项技能，取决于会话、模型、工具配置和任务上下文；下载成功不等于每项工具都已完成运行验证。

## 自动化作业链与指纹匹配

插件提供本地指纹匹配和任务台账接口。匹配计算与台账写入在本机完成；技能下载、联网模型调用及实际目标验证可能产生网络请求。

| 接口 | 用途 |
| --- | --- |
| `POST /api/dsh-prompt-custom/match` | 输入端口、服务标识或产品名称，返回排序后的知识库候选条目及匹配原因。匹配权重包含端口 40、产品 30、CVE 20、关键词 20、严重级别 5。 |
| `/api/dsh-prompt-custom/campaigns` | 管理测试范围、资产指纹、执行步骤、尝试记录和任务阶段。台账保存在 `$DSH_HOME/vuln-report/campaigns.json`。使用 `GET ?id=` 可读取任务及下一步建议。 |

作业链按以下阶段组织工作：

**信息收集 → 指纹识别 → 漏洞匹配 → 可行性验证 → 漏洞利用 → 横向移动 → 报告输出**

每个任务可以绑定一个会话，一个会话最多绑定一个任务。插件通过 `campaign:context` 向绑定的人工智能提供任务、阶段、资产数量及后续建议，并可调用 `agent.followup(...)` 继续推进。任务接口提供 `bind`、`unbind`、`kick` 等操作。

当前实现由用户在插件面板中创建任务；人工智能使用已有任务记录资产、步骤和结果。原生工具接口包括 `kb_match`、`campaign_upsert`、`finding_upsert`、`pipeline_next`，技能检索入口包括 `skill_search` 和 `skill_read`。原生工具注册依赖可解析的 DSH 工具服务，相应本地 HTTP 接口也提供功能入口。

任务可以记录目标、进度和完成标记。自动续跑默认最多 8 轮，并提供停滞判断与下一步建议。进度和阶段用于辅助组织任务，不等于漏洞已确认；漏洞报告仍应由验证结果和证据支持。

## 内置 CVE / PoC 知识库

知识库文件位于 `plugin/knowledge/`，随插件提供，启用本身无需下载。知识内容按九个分类技能注册到 `skills.registerProvider`，人工智能可以在 `available_skills` 目录发现它们并按需加载。

| 分类技能 | 主要覆盖内容 |
| --- | --- |
| `kb-java-deser` | Java 反序列化与相关组件问题，包括 Log4Shell、Spring4Shell、Struts2、WebLogic、Shiro、Fastjson、Java ECDSA 签名校验等。 |
| `kb-java-web` | Java 与开发协作平台相关问题，包括 Confluence、GitLab、Jenkins、TeamCity、Solr、Tomcat、Struts2 等。 |
| `kb-edge-device` | 边界设备相关问题，包括 PAN-OS、Ivanti、Pulse、Citrix、FortiOS、F5 等。 |
| `kb-exchange-ad` | Exchange 与域环境相关问题，包括 ProxyLogon、ProxyShell、ProxyNotShell、Zerologon、AD CS、PrintNightmare、MS17-010、BlueKeep、Outlook 等。 |
| `kb-web-cms` | 网站与内容管理系统相关问题，包括 Drupal、PHP、Laravel、ThinkPHP、vBulletin、Apache、Joomla 等。 |
| `kb-linux-priv` | Linux 权限提升相关问题，包括 PwnKit、Dirty Pipe、Baron Samedit、文件系统上下文、nf_tables、Looney Tunables、overlayfs 等。 |
| `kb-cloud-container` | 云与容器相关问题，包括 runc、cgroups、Docker API、Kubernetes、Redis、PostgreSQL、Nacos 等。 |
| `kb-gray-market` | 业务站点与接口风险，包括源码及配置泄露、接口越权、账户层级、支付回调、并发与幂等性、上传、公开存储桶、导出路径、SQL 注入、SSRF 等。 |
| `kb-triage` | 从指纹识别到 CVE 候选筛选、验证证据整理与报告模板。 |

知识条目是对公开资料的整理，不应当作已经在当前目标上验证的结论。条目通过 `verified: false`、`sources:` 等元数据标记验证状态和来源，利用步骤须结合目标版本与前置条件复核。

每个条目以 Markdown 文件保存，元数据包括 `title`、`cve`、`severity`、`cvss`、`product`、`versions`、`ports`、`keywords` 等，并包含指纹、前置条件、PoC、利用步骤、修复与缓解、参考资料等内容。加载条目时会重新读取文件，知识库内容更新后可在后续调用中生效；分类定义位于 `lib/knowledge.js`，调整分类后需要重新加载插件。

知识库默认开启，开关状态保存在 `$DSH_HOME/fujiang-skills/knowledge-state.json`。关闭后停止向人工智能提供相关知识内容，原始文件仍保留在本地；由于知识库已经随包提供，不需要额外安装或下载。

## 兼容性与验证范围

插件声明兼容以下版本，安装时由 DSH 插件管理器检查：

- DeepSeek Harness 与 `dsh-system-prompt`：`>=0.2.1-rc.5 <0.3.0`。
- Cordis：`>=4.0.5 <5`。

插件使用公开的 `systemPrompt`、`skills`、`tools`、智能体生命周期及 `webServer` 服务，不通过修改 Harness 程序文件安装。安装后需要完全退出并重新启动 Harness。

0.20.13 修复了关闭免责声明后 Enter 发送、Shift+Enter 换行及 Esc 被拦截的问题，并避免中文输入法确认候选词时误触发弹窗快捷键。本次验证针对键盘事件与安装路径修复，不代表全部技能、CVE 条目或自动流程均已完成实际运行验证。

## 测试

Linux 全量测试有一条入口，在 WSL 的 Ubuntu 26.04（Node v22.22.3、python3 3.14.4、未安装 unzip 与 bsdtar）上全部通过：

```bash
# 先把真实上游包放到默认位置（真实压缩包相关用例需要它）
curl -L -o ~/work/AboutSecurity.zip https://codeload.github.com/wgpsec/AboutSecurity/zip/refs/heads/master

# 跑全部 Linux 测试 + 语法检查
bash tests/run-all-linux.sh

# 也可以指定压缩包路径
bash tests/run-all-linux.sh /path/to/AboutSecurity.zip
```

各测试文件的分工：

| 测试 | 覆盖内容 | 断言数 |
| --- | --- | --- |
| `tests/install-paths.sh` | 安装器：中文与空格路径解析、dry-run、未知参数拒绝、提示词备份与失败还原、复制内容与 `dsh plugin add` 参数；配置自动识别的全部分支（命令行、`DSH_PROFILE`、进程、`dsh-process.json`、依赖线索、路径注入拒绝、配置缺失报错） | 32 |
| `tests/linux-runtime.mjs` | ZIP 解析器（store/deflate、UTF-8 名、权限位、路径逃逸拒绝）、REA 版本门槛边界值、Node 与 npm 定位 | 23 |
| `tests/aboutsecurity-extractors.mjs` | 解压降级链的控制流：unzip 与 python3 的嵌套路径归位、不完整解压被拒绝并继续降级、全失败时的报错内容与残留清理 | 21 |
| `tests/aboutsecurity-extract.mjs` | 真实压缩包端到端：先打印系统 `tar` 读取失败的原始报错，再用插件真实代码路径（伪造 HTTP 流）完整跑一次安装 | 16 |
| `tests/aboutsecurity-real-extract.mjs` | 真实系统命令：分别禁用部分后端，验证 `python3` 与内置解析器都能完成解压并正确归位 | 14 |

合计 106 项断言。

Windows 相关测试见 `tests/install-paths.ps1`（28 项，含配置自动识别的对应分支）与 `tests/keyboard-*.mjs`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\install-paths.ps1
```

## 提示词配置与免责声明

`prompt-custom.json` 独立于插件程序文件，可能包含个人配置。安装、备份或再次分发时，请确认采用的是你希望使用或分享的版本。

使用说明与责任边界请参阅 [免责声明](./DISCLAIMER.md)。项目名称及对 DeepSeek 的提及不代表官方背书。

搜索关键词：**富江破甲、破甲、深度求索、人工智能安全评估、技能库、漏洞知识库、Ubuntu、Linux**。


## 功能效果图

### 自定义提示词

![自定义提示词](./docs/screenshots/01-custom-prompt.png)

### 技能库

![技能库](./docs/screenshots/02-skills.png)

### 知识库

![知识库](./docs/screenshots/03-knowledge.png)

### 渗透作业链

![渗透作业链](./docs/screenshots/04-workflow.png)
