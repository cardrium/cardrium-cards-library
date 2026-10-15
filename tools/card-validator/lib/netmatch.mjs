// 网址模式解析与静态匹配。运行时平台用同一套规则对“实际网址”做最终校验。
// 共享模块：纯 ESM、无 Node 依赖（只用 WHATWG URL），平台运行时原样导入本文件 + ./psl.mjs + ./data/*.mjs，
// 其中 hostRisk()、wildcardRisk()、parsePattern()、matchPattern() 是请求层必须调用的四个函数（INTERFACE-CONTRACT 第 1 节）。
const DEFAULT_PORT = { 'https:': '443', 'http:': '80' };
import { isPublicSuffix, publicSuffix, hasSuffixBelow, suffixesBelow, PSL_VERSION } from './psl.mjs';
import { RISKY_HOSTING, RISKY_HOSTING_VERSION } from './data/risky-hosting.mjs';
export { PSL_VERSION, RISKY_HOSTING_VERSION };

// ---------- 内网 / 本机地址拦截 ----------
// 卡片的网络权限和请求网址一律不允许指向本机、内网、链路本地地址（含云元数据 169.254.169.254）。
// 本地服务（如 Ollama）只能由用户在“模型渠道”里配置，不能出现在卡片里。
const PRIVATE_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)$/;
// 把任意子域解析到指定 IP 的公共“通配 DNS”服务（如 127.0.0.1.nip.io），静态看是域名，实际指向内网
const WILDCARD_DNS = /(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|vcap\.me|lacolhost\.com|traefik\.me|backname\.io)$/;

const v4ToInt = (ip) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
// 拦截清单（技术负责人第二轮拍板 F1，必须与 INTERFACE-CONTRACT 第 1 节一致）。
// 清单之外的 IP 字面量同样被拒绝，只是错误码为 E_NET_IP_LITERAL（卡片只能写域名）。
const V4_BLOCKS = [
  ['0.0.0.0', 8, '“本网络”地址（0.0.0.0/8）'], ['10.0.0.0', 8, '内网（10/8）'], ['100.64.0.0', 10, '运营商级 NAT（100.64/10）'],
  ['127.0.0.0', 8, '本机回环（127/8）'], ['169.254.0.0', 16, '链路本地（169.254/16，含云元数据 169.254.169.254）'], ['172.16.0.0', 12, '内网（172.16/12）'],
  ['192.168.0.0', 16, '内网（192.168/16）'],
].map(([b, len, label]) => [v4ToInt(b), len, label]);
function v4Block(ip) {
  const n = v4ToInt(ip);
  for (const [base, len, label] of V4_BLOCKS) { const size = 2 ** (32 - len); if (n >= base && n < base + size) return label; }
  return null;
}
function expandV6(h) {
  let s = h.replace(/^\[|\]$/g, '').toLowerCase();
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s); // 末尾内嵌 IPv4
  if (m) { const n = v4ToInt(m[1]); s = s.slice(0, -m[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16)); }
  const [head, tail] = s.split('::');
  const hp = head ? head.split(':') : [];
  const tp = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = tail !== undefined ? Array(8 - hp.length - tp.length).fill('0') : [];
  return [...hp, ...fill, ...tp].map((x) => parseInt(x || '0', 16));
}
const wordsToV4 = (a, b) => [a >> 8, a & 255, b >> 8, b & 255].join('.');

/** 检查主机名；返回 null 表示可以，否则 { code, reason } */
export function hostRisk(rawHost) {
  const host = String(rawHost).toLowerCase();
  if (host.endsWith('.')) return { code: 'E_NET_HOST_FORM', reason: '主机名不能以点结尾' };
  if (host.startsWith('[')) {
    const w = expandV6(host);
    const all0 = (a, b) => w.slice(a, b).every((x) => x === 0);
    let embedded = null;
    if (all0(0, 5) && w[5] === 0xffff) embedded = wordsToV4(w[6], w[7]);            // ::ffff:a.b.c.d（IPv4 映射）
    else if (w[0] === 0x64 && w[1] === 0xff9b && all0(2, 6)) embedded = wordsToV4(w[6], w[7]); // NAT64
    else if (w[0] === 0x2002) embedded = wordsToV4(w[1], w[2]);                          // 6to4
    else if (all0(0, 6) && (w[6] || w[7] > 1)) embedded = wordsToV4(w[6], w[7]);        // ::a.b.c.d（已废弃的兼容写法）
    if (embedded) { const b = v4Block(embedded); if (b) return { code: 'E_NET_PRIVATE_ADDRESS', reason: `IPv6 地址内嵌 ${embedded}（${b}）` }; }
    if (all0(0, 7) && w[7] === 1) return { code: 'E_NET_PRIVATE_ADDRESS', reason: 'IPv6 本机回环（::1）' };
    if ((w[0] & 0xfe00) === 0xfc00) return { code: 'E_NET_PRIVATE_ADDRESS', reason: 'IPv6 唯一本地地址（ULA，fc00::/7）' };
    if ((w[0] & 0xffc0) === 0xfe80) return { code: 'E_NET_PRIVATE_ADDRESS', reason: 'IPv6 链路本地地址（fe80::/10）' };
    return { code: 'E_NET_IP_LITERAL', reason: '不允许直接写 IP 地址，请使用域名' };
  }
  // WHATWG 规则：最后一段是数字（十进制 / 0x 十六进制 / 0 开头八进制）就按 IPv4 解析，2130706433、0x7f.1、0177.0.0.1 都等于 127.0.0.1
  const last = host.split('.').pop();
  if (/^(0x[0-9a-f]*|[0-9]+)$/.test(last)) {
    let canon;
    try { canon = new URL(`http://${host}/`).hostname; } catch { return { code: 'E_NET_BAD_URL', reason: '无法解析的数字主机名' }; }
    const trick = canon !== host ? `（${host} 实际等于 ${canon}）` : '';
    const b = /^\d+\.\d+\.\d+\.\d+$/.test(canon) ? v4Block(canon) : null;
    if (b) return { code: 'E_NET_PRIVATE_ADDRESS', reason: `${b}地址${trick}` };
    return { code: 'E_NET_IP_LITERAL', reason: `不允许直接写 IP 地址，请使用域名${trick}` };
  }
  if (PRIVATE_NAME.test(host)) return { code: 'E_NET_PRIVATE_ADDRESS', reason: `${host} 是本机 / 内网主机名` };
  if (WILDCARD_DNS.test(host)) return { code: 'E_NET_PRIVATE_ADDRESS', reason: `${host} 属于可把任意子域解析到内网 IP 的通配 DNS 服务` };
  return null;
}

