// The catalog stores sources only. REA is acquired on demand into an owned directory.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const OWNER = 'dsh-prompt-custom:skill-library:v1';
const MARKER = '.fujiang-owner.json';
const MCP_VERSION = '0.2.1-rc.5';
const MAX_REA_TARBALL_BYTES = 128 * 1024 * 1024;
const SKILL_NAME = 'fujiang-rea-reverse-engineer-anything';
const SERVER_NAME = 'fujiang_rea';
const CATALOG = Object.freeze({
  id: 'rea', name: '逆向破解', projectName: 'Reverse Engineer Anything (REA)',
  repositoryUrl: 'https://github.com/morluto/rea',
  installUrl: 'https://registry.npmjs.org/rea-agents/latest',
});
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const messageOf = error => String(error?.message || error).slice(0, 1600);
const isInside = (base, file) => {
  const relative = path.relative(base, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function run(command, args, { cwd, signal, timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, signal, windowsHide: true, shell: false,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = chunk => { output = (output + chunk.toString()).slice(-6000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    let spawnError = null;
    child.on('error', error => { spawnError = error; });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('下载或安装超时，请检查网络后重试。'));
      else if (spawnError) reject(spawnError);
      else if (code !== 0) reject(new Error(`安装进程退出 (${code})：${output.trim().slice(-1400)}`));
      else resolve(output.trim());
    });
  });
}

const WIN = process.platform === 'win32';
const HOME = os.homedir();

/** 展开可能不存在的目录：只返回真实存在的路径，避免污染候选列表。 */
function existing(dirs) {
  const found = [];
  for (const dir of dirs) {
    if (!dir) continue;
    try { if (fs.existsSync(dir)) found.push(dir); } catch { /* 权限不足的目录直接跳过 */ }
  }
  return found;
}

/** 枚举家目录下版本管理器安装的 Node（nvm / fnm / volta / n 各自一套布局）。 */
function versionManagerBins() {
  const dirs = [];
  const expand = (base, suffix) => {
    try {
      for (const name of fs.readdirSync(base)) dirs.push(path.join(base, name, suffix));
    } catch { /* 没装这个管理器 */ }
  };
  expand(path.join(HOME, '.nvm/versions/node'), 'bin');                 // nvm
  expand(path.join(HOME, '.nvm/versions/node'), 'bin');                 // (幂等，保留可读性)
  expand(path.join(HOME, '.local/share/fnm/node-versions'), 'installation/bin'); // fnm
  dirs.push(path.join(HOME, '.volta/bin'));                             // volta
  dirs.push(path.join(HOME, '.local/bin'));                             // n / 手工前缀
  return existing(dirs);
}

function nodeDirs() {
  return [...new Set(existing([
    // 1) 跑本插件的 Node 本体：Desktop 打包版与 npx 启动都落在这里。
    path.dirname(process.execPath),
    // 2) Linux/Ubuntu 系统与发行渠道
    '/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', '/opt/node/bin', '/opt/nodejs/bin',
    // 3) 版本管理器
    ...versionManagerBins(),
    // 4) Windows 兼容路径（原行为保留，方便同一份代码两边都能跑）
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'nodejs'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin'),
    // 5) 最后按 PATH 兜底
    ...(process.env.PATH || '').split(path.delimiter),
  ]))];
}

/** npm-cli.js 的常见位置：Node 自带、系统全局、Windows 全局。 */
function npmCliCandidates(binDir) {
  return existing([
    path.join(binDir, 'node_modules/npm/bin/npm-cli.js'),               // nvm / volta
    path.join(binDir, '../lib/node_modules/npm/bin/npm-cli.js'),        // 官方 tarball 布局 /usr/local/bin → /usr/local/lib
    path.join(binDir, '../../lib/node_modules/npm/bin/npm-cli.js'),     // /usr/bin 深一层
    '/usr/lib/node_modules/npm/bin/npm-cli.js',                         // apt install nodejs npm
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',                   // 官方 tarball 默认前缀
    '/usr/share/nodejs/npm/bin/npm-cli.js',                             // Debian/Ubuntu 拆包布局
    path.join(process.env.APPDATA || '', 'npm/node_modules/npm/bin/npm-cli.js'),
  ]);
}

