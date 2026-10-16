// 文本、链接和疑似凭据参数的静态检查（安全测试 VAL-04/05/06/07/09）。
// 主防线在渲染层（一律按纯文本渲染、href 协议白名单、markdown 不渲染图片和 HTML）和请求层；这里是纵深防御。

const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')', nbsp: ' ' };
/** 解 HTML 实体（含不带分号的数字实体）和百分号编码，最多三轮，得到浏览器最终可能看到的字符 */
export function decodeAll(s) {
  let cur = String(s);
  for (let i = 0; i < 3; i++) {
    let next = cur
      .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) % 0x110000))
      .replace(/&#([0-9]+);?/g, (_, d) => String.fromCodePoint(Number(d) % 0x110000))
      .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
    try { next = decodeURIComponent(next); } catch { /* 非法百分号编码保持原样 */ }
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

// 展示类文本：任何形式的标签、事件属性、HTML 实体、编码后的尖括号、脚本协议都不允许
// VAL-16：只拒绝“像标签”的尖括号——按 HTML 分词规则，< 后面紧跟字母、!、/、? 才会开始一个标签 / 注释；
// “温度 < 0”“a < b”“x > 3”这类普通符号允许（渲染层本来就按纯文本输出）
const MARKUP = [
  [/<[a-z!/?]/i, 'HTML 标签'],
  [/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i, 'HTML 实体'],
  [/%3[ce]/i, '编码后的尖括号'],
  [/\bon[a-z]{3,}\s*=/i, '事件属性（on…=）'],
  [/(?:java|vb)script\s*:|data\s*:\s*text\/html/i, '脚本协议'],
];
export function markupIssue(text) {
  for (const [re, label] of MARKUP) if (re.test(text)) return label;
  const d = decodeAll(text);
  if (d !== text) for (const [re, label] of MARKUP.slice(0, 1).concat(MARKUP.slice(3))) if (re.test(d)) return `${label}（解码后）`;
  return null;
}
// 输出绑定里的字面量文字：允许普通的 "<"（例如 "温度 < 0"），但不允许像标签、事件属性、实体这样的结构
const BIND_MARKUP = [
  [/<\s*[a-z!/?]/i, 'HTML 标签'],
  [/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i, 'HTML 实体'],
  [/\bon[a-z]{3,}\s*=/i, '事件属性（on…=）'],
];
export function bindMarkupIssue(text) {
  const t = String(text).replace(/<[a-z][a-z0-9+.-]*:[^>\s]*>/gi, ''); // markdown 自动链接 <https://…> / <mailto:…> 由链接规则单独检查
  for (const [re, label] of BIND_MARKUP) if (re.test(t)) return label;
  return null;
}

/** 链接协议：只允许 https:，以及 mailto:（allowMailto）。先解码实体、去掉控制字符和空白（浏览器解析协议时会忽略它们） */
export function linkIssue(url, { allowMailto = true } = {}) {
  const d = decodeAll(url).replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '').toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(d);
  if (!m) return '链接必须是完整的 https:// 地址';
  if (m[1] === 'https') return null;
  if (m[1] === 'mailto' && allowMailto) return null;
  return `不允许 ${m[1]}: 链接，只允许 https:${allowMailto ? ' 和 mailto:' : ''}`;
}
/** 开头是危险协议的字面量（出现在任何绑定字段里都拒绝） */
export function dangerousSchemePrefix(text) {
  const d = decodeAll(text).replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\ufeff]/g, '').toLowerCase();
  const m = /^(javascript|vbscript|data|file|blob|filesystem):/.exec(d);
  return m ? m[1] : null;
}
/** 在 markdown 字面量里找链接目标和图片 */
export function markdownTargets(md) {
  const links = [];
  let images = 0;
  const s = String(md);
  for (const m of s.matchAll(/(!?)\[[^\]]*\]\(\s*<?([^)\s>]*)/g)) { if (m[1]) images++; else links.push(m[2]); }
  for (const m of s.matchAll(/<([a-z][a-z0-9+.-]*:[^>\s]*)>/gi)) links.push(m[1]);
  for (const m of s.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(\s|$)/gm)) links.push(m[1]);
  return { links, images };
}

