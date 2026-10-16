#!/usr/bin/env node
// 用法：
//   node validate.mjs [--site-origin=https://主站,https://沙箱站] <卡片.json> [...]   校验指定文件
//   node validate.mjs --selftest          全部示范样例必须通过、全部反例必须按预期错误码被拦（npm test）
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCard } from './lib/validate-card.mjs';

const EXAMPLES = fileURLToPath(new URL('../card-examples/', import.meta.url));
const INVALID = join(EXAMPLES, 'invalid');

const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
const fmt = (e) => `    [${e.code}] ${e.path}  ${e.message}`;

let cliOpts = {};
function checkFile(f) {
  const r = validateCard(load(f), cliOpts);
  console.log(`${r.valid ? '通过' : '失败'}  ${f}`);
  r.errors.forEach((e) => console.log(fmt(e)));
  r.warnings.forEach((e) => console.log(fmt(e).replace('[', '[警告 ')));
  return r.valid;
}

// 设计评审 9.2：英文版任何位置都不能有中日韩字符（汉字、假名、谚文、全角标点）
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const SITE_PROBE = ['https://app.site-under-test.example', 'https://sandbox.site-under-test.example'];

// 英文版示范卡片（PRD F-I18N-06、AC-I18N-6）：<id>-en.json 与中文版 <id>.json 的参数项、步骤结构一一对应，只有文案、默认值和数据源不同
// U11（10-09）中文版 hot-topics 已改成与英文版相同的 7 步结构，原来的 hot-topics-en 例外已取消
const STRUCTURE_EXCEPTIONS = {};
function checkLocalePairs(files) {
  let bad = 0;
  const en = files.filter((f) => f.endsWith('-en.json'));
  if (en.length) console.log('\n== 英文版与中文版一一对应（参数项、步骤结构） ==');
  for (const f of en) {
    const e = load(join(EXAMPLES, f));
    const zf = f.replace(/-en\.json$/, '.json');
    const problems = [];
    if (!files.includes(zf)) problems.push(`缺少中文版 ${zf}`);
    else {
      const z = load(join(EXAMPLES, zf));
      if (e.meta.locale !== 'en') problems.push(`meta.locale 应为 "en"，实际 ${e.meta.locale}`);
      if (e.meta.id !== z.meta.id + '-en') problems.push(`meta.id 应为 ${z.meta.id}-en`);
      const sig = (c) => c.inputs.map((i) => `${i.key}:${i.type}${i.required ? '!' : ''}`).join(',');
      if (sig(e) !== sig(z)) problems.push(`参数项不一致：${sig(e)} ≠ ${sig(z)}`);
      const opt = (c) => c.inputs.map((i) => (i.options || []).length).join(',');
      if (opt(e) !== opt(z)) problems.push('select 选项个数不一致');
      for (const k of ['model', 'storage', 'code', 'usage']) if (!!e.permissions[k] !== !!z.permissions[k]) problems.push(`permissions.${k} 不一致`);
      if (e.display.component !== z.display.component) problems.push('展示组件不一致');
      if (JSON.stringify(e.workflow.trigger) !== JSON.stringify(z.workflow.trigger)) problems.push('触发方式不一致');
      const st = (c) => c.workflow.steps.map((s) => `${s.id}:${s.type}`).join(',');
      if (st(e) !== st(z)) { if (STRUCTURE_EXCEPTIONS[e.meta.id]) console.log(`例外  ${f}：步骤结构不同（${STRUCTURE_EXCEPTIONS[e.meta.id]}）`); else problems.push(`步骤结构不一致：${st(e)} ≠ ${st(z)}`); }
      const cjk = CJK_RE.exec(JSON.stringify(e)); // 包括 JSONata 表达式、代码、提示词、展示文字、选项和默认值
      if (cjk) problems.push(`英文版里有中文字符 "${cjk[0]}"（英文界面不应出现中文）`);
    }
    if (problems.length) bad++;
    console.log(`${problems.length ? '失败' : '通过'}  ${f} ↔ ${zf}`);
    problems.forEach((p) => console.log(`    ${p}`));
  }
  return bad;
}

