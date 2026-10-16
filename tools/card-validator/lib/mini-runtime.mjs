// 参考用的最小运行时：只为 dry-run 验证示范卡片的引用、表达式和绑定是否真的能算出结果。
// 网络、模型、平台用量都用夹具（fixture）替代；代码步骤在 Node 里直接执行（仅测试用途，产品中必须在沙箱内执行）。
import jsonata from 'jsonata';
import { compileSafe } from './expr.mjs';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { wholeRef, parsePath } from './refs.mjs';
import { parsePattern, analyzeUrlTemplate, matchPattern } from './netmatch.mjs';

// 该网址是否需要代理：卡片网络条目 requires:"proxy"，或平台内置“已知需代理域名”清单（夹具 knownProxyHosts 模拟）
const SIMPLE_CT = new Set(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']);
function needsProxy(url, card, fixtures) {
  const info = analyzeUrlTemplate(url, -1);
  if (!info.ok) return false;
  if ((fixtures.knownProxyHosts || []).includes(info.host)) return true;
  return card.permissions.network.some((e) => typeof e === 'object' && e.requires === 'proxy' && matchPattern(info, parsePattern(e.pattern)));
}

const SEG_RE = /\.([A-Za-z_$][A-Za-z0-9_$-]*)|\[([0-9]+)\]/g;
function getPath(ctx, p) {
  let v = p.root === 'step' ? ctx[p.name] : ctx[p.root]?.[p.name];
  for (const m of p.rest.matchAll(SEG_RE)) { if (v == null) return undefined; v = m[1] !== undefined ? v[m[1]] : v[Number(m[2])]; }
  return v;
}
export function renderTemplate(str, ctx) {
  const w = wholeRef(str);
  if (w) return getPath(ctx, w);
  return str.replace(/(\\?)\{\{\s*([^{}]+?)\s*\}\}/g, (all, bs, inner) => {
    if (bs) return all.slice(1);
    const v = getPath(ctx, parsePath(inner));
    return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}
export function renderDeep(v, ctx) {
  if (typeof v === 'string') return renderTemplate(v, ctx);
  if (Array.isArray(v)) return v.map((x) => renderDeep(x, ctx));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, renderDeep(x, ctx)]));
  return v;
}
// 与平台运行时一致：先按函数允许清单检查，再把 $eval 覆盖成抛错（VAL-11）
const evalExpr = async (src, ctx) => { const r = await compileSafe(src).evaluate(ctx); return r === undefined ? null : JSON.parse(JSON.stringify(r)); };
const truthy = (v) => !(v === false || v == null || v === '' || v === 0 || v === 'false' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0));
const bindValue = async (v, ctx) => (v && typeof v === 'object' && typeof v.expr === 'string' ? evalExpr(v.expr, ctx) : typeof v === 'string' ? renderTemplate(v, ctx) : v);

export async function runCard(card, { inputs = {}, run = {}, store, fixtures, log = () => {} }) {
  const ctx = { inputs: {}, run: { locale: 'zh-CN', timezone: 'Asia/Shanghai', time: '08:00', modelConfigured: true, proxyConfigured: !!fixtures.proxyConfigured, ...run } };
  for (const i of card.inputs) ctx.inputs[i.key] = inputs[i.key] ?? i.default ?? null;
  ctx.run.startedAt ??= ctx.run.now;
  const stats = { modelCalls: 0, skipped: [], errors: [], notices: [] };
  const cache = fixtures.cache || (fixtures.cache = {});
  let status = 'normal';
  for (const s of card.workflow.steps) {
    if (s.type === 'output') {
      const bind = {};
      for (const [k, v] of Object.entries(s.bind)) bind[k] = await bindValue(v, ctx);
      return { bind, ctx, stats, status, notices: stats.notices };
    }
    if (s.disabled || (s.enabledIf !== undefined && !truthy(await bindValue(s.enabledIf, ctx)))) { ctx[s.id] = null; stats.skipped.push(s.id); continue; }
    try {
      ctx[s.id] = await execStep(s, ctx, { store, fixtures, stats, cache, card });
    } catch (e) {
      if (s.onError === 'continue') { ctx[s.id] = null; stats.errors.push(`${s.id}: ${e.message}`); log(`  ${s.id} 失败（continue）：${e.message}`); }
      else throw new Error(`步骤 ${s.id} 失败：${e.message}`);
    }
    if (s.type === 'condition' && ctx[s.id]) {
      if (s.then.action === 'status') status = s.then.status;
      if (s.then.action === 'stop') return { stopped: s.then.message, ctx, stats, notices: stats.notices };
    }
  }
  throw new Error('没有 output 步骤');
}

