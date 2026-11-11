// 用真实系统命令（python3 / bsdtar / 内置解析器）跑完整降级链，验证真实环境下的行为。
//
// 与 aboutsecurity-extractors.mjs 的区别：那里用假的 run() 验证控制流，这里真调 python3 zipfile，
// 验证「真实 python3 解出的目录结构」能被 locateSkills() 正确归位。
//
// 运行：node tests/aboutsecurity-real-extract.mjs ~/work/AboutSecurity.zip
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createAboutSecuritySkillLibrary } from '../plugin/lib/aboutsecurity.js';

const archive = process.argv[2];
if (!archive || !fs.existsSync(archive)) {
  console.error('用法：node tests/aboutsecurity-real-extract.mjs <AboutSecurity-master.zip>');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) { console.log('PASS ' + name); pass += 1; }
  else { console.error('FAIL ' + name + (extra ? '\n  ' + extra : '')); fail += 1; }
};

const which = command => {
  try { return execFileSync('sh', ['-c', 'command -v ' + command], { encoding: 'utf8' }).trim(); }
  catch { return null; }
};
console.log('环境探测：unzip=' + (which('unzip') || '缺失')
  + ' python3=' + (which('python3') || '缺失')
  + ' bsdtar=' + (which('bsdtar') || '缺失'));

const plainCtx = () => ({ inject: () => {}, effect: () => {}, logger: { warn: () => {}, info: () => {} } });
const fileResponse = file => {
  const buffer = fs.readFileSync(file);
  return {
    ok: true, status: 200,
    headers: { get: name => (String(name).toLowerCase() === 'content-length' ? String(buffer.length) : null) },
    body: { async *[Symbol.asyncIterator]() { for (let i = 0; i < buffer.length; i += 1 << 16) yield buffer.subarray(i, i + (1 << 16)); } },
  };
};

/** 跑一次插件安装，block 决定哪些命令被"禁用"（抛 ENOENT）。 */
async function runInstall(label, { disable }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fujiang-real-'));
  try {
    const realRun = (await import('node:child_process')).spawn;
    const run = (command, args, opts) => new Promise((resolve, reject) => {
      if (disable.includes(command)) return reject(Object.assign(new Error('spawn ' + command + ' ENOENT'), { code: 'ENOENT' }));
      const child = realRun(command, args, { cwd: opts?.cwd, signal: opts?.signal, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', c => { out += c; });
      child.stderr.on('data', c => { out += c; });
      child.on('error', reject);
      child.on('close', code => (code === 0 ? resolve(out) : reject(new Error('exit ' + code + ': ' + out.slice(-400)))));
    });
    const lib = createAboutSecuritySkillLibrary(plainCtx(), { home, fetch: async () => fileResponse(archive), run });
    await lib.ready;
    lib.action({ id: 'aboutsecurity', action: 'install' });
    await lib.settled();
    return { home, state: lib.snapshot().skills[0] };
  } catch (error) {
    fs.rmSync(home, { recursive: true, force: true });
    throw error;
  }
}

const cases = [];
if (which('python3')) cases.push({ label: 'python3（禁 unzip / bsdtar）', disable: ['unzip', 'bsdtar'], expect: 'python3' });
if (which('bsdtar')) cases.push({ label: 'bsdtar（禁 unzip / python3）', disable: ['unzip', 'python3'], expect: 'bsdtar' });
cases.push({ label: '内置解析器（全部外部命令禁用）', disable: ['unzip', 'python3', 'bsdtar', 'tar'], expect: '内置 ZIP 解析器' });

for (const { label, disable, expect } of cases) {
  let home = null;
  try {
    const result = await runInstall(label, { disable });
    home = result.home;
    const state = result.state;
    console.log('\n--- ' + label + ' ---');
    ok(label + '：安装成功', state.installed === true, JSON.stringify({ phase: state.phase, message: state.message }));
    ok(label + '：使用后端 ' + expect, state.extractors?.used === expect, JSON.stringify(state.extractors));
    ok(label + '：技能数 >= 200', state.skillCount >= 200, String(state.skillCount));
    const skillsDir = path.join(home, 'fujiang-skills', 'aboutsecurity', 'skills');
    ok(label + '：skills/ 就位', fs.existsSync(skillsDir));
    ok(label + '：无 AboutSecurity-master 残留',
      !fs.existsSync(path.join(home, 'fujiang-skills', 'aboutsecurity', 'AboutSecurity-master')));
    ok(label + '：无暂存目录残留',
      !fs.readdirSync(path.join(home, 'fujiang-skills')).some(n => n.startsWith('.staging-')));
    if (fs.existsSync(skillsDir)) {
      const cats = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
      ok(label + '：分类目录 >= 5', cats >= 5, String(cats));
    }
  } catch (error) {
    ok(label + '：安装成功', false, String(error?.message || error));
  } finally {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n' + pass + ' 项通过，' + fail + ' 项失败。');
process.exit(fail === 0 ? 0 : 1);
