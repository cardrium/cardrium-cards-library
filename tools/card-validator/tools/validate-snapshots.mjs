#!/usr/bin/env node
// 演示快照校验（INTERFACE-CONTRACT §5，tools/capture-snapshots.mjs 的配套检查；npm test 会跑）
//   node tools/validate-snapshots.mjs [--site-origin=https://主站,https://沙箱站]
// 检查每一份 demo-snapshots/<基础 id>.<zh-CN|en>.json：
//   1. 示范卡片和快照一一对应：每张 card-examples/<id>.json（及 -en）都有快照，没有孤立快照；
//   2. 头部字段：snapshotVersion=1、meta.id / meta.version 与卡片一致、locale 与卡片 meta.locale 一致、capturedAt 是 UTC ISO 时间、dataKind、notes；
//   3. inputs 只含卡片定义过的参数，类型、select 选项、min/max 合法；
//   4. 输出形状：display.component 与卡片一致；bind 的字段都来自卡片 output 步骤的 bind（外加平台允许的 status/link），
//      组件必填字段存在，条目结构符合 card-schema-v1.md 第 8 节的组件契约（list 条目 title 必填、url 只许 https 等）；
//   5. 不含站点域名：不出现产品名，不出现本站（主站 / 沙箱站）地址，不出现托管平台域名（pages.dev、workers.dev）；
//      站点地址只来自运行时 __APP_ENV__（tech-stack 3.2）；
//   6. 英文快照任何位置都没有中日韩字符（设计评审 9.2）；
//   7. 不含疑似凭据。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { siteOriginIssues } from '../lib/siteorigin.mjs';