/** 允许用户显式指定，绕开版本探测（例如 WSL 里的 Windows 侧 npm 挂载）。 */
function overrideFromEnv() {
  const node = process.env.FUJIANG_NODE?.trim();
  const npm = process.env.FUJIANG_NPM?.trim();
  if (!node || !npm) return null;
  if (!fs.existsSync(node) || !fs.existsSync(npm)) return null;
  return { node, npm, score: Number.MAX_SAFE_INTEGER, source: 'env' };
}

/** REA 公布的运行时下限：^22.23.4 || ^24.22.1 || >=26.12.1。 */
function satisfiesRea(major, minor, patch) {
  if (major === 22) return minor > 23 || (minor === 23 && patch >= 4);
  if (major === 24) return minor > 22 || (minor === 22 && patch >= 1);
  if (major === 26) return minor > 12 || (minor === 12 && patch >= 1);
  return major > 26;
}

async function findNode(signal) {
  const override = overrideFromEnv();
  if (override) return override;
  const compatible = [];
  for (const dir of nodeDirs()) {
    const node = path.join(dir, WIN ? 'node.exe' : 'node');
    if (!fs.existsSync(node)) continue;
    try {
      const version = await run(node, ['--version'], { signal, timeout: 10000 });
      if (!/^v\d+\.\d+\.\d+$/.test(version)) continue;
      const [major, minor, patch] = version.slice(1).split('.').map(Number);
      // npm --engine-strict 稍后还会再校验一次实际安装的发行版。
      if (!satisfiesRea(major, minor, patch)) continue;
      const npm = npmCliCandidates(dir)[0];
      if (npm) compatible.push({ node, npm, score: major * 1000000 + minor * 1000 + patch, source: dir });
    } catch { if (signal?.aborted) throw new Error('操作已停止。'); }
  }
  if (compatible.length) return compatible.sort((a, b) => b.score - a.score)[0];
  throw new Error('没有找到可用的 Node.js 和 npm。Ubuntu 上可执行：sudo apt update && sudo apt install -y nodejs npm；'
    + '或用 nvm 安装 Node 22.23.4 / 24.22.1 及以上。也可用 FUJIANG_NODE / FUJIANG_NPM 指定绝对路径。');
}

function writeJson(file, value) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}

