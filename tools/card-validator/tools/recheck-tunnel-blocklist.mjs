// 补充禁用名单（lib/data/risky-hosting.mjs）每周复查（安全测试 VAL-13 复核 2026-10-15 提出：注释里写了“每周复查”，但此前没有脚本也没有记录）。
// 由运维每周运行一次（建议周一），把生成的记录提交到 qa/security/tunnel-blocklist-recheck/<日期>.md。
// 需要联网，所以**不在** npm test 里跑。只读：不修改名单；发现异常时由安全测试和架构师判断是否调整名单。
//
//   node tools/recheck-tunnel-blocklist.mjs                    复查名单里的全部域名
//   node tools/recheck-tunnel-blocklist.mjs --category=tunnel  只查某一类（ddns / tunnel / hosting / collector；未知类别报错退出 2）
//   node tools/recheck-tunnel-blocklist.mjs --domains=a.com,b.io   非法域名、IP 字面量报错退出 2
//   （带 --category / --domains 的部分复查写 <日期>-partial-<时分秒毫秒>[-n].md（日期时间均为 UTC+8），不覆盖当天全量记录 <日期>.md）
//   node tools/recheck-tunnel-blocklist.mjs --out=<目录>       默认 ../../qa/security/tunnel-blocklist-recheck/
//   node tools/recheck-tunnel-blocklist.mjs --stdout           只打印，不写文件
//   node tools/recheck-tunnel-blocklist.mjs --strict           有“需关注”的域名时 exit 1（便于接定时任务告警）
//
// 每个域名查三项：
//   1. 根域 A / NS（DNS over HTTPS，cloudflare-dns.com，box 上通常没有 dig）
//   2. 随机子域 A（<随机串>.<域名>）：有解析说明存在通配，常见于 DDNS / 隧道服务给任意子域应答
//   3. RDAP 注册状态（按 IANA 引导表直连注册局 RDAP；对可注册域名查询，例如 tunnel.pyjam.as 查 pyjam.as）
// “需关注”：注册局 RDAP 404 且应答是 RDAP JSON（未注册）、404 但不是 RDAP 应答（rdap-broken）、30 天内到期、顶级域没有 RDAP、
//   根域 SERVFAIL 等非 NOERROR/NXDOMAIN 应答、RDAP 状态含 hold / pendingDelete / redemption（即将释放）、根域 NXDOMAIN、查询出错。
import { writeFileSync, mkdirSync } from 'node:fs';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RISKY_HOSTING, RISKY_HOSTING_VERSION } from '../lib/data/risky-hosting.mjs';
import { publicSuffix } from '../lib/psl.mjs';

// 第 4 轮 P3-4：所有显示时间（运行时间、文件名日期、到期日）一律按 Asia/Shanghai（UTC+8），与运行机器的时区无关
const SH_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const sh = (d) => {
  const p = Object.fromEntries(SH_FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, hms: `${p.hour}${p.minute}${p.second}` };
};
const shText = (d) => { const t = sh(d); return `${t.day} ${t.hm}（UTC+8）`; };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const flag = (k) => process.argv.includes(`--${k}`);
const OUT = arg('out') || fileURLToPath(new URL('../../../qa/security/tunnel-blocklist-recheck/', import.meta.url));
const DOH = 'https://cloudflare-dns.com/dns-query';
const TIMEOUT = 10000;

let list = RISKY_HOSTING;
const CATS = [...new Set(RISKY_HOSTING.map((e) => e.category))];
if (arg('category') !== undefined) {
  if (!CATS.includes(arg('category'))) { console.error(`错误：未知类别 --category=${arg('category')}（可用：${CATS.join(' / ')}）`); process.exit(2); }
  list = list.filter((e) => e.category === arg('category'));
}
if (arg('domains') !== undefined) { const want = arg('domains').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  // 第 3 轮 P4-3：只接受合法主机名（字母数字和连字符的标签，至少两段），其他一律报错退出 2
  const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  // 第 4 轮 P4-5：IP 字面量（IPv4 / IPv6，含方括号写法和全数字末段）一律拒绝
  const isIpLike = (d) => isIP(d.replace(/^\[|\]$/g, '')) !== 0 || /^[0-9.]+$/.test(d) || /^[0-9]+$/.test(d.split('.').pop());
  const bad = want.filter((d) => !HOST_RE.test(d) || isIpLike(d));
  if (bad.length) { console.error(`错误：--domains 含非法域名：${bad.map((d) => JSON.stringify(d)).join('、')}`); process.exit(2); } list = want.map((d) => RISKY_HOSTING.find((e) => e.domain === d) || { domain: d, category: '（不在名单）', source: '' }); }

