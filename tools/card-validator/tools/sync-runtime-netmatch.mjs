// 把请求层共享模块（netmatch.mjs + psl.mjs + data/*.mjs）同步到沙箱原型的主站运行时，保证校验器和运行时是同一份代码。
//   node tools/sync-runtime-netmatch.mjs          复制（校验器 lib/ 是唯一来源，运行时一侧只许复制、不许手改）
//   node tools/sync-runtime-netmatch.mjs --check  只比对 sha256，任何一个文件不一致就失败（npm test 和沙箱原型的测试都会先跑这一步）
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

const SRC = new URL('../lib/', import.meta.url);
const DST = new URL('../../sandbox-prototype/sites/main/lib/', import.meta.url);
const FILES = ['netmatch.mjs', 'psl.mjs', 'data/psl-data.mjs', 'data/risky-hosting.mjs'];
// 旧的 .js 入口只保留为转发，避免有人继续改一份独立副本
const SHIMS = {
  'netmatch.js': "// 自动生成，不要手改：转发到与校验器同一份的 netmatch.mjs（card-validator/tools/sync-runtime-netmatch.mjs）\nexport * from './netmatch.mjs';\n",
  'psl.js': "// 自动生成，不要手改：转发到与校验器同一份的 psl.mjs（card-validator/tools/sync-runtime-netmatch.mjs）\nexport * from './psl.mjs';\n",
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const check = process.argv.includes('--check');
let bad = 0;
for (const f of FILES) {
  const src = readFileSync(new URL(f, SRC));
  const dstUrl = new URL(f, DST);
  const dst = existsSync(dstUrl) ? readFileSync(dstUrl) : null;
  const same = dst && sha(dst) === sha(src);
  if (check) {
    if (!same) { bad++; console.log(`失败  运行时 lib/${f} 与校验器不一致（校验器 ${sha(src).slice(0, 12)}，运行时 ${dst ? sha(dst).slice(0, 12) : '缺失'}）；请运行 node tools/sync-runtime-netmatch.mjs`); }
    else console.log(`一致  lib/${f}  ${sha(src).slice(0, 12)}`);
  } else if (!same) { mkdirSync(dirname(dstUrl.pathname), { recursive: true }); writeFileSync(dstUrl, src); console.log(`已同步  lib/${f}  ${sha(src).slice(0, 12)}`); }
}
for (const [f, body] of Object.entries(SHIMS)) {
  const u = new URL(f, DST);
  const cur = existsSync(u) ? readFileSync(u, 'utf8') : null;
  if (check) { if (cur !== body) { bad++; console.log(`失败  运行时 lib/${f} 应当只是转发文件`); } }
  else if (cur !== body) { writeFileSync(u, body); console.log(`已改为转发  lib/${f}`); }
}
// ---- N-4（安全复测 2026-10-05）：防止运行时一侧出现“第二份规则” ----
if (check) {
  const MAIN = new URL('../', DST);
  const walk = (u, rel = '') => readdirSync(u).flatMap((n) => {
    const cu = new URL(n + (statSync(new URL(n, u)).isDirectory() ? '/' : ''), u);
    return cu.href.endsWith('/') ? walk(cu, rel + n + '/') : [rel + n];
  });
  // (a) lib/ 下只许有同步文件和转发文件
  const allowed = new Set([...FILES, ...Object.keys(SHIMS)]);
  for (const f of walk(DST)) if (!allowed.has(f)) { bad++; console.log(`失败  运行时 lib/${f} 不是同步文件也不是转发文件（lib/ 只许放与校验器同一份的模块）`); }
  // (b) lib/ 以外不许出现规则逻辑的签名（防止有人在别处复制一份 hostRisk / PSL 表）
  const SIGS = [/function\s+hostRisk\b/, /\bPSL_ICANN\b/, /\bPSL_PRIVATE\b/, /\bV4_BLOCKS\b/, /function\s+(wildcardRisk|parsePattern|matchPattern|isPublicSuffix|registrableDomain)\b/, /\bRISKY_HOSTING\s*=/];
  const files = walk(MAIN).filter((f) => !f.startsWith('lib/') && /\.(m?js|html)$/.test(f));
  for (const f of files) {
    const txt = readFileSync(new URL(f, MAIN), 'utf8');
    for (const re of SIGS) if (re.test(txt)) { bad++; console.log(`失败  sites/main/${f} 含规则逻辑签名 ${re}；规则只能来自 lib/（与校验器同一份）`); }
    // (c) 不许 import 转发文件或其他副本，只许 import lib/netmatch.mjs / lib/psl.mjs
    for (const m of txt.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (/netmatch|psl|risky-hosting/.test(spec) && !/^\.{1,2}\/(?:\.\.\/)*lib\/(netmatch|psl)\.mjs$/.test(spec)) { bad++; console.log(`失败  sites/main/${f} 导入了 ${spec}；只许导入 lib/netmatch.mjs 或 lib/psl.mjs`); }
    }
  }
  const host = existsSync(new URL('host.js', MAIN)) ? readFileSync(new URL('host.js', MAIN), 'utf8') : '';
  if (!/^\s*import\s[^;]*from\s*['"]\.\/lib\/netmatch\.mjs['"]/m.test(host)) { bad++; console.log('失败  sites/main/host.js 没有静态 import \'./lib/netmatch.mjs\''); }
  // 附加：密钥模式与校验器一致
  const sp = new URL('rt/secret-patterns.mjs', MAIN);
  if (existsSync(sp)) {
    const grab = (t) => { const m = /SECRET_PATTERNS\s*=\s*(\[[\s\S]*?\n\]);/.exec(t); return m ? m[1].replace(/\s+/g, '') : null; };
    const a = grab(readFileSync(sp, 'utf8')), b = grab(readFileSync(new URL('semantic.mjs', SRC), 'utf8'));
    if (!a || !b || a !== b) { bad++; console.log('失败  rt/secret-patterns.mjs 的 SECRET_PATTERNS 与校验器 lib/semantic.mjs 不一致'); }
    else console.log('一致  rt/secret-patterns.mjs SECRET_PATTERNS');
  }
  console.log(bad ? `共享网络规则模块：${bad} 项不一致` : '通过  共享网络规则模块：运行时与校验器逐字节一致，且运行时没有第二份规则');
  process.exit(bad ? 1 : 0);
}
