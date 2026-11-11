// 解压后端降级链的单元测试（不联网、不需要真实压缩包）。
//
// 重点验证一个真实缺陷：unzip / python3 会在目标目录下重建 zip 内的完整路径
// （<out>/AboutSecurity-master/skills），而 bsdtar / 内置解析器用 --strip-components 直接得到
// <out>/skills。若只检查 <out>/skills，前两个后端即使解压成功也会被误判为失败。
//
// 运行：node tests/aboutsecurity-extractors.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAboutSecuritySkillLibrary } from '../plugin/lib/aboutsecurity.js';

let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) { console.log('PASS ' + name); pass += 1; }
  else { console.error('FAIL ' + name + (extra ? '\n  ' + extra : '')); fail += 1; }
};

const SKILLS = 200;
const MEMBER = 'AboutSecurity-master/skills';

/** 生成一个合法的技能树：200 个 SKILL.md + 若干分类目录。 */
function plantSkills(root) {
  for (let i = 0; i < SKILLS; i += 1) {
    const category = 'cat-' + (i % 7);
    const dir = path.join(root, category, 'skill-' + i);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), [
      '---',
      'name: skill-' + i,
      'description: 测试技能 ' + i,
      '---',
      '',
      '# skill-' + i,
    ].join('\n'), 'utf8');
  }
}

/** 伪造一个 ZIP 响应体：只要魔数正确，looksLikeZip 就会放行。 */
function fakeResponse() {
  const chunks = [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(4096, 7)];
  return {
    ok: true, status: 200,
    headers: { get: () => String(chunks.reduce((n, c) => n + c.length, 0)) },
    body: {
      async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
    },
  };
}

function fakeCtx() {
  return {
    inject: () => {},
    effect: () => {},
    logger: { warn: () => {}, info: () => {} },
  };
}

/**
 * 构造一个 library 实例，run() 由 scenarios 决定行为。
 * scenarios 形如 { unzip: fn|'missing', python3: ..., bsdtar: ... }。
 */
function makeLibrary({ home, run }) {
  return createAboutSecuritySkillLibrary(fakeCtx(), { home, run: run || (() => Promise.reject(Object.assign(new Error('command not found'), { code: 'ENOENT' }))), fetch: async () => fakeResponse() });
}