export function createSkillLibrary(ctx, options = {}) {
  const home = path.resolve(options.home || process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh'));
  const root = path.join(home, 'fujiang-skills');
  const installDir = path.join(root, 'rea');
  const stateFile = path.join(root, 'state.json');
  const controller = new AbortController();
  let state = { enabled: false };
  let installed = false;
  let version = null;
  let phase = 'not_installed';
  let error = null;
  let detail = null;
  let busy = false;
  let closed = false;
  let operation = null;
  let operationController = null;
  let cancelRequested = false;
  let progress = null;
  let canCancel = false;
  let skillDispose = null;
  let mcpFiber = null;
  let runtimeCtx = null;
  let active = false;
  let restored = false;

  function assertOwned(dir) {
    if (!isInside(home, dir)) throw new Error('技能目录不在插件管理范围内。');
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('技能目录是链接，已停止清理以保护其他安装。');
    const marker = readJson(path.join(dir, MARKER));
    if (marker.owner !== OWNER) throw new Error('目录不属于本插件，已停止操作。');
    const realHome = fs.realpathSync(home);
    if (!isInside(realHome, fs.realpathSync(dir))) throw new Error('技能目录实际位置不在插件管理范围内。');
  }
  function ensureRoot() {
    fs.mkdirSync(home, { recursive: true });
    if (fs.existsSync(root)) assertOwned(root);
    else {
      fs.mkdirSync(root);
      writeJson(path.join(root, MARKER), { owner: OWNER });
    }
  }
  function save() { ensureRoot(); writeJson(stateFile, { schema: 1, enabled: state.enabled }); }
  function verifyInstallation(dir = installDir) {
    assertOwned(root);
    assertOwned(dir);
    const pkg = readJson(path.join(dir, 'node_modules/rea-agents/package.json'));
    if (pkg.name !== 'rea-agents' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('REA 安装信息不完整，请删除后重新下载。');
    for (const file of ['scripts/rea.mjs', 'skills/reverse-engineer-anything/SKILL.md']) {
      if (!fs.statSync(path.join(dir, 'node_modules/rea-agents', file)).isFile()) throw new Error('REA 安装文件缺失。');
    }
    const require = createRequire(path.join(dir, 'package.json'));
    require.resolve('@deepseek-ai/dsh-mcp-client');
    return pkg.version;
  }
  function removeOwned(dir) {
    assertOwned(root); assertOwned(dir);
    if (path.dirname(dir) !== root) throw new Error('拒绝清理非托管技能目录。');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const toolCount = () => {
    try {
      const definitions = runtimeCtx?.tools?.schemas?.() || [];
      return definitions.filter(tool => tool.name?.startsWith(`mcp__${SERVER_NAME}__`)).length;
    } catch { return 0; }
  };
  const snapshot = () => ({ ok: true, skills: [{ ...CATALOG, installed, enabled: active,
    busy, phase, version, message: error || detail, progress: progress && { ...progress }, canCancel,
    tools: active ? toolCount() : 0 }] });

  const operationSignal = () => AbortSignal.any([
    controller.signal, operationController?.signal || new AbortController().signal,
  ]);

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function downloadTarball(metadata, destination, fetcher, signal) {
    const dist = metadata.dist;
    if (!dist || typeof dist.tarball !== 'string' || typeof dist.integrity !== 'string') {
      throw new Error('官方安装源缺少包文件或完整性校验信息。');
    }
    const url = new URL(dist.tarball);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org'
      || !url.pathname.startsWith(`/rea-agents/-/rea-agents-${metadata.version}.`)) {
      throw new Error('官方安装源返回了非预期的下载地址。');
    }
    const response = await fetcher(url.href, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]), redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error(`REA 安装包下载失败 (HTTP ${response.status})。`);
    const totalHeader = Number(response.headers?.get?.('content-length'));
    const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
    if (totalBytes && totalBytes > MAX_REA_TARBALL_BYTES) throw new Error('REA 安装包超过允许的下载大小。');
    const expectedIntegrity = dist.integrity.split(/\s+/).find(value => value.startsWith('sha512-'));
    if (!expectedIntegrity) throw new Error('官方安装源缺少 SHA-512 完整性校验值。');
    const hash = createHash('sha512');
    let receivedBytes = 0;
    const file = await fs.promises.open(destination, 'wx');
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        const buffer = Buffer.from(chunk);
        await file.writeFile(buffer);
        hash.update(buffer);
        receivedBytes += buffer.length;
        if (receivedBytes > MAX_REA_TARBALL_BYTES) throw new Error('REA 安装包超过允许的下载大小。');
        const percent = totalBytes ? Math.min(100, Math.floor(receivedBytes * 100 / totalBytes)) : null;
        progress = { stage: 'package', percent, receivedBytes, totalBytes };
        detail = totalBytes
          ? `正在下载 REA 安装包 ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`
          : `正在下载 REA 安装包 ${formatBytes(receivedBytes)}`;
      }
      await file.sync();
    } finally { await file.close(); }
    if (totalBytes && receivedBytes !== totalBytes) throw new Error('REA 安装包下载长度不完整，请重试。');
    if (hash.digest('base64') !== expectedIntegrity.slice('sha512-'.length)) {
      throw new Error('REA 安装包完整性校验失败，临时文件已清理。');
    }
    progress = { stage: 'package', percent: 100, receivedBytes, totalBytes };
  }

  async function deactivate() {
    active = false;
    if (skillDispose) { const dispose = skillDispose; skillDispose = null; dispose(); }
    if (mcpFiber) { const fiber = mcpFiber; mcpFiber = null; await fiber.dispose(); }
  }

  async function activate() {
    if (active) return;
    if (closed) throw new Error('插件已停止，请重启 DSH。');
    version = verifyInstallation();
    if (!runtimeCtx) throw new Error('当前 DSH 尚未提供技能和工具服务，请完整重启官方 Desktop 后重试。');
    const launch = readJson(path.join(installDir, 'launch.json'));
    if (!path.isAbsolute(launch.node) || !fs.existsSync(launch.node)) throw new Error('Node.js 路径已失效，请删除后重新下载安装。');
    const require = createRequire(path.join(installDir, 'package.json'));
    let mcpClient;
    try { mcpClient = await ctx.get('loader')?.import('@deepseek-ai/dsh-mcp-client'); } catch { /* use the owned fallback */ }
    mcpClient ||= await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-mcp-client')).href);
    const skillDir = path.join(installDir, 'node_modules/rea-agents/skills/reverse-engineer-anything');
    const skillPath = path.join(skillDir, 'SKILL.md');
    const markdown = fs.readFileSync(skillPath, 'utf8');
    const content = markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    try {
      mcpFiber = runtimeCtx.plugin(mcpClient, {
        transport: 'stdio', serverName: SERVER_NAME, command: launch.node,
        args: [path.join(installDir, 'node_modules/rea-agents/scripts/rea.mjs'), '--mcp'],
        cwd: installDir, env: { REA_MCP_OUTPUT_SCHEMA_PROFILE: 'off' },
        toolCallTimeoutMs: 60000, failOnStartupError: true, maxInstructionBytes: 32768,
        reconnect: { enabled: true, initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 5 },
      });
      await mcpFiber;
      if (closed) throw new Error('插件已停止。');
      if (toolCount() === 0) throw new Error('REA 未注册任何工具，请重试或重新下载安装。');
      skillDispose = runtimeCtx.skills.register({
        name: SKILL_NAME, description: '使用 REA 逆向分析原生程序、Electron/JavaScript、软件包、固件和浏览器目标。',
        source: 'runtime', provider: 'fujiang-skill-library', path: skillPath, content,
        resourceBase: { kind: 'directory', path: skillDir },
        invocation: { modelInvocable: true, userInvocable: true },
        metadata: { project: 'morluto/rea', version },
      });
      active = true;
      phase = 'ready';
    } catch (error) { await deactivate(); throw error; }
  }

  async function download() {
    ensureRoot();
    if (fs.existsSync(installDir)) throw new Error('已有安装目录，请先删除后重新下载。');
    const signal = operationSignal();
    progress = { stage: 'metadata', percent: null, receivedBytes: null, totalBytes: null };
    detail = '正在获取官方安装源…';
    const fetcher = options.fetch || globalThis.fetch;
    const response = await fetcher(CATALOG.installUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), redirect: 'error' });
    if (!response.ok) throw new Error(`无法读取官方安装链接 (HTTP ${response.status})。`);
    const metadataText = await response.text();
    if (metadataText.length > 1024 * 1024) throw new Error('安装源响应过大。');
    const metadata = JSON.parse(metadataText);
    if (metadata.name !== 'rea-agents' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version)) throw new Error('官方安装源返回了无效版本。');
    const launch = await (options.findNode || findNode)(signal);
    const stage = path.join(root, '.staging-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    fs.mkdirSync(stage);
    writeJson(path.join(stage, MARKER), { owner: OWNER });
    writeJson(path.join(stage, 'package.json'), { name: 'fujiang-managed-rea', private: true, version: '1.0.0' });
    try {
      const tarballPath = path.join(stage, 'rea-agents.tgz');
      await downloadTarball(metadata, tarballPath, fetcher, signal);
      progress = { stage: 'dependencies', percent: null, receivedBytes: null, totalBytes: null };
      detail = `REA ${metadata.version} 已下载，正在安装依赖…`;
      await (options.run || run)(launch.node, [launch.npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund',
        '--omit=dev', '--engine-strict', '--registry=https://registry.npmjs.org', '--no-save', '--package-lock=false',
        tarballPath, `@deepseek-ai/dsh-mcp-client@${MCP_VERSION}`], { cwd: stage, signal });
      if (closed) throw new Error('插件已停止。');
      verifyInstallation(stage);
      fs.unlinkSync(tarballPath);
      writeJson(path.join(stage, 'launch.json'), { node: launch.node });
      fs.renameSync(stage, installDir);
      installed = true;
      version = metadata.version;
      canCancel = false;
      progress = { stage: 'registering', percent: null, receivedBytes: null, totalBytes: null };
      detail = '下载完成，正在注册技能和工具…';
    } finally { if (fs.existsSync(stage)) removeOwned(stage); }
  }

  function start(action, task) {
    if (closed) return { status: 503, body: { ...snapshot(), ok: false, message: '插件已停止，请重启。' } };
    if (busy) return { status: 409, body: { ...snapshot(), ok: false, message: '正在处理，请等待当前操作完成。' } };
    busy = true; error = null; detail = null; cancelRequested = false;
    operationController = new AbortController();
    progress = action === 'install' ? { stage: 'metadata', percent: null, receivedBytes: null, totalBytes: null } : null;
    canCancel = action === 'install';
    phase = { install: 'installing', enable: 'enabling', disable: 'disabling', delete: 'deleting' }[action];
    operation = Promise.resolve().then(task).catch(cause => {
      if (cancelRequested && !closed) {
        error = null; phase = 'cancelled'; detail = '下载已取消，临时文件已清理。';
        progress = { ...(progress || {}), stage: 'cancelled' };
        state.enabled = false;
      } else {
        error = messageOf(cause); phase = 'error';
        try { ctx.logger?.warn?.('REA 技能库：' + error); } catch { /* optional logger */ }
      }
    }).finally(() => {
      busy = false;
      if (phase !== 'cancelled') detail = null;
      operation = null;
      operationController = null;
      cancelRequested = false;
    });
    return { status: 202, body: snapshot() };
  }

  function action(body) {
    if (!body || Array.isArray(body) || body.id !== 'rea' || !['install', 'enable', 'disable', 'delete', 'cancel'].includes(body.action)
      || Object.keys(body).some(key => !['id', 'action'].includes(key))) {
      return { status: 400, body: { ok: false, message: '不支持的技能或操作。' } };
    }
    if (body.action === 'cancel') {
      if (!busy || !canCancel || !operationController) return { status: 409, body: { ...snapshot(), ok: false, message: '当前阶段无法取消。' } };
      cancelRequested = true; canCancel = false; phase = 'cancelling';
      progress = { ...(progress || {}), stage: 'cancelling' };
      detail = '正在停止下载并清理临时文件…';
      operationController.abort(new Error('Cancelled by user'));
      return { status: 202, body: snapshot() };
    }
    return start(body.action, async () => {
      switch (body.action) {
        case 'install':
          if (!installed) await download();
          canCancel = false;
          state.enabled = true; save(); await activate(); break;
        case 'enable':
          if (!installed) throw new Error('请先下载安装 REA。');
          state.enabled = true; save(); await activate(); break;
        case 'disable':
          state.enabled = false; save(); await deactivate(); phase = installed ? 'disabled' : 'not_installed'; break;
        case 'delete':
          state.enabled = false; save(); await deactivate();
          if (fs.existsSync(installDir)) removeOwned(installDir);
          installed = false; version = null; phase = 'not_installed'; break;
      }
    });
  }

  // Services are optional for the prompt feature. Their absence is reported by the skill card.
  ctx.inject(['skills', 'tools'], scope => {
    runtimeCtx = scope;
    scope.effect(() => async () => { runtimeCtx = null; await deactivate(); }, 'fujiang-skills: runtime cleanup');
    if (restored && installed && state.enabled && !active && !busy && !closed) start('enable', activate);
  });
  const restore = async () => {
    try {
      if (!fs.existsSync(root)) return;
      assertOwned(root);
      if (fs.existsSync(stateFile)) state = { enabled: readJson(stateFile).enabled === true };
      if (fs.existsSync(installDir)) {
        assertOwned(installDir);
        installed = true; // A broken owned installation must still offer Delete in the UI.
        version = verifyInstallation(); phase = 'disabled';
        if (state.enabled && runtimeCtx) {
          // Cordis finishes injecting dependent services before this delayed restore.
          start('enable', async () => { await activate(); });
        }
      }
    } catch (cause) { error = messageOf(cause); phase = 'error'; }
    finally { restored = true; }
  };
  const ready = new Promise(resolve => setImmediate(() => resolve(restore())));
  ctx.effect(() => async () => {
    closed = true; controller.abort();
    if (operation) await operation;
    await deactivate();
  }, 'fujiang-skills: manager cleanup');
  return { snapshot, action, ready, settled: async () => { await ready; if (operation) await operation; },
    // No prompt file access is performed anywhere in this module.
  };
}