const EX = fileURLToPath(new URL('../../card-examples/', import.meta.url));
const SNAP = fileURLToPath(new URL('../../demo-snapshots/', import.meta.url));
const so = process.argv.find((a) => a.startsWith('--site-origin='));
const SITE_ORIGINS = so ? so.slice(14).split(',').filter(Boolean) : ['https://app.site-under-test.example', 'https://sandbox.site-under-test.example'];
export const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const PRODUCT_RE = /cardrium|peekaboard|卡馆/i;
const HOSTING_RE = /\/\/[^\s/"']*\.(?:pages\.dev|workers\.dev)\b/i;
const SECRET_RE = /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|Bearer\s+[A-Za-z0-9._~+/-]{20,}/;
const DATA_KINDS = new Set(['captured', 'mixed', 'sample']);
const REQUIRED = { number: ['value'], list: ['items'], text: ['content'], chart: ['series'], todo: [] };
const COMMON_BIND = new Set(['status', 'link']);
const LIST_ITEM_FIELDS = new Set(['title', 'url', 'subtitle', 'meta', 'badge', 'source', '_unverified']);
const NOTICE_CODES = new Set(['PROXY_REQUIRED']);

const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const isLink = (u) => { try { return ['https:', 'mailto:'].includes(new URL(u).protocol); } catch { return false; } };

export function checkSnapshot(snap, card, file) {
  const p = [];
  const base = card.meta.id.replace(/-en$/, '');
  const loc = card.meta.locale === 'en' ? 'en' : 'zh-CN';
  if (file !== `${base}.${loc}.json`) p.push(`文件名应为 ${base}.${loc}.json`);
  if (snap.snapshotVersion !== 1) p.push('snapshotVersion 应为 1');
  if (snap.meta?.id !== card.meta.id) p.push(`meta.id ${snap.meta?.id} ≠ 卡片 ${card.meta.id}`);
  if (snap.meta?.version !== card.meta.version) p.push(`meta.version ${snap.meta?.version} ≠ 卡片 ${card.meta.version}（卡片升版后要重新采集）`);
  if (snap.locale !== loc) p.push(`locale 应为 ${loc}`);
  if (typeof snap.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(snap.capturedAt) || Number.isNaN(Date.parse(snap.capturedAt))) p.push('capturedAt 应为 UTC ISO 时间（以 Z 结尾）');
  if (!DATA_KINDS.has(snap.dataKind)) p.push(`dataKind 只能是 ${[...DATA_KINDS].join('/')}`);
  if (typeof snap.notes !== 'string' || !snap.notes.trim()) p.push('notes 必填：说明数据来源和哪些是手写的');
  const known = new Set(['snapshotVersion', 'meta', 'locale', 'inputs', 'capturedAt', 'dataKind', 'notes', 'display', 'notices']);
  for (const k of Object.keys(snap)) if (!known.has(k)) p.push(`未知字段 ${k}`);
  // 参数
  const defs = new Map(card.inputs.map((i) => [i.key, i]));
  for (const [k, v] of Object.entries(snap.inputs || {})) {
    const d = defs.get(k);
    if (!d) { p.push(`inputs.${k} 不是卡片定义的参数`); continue; }
    if (d.type === 'select' && !d.options.some((o) => o.value === v)) p.push(`inputs.${k}="${v}" 不在可选项里`);
    if (d.type === 'number' && (typeof v !== 'number' || (d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max))) p.push(`inputs.${k} 应为 ${d.min ?? ''}–${d.max ?? ''} 的数字`);
    if (d.type === 'boolean' && typeof v !== 'boolean') p.push(`inputs.${k} 应为布尔值`);
    if (d.type === 'url-list' && (!Array.isArray(v) || !v.every(isHttps))) p.push(`inputs.${k} 应为 https 网址数组`);
    if ((d.type === 'string' || d.type === 'text') && typeof v !== 'string') p.push(`inputs.${k} 应为字符串`);
  }
  for (const d of card.inputs) if (d.required && !(d.key in (snap.inputs || {}))) p.push(`缺少必填参数 inputs.${d.key}`);
  // 输出形状
  const comp = card.display.component;
  if (snap.display?.component !== comp) p.push(`display.component ${snap.display?.component} ≠ 卡片 ${comp}`);
  const bind = snap.display?.bind;
  if (!bind || typeof bind !== 'object' || Array.isArray(bind)) p.push('display.bind 必须是对象');
  else {
    const out = card.workflow.steps.find((s) => s.type === 'output');
    const allowed = new Set([...Object.keys(out?.bind || {}), ...COMMON_BIND]);
    for (const k of Object.keys(bind)) if (!allowed.has(k)) p.push(`bind.${k} 不在卡片 output 步骤的绑定里（卡片输出：${[...allowed].join(', ')}）`);
    for (const k of REQUIRED[comp] || []) if (bind[k] === undefined) p.push(`${comp} 组件缺少必填字段 bind.${k}`);
    if (bind.status !== undefined && !['normal', 'warn', 'alert'].includes(bind.status)) p.push(`bind.status 只能是 normal/warn/alert，实际 ${bind.status}`);
    if (bind.link !== undefined && bind.link !== null && !isLink(bind.link)) p.push('bind.link 只允许 https / mailto');
    if (comp === 'number' && !(typeof bind.value === 'number' || bind.value === null)) p.push('number.value 应为数字或 null');
    if (comp === 'number' && bind.delta !== undefined && bind.delta !== null && typeof bind.delta !== 'number') p.push('number.delta 应为数字或 null');
    if (comp === 'list') {
      if (!Array.isArray(bind.items)) p.push('list.items 应为数组');
      else bind.items.forEach((it, i) => {
        if (!it || typeof it !== 'object') return p.push(`items[${i}] 不是对象`);
        if (typeof it.title !== 'string' || !it.title) p.push(`items[${i}].title 必填`);
        if (it.url !== undefined && !isHttps(it.url)) p.push(`items[${i}].url 只允许 https：${it.url}`);
        for (const k of Object.keys(it)) if (!LIST_ITEM_FIELDS.has(k)) p.push(`items[${i}].${k} 不是 list 条目字段`);
      });
      if (bind.errors !== undefined && !Array.isArray(bind.errors)) p.push('list.errors 应为数组');
    }
    if (comp === 'text' && typeof bind.content !== 'string') p.push('text.content 应为字符串');
    if (comp === 'text' && /!\[[^\]]*\]\(/.test(bind.content || '')) p.push('text.content 不允许 markdown 图片');
    if (comp === 'text' && Array.isArray(bind.citations)) bind.citations.forEach((c, i) => { if (!isHttps(c?.url)) p.push(`citations[${i}].url 只允许 https`); });
    if (comp === 'chart') {
      if (!Array.isArray(bind.series)) p.push('chart.series 应为数组');
      else bind.series.forEach((s, i) => { if (typeof s?.name !== 'string' || !Array.isArray(s.data) || !s.data.every((d) => d && 'x' in d && (typeof d.y === 'number' || d.y === null))) p.push(`series[${i}] 应为 { name, data: [{ x, y }] }`); });
    }
    if (comp === 'todo' && bind.items !== undefined) {
      if (!Array.isArray(bind.items)) p.push('todo.items 应为数组');
      else bind.items.forEach((t, i) => { if (typeof t?.id !== 'string' || typeof t.text !== 'string' || typeof t.done !== 'boolean') p.push(`todo items[${i}] 应为 { id, text, done }`); });
    }
  }
  for (const [i, n] of (snap.notices || []).entries()) if (!NOTICE_CODES.has(n?.code) || typeof n.host !== 'string') p.push(`notices[${i}] 应为 { code: PROXY_REQUIRED, host }`);
  // 站点域名、产品名、凭据、语言
  const raw = JSON.stringify(snap);
  const prod = PRODUCT_RE.exec(raw); if (prod) p.push(`出现产品名 / 站点域名 "${prod[0]}"（站点地址只能来自运行时 __APP_ENV__）`);
  const host = HOSTING_RE.exec(raw); if (host) p.push(`出现托管平台地址 "${host[0]}"（快照里只能有公开来源的链接）`);
  for (const s of siteOriginIssues(snap, SITE_ORIGINS)) p.push(`${s.path} 含本站地址 ${s.host}`);
  const sec = SECRET_RE.exec(raw); if (sec) p.push(`疑似凭据 "${sec[0].slice(0, 12)}…"`);
  if (loc === 'en') { const c = CJK_RE.exec(raw); if (c) p.push(`英文快照里有中日韩字符 "${c[0]}"`); }
  return p;
}

function main() {
  const cards = readdirSync(EX).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(EX + f, 'utf8')));
  const byFile = new Map(cards.map((c) => [`${c.meta.id.replace(/-en$/, '')}.${c.meta.locale === 'en' ? 'en' : 'zh-CN'}.json`, c]));
  const snaps = readdirSync(SNAP).filter((f) => f.endsWith('.json')).sort();
  let bad = 0;
  console.log('== 演示快照（输出形状、站点域名、英文无中文） ==');
  // 自检：检查器本身能抓到问题
  const probeCard = byFile.get('hot-topics.en.json');
  if (probeCard) {
    const probe = { snapshotVersion: 1, meta: { id: probeCard.meta.id, version: probeCard.meta.version }, locale: 'en', inputs: {}, capturedAt: '2026-10-05T00:00:00Z', dataKind: 'captured', notes: 'x',
      display: { component: 'list', bind: { items: [{ title: '中文', url: 'http://x.example' }, { title: 'y', url: 'https://app.site-under-test.example/#/share/1' }], extra: 1 } } };
    const pr = checkSnapshot(probe, probeCard, 'hot-topics.en.json').join('\n');
    for (const must of ['中日韩', '只允许 https', '本站地址', 'bind.extra']) if (!pr.includes(must)) { bad++; console.log(`失败  检查器自检：没有抓到“${must}”`); }
  }
  for (const f of snaps) {
    const card = byFile.get(f);
    if (!card) { bad++; console.log(`失败  ${f}：没有对应的示范卡片（孤立快照）`); continue; }
    let snap; try { snap = JSON.parse(readFileSync(SNAP + f, 'utf8')); } catch (e) { bad++; console.log(`失败  ${f}：JSON 解析失败 ${e.message}`); continue; }
    const p = checkSnapshot(snap, card, f);
    if (p.length) bad++;
    console.log(`${p.length ? '失败' : '通过'}  ${f}（${snap.dataKind}，${snap.capturedAt}）`);
    p.forEach((x) => console.log(`    ${x}`));
  }
  for (const f of byFile.keys()) if (!snaps.includes(f)) { bad++; console.log(`失败  缺少快照 demo-snapshots/${f}（node tools/capture-snapshots.mjs --only=${f.split('.')[0]}）`); }
  console.log(`\n结果：快照 ${snaps.length} 份，${bad ? `${bad} 项不符合` : '全部通过'}`);
  process.exit(bad ? 1 : 0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
