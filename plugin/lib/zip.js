// 零依赖 ZIP 读取器：给 Ubuntu 上的 AboutSecurity 解压做兜底。
//
// 为什么需要它：
//   上游用 `tar -xf aboutsecurity.zip ...` 解压。GNU tar（Ubuntu 默认）**不认 zip**，
//   只有 bsdtar / libarchive 才认。Windows 的 tar.exe 是 bsdtar 所以能过。
//   在 Ubuntu 上如果不装 unzip，这条链路会直接报 "This does not look like a tar archive"。
//   技能包只有几千个 Markdown，用不着引入 yauzl/adm-zip 依赖，这里自己读中央目录即可。
//
// 支持：store(0) 与 deflate(8)，UTF-8 文件名（bit 11），ZIP64 的 size/offset 扩展字段，
//       data descriptor 条目（size 走中央目录，所以天然兼容流式写入的 zip）。
// 忽略：加密条目（抛错）、目录条目（返回 type 'dir'，由调用方建目录）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;
const ZIP64_EXTRA = 0x0001;
const MAX_EOCD_SEARCH = 66 * 1024; // EOCD 最大 22 字节 + 注释最大 65535

const messageOf = error => String(error?.message || error).slice(0, 800);

/** 定位 EOCD，返回解析后的中央目录元信息。 */
function readEndOfCentralDirectory(fd, size) {
  const windowSize = Math.min(size, MAX_EOCD_SEARCH);
  const buffer = Buffer.alloc(windowSize);
  fs.readSync(fd, buffer, 0, windowSize, size - windowSize);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（未找到中央目录结尾记录）。');
  let total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  // ZIP64：条目数或偏移溢出时，EOCD64 定位器紧跟在 EOCD 之前。
  if (total === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && buffer.readUInt32LE(locator) === EOCD64_LOCATOR_SIG) {
      const eocd64Offset = Number(buffer.readBigUInt64LE(locator + 8));
      const head = Buffer.alloc(56);
      fs.readSync(fd, head, 0, 56, eocd64Offset);
      if (head.readUInt32LE(0) !== EOCD64_SIG) throw new Error('ZIP64 中央目录结尾记录无效。');
      total = Number(head.readBigUInt64LE(32));
      offset = Number(head.readBigUInt64LE(48));
    }
  }
  return { total, offset };
}

/** 解析出全部条目：{ name, dir, mode, method, compressedSize, size, localOffset }。 */
function readEntries(fd) {
  const size = fs.fstatSync(fd).size;
  if (size < 22) throw new Error('文件太小，不是 ZIP。');
  const { total, offset } = readEndOfCentralDirectory(fd, size);
  if (total > 200000) throw new Error('ZIP 条目数异常，已停止解析。');
  const buffer = Buffer.alloc(size - offset);
  fs.readSync(fd, buffer, 0, buffer.length, offset);

  const entries = [];
  let cursor = 0;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > buffer.length) throw new Error('ZIP 中央目录被截断。');
    if (buffer.readUInt32LE(cursor) !== CEN_SIG) throw new Error('ZIP 中央目录条目签名错误。');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    let compressedSize = buffer.readUInt32LE(cursor + 20);
    let size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttrs = buffer.readUInt32LE(cursor + 38);
    let localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const rawName = buffer.subarray(nameStart, nameStart + nameLength);
    const name = (flags & 0x800) ? rawName.toString('utf8') : rawName.toString('latin1');

    // ZIP64 扩展字段覆盖 0xffffffff 占位值。
    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let extra = nameStart + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = buffer.readUInt16LE(extra);
        const dataSize = buffer.readUInt16LE(extra + 2);
        if (id === ZIP64_EXTRA) {
          let field = extra + 4;
          if (size === 0xffffffff) { size = Number(buffer.readBigUInt64LE(field)); field += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(buffer.readBigUInt64LE(field)); field += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(buffer.readBigUInt64LE(field)); }
          break;
        }
        extra += 4 + dataSize;
      }
    }
    if (flags & 0x1) throw new Error(`ZIP 条目已加密，无法解压：${name}`);
    if (method !== 0 && method !== 8) throw new Error(`ZIP 使用了不支持的压缩方式 (${method})：${name}`);

    const unixMode = externalAttrs >>> 16;
    entries.push({
      name: name.replace(/\\/g, '/'),
      dir: name.endsWith('/') || (unixMode & 0o170000) === 0o040000,
      mode: (unixMode & 0o777) || (name.endsWith('/') ? 0o755 : 0o644),
      method, compressedSize, size, localOffset,
    });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 读取单个条目内容。 */