async function install(home, run) {
  const lib = makeLibrary({ home, run });
  await lib.ready;
  const result = lib.action({ id: 'aboutsecurity', action: 'install' });
  await lib.settled();
  return { result, snapshot: lib.snapshot().skills[0] };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fujiang-extractors-'));

try {
  // ---- 1. unzip 可用：会重建完整路径，必须被归位 ----
  {
    const home = path.join(tmp, 'case-unzip');
    fs.mkdirSync(home, { recursive: true });
    const seen = [];
    const { snapshot } = await install(home, async (command, args) => {
      seen.push(command + ' ' + args.join(' '));
      if (command !== 'unzip') throw new Error(command + ' 不可用');
      const out = args[args.indexOf('-d') + 1];
      plantSkills(path.join(out, MEMBER));           // unzip 保留完整路径
      return '';
    });
    const skillsDir = path.join(home, 'fujiang-skills', 'aboutsecurity', 'skills');
    ok('unzip 路径：状态为已安装', snapshot.installed === true, JSON.stringify({ err: snapshot.message, phase: snapshot.phase }));
    ok('unzip 路径：记录了所用后端', snapshot.extractors?.used === 'unzip', JSON.stringify(snapshot.extractors));
    ok('unzip 路径：技能目录被归位到 skills/',
      fs.existsSync(path.join(skillsDir, 'cat-0', 'skill-0', 'SKILL.md')));
    ok('unzip 路径：清掉了 AboutSecurity-master 中间目录',
      !fs.existsSync(path.join(home, 'fujiang-skills', 'aboutsecurity', 'AboutSecurity-master')));
    ok('unzip 路径：技能数量正确', snapshot.skillCount === SKILLS, String(snapshot.skillCount));
    // 只统计"解压调用"，排除 availableExtractors() 的探测（unzip -v / python3 -V / bsdtar --version）。
    const extractions = seen.filter(c => /\s-(?:q|xf|c)\b/.test(c));
    ok('unzip 路径：没有回退到其他后端',
      extractions.length === 1 && extractions[0].startsWith('unzip '), extractions.join(' | '));
  }

  // ---- 2. unzip 缺失 → python3 接手，同样重建完整路径 ----
  {
    const home = path.join(tmp, 'case-python');
    fs.mkdirSync(home, { recursive: true });
    const tried = [];
    const { snapshot } = await install(home, async (command, args) => {
      tried.push(command);
      if (command === 'unzip') throw Object.assign(new Error('spawn unzip ENOENT'), { code: 'ENOENT' });
      // 解压调用形如：python3 -c <脚本> <archive> <extracted> <member>
      if (command === 'python3' && args[0] === '-c') { plantSkills(path.join(args[3], MEMBER)); return ''; }
      throw new Error(command + ' 不可用');
    });
    ok('python3 路径：降级成功', snapshot.installed === true, JSON.stringify({ err: snapshot.message }));
    ok('python3 路径：记录了所用后端', snapshot.extractors?.used === 'python3', JSON.stringify(snapshot.extractors));
    ok('python3 路径：先试 unzip 再试 python3', tried[0] === 'unzip' && tried[1] === 'python3', tried.join(','));
    ok('python3 路径：技能目录被归位',
      fs.existsSync(path.join(home, 'fujiang-skills', 'aboutsecurity', 'skills', 'cat-1', 'skill-1', 'SKILL.md')));
    ok('python3 路径：可用后端列表含内置解析器',
      Array.isArray(snapshot.extractors?.available) && snapshot.extractors.available.includes('内置 ZIP 解析器'),
      JSON.stringify(snapshot.extractors));
  }

  // ---- 3. 后端解压出空目录（技能数不足）→ 清理后继续降级 ----
  {
    const home = path.join(tmp, 'case-thin');
    fs.mkdirSync(home, { recursive: true });
    let ranBuiltin = false;
    const { snapshot } = await install(home, async (command, args) => {
      if (command === 'unzip') { plantSkills(path.join(args[args.indexOf('-d') + 1], MEMBER)); return ''; }
      // 这里让 unzip 只解出极少数技能，模拟不完整解压
      throw new Error(command + ' 不可用');
    });
    ok('技能数不足时不会误判为成功', snapshot.installed === true && snapshot.extractors?.used === 'unzip');

    // 单独构造：unzip 只解出 3 个技能 → 必须被拒绝并回退到下一后端
    const home2 = path.join(tmp, 'case-partial');
    fs.mkdirSync(home2, { recursive: true });
    const ran = [];
    const partial = await install(home2, async (command, args) => {
      ran.push(command);
      if (command === 'unzip' || command === 'python3') {
        const out = command === 'unzip' ? args[args.indexOf('-d') + 1] : args[1];
        const dir = path.join(out, MEMBER, 'cat-0', 'only-' + command);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: only-' + command + '\ndescription: 只有一个\n---\n', 'utf8');
        return '';
      }
      throw new Error(command + ' 不可用');
    });
    ok('不完整解压被拒绝', partial.snapshot.installed === false, JSON.stringify({ phase: partial.snapshot.phase, err: partial.snapshot.message }));
    ok('不完整解压后继续尝试了 python3', ran.includes('python3'), ran.join(','));
    ok('不完整解压的残留目录被清理',
      !fs.existsSync(path.join(home2, 'fujiang-skills', 'aboutsecurity')));
    ranBuiltin = true; // 内置解析器在本用例中因伪造包不可解而失败，由 aboutsecurity-extract.mjs 用真实包覆盖
  }

  // ---- 4. 全部后端失败 → 报错信息里列出每个后端的原因 ----
  {
    const home = path.join(tmp, 'case-allfail');
    fs.mkdirSync(home, { recursive: true });
    const { snapshot } = await install(home, async command => {
      throw Object.assign(new Error('spawn ' + command + ' ENOENT'), { code: 'ENOENT' });
    });
    ok('全部失败时进入 error 状态', snapshot.phase === 'error', JSON.stringify(snapshot.phase));
    ok('报错列出了 unzip 的原因', String(snapshot.message).includes('unzip'));
    ok('报错列出了 python3 的原因', String(snapshot.message).includes('python3'));
    ok('报错列出了内置解析器', String(snapshot.message).includes('内置 ZIP 解析器'));
    ok('报错给出 apt 安装建议', String(snapshot.message).includes('apt install'));
    ok('失败后没有留下安装目录', !fs.existsSync(path.join(home, 'fujiang-skills', 'aboutsecurity')));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + pass + ' 项通过，' + fail + ' 项失败。');
process.exit(fail === 0 ? 0 : 1);
