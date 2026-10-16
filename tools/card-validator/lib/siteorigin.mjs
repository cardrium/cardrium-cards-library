// 站点地址可替换（技术负责人约束，tech-stack 3.2）：卡片和模板里不得出现本站（主站 / 沙箱站）的绝对地址。
// 站点地址只来自运行时 __APP_ENV__，分享链接一律相对或在运行时由当前 origin 拼出，从不以绝对地址存进卡片。
// 本站地址没有写死在校验器里：调用方把当前主站、沙箱站 origin 传进来（前端传 location.origin 和 __APP_ENV__.sandboxOrigin）。
const URL_RE = /(?:\b(?:https?|wss?):)?\/\/([^\s/"'<>?#\\]+)/gi;

export function siteHosts(origins = []) {
  const out = new Set();
  for (const o of origins) {
    if (!o) continue;
    try { out.add(new URL(o).hostname.toLowerCase().replace(/\.$/, '')); } catch { /* 非法 origin 由调用方的 env 校验负责 */ }
  }
  return out;
}

function hostOf(authority) {
  let h = authority.replace(/^.*@/, '');               // 去掉 userinfo
  h = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.replace(/:\d*$/, '');
  return h.toLowerCase().replace(/\.$/, '');
}

// 遍历卡片里所有字符串值，找指向本站主机（或其子域）的绝对 / 协议相对地址
export function siteOriginIssues(card, origins) {
  const hosts = siteHosts(origins);
  if (!hosts.size) return [];
  const issues = [];
  const walk = (v, ptr) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(URL_RE)) {
        const h = hostOf(m[1]);
        for (const s of hosts) if (h === s || h.endsWith('.' + s)) { issues.push({ path: ptr, host: h, site: s }); break; }
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${ptr}/${i}`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${ptr}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
  };
  walk(card, '');
  return issues;
}