async function execStep(s, ctx, { store, fixtures, stats, cache, card }) {
  const proxyMissing = (url) => !fixtures.proxyConfigured && needsProxy(url, card, fixtures);
  const notice = (url) => { const host = new URL(url).host; if (!stats.notices.some((n) => n.host === host)) stats.notices.push({ code: 'PROXY_REQUIRED', host, action: 'open-proxy-settings' }); };
  switch (s.type) {
    case 'http': {
      const url = renderTemplate(s.url, ctx);
      // schema v1.1 增量约束（与校验器、INTERFACE-CONTRACT 2.2 第 3a 步同一条规则）：线上的写请求永远带 Content-Type。
      // 卡片没写时平台补 application/json（字符串 body 原样发送，对象和数组按 JSON 序列化），照常直连、触发预检。
      // 声明了简单类型（text/plain、form-urlencoded、multipart）的请求绝不直连：配置了代理就经代理，没有代理返回 PROXY_REQUIRED、按 onProxyMissing 处理。
      const method = (s.method ?? 'GET').toUpperCase();
      const ctKey = Object.keys(s.headers || {}).find((h) => /^content-type$/i.test(h));
      const write = method !== 'GET' && method !== 'HEAD';
      const declared = ctKey ? renderTemplate(s.headers[ctKey], ctx) : null;
      const contentType = write ? (declared ?? 'application/json') : null;
      const proxyOnlyBody = write && declared !== null && SIMPLE_CT.has(String(declared).split(';')[0].trim().toLowerCase());
      const viaProxy = proxyOnlyBody || needsProxy(url, card, fixtures);
      (stats.requests ||= []).push({ step: s.id, method, url, contentType, transport: viaProxy ? 'proxy' : 'direct' });
      if (proxyOnlyBody && !fixtures.proxyConfigured) {
        notice(url);
        if (s.onProxyMissing === 'fail') throw new Error('PROXY_REQUIRED');
        return null;
      }
      if (proxyMissing(url)) {
        notice(url);
        if (s.onProxyMissing === 'fail') throw new Error('PROXY_REQUIRED');
        return null;
      }
      let f = fixtures.http?.find((h) => url.startsWith(h.match));
      if (!f && fixtures.live) f = { body: await fixtures.live(url, s) }; // 采集演示快照时用真实请求（tools/capture-snapshots.mjs）
      if (!f) throw new Error(`没有夹具：${url}`);
      if (f.error) throw new Error(f.error);
      const body = typeof f.body === 'function' ? f.body(url) : f.body; // 夹具可以是函数：用于断言实际请求的网址
      const out = { status: 200, headers: {}, body };
      if (body && typeof body === 'object' && !Array.isArray(body)) for (const [k, v] of Object.entries(body)) if (!(k in out)) out[k] = v;
      return out;
    }
    case 'rss': {
      const urls = typeof s.urls === 'string' ? renderTemplate(s.urls, ctx) : s.urls.map((u) => renderTemplate(u, ctx));
      const items = []; const errors = [];
      for (const u of urls) {
        if (proxyMissing(u)) { notice(u); errors.push({ feedUrl: u, code: 'PROXY_REQUIRED', message: String(ctx.run?.locale || '').startsWith('en') ? 'This source needs a proxy' : '此来源需要代理' }); continue; }   // 平台文案按界面语言
        let f = fixtures.rss?.[u];
        if (!f && fixtures.liveRss) { try { f = await fixtures.liveRss(u); } catch { f = undefined; } }
        if (!f) errors.push({ feedUrl: u, code: 'NETWORK_ERROR', message: '网络错误或跨域被拦（夹具）' }); else items.push(...f.map((x) => ({ ...x, feedUrl: u })));
      }
      if (s.onProxyMissing === 'fail' && errors.some((e) => e.code === 'PROXY_REQUIRED')) throw new Error('PROXY_REQUIRED');
      items.sort((a, b) => String(b.published).localeCompare(String(a.published)));
      return { items: items.slice(0, s.maxItems ?? 20), errors };
    }
    case 'ai': case 'ai_search': {
      const prompt = renderTemplate(s.prompt, ctx);
      const ck = s.cacheKey ? `${s.id}|${renderTemplate(s.cacheKey, ctx)}` : null;
      if (ck && cache[ck]) return cache[ck];
      const lim = card.limits?.modelCallsPerRun ?? 0;   // 省略按 0
      if (!card.permissions.model || lim === 0) throw new Error('PERMISSION_DENIED');
      if (stats.modelCalls >= lim) throw new Error('QUOTA_EXCEEDED');
      stats.modelCalls++;
      const f = fixtures.ai?.[s.id];
      if (f === undefined) throw new Error(`没有模型夹具：${s.id}`);
      const r = typeof f === 'function' ? f(prompt, ctx) : f;
      const out = s.outputFormat === 'json' ? { ...r, _raw: JSON.stringify(r), _usage: {} } : { text: r, _usage: {} };
      if (ck) cache[ck] = out;
      return out;
    }
    case 'transform': return evalExpr(s.expr, ctx);
    case 'condition': return truthy(await evalExpr(s.if, ctx));
    case 'storage': {
      if (s.scope === 'platform.usage') return fixtures.usage;
      if (s.op === 'get') return s.key in store ? structuredClone(store[s.key]) : renderDeep(s.default ?? null, ctx);
      if (s.op === 'set') { store[s.key] = renderDeep(s.value, ctx); return store[s.key]; }
      if (s.op === 'delete') { delete store[s.key]; return null; }
      const v = renderDeep(s.value, ctx);
      let arr = Array.isArray(store[s.key]) ? store[s.key] : [];
      if (s.uniqueBy) arr = arr.filter((x) => x?.[s.uniqueBy] !== v?.[s.uniqueBy]);
      arr.push(v);
      if (s.maxLength) arr = arr.slice(-s.maxLength);
      store[s.key] = arr;
      return arr;
    }
    case 'code': {
      const dir = mkdtempSync(join(tmpdir(), 'card-code-'));
      const f = join(dir, 'step.mjs');
      writeFileSync(f, s.source);
      let mod;
      try { mod = await import(pathToFileURL(f).href); } finally { rmSync(dir, { recursive: true, force: true }); }
      const platform = { storage: { get: async (k) => store[k] ?? null, set: async (k, v) => { store[k] = v; } }, fetch: async () => { throw new Error('NOT_DECLARED'); }, net: { fetch: async () => { throw new Error('NOT_DECLARED'); } }, model: { call: async () => { throw new Error('PERMISSION_DENIED'); } } };
      return JSON.parse(JSON.stringify(await mod.default(structuredClone(ctx), platform)));
    }
    default: throw new Error(`未知步骤类型 ${s.type}`);
  }
}
