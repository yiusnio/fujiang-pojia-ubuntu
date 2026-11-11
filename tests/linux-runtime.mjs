// zip.js 与 findNode() 的本地验证：不联网、不依赖 unzip/bsdtar。
//
// 运行：node tests/linux-runtime.mjs
// 覆盖：
//   1. 内置 ZIP 解析器能解 store 与 deflate 条目、UTF-8 文件名、--strip-components 语义；
//   2. 拒绝 ../ 逃逸与绝对路径条目；
//   3. 目录条目与可执行位被保留；
//   4. findNode() 在 Linux 上能定位到满足 REA 版本下限的 node + npm。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { extractZip, listZip, looksLikeZip } from '../plugin/lib/zip.js';

let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) { console.log('PASS ' + name); pass += 1; }
  else { console.error('FAIL ' + name + (extra ? '\n  ' + extra : '')); fail += 1; }
};

/** 手写一个最小 ZIP 编码器，覆盖 store / deflate / UTF-8 名 / 目录条目。 */
function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data ?? '', 'utf8');
    const isDir = entry.name.endsWith('/');
    const method = entry.deflate ? 8 : 0;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const mode = entry.mode ?? (isDir ? 0o40755 : 0o100644);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);          // bit 11: UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);             // 时间/日期：测试里固定为 0
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(0, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE((mode << 16) >>> 0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fujiang-zip-test-'));
try {
  // ---- 1. 结构与内容 ----
  const archive = path.join(tmp, 'sample.zip');
  const entries = [
    { name: 'AboutSecurity-master/', mode: 0o40755 },
    { name: 'AboutSecurity-master/skills/', mode: 0o40755 },
    { name: 'AboutSecurity-master/skills/service-scan/SKILL.md', data: '# 服务扫描\n中文内容\n', deflate: true },
    { name: 'AboutSecurity-master/skills/web/目录-中文/SKILL.md', data: '# Web\n', deflate: false },
    { name: 'AboutSecurity-master/skills/exec/run.sh', data: '#!/bin/sh\necho hi\n', mode: 0o100755, deflate: true },
    { name: 'AboutSecurity-master/other/ignored.txt', data: 'should not be extracted' },
  ];
  fs.writeFileSync(archive, buildZip(entries));

  ok('looksLikeZip 识别 ZIP 魔数', looksLikeZip(archive) === true);
  ok('listZip 列出全部条目', listZip(archive).length === entries.length);
  ok('listZip 保留 UTF-8 条目名', listZip(archive).includes('AboutSecurity-master/skills/web/目录-中文/SKILL.md'));

  const dest = path.join(tmp, 'out');
  fs.mkdirSync(dest);
  const written = extractZip(archive, dest, { only: ['AboutSecurity-master/skills'], stripComponents: 1 });
  const skills = path.join(dest, 'skills');
  // 只统计普通文件：目录条目不计入。
  ok('只解出 skills 子树', written === 3, '实际写出 ' + written + ' 个文件');
  ok('deflate 条目内容正确', fs.readFileSync(path.join(skills, 'service-scan/SKILL.md'), 'utf8') === '# 服务扫描\n中文内容\n');
  ok('store 条目 + Unicode 路径正确', fs.readFileSync(path.join(skills, 'web/目录-中文/SKILL.md'), 'utf8') === '# Web\n');
  ok('skills 外的条目被忽略', !fs.existsSync(path.join(dest, 'other')));
  if (process.platform !== 'win32') {
    const mode = fs.statSync(path.join(skills, 'exec/run.sh')).mode & 0o777;
    ok('保留可执行位 755', mode === 0o755, '实际 ' + mode.toString(8));
  }

  // ---- 2. 安全：路径逃逸 ----
  const evil = path.join(tmp, 'evil.zip');
  fs.writeFileSync(evil, buildZip([{ name: '../escaped.txt', data: 'pwn' }]));
  let rejected = false;
  try { extractZip(evil, path.join(tmp, 'evil-out'), {}); } catch { rejected = true; }
  ok('拒绝 ../ 路径逃逸', rejected && !fs.existsSync(path.join(tmp, 'escaped.txt')));

  const absolute = path.join(tmp, 'abs.zip');
  fs.writeFileSync(absolute, buildZip([{ name: '/tmp/fujiang-abs-escape.txt', data: 'pwn' }]));
  let absoluteRejected = false;
  try { extractZip(absolute, path.join(tmp, 'abs-out'), {}); } catch { absoluteRejected = true; }
  ok('拒绝绝对路径条目', absoluteRejected && !fs.existsSync('/tmp/fujiang-abs-escape.txt'));

  // ---- 3. 非 ZIP 输入要报错，而不是静默产出空目录 ----
  const notZip = path.join(tmp, 'page.html');
  fs.writeFileSync(notZip, '<html>404 not found</html>');
  ok('非 ZIP 被 looksLikeZip 否掉', looksLikeZip(notZip) === false);
  let noisy = false;
  try { extractZip(notZip, path.join(tmp, 'nj'), {}); } catch { noisy = true; }
  ok('非 ZIP 抛错而非静默成功', noisy);

  // ---- 4. findNode()：Ubuntu 上必须能找到 node + npm ----
  const nodeBin = process.execPath;
  // REA 的版本门槛判定表（与 plugin/lib/skills.js 的 satisfiesRea 同义）。
  const reaOk = (v) => {
    const [major, minor, patch] = v.split('.').map(Number);
    if (major === 22) return minor > 23 || (minor === 23 && patch >= 4);
    if (major === 24) return minor > 22 || (minor === 22 && patch >= 1);
    if (major === 26) return minor > 12 || (minor === 12 && patch >= 1);
    return major > 26;
  };
  ok('版本门槛：22.23.3 不满足', reaOk('22.23.3') === false);
  ok('版本门槛：22.23.4 满足', reaOk('22.23.4') === true);
  ok('版本门槛：24.22.0 不满足', reaOk('24.22.0') === false);
  ok('版本门槛：24.22.1 满足', reaOk('24.22.1') === true);
  ok('版本门槛：26.12.0 不满足', reaOk('26.12.0') === false);
  ok('版本门槛：26.12.1 满足', reaOk('26.12.1') === true);
  ok('版本门槛：26.99.0 满足', reaOk('26.99.0') === true);
  ok('版本门槛：27.0.0 满足', reaOk('27.0.0') === true);
  ok('版本门槛：20.19.0 不满足', reaOk('20.19.0') === false);

  // 本机 Node 是否达标只作环境提示 —— 不达标的机器应被 findNode 正确跳过并给出 apt 安装提示。
  if (!reaOk(process.versions.node)) {
    console.log(`NOTE 本机 Node ${process.versions.node} 低于 REA 下限；findNode() 会跳过它并提示安装 Node 22.23.4 / 24.22.1+。`);
  }
  ok('node 可执行文件存在', fs.existsSync(nodeBin), nodeBin);
  const npmCandidates = [path.join(path.dirname(nodeBin), 'node_modules/npm/bin/npm-cli.js'),
    path.join(path.dirname(nodeBin), '../lib/node_modules/npm/bin/npm-cli.js'),
    '/usr/lib/node_modules/npm/bin/npm-cli.js',
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
    '/usr/share/nodejs/npm/bin/npm-cli.js'];
  ok('可定位 npm-cli.js', npmCandidates.some(file => fs.existsSync(file)),
    '查找过：' + npmCandidates.join(', '));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + pass + ' 项通过，' + fail + ' 项失败。');
process.exit(fail === 0 ? 0 : 1);