// 请求层共享模块（hostRisk / wildcardRisk / parsePattern / matchPattern）必须能被浏览器运行时原样导入：
// 不许有 node: 等非相对导入；PSL 数据模块必须与 data/public_suffix_list.dat 同一版本；VAL-12 / VAL-13 的关键样例
async function checkSharedNetModules() {
  let bad = 0;
  const LIB = new URL('./lib/', import.meta.url);
  for (const f of ['netmatch.mjs', 'psl.mjs', 'data/psl-data.mjs', 'data/risky-hosting.mjs']) {
    const src = readFileSync(new URL(f, LIB), 'utf8');
    const imports = [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const nonRel = imports.filter((x) => !x.startsWith('./') && !x.startsWith('../'));
    if (nonRel.length || /\brequire\(|process\.|Buffer\b/.test(src)) { bad++; console.log(`失败  lib/${f} 不能被浏览器原样导入（${nonRel.join(', ') || 'Node 专有 API'}）`); }
  }
  const nm = await import('./lib/netmatch.mjs');
  const dat = readFileSync(new URL('./data/public_suffix_list.dat', import.meta.url), 'utf8');
  const datVer = (/^\/\/ VERSION: (\S+)/m.exec(dat) || [])[1];
  if (nm.PSL_VERSION !== datVer) { bad++; console.log(`失败  lib/data/psl-data.mjs（${nm.PSL_VERSION}）与 data/public_suffix_list.dat（${datVer}）版本不一致，请运行 node tools/build-psl.mjs`); }
  for (const f of ['hostRisk', 'wildcardRisk', 'parsePattern', 'matchPattern']) if (typeof nm[f] !== 'function') { bad++; console.log(`失败  netmatch.mjs 没有导出 ${f}`); }
  const mustBlock = ['https://*.amazonaws.com/*', 'https://*.core.windows.net/*', 'https://*.cpolar.top/*', 'https://*.oicp.net/*', 'https://*.f3322.net/*', 'https://*.xicp.net/*', 'https://*.neocities.org/*',
    // VAL-13 第二轮（2026-10-05）黄色名单清零后加入的 6 个
    'https://*.oicp.io/*', 'https://*.xicp.io/*', 'https://*.zicp.io/*', 'https://*.zicp.net/*', 'https://*.nat123.top/*', 'https://*.ngrok.cc/*',
    // VAL-13 复核（2026-10-15）：sunny-ngrok.com 预防性加入
    'https://*.sunny-ngrok.com/*'];
  const mustAllow = ['https://*.github.com/*', 'https://*.example.com/*', 'https://*.bbc.co.uk/*', 'https://*.www.ck/*'];
  for (const p of mustBlock) if (nm.wildcardRisk(p)?.code !== 'E_NET_PATTERN_TOO_BROAD') { bad++; console.log(`失败  ${p} 应当被拒（VAL-12 / VAL-13）`); }
  for (const p of mustAllow) if (nm.wildcardRisk(p)) { bad++; console.log(`失败  ${p} 应当允许`); }
  const rh = await import('./lib/data/risky-hosting.mjs');
  // VAL-13 复核（2026-10-15）：具体主机（根域、子域、多级子域）都必须报隧道提示；VAL13_DECISIONS.blocked 必须全部在名单里
  for (const h of ['sunny-ngrok.com', 'abc.sunny-ngrok.com', 'a.b.sunny-ngrok.com', 'x.ngrok.cc']) if (!nm.isTunnelHost(h)) { bad++; console.log(`失败  ${h} 应当报 W_NET_TUNNEL_HOST（VAL-13）`); }
  for (const h of ['notsunny-ngrok.com', 'sunny-ngrok.com.example.com']) if (nm.isTunnelHost(h)) { bad++; console.log(`失败  ${h} 不应当算隧道主机`); }
  for (const d of rh.VAL13_DECISIONS?.blocked || []) if (!nm.TUNNEL_HOSTING.includes(d)) { bad++; console.log(`失败  VAL13_DECISIONS.blocked 的 ${d} 不在补充禁用名单里`); }
  if (Object.keys(rh.VAL13_DECISIONS?.notBlocked || {}).length) { bad++; console.log(`失败  VAL13_DECISIONS.notBlocked 应当为空（10-15 复核后全部加入）`); }
  if ((rh.VAL13_UNVERIFIED || []).length) { bad++; console.log(`失败  VAL-13 黄色人工名单应当清零：${rh.VAL13_UNVERIFIED.join(', ')}`); }
  // 安全测试复测：PSL 在 x 下面只有通配规则时（如 *.compute.amazonaws.com），报错信息不能出现空的"（如 ）"，要给出具体后缀或不写括号
  for (const p of ['https://*.compute.amazonaws.com/*', 'https://*.compute.amazonaws.com.cn/*', 'https://*.amazonaws.com/*', 'https://*.core.windows.net/*']) {
    const r = nm.wildcardRisk(p);
    if (r?.code !== 'E_NET_PATTERN_TOO_BROAD') { bad++; console.log(`失败  ${p} 应当被拒（VAL-12）`); continue; }
    if (/（如\s*）|如\s*）|（\s*）/.test(r.reason)) { bad++; console.log(`失败  ${p} 的报错信息有空括号：${r.reason}`); }
  }
  if (!/（如 \*\.compute\.amazonaws\.com）/.test(nm.wildcardRisk('https://*.compute.amazonaws.com/*')?.reason || '')) { bad++; console.log('失败  *.compute.amazonaws.com 的报错信息应当给出具体后缀 *.compute.amazonaws.com'); }
  console.log(`${bad ? '失败' : '通过'}  请求层共享模块：可被浏览器原样导入，PSL ${nm.PSL_VERSION}，补充名单 ${nm.RISKY_HOSTING_VERSION}（${nm.TUNNEL_HOSTING.length} 个域名）`);
  return bad;
}

async function selftest() {
  let failed = 0;
  console.log('== 示范样例（必须全部通过） ==');
  const valid = readdirSync(EXAMPLES).filter((f) => f.endsWith('.json')).sort();
  if (valid.length === 0) { console.log('失败  card-examples/ 下没有示范样例'); failed++; }
  for (const f of valid) {
    const r = validateCard(load(join(EXAMPLES, f)));
    const mark = r.valid ? '通过' : '失败';
    if (!r.valid) failed++;
    console.log(`${mark}  ${f}${r.warnings.length ? `（${r.warnings.length} 条警告）` : ''}`);
    r.errors.forEach((e) => console.log(fmt(e)));
    r.warnings.forEach((e) => console.log(fmt(e).replace('[', '[警告 ')));
  }
  // 站点地址可替换（tech-stack 3.2）：示范卡片里不得出现产品名 / 本站域名；再用假定的本站 origin 跑一遍 E_SITE_ORIGIN_LINK
  for (const f of valid) {
    const raw = readFileSync(join(EXAMPLES, f), 'utf8');
    const hit = /cardrium|peekaboard|卡馆/i.exec(raw);
    if (hit) { failed++; console.log(`失败  ${f}：出现产品名 / 站点域名 "${hit[0]}"（站点地址只能来自运行时 __APP_ENV__）`); }
    const r = validateCard(JSON.parse(raw), { siteOrigins: SITE_PROBE });
    if (r.errors.some((e) => e.code === 'E_SITE_ORIGIN_LINK')) { failed++; console.log(`失败  ${f}：含本站绝对地址`); }
  }
  if (!CJK_RE.test('未完成 2 项') || !CJK_RE.test('较昨日') || CJK_RE.test('72°F · → “quoted”')) { failed++; console.log('失败  CJK 检查本身不正确'); }
  failed += checkLocalePairs(valid);
  failed += await checkSharedNetModules();
  // 额外的正例：安全规则的误报回归（例如 *.github.com、mailto: 链接、代码里访问已声明网址）
  const EXTRA = join(EXAMPLES, 'valid-extra');
  const extra = existsSync(EXTRA) ? readdirSync(EXTRA).filter((f) => f.endsWith('.json') && f !== 'expected-warnings.json').sort() : [];
  if (extra.length) console.log('\n== 额外正例（必须通过，防止安全规则误报） ==');
  for (const f of extra) {
    const r = validateCard(load(join(EXTRA, f)));
    // 文件名里写了 -defaulted 的正例还必须带 W_HTTP_CONTENT_TYPE_DEFAULTED 警告（省略 Content-Type 时平台补 application/json）
    const needWarn = /-defaulted\.json$/.test(f) && !r.warnings.some((w) => w.code === 'W_HTTP_CONTENT_TYPE_DEFAULTED');
    if (!r.valid || needWarn) failed++;
    console.log(`${r.valid && !needWarn ? '通过' : '失败'}  valid-extra/${f}${needWarn ? '（缺少 W_HTTP_CONTENT_TYPE_DEFAULTED 警告）' : ''}`);
    r.errors.forEach((e) => console.log(fmt(e)));
  }
  // 带警告预期的正例（VAL-13 复核 2026-10-15）：warn 必须出现，notWarn 必须不出现
  const WEXP = join(EXTRA, 'expected-warnings.json');
  if (existsSync(WEXP)) {
    console.log('\n== 警告预期（正例上的警告码必须符合预期） ==');
    const wexp = load(WEXP);
    for (const [f, exp] of Object.entries(wexp)) {
      if (!extra.includes(f)) { failed++; console.log(`失败  expected-warnings.json 列出的 valid-extra/${f} 不存在`); continue; }
      const codes = validateCard(load(join(EXTRA, f))).warnings.map((w) => w.code);
      const miss = (exp.warn || []).filter((c) => !codes.includes(c));
      const extraHit = (exp.notWarn || []).filter((c) => codes.includes(c));
      const okW = !miss.length && !extraHit.length;
      if (!okW) failed++;
      console.log(`${okW ? '通过' : '失败'}  valid-extra/${f}${miss.length ? `（缺少 ${miss.join('、')}）` : ''}${extraHit.length ? `（不应出现 ${extraHit.join('、')}）` : ''}`);
    }
  }
  console.log('\n== 反例（必须全部被拦，且命中预期错误码） ==');
  const expected = load(join(INVALID, 'expected.json'));
  const files = readdirSync(INVALID).filter((f) => f.endsWith('.json') && f !== 'expected.json').sort();
  if (files.length === 0) { console.log('失败  card-examples/invalid/ 下没有反例'); failed++; }
  for (const f of files) {
    const exp = expected[f];
    if (!exp) { console.log(`失败  ${f}：expected.json 中缺少预期错误码`); failed++; continue; }
    const r = validateCard(load(join(INVALID, f)), exp.options || {});
    const codes = r.errors.map((e) => e.code);
    const hit = !r.valid && codes.includes(exp.code) && (exp.also || []).every((c) => codes.includes(c));
    if (!hit) failed++;
    console.log(`${hit ? '已拦截' : '未按预期拦截'}  ${f}  预期 ${[exp.code, ...(exp.also || [])].join(' + ')}（${exp.why}）`);
    r.errors.forEach((e) => console.log(fmt(e)));
  }
  for (const f of Object.keys(expected)) if (!files.includes(f)) { console.log(`失败  expected.json 列出的 ${f} 不存在`); failed++; }
  // 错误码文档完整性：校验器源码里出现的每个 E_* / W_* 码都必须列在 card-schema-v1.md 第 9 节
  {
    const md = readFileSync(fileURLToPath(new URL('../card-schema-v1.md', import.meta.url)), 'utf8');
    const a = md.indexOf('\n## 9'), b = md.indexOf('\n## 10', a);
    const sec = a >= 0 && b > a ? md.slice(a, b) : '';
    const libDir = fileURLToPath(new URL('./lib/', import.meta.url));
    const srcs = [fileURLToPath(import.meta.url), ...readdirSync(libDir, { recursive: true }).filter((f) => f.endsWith('.mjs')).map((f) => join(libDir, f))];
    const codes = new Set(srcs.flatMap((f) => readFileSync(f, 'utf8').match(/\b[EW]_[A-Z0-9_]+\b/g) || []));
    const missing = [...codes].filter((c) => !new RegExp(`\\b${c}\\b`).test(sec)).sort();
    if (!sec) { console.log('失败  card-schema-v1.md 找不到第 9 节'); failed++; }
    else if (missing.length) { console.log(`失败  card-schema-v1.md 第 9 节缺少错误码：${missing.join('、')}`); failed++; }
    else console.log(`通过  card-schema-v1.md 第 9 节列全了校验器的 ${codes.size} 个错误码 / 警告码`);
  }
  console.log(`\n结果：示范样例 ${valid.length} 个，反例 ${files.length} 个，${failed === 0 ? '全部符合预期' : `${failed} 项不符合预期`}`);
  process.exit(failed === 0 ? 0 : 1);
}

let args = process.argv.slice(2);
// --site-origin=https://主站,https://沙箱站：检查卡片里是否出现本站绝对地址（E_SITE_ORIGIN_LINK）
const so = args.find((a) => a.startsWith('--site-origin='));
if (so) { cliOpts = { siteOrigins: so.slice(14).split(',').filter(Boolean) }; args = args.filter((a) => a !== so); }
if (args.includes('--selftest') || args.length === 0) selftest();
else process.exit(args.map(checkFile).every(Boolean) ? 0 : 1);