// N-5（安全复测 2026-10-05）：只接受 https 模式，非 https 一律返回 null（不匹配任何网址），
// “只允许 https”不再只靠调用方先调 analyzeUrlTemplate()。
export function parsePattern(p) {
  if (typeof p !== 'string') return null;
  const m = /^(https?):\/\/(\*\.)?(\[[0-9a-fA-F:.]+\]|[^/:\[\]]+)(?::([0-9]{1,5}))?(\/.*)?$/.exec(p);
  if (!m || m[1] !== 'https') return null;
  const scheme = m[1] + ':';
  const port = m[4] || DEFAULT_PORT[scheme];
  if (Number(port) > 65535) return null;
  let path = m[5];
  let pathMode = 'any';
  let prefix = '';
  if (path !== undefined) {
    if (path.endsWith('*')) { pathMode = 'prefix'; prefix = path.slice(0, -1); }
    else { pathMode = 'exact'; prefix = path; }
  }
  return { raw: p, scheme, wildcard: !!m[2], host: m[3], port, pathMode, prefix };
}

/**
 * 解析请求网址模板的字面量部分。
 * 返回 { ok, reason, scheme, host, port, path, pathComplete }
 */
export function analyzeUrlTemplate(url, firstRef) {
  const literal = firstRef === -1 ? url : url.slice(0, firstRef);
  const m = /^(https?):\/\/([^/?#]*)(.*)$/s.exec(literal);
  if (!m) return { ok: false, code: 'E_NET_TEMPLATED_HOST', reason: 'scheme 与主机必须是字面量' };
  const hostport = m[2];
  const after = m[3];
  if (firstRef !== -1 && after === '') return { ok: false, code: 'E_NET_TEMPLATED_HOST', reason: '主机名中含有引用，无法静态核对权限' };
  if (hostport.includes('@')) return { ok: false, code: 'E_NET_USERINFO', reason: '网址中不允许 user@host 形式' };
  if (m[1] !== 'https') return { ok: false, code: 'E_NET_BAD_URL', reason: '只允许 https' };
  const rawHost = hostport.replace(/:\d+$/, '');
  const risk = hostRisk(rawHost);
  if (risk) return { ok: false, ...risk };
  let u;
  try { u = new URL(`${m[1]}://${hostport}/`); } catch { return { ok: false, code: 'E_NET_BAD_URL', reason: '网址无法解析' }; }
  const risk2 = hostRisk(u.hostname);
  if (risk2) return { ok: false, ...risk2 };
  const qIdx = after.search(/[?#]/);
  const pathPart = qIdx === -1 ? after : after.slice(0, qIdx);
  const pathComplete = firstRef === -1 || qIdx !== -1;
  if (/(^|\/)\.\.?(\/|$)/.test(pathPart) || /%2e|%2f|%5c|\\/i.test(pathPart)) return { ok: false, code: 'E_NET_PATH_TRAVERSAL', reason: '路径中含 .. / 编码斜杠 / 反斜杠' };
  return {
    ok: true,
    scheme: u.protocol,
    host: u.hostname,
    port: u.port || DEFAULT_PORT[u.protocol],
    path: pathPart === '' ? '/' : pathPart,
    pathComplete,
  };
}

export function matchPattern(info, pat) {
  if (!info || !pat || info.scheme !== 'https:' || pat.scheme !== 'https:') return false; // N-5：两侧都必须是 https
  if (info.scheme !== pat.scheme || info.port !== pat.port) return false;
  if (pat.wildcard) { if (!info.host.endsWith('.' + pat.host)) return false; }
  else if (info.host !== pat.host) return false;
  if (pat.pathMode === 'any') return true;
  if (pat.pathMode === 'prefix') return info.path.startsWith(pat.prefix);
  return info.pathComplete && info.path === pat.prefix;
}

// ---------- 补充禁用名单（安全测试 VAL-03 / VAL-13） ----------
// PSL 之外、任何人都能免费开子域的动态 DNS / 内网穿透 / 免费托管 / 请求收集服务，数据和出处在 ./data/risky-hosting.mjs。
// 只用于"不允许在其上通配"；具体主机（例如 abc.ngrok-free.app）仍按普通域名处理，但会给出 W_NET_TUNNEL_HOST 提示。
export const TUNNEL_HOSTING = RISKY_HOSTING.map((e) => e.domain);
const CATEGORY = { ddns: '动态 DNS ', tunnel: '内网穿透', hosting: '免费托管 / 对象存储', collector: '请求收集' };
export const riskyHostingEntry = (host) => RISKY_HOSTING.find((e) => host === e.domain || host.endsWith('.' + e.domain)) || null;
export const isTunnelHost = (host) => TUNNEL_HOSTING.some((d) => host === d || host.endsWith('.' + d));

// ---------- 通配符范围（技术负责人第三轮拍板 G1） ----------
// 卡片网络权限不允许通配所有域名。* 只能以 "*." 的形式写在主机最左侧，
// 规则原文（技术负责人拍板，RR-01 前提 3 补全版，P1-04 = VAL-12）：
//   “*.x 只有在 x 是可注册域名，并且公共后缀列表（含 PRIVATE 段）里没有任何以 .x 结尾的规则时才允许。”
//   *.github.com 可以；*.github.io、*.workers.dev、*.com.cn、*.com 不行（x 本身是公共后缀）；
//   *.amazonaws.com、*.core.windows.net 也不行（PSL 在它们下面有 s3.amazonaws.com、blob.core.windows.net 等，任何人都能在那里开桶）。
// 另外 x 不能落在补充禁用名单（./data/risky-hosting.mjs）里。
// 返回 null 表示可以，否则 { code: 'E_NET_PATTERN_TOO_BROAD', reason }
export function wildcardRisk(raw) {
  if (typeof raw !== 'string' || !raw.includes('*')) return null;
  const s = raw.trim();
  const m = /^([^:/]*):\/\/([^/]*)/.exec(s);
  const scheme = m ? m[1] : null;
  const hostport = m ? m[2] : s.split('/')[0];
  const TOO = (reason) => ({ code: 'E_NET_PATTERN_TOO_BROAD', reason });
  if (scheme && scheme.includes('*')) return TOO(`协议部分不能用 *（"${raw}"），只允许 https`);
  const host = hostport.replace(/:[0-9*]*$/, '').toLowerCase();
  if (!host.includes('*')) return null;
  if (/^\*\.?$/.test(host)) return TOO(`"${raw}" 通配了所有域名；卡片必须列出具体主机`);
  if (!host.startsWith('*.') || host.slice(2).includes('*')) return TOO(`主机 "${host}" 里的 * 只能以 "*." 的形式写在最左侧`);
  const rest = host.slice(2).replace(/\.$/, '');
  if (rest === '' || rest.split('.').some((l) => l === '')) return TOO(`主机 "${host}" 含空标签（如 "*..x"），不是合法的通配写法`);
  if (hostRisk(rest)) return null; // *.localhost、*.local 等交给内网规则报 E_NET_PRIVATE_ADDRESS
  const deny = riskyHostingEntry(rest);
  if (deny) return TOO(`"${rest}" 属于${CATEGORY[deny.category] || '免费'}服务（${deny.domain}，补充禁用名单 ${RISKY_HOSTING_VERSION}），任何人都能在下面开子域；不允许通配，请写具体主机`);
  if (isPublicSuffix(rest)) {
    const ps = publicSuffix(rest);
    const where = ps.section === 'PRIVATE' ? '公共后缀列表 PRIVATE 段（任何人都能在它下面开子域）' : ps.section === 'DEFAULT' ? '顶级域' : '公共后缀列表 ICANN 段';
    return TOO(`"${rest}" 是公共后缀（${where}），*.${rest} 会放行无数个不相关的网站；请写具体主机，或在可注册域名上通配（如 *.example.com）。PSL 快照 ${PSL_VERSION}`);
  }
  if (hasSuffixBelow(rest)) {
    const eg = suffixesBelow(rest);
    const egText = eg.length ? `（如 ${eg.join('、')}）` : '';
    return TOO(`公共后缀列表在 "${rest}" 下面还有公共后缀${egText}，任何人都能在那里开子域，*.${rest} 会把它们一起放行；请写具体主机。规则：*.x 只有在 x 是可注册域名、且 PSL（含 PRIVATE 段）没有以 .x 结尾的规则时才允许。PSL 快照 ${PSL_VERSION}`);
  }
  return null;
}