// ---------- 疑似凭据参数名（VAL-07） ----------
// 先归一化再按词根判断（回归发现精确清单漏掉 api_token、access_key、secret_key、apiToken 等）：
// 百分号解码 → 拆驼峰（apiToken → api Token，APIKey → API Key）→ 小写 → 按非字母数字切词。
// 命中条件：任一词是词根本身，或是“前缀 + 词根”的连写（accesstoken、clientsecret、xapikey）。
// key 只按整词或已知连写判断，避免 keyword、monkey、hockey 这类误伤；auth 同理（author 不算）。
export function splitWords(name) {
  let s = String(name);
  try { s = decodeURIComponent(s); } catch { /* 保持原样 */ }
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
const ROOT_WORDS = new Set(['token', 'tokens', 'secret', 'secrets', 'password', 'passwd', 'pwd', 'pass', 'passphrase', 'sig', 'signature', 'auth', 'authorization', 'credential', 'credentials', 'cred', 'creds', 'session', 'sessionid', 'sid', 'jwt', 'bearer', 'key', 'apikey', 'appkey', 'appsecret', 'accesskey', 'secretkey', 'privatekey', 'authkey', 'clientkey', 'masterkey', 'subscriptionkey', 'otp', 'totp']);
const ROOT_SUFFIX = /(token|tokens|secret|password|passwd|signature|credentials?|sessionid)$/;
export function isSecretParamName(name) {
  return splitWords(name).some((w) => ROOT_WORDS.has(w) || ROOT_SUFFIX.test(w) || /^session(id|key|token)?$/.test(w));
}
/** 兼容旧调用：SECRET_PARAM_NAMES.test(name) */
export const SECRET_PARAM_NAMES = { test: (name) => isSecretParamName(name) };
/** 去掉 {{引用}} 后是否还有字面量内容 */
export const hasLiteral = (v) => String(v).replace(/\{\{[^}]*\}\}/g, '').trim().length > 0;
/** 从网址（或网址的字面量前缀）里取查询参数 [name, value] */
export function queryParams(url) {
  const s = String(url);
  const q = s.indexOf('?');
  if (q === -1) return [];
  return s.slice(q + 1).split('#')[0].split(/[&;]/).filter(Boolean).map((kv) => {
    const i = kv.indexOf('=');
    const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } };
    return i === -1 ? [dec(kv), ''] : [dec(kv.slice(0, i)), dec(kv.slice(i + 1))];
  });
}

/** VAL-17：网址片段（# 后面）里的参数，例如 #access_token=…、#/cb?token=…。片段不随请求发出，但它仍是写在模板里、所有导入者共享的字面量 */
export function fragmentParams(url) {
  const s = String(url);
  const h = s.indexOf('#');
  if (h === -1) return [];
  let frag = s.slice(h + 1);
  const q = frag.indexOf('?');
  if (q !== -1) frag = frag.slice(q + 1);
  return queryParams('?' + frag);
}

// ---------- 诱导用户填写 Key 的参数（VAL-09） ----------
// VAL-14：补“凭证 / 凭据 / 授权码 / AppSecret”等；英文先拆驼峰（AppSecret → App Secret）再匹配
const SECRET_INPUT_RE = /\b(?:api[\s_-]?key|apikey|access[\s_-]?(?:token|key)|secret[\s_-]?key|app[\s_-]?secret|appsecret|app[\s_-]?key|client[\s_-]?secret|token|secret|password|passwd|credentials?|bearer|sk-)\b|密钥|秘钥|口令|令牌|密码|私钥|凭证|凭据|授权码|访问码|\bkey\b/i;
export const SECRET_INPUT_WORDS = { test: (text) => SECRET_INPUT_RE.test(String(text)) || SECRET_INPUT_RE.test(String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2')) };