function readEntry(fd, entry) {
  const header = Buffer.alloc(30);
  fs.readSync(fd, header, 0, 30, entry.localOffset);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`ZIP 本地文件头无效：${entry.name}`);
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const raw = Buffer.alloc(entry.compressedSize);
  if (entry.compressedSize > 0) fs.readSync(fd, raw, 0, entry.compressedSize, dataStart);
  if (entry.method === 0) return raw;
  const inflated = zlib.inflateRawSync(raw);
  if (entry.size && inflated.length !== entry.size) {
    throw new Error(`ZIP 条目解压后长度不符：${entry.name}`);
  }
  return inflated;
}

/** 目录条目也要建出来，否则后面 rename 会缺层级。 */
function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true });
}

/**
 * 解压整个 ZIP 到 destination。
 * only：只要这些顶层路径（zip 内路径前缀），例如 ['AboutSecurity-master/skills']。
 * stripComponents：与 tar --strip-components 同义，去掉前 N 层目录。
 * 返回写出的文件数。
 */
export function extractZip(archive, destination, { only = [], stripComponents = 0, onEntry = null } = {}) {
  const fd = fs.openSync(archive, 'r');
  const root = path.resolve(destination);
  const wanted = only.map(prefix => prefix.replace(/\/+$/, ''));
  let written = 0;
  try {
    const entries = readEntries(fd);
    for (const entry of entries) {
      const clean = entry.name.replace(/^\/+/, '');
      // 拒绝绝对路径与 ../ 逃逸。
      if (path.isAbsolute(entry.name) || clean.split('/').includes('..')) {
        throw new Error(`ZIP 条目路径不安全，已停止：${entry.name}`);
      }
      if (wanted.length && !wanted.some(prefix => clean === prefix || clean.startsWith(prefix + '/'))) continue;
      const parts = clean.split('/').filter(Boolean);
      const stripped = parts.slice(stripComponents);
      if (!stripped.length) continue;
      const target = path.join(root, ...stripped);
      if (!(target === root || target.startsWith(root + path.sep))) {
        throw new Error(`ZIP 条目越出目标目录，已停止：${entry.name}`);
      }
      if (entry.dir) { ensureDirectory(target); continue; }
      ensureDirectory(path.dirname(target));
      const content = readEntry(fd, entry);
      fs.writeFileSync(target, content, { mode: entry.mode & 0o777 });
      written += 1;
      if (onEntry) onEntry(clean, written);
    }
  } finally {
    fs.closeSync(fd);
  }
  return written;
}

/** 只列出条目名，用于自查与测试。 */
export function listZip(archive) {
  const fd = fs.openSync(archive, 'r');
  try { return readEntries(fd).map(entry => entry.name); } finally { fs.closeSync(fd); }
}

/** 探测 ZIP 魔数，避免把 HTML 错误页当压缩包解。 */
export function looksLikeZip(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(4);
      const read = fs.readSync(fd, head, 0, 4, 0);
      if (read < 4) return false;
      return head.readUInt32LE(0) === 0x04034b50
        || head.readUInt32LE(0) === 0x06054b50
        || head.readUInt32LE(0) === 0x08074b50;
    } finally { fs.closeSync(fd); }
  } catch (error) { throw new Error('压缩包不可读：' + messageOf(error)); }
}

export const zipInternals = { readEntries, readEntry, readEndOfCentralDirectory };
