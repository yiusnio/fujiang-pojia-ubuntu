// 真实上游包的端到端验证：用 codeload 下载的 AboutSecurity-master.zip。
//
// 目的：证明「Ubuntu 上 GNU tar 读不了 zip」这个上游缺陷，以及本仓库内置解析器可以绕过它。
// 运行：node tests/aboutsecurity-extract.mjs /tmp/AboutSecurity.zip
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { extractZip, looksLikeZip, listZip } from '../plugin/lib/zip.js';
import { createAboutSecuritySkillLibrary } from '../plugin/lib/aboutsecurity.js';

const archive = process.argv[2];
if (!archive || !fs.existsSync(archive)) {
  console.error('用法：node tests/aboutsecurity-extract.mjs <AboutSecurity-master.zip>');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) { console.log('PASS ' + name); pass += 1; }
  else { console.error('FAIL ' + name + (extra ? '\n  ' + extra : '')); fail += 1; }
};

const size8 = a => (a / (1024 * 1024)).toFixed(1) + ' MB';
console.log('上游包：' + size8(fs.statSync(archive).size) + '（' + archive + '）');
ok('识别为 ZIP', looksLikeZip(archive) === true);

// ---- 1. 复现上游缺陷：GNU tar 解 zip 会失败 ----
let gnuTarMessage = '';
try {
  const out = path.join(os.tmpdir(), 'fujiang-gnutar-' + Date.now());
  fs.mkdirSync(out);
  try {
    execFileSync('tar', ['-xf', archive, '-C', out, '--strip-components', '1', 'AboutSecurity-master/skills'], { stdio: 'pipe' });
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
} catch (error) {
  gnuTarMessage = String(error.stderr || error.message).split('\n')[0];
}
if (gnuTarMessage) {
  console.log('NOTE 本机 tar 解 zip 失败（这正是 Ubuntu 上的原缺陷）：' + gnuTarMessage);
} else {
  console.log('NOTE 本机 tar 是 libarchive/bsdtar，能解 zip；Ubuntu 默认的 GNU tar 则不行。');
}

// ---- 2. 内置解析器：列条目 ----
const names = listZip(archive);
console.log('条目总数：' + names.length);
ok('条目数在合理范围', names.length > 200 && names.length < 200000, String(names.length));
ok('包含目标子树', names.some(n => n.startsWith('AboutSecurity-master/skills/')));

// ---- 3. 内置解析器：只解 skills 子树 ----
const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'fujiang-aboutsec-'));
const started = Date.now();
let written = 0;
try {
  written = extractZip(archive, dest, { only: ['AboutSecurity-master/skills'], stripComponents: 1 });
  const skills = path.join(dest, 'skills');
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log('解压完成：' + written + ' 个文件，用时 ' + elapsed + 's');
  ok('写出文件数 > 200（与插件 download() 的阈值一致）', written > 200, String(written));
  ok('skills 目录存在', fs.existsSync(skills) && fs.statSync(skills).isDirectory());
  ok('未解出 skills 之外的顶层目录', !fs.existsSync(path.join(dest, 'other')) && !fs.existsSync(path.join(dest, 'README.md')));

  // 递归找 SKILL.md，与 aboutsecurity.js 的 scanSkills 口径对齐
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') found.push(full);
    }
  };
  walk(skills);
  console.log('发现 SKILL.md：' + found.length + ' 个');
  ok('SKILL.md 数量 >= 200（否则插件会拒绝安装）', found.length >= 200, String(found.length));

  // 抽查内容可读、frontmatter 完整
  const sample = found.find(f => fs.readFileSync(f, 'utf8').includes('---'));
  ok('抽查条目含 frontmatter', !!sample, sample || '');
  if (sample) {
    const head = fs.readFileSync(sample, 'utf8').slice(0, 200);
    console.log('样本（' + path.relative(skills, sample) + '）：\n' + head.split('\n').slice(0, 6).join('\n'));
  }
  ok('中文内容条目存在', names.some(n => /[\u4e00-\u9fa5]/.test(n)) || found.some(f => /[\u4e00-\u9fa5]/.test(fs.readFileSync(f, 'utf8'))));
  // 上游包路径本身全是 ASCII（中文在正文里）。UTF-8 条目名的解码由 linux-runtime.mjs 的合成包覆盖。
  const nonAscii = names.filter(n => /[^\x00-\x7F]/.test(n));
  console.log('非 ASCII 路径条目：' + nonAscii.length + '（UTF-8 名解码另由 linux-runtime.mjs 合成包验证）');
  ok('条目名无 Windows 反斜杠残留', names.every(n => !n.includes('\\')));
  ok('skills 下分类目录数量合理', new Set(names.filter(n => n.startsWith('AboutSecurity-master/skills/')).map(n => n.split('/')[2])).size >= 5);
} finally {
  fs.rmSync(dest, { recursive: true, force: true });
}

// ---- 4. 走插件真实代码路径：从本地文件伪造 HTTP 响应流，完整跑一次 install ----
// 这是最有价值的一步：它验证的是 aboutsecurity.js 里的 extractSkills()，而不是测试自己写的解析。
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fujiang-plugin-home-'));
  const plainCtx = () => ({ inject: () => {}, effect: () => {}, logger: { warn: () => {}, info: () => {} } });
  const fileResponse = file => {
    const buffer = fs.readFileSync(file);
    return {
      ok: true, status: 200,
      headers: { get: name => (String(name).toLowerCase() === 'content-length' ? String(buffer.length) : null) },
      body: { async *[Symbol.asyncIterator]() { for (let i = 0; i < buffer.length; i += 1 << 16) yield buffer.subarray(i, i + (1 << 16)); } },
    };
  };
  try {
    const lib = createAboutSecuritySkillLibrary(plainCtx(), {
      home,
      fetch: async () => fileResponse(archive),
      // 故意让外部解压命令全部不可用，逼插件使用内置解析器 —— 这正是最小化 Ubuntu 环境的真实情况。
      run: async command => { throw Object.assign(new Error('spawn ' + command + ' ENOENT'), { code: 'ENOENT' }); },
    });
    await lib.ready;
    lib.action({ id: 'aboutsecurity', action: 'install' });
    await lib.settled();
    const state = lib.snapshot().skills[0];
    ok('插件全流程：状态为已安装', state.installed === true, JSON.stringify({ phase: state.phase, message: state.message }));
    ok('插件全流程：使用内置 ZIP 解析器兜底', state.extractors?.used === '内置 ZIP 解析器', JSON.stringify(state.extractors));
    ok('插件全流程：技能数 >= 200', state.skillCount >= 200, String(state.skillCount));
    ok('插件全流程：技能目录就位',
      fs.existsSync(path.join(home, 'fujiang-skills', 'aboutsecurity', 'skills')));
    ok('插件全流程：未残留 AboutSecurity-master 中间目录',
      !fs.existsSync(path.join(home, 'fujiang-skills', 'aboutsecurity', 'AboutSecurity-master')));
    console.log('插件注册的技能数量：' + state.skillCount + '（注册需 DSH 运行时，这里只验证到扫描与落盘）');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n' + pass + ' 项通过，' + fail + ' 项失败。');
process.exit(fail === 0 ? 0 : 1);
