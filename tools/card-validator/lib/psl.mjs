// 公共后缀列表（Public Suffix List，https://publicsuffix.org/）匹配。ICANN 段和 PRIVATE 段都用。
// 纯 ESM、无 Node 依赖：规则来自预处理好的 ./data/psl-data.mjs（node tools/build-psl.mjs 生成），
// 校验器和平台运行时（主站请求层）原样导入同一份文件，保证“同一套规则”。
import { PSL_VERSION, PSL_COMMIT, PSL_ICANN, PSL_PRIVATE } from './data/psl-data.mjs';
export { PSL_VERSION, PSL_COMMIT };

const exact = new Map();      // 规则 → 'ICANN' | 'PRIVATE'
const wildcard = new Map();   // "*.x" 的 x → 段
const exception = new Map();  // "!x" 的 x → 段
const hasBelow = new Set();   // VAL-12：PSL 里至少有一条规则以 ".x" 结尾的 x（x 之下还有公共后缀）
for (const [section, blob] of [['ICANN', PSL_ICANN], ['PRIVATE', PSL_PRIVATE]]) {
  for (const rule of blob.split('\n')) {
    if (!rule) continue;
    const body = rule.startsWith('!') ? rule.slice(1) : rule;
    if (rule.startsWith('!')) exception.set(body, section);
    else if (body.startsWith('*.')) wildcard.set(body.slice(2), section);
    else exact.set(body, section);
    const labels = body.split('.');
    for (let i = 1; i < labels.length; i++) hasBelow.add(labels.slice(i).join('.'));
  }
}

// WHATWG 主机规范化（小写、IDN 转 punycode），浏览器和 Node 都有 URL
const norm = (host) => {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  try { return new URL(`http://${h}/`).hostname; } catch { return h; }
};
/** 返回 { suffix, section, rule }：host 的公共后缀（最长匹配规则，例外规则优先；都不匹配时按默认规则 "*"，即最后一段）。 */
export function publicSuffix(host) {
  const labels = norm(host).split('.');
  for (let i = 0; i < labels.length; i++) {
    const cand = labels.slice(i).join('.');
    const parent = labels.slice(i + 1).join('.');
    if (exception.has(cand)) return { suffix: parent, section: exception.get(cand), rule: '!' + cand };
    if (exact.has(cand)) return { suffix: cand, section: exact.get(cand), rule: cand };
    if (parent && wildcard.has(parent)) return { suffix: cand, section: wildcard.get(parent), rule: '*.' + parent };
  }
  return { suffix: labels[labels.length - 1], section: 'DEFAULT', rule: '*' };
}

/** host 本身就是公共后缀（含 PRIVATE 段，例如 github.io、workers.dev；未知顶级域按默认规则也算） */
export function isPublicSuffix(host) {
  return publicSuffix(host).suffix === norm(host);
}

/** VAL-12：PSL（含 PRIVATE 段）里是否有任何规则以 ".host" 结尾，即 host 之下还有公共后缀（如 amazonaws.com 之下的 s3.amazonaws.com） */
export function hasSuffixBelow(host) {
  return hasBelow.has(norm(host));
}
/** 列出 host 之下的若干条 PSL 规则（报错信息用） */
export function suffixesBelow(host, limit = 3) {
  const h = norm(host); const out = [];
  // 示例只取“确实是公共后缀”的规则：精确规则原样输出；通配规则 "*.k" 按 PSL 写法原样输出为 "*.k"
  // （k 等于 h 时也算在 h 之下，例如 compute.amazonaws.com 下面只有 *.compute.amazonaws.com，避免报错信息里出现空的"（如 ）"）。
  // 例外规则 "!k" 表示 k **不是**公共后缀，不能当作“下面还有公共后缀”的例子，不输出（安全复测 2026-10-05 文案项）。
  for (const m of [exact, wildcard]) for (const k of m.keys()) {
    const under = k.endsWith('.' + h) || (m === wildcard && k === h);
    if (under) { out.push(m === wildcard ? '*.' + k : k); if (out.length >= limit) return out; }
  }
  return out;
}