if (!list.length) {   // 空列表不能静默通过（第 2 轮 P3-2）
  console.error('错误：没有要复查的域名（--category / --domains 筛选后为空）');
  process.exit(flag('strict') ? 1 : 2);
}
const fetchT = async (url, init = {}) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT);
  try { return await fetch(url, { ...init, signal: ac.signal, redirect: 'follow' }); } finally { clearTimeout(t); }
};
const RCODE = { 0: 'NOERROR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 5: 'REFUSED' };
async function doh(name, type) {
  try {
    const r = await fetchT(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
    if (!r.ok) return { err: `HTTP ${r.status}` };
    const j = await r.json();
    const ans = (j.Answer || []).filter((a) => a.type === (type === 'A' ? 1 : 2)).map((a) => a.data).sort();   // 排序：DNS 应答顺序不固定，报告要可复现
    return { rcode: RCODE[j.Status] || `rcode ${j.Status}`, ans };
  } catch (e) { return { err: e.name === 'AbortError' ? '超时' : e.message }; }
}
// RDAP 查可注册域名：最后两段；如果最后两段本身是 ICANN 公共后缀（如 com.cn），取最后三段
function registrable(domain) {
  const l = domain.split('.');
  for (let n = 2; n <= l.length; n++) {
    const cand = l.slice(-n).join('.');
    const ps = publicSuffix(cand);
    if (!(ps.section === 'ICANN' && ps.suffix === cand)) return cand;
  }
  return domain;
}
// IANA RDAP 引导表：顶级域 → 注册局 RDAP 服务（不经 rdap.org，避免 429 限流）
let BOOT = null;   // Promise<Map>，只拉一次（并发调用共用同一个 Promise）
async function rdapBase(domain) {
  BOOT ??= (async () => {
    const m = new Map();
    try {
      const j = await (await fetchT('https://data.iana.org/rdap/dns.json')).json();
      for (const [tlds, urls] of j.services) for (const t of tlds) m.set(t, urls.find((u) => u.startsWith('https:')) || urls[0]);
    } catch { /* 拿不到引导表时每个域名都会报“顶级域无 RDAP” */ }
    return m;
  })();
  const boot = await BOOT;
  const tld = domain.split('.').pop();
  return boot.get(tld);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rdap(domain) {
  const base = await rdapBase(domain);
  if (!base) return { noService: true, text: '该顶级域没有 RDAP 服务（需人工 whois）' };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetchT(`${base.replace(/\/?$/, '/')}domain/${encodeURIComponent(domain)}`, { headers: { accept: 'application/rdap+json', 'user-agent': 'tunnel-blocklist-recheck/1.0 (weekly ops job)' } });
      if (r.status === 429) { await sleep(2000 * 2 ** attempt); continue; }
      if (r.status === 404) {
        // 第 2 轮 P2-2：只有注册局给出 RDAP 格式的 404 才算“未注册”；HTML 或其他内容的 404（例如 rdap.nic.ms 的 Tomcat 404）是 RDAP 服务故障
        const ct = r.headers.get('content-type') || '';
        let body = null; try { body = JSON.parse(await r.text()); } catch { /* 不是 JSON */ }
        const isRdap = /application\/rdap\+json/i.test(ct) || (/json/i.test(ct) && body && typeof body === 'object' && ('errorCode' in body || 'objectClassName' in body));
        return isRdap ? { registered: false, text: '404 未注册（RDAP 应答）' } : { broken: true, text: `RDAP 服务异常（404，应答不是 RDAP JSON，content-type: ${ct || '无'}）` };
      }
      if (!r.ok) return { err: `HTTP ${r.status}` };
      const j = await r.json();
      const ev = Object.fromEntries((j.events || []).map((e) => { const d = new Date(e.eventDate || ''); return [e.eventAction, Number.isNaN(+d) ? (e.eventDate || '') : shText(d)]; }));
      return { registered: true, status: j.status || [], expires: ev.expiration ? new Date((j.events || []).find((e) => e.eventAction === 'expiration').eventDate) : null, text: `已注册（${(j.status || []).join(', ') || '无状态'}；到期 ${ev.expiration || '?'}）` };
    } catch (e) { if (attempt === 3) return { err: e.name === 'AbortError' ? '超时' : e.message }; }
  }
  return { err: 'HTTP 429（重试 4 次仍被限流）' };
}
const fmtDns = (r) => (r.err ? `出错：${r.err}` : r.ans.length ? r.ans.slice(0, 3).join(' / ') + (r.ans.length > 3 ? ` 等 ${r.ans.length} 条` : '') : r.rcode);

async function checkOne(e) {
  const probe = `${randomBytes(5).toString('hex')}.${e.domain}`;
  const reg = registrable(e.domain);
  const [a, ns, sub, rd] = await Promise.all([doh(e.domain, 'A'), doh(e.domain, 'NS'), doh(probe, 'A'), rdap(reg)]);
  const flags = [];
  if (rd.broken) flags.push('RDAP 服务异常（rdap-broken），需人工核对');
  if (rd.expires && !Number.isNaN(+rd.expires) && rd.expires - Date.now() <= 30 * 86400e3) flags.push(`30 天内到期（${shText(rd.expires)}），关注续费 / 释放`);
  for (const [label, r] of [['根域 A', a], ['根域 NS', ns]]) if (r.rcode && r.rcode !== 'NOERROR' && r.rcode !== 'NXDOMAIN') flags.push(`${label} ${r.rcode}`);
  if (rd.registered === false && ns.ans?.length) flags.push('RDAP 404 但根域有 NS 记录，结果矛盾，需人工 whois 核对');
  else if (rd.registered === false) flags.push('未注册（注册局 RDAP 404，任何人可注册）');
  if (rd.noService) flags.push('顶级域无 RDAP，需人工 whois 核对');
  if (rd.status?.some((s) => /hold|pending ?delete|redemption/i.test(s))) flags.push(`注册状态异常（${rd.status.join(', ')}）`);
  if (a.rcode === 'NXDOMAIN' && ns.rcode === 'NXDOMAIN') flags.push('根域 NXDOMAIN');
  if (a.err || ns.err || sub.err || rd.err) flags.push('查询出错，需人工复核');
  return { e, reg, a, ns, sub, rd, flags };
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const started = new Date();
const res = await pool(list, 3, checkOne);
const pad = (x) => String(x).padStart(2, '0');
const day = sh(started).day;
const when = shText(started);
// 第 2 轮 P4：报告里的外部内容（DNS 应答、RDAP 状态、域名）全部转义 Markdown 特殊字符并去掉换行
const cell = (s) => String(s).replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()#+\-!|<>~]/g, (c) => '\\' + c);
const attention = res.filter((r) => r.flags.length);
const md = [
  `# 补充禁用名单每周复查（${day}${arg('domains') !== undefined || arg('category') !== undefined ? '，部分复查' : ''}）`,
  '',
  `> 运行时间：${when}｜名单版本 \`RISKY_HOSTING_VERSION = '${RISKY_HOSTING_VERSION}'\`｜共 ${res.length} 个域名，需关注 ${attention.length} 个`,
  '> 生成方式：`m0/card-validator/tools/recheck-tunnel-blocklist.mjs`（运维每周运行；DNS 走 DoH cloudflare-dns.com，注册状态走 IANA 引导的注册局 RDAP）。只读，不修改名单。',
  '> 处理：“需关注”的条目由安全测试和架构师判断是否调整名单（未注册的仿冒名一般**保留拦截**，见 qa/security/VAL-13复核-20261015.md 第 4 节）。',
  '',
  '## 需关注',
  '',
  attention.length ? attention.map((r) => `- ${cell(r.e.domain)}（${cell(r.e.category)}）：${cell(r.flags.join('；'))}`).join('\n') : '无。',
  '',
  '## 明细',
  '',
  '| 域名 | 类别 | 根域 A | 根域 NS | 随机子域 A | RDAP（查询域名） | 需关注 |',
  '|---|---|---|---|---|---|---|',
  ...res.map((r) => `| ${cell(r.e.domain)} | ${cell(r.e.category)} | ${cell(fmtDns(r.a))} | ${cell(fmtDns(r.ns))} | ${cell(fmtDns(r.sub))} | ${cell(r.rd.err ? `出错：${r.rd.err}` : r.rd.text)}（${cell(r.reg)}） | ${cell(r.flags.join('；') || '—')} |`),
  '',
].join('\n');

if (flag('stdout')) process.stdout.write(md);
else {
  // 第 3 轮 P3-3：带 --domains / --category 的部分复查不覆盖当天全量记录，写 <日期>-partial-<时分秒>.md
  const partial = arg('domains') !== undefined || arg('category') !== undefined;
  // 第 4 轮 P4-4：部分复查文件名带毫秒，并用 wx 独占创建（并发进程也不会互相覆盖），仍重名时加 -2、-3…；全量记录 <日期>.md 按天覆盖
  mkdirSync(OUT, { recursive: true });
  let f = join(OUT, `${day}.md`);
  if (partial) {
    const stem = join(OUT, `${day}-partial-${sh(started).hms}${String(started.getMilliseconds()).padStart(3, '0')}`);
    for (let k = 1; ; k++) {
      f = k === 1 ? `${stem}.md` : `${stem}-${k}.md`;
      try { writeFileSync(f, md, { flag: 'wx' }); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  } else writeFileSync(f, md);
  console.log(`已写入 ${f}（${res.length} 个域名，需关注 ${attention.length} 个）`); }
if (flag('strict') && attention.length) process.exit(1);
