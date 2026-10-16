#!/usr/bin/env node
// 生成演示快照（INTERFACE-CONTRACT §5）：用参考运行时真实执行示范卡片，网络数据取自采集缓存（真实公开来源），
// AI 步骤的输出没有真实模型可调用，用下面手写的夹具（因此这类快照标 dataKind = "mixed"）。
// 用法：
//   1. 采集原始数据到缓存目录（默认 /tmp/snapcache，见文件末尾 CAPTURE 注释里的 curl 列表）
//   2. node tools/capture-snapshots.mjs [--cache=/tmp/snapcache] [--print-prompts]
//   3. node tools/validate-snapshots.mjs（npm test 也会跑）
//   只重采一部分：--only=<基础 id> 和/或 --locale=zh-CN|en
// 产物：m0/demo-snapshots/<基础 id>.<zh-CN|en>.json。快照里只有卡片输出和公开来源的链接，不含本站域名、Key、代理地址。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCard } from '../lib/mini-runtime.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const CACHE = arg('cache', '/tmp/snapcache');
// 2026-10-05 补采（github-repo 两份、U11 改版后的中文 hot-topics）的缓存目录，见文件末尾 CAPTURE-1005
const CACHE2 = arg('cache2', '/tmp/snapcache-1005');
const LOCALE = arg('locale', '');
const PRINT = process.argv.includes('--print-prompts');
const OUT = new URL('../../demo-snapshots/', import.meta.url);
const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../card-examples/${id}.json`, import.meta.url)), 'utf8'));
const cache = (f) => readFileSync(`${CACHE}/${f}`, 'utf8');
const json = (f) => JSON.parse(cache(f));
const json2 = (f) => JSON.parse(readFileSync(`${CACHE2}/${f}`, 'utf8'));

// 采集时刻（缓存文件的抓取时间，UTC+8 2026-09-27 23:47；GitHub 数据见 GH_AT）
const CAPTURED_AT = '2026-09-27T15:47:00Z';
const GH_AT = process.env.GH_AT || CAPTURED_AT;
const runZh = { today: '2026-09-27', yesterday: '2026-09-26', now: '2026-09-27T23:47:00+08:00', time: '23:47', weekday: '周日', locale: 'zh-CN', timezone: 'Asia/Shanghai' };
const runEn = { today: '2026-09-27', yesterday: '2026-09-26', now: '2026-09-27T11:47:00-04:00', time: '11:47', weekday: 'Sunday', locale: 'en-US', timezone: 'America/New_York' };
// 2026-10-05 补采：GitHub 12:32、HN 与中文维基 12:27（UTC+8）
const AT_1005_GH = process.env.GH_AT || '2026-10-05T04:32:27Z';
const AT_1005 = '2026-10-05T04:27:22Z';
const AT_1005_FEEDS = '2026-10-05T04:38:56Z';   // sspai / dev.to / Open-Meteo / wttr.in 补采时间
const AT_1005_WM_EN = '2026-10-05T04:51:51Z';   // 英文维基 REST feed 采集时间（HN 首页沿用 hn-1005.json，04:27）
const AT_1005_KW = '2026-10-05T04:48:33Z';   // 关键词 HN 搜索采集时间；学习计划（示例数据）同批重生成
const RSS_1005 = { 'https://sspai.com/feed': 'sspai.xml', 'https://dev.to/feed': 'devto.xml', 'https://dev.to/feed/tag/ai': 'devto-ai.xml' };
const runZh1005 = { today: '2026-10-05', yesterday: '2026-10-04', now: '2026-10-05T12:27:00+08:00', time: '12:27', weekday: '周一', locale: 'zh-CN', timezone: 'Asia/Shanghai' };
const runEn1005 = { today: '2026-10-05', yesterday: '2026-10-04', now: '2026-10-05T00:32:00-04:00', time: '00:32', weekday: 'Monday', locale: 'en-US', timezone: 'America/New_York' };

// ---------- 缓存里的真实响应 ----------
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const strip = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function parseRss(file, dir = CACHE) {          // 与平台 rss 步骤输出同形：title / link / published / summary / source
  const x = readFileSync(`${dir}/${file}`, 'utf8');
  const source = strip((x.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/) || [])[1] || '');
  return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const g = (t) => (it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`)) || [])[1] || '';
    return { title: strip(g('title')), link: strip(g('link')), published: new Date(strip(g('pubDate'))).toISOString(), summary: strip(g('description')).slice(0, 300), source };
  });
}
const RSS = { 'https://sspai.com/feed': 'sspai.xml', 'https://dev.to/feed': 'devto.xml', 'https://dev.to/feed/tag/ai': 'devto-ai.xml' };
const HTTP = [
  ['https://hn.algolia.com/api/v1/search?tags=front_page', () => json('hn.json')],
  ['https://api.wikimedia.org/feed/v1/wikipedia/en/featured/2026/09/26', () => json('wm-en.json')],
  ['https://api.open-meteo.com/', () => { throw new Error('HTTP 429'); }],   // 采集时共享出口 IP 被 Open-Meteo 限流（真实结果）→ 卡片自动改用 wttr.in
  ['https://wttr.in/New York', () => json('wttr-ny.json')],
  ['https://wttr.in/上海', () => json('wttr-sh.json')],
  ['https://api.github.com/repos/vuejs/core/releases', () => json('gh-vue-rel.json')],
  ['https://api.github.com/repos/vuejs/core/issues', () => json('gh-vue-iss.json')],
  ['https://api.github.com/repos/vuejs/core', () => json('gh-vue.json')],
  ['https://api.github.com/repos/facebook/react/releases', () => json('gh-react-rel.json')],
  ['https://api.github.com/repos/facebook/react/issues', () => json('gh-react-iss.json')],
  ['https://api.github.com/repos/facebook/react', () => json('gh-react.json')],
];
const fixturesBase = (extra = {}) => ({
  knownProxyHosts: ['36kr.com', 'hnrss.org'],  // 平台内置“已知需代理域名”清单（节选）；演示访客没有配置代理
  live: async (url) => { const h = (extra.http2 || []).find(([p]) => url.startsWith(p)) || HTTP.find(([p]) => url.startsWith(p)); if (!h) throw new Error(`缓存里没有：${url}`); const b = h[1](); if (b?.message && /rate limit/i.test(b.message)) throw new Error('GitHub 缓存是限流错误，请重新采集'); return b; },
  liveRss: async (u) => (extra.rss2?.[u] ? parseRss(extra.rss2[u], CACHE2) : RSS[u] ? parseRss(RSS[u]) : undefined),
  ...extra,
});

// ---------- 手写的 AI 输出（没有真实模型调用；内容只复述采集到的标题 / 天气，不添加来源里没有的事实） ----------
let hnCache; const hn = () => (hnCache ||= json('hn.json').hits);   // 惰性读取：只补采 10-05 的快照时不需要 09-27 的缓存
const hnById = (id) => hn().find((h) => h.objectID === id);
const kwHits = (f) => json(f).hits;
const kw2 = (f) => { const hits = json2(f).hits; return (id) => { const h = hits.find((x) => x.objectID === id); if (!h) throw new Error(`${f} 里没有 ${id}`); return h; }; };
const AI = {
  // 'hot-topics'：U11 后中文版与英文版同为 HN + 维基百科 7 步结构，演示模式没有模型，不需要 AI 夹具（旧的 ai_search 手写夹具已删除）
  // 2026-10-05 产品经理新演示参数：标题、链接、日期来自 HN 关键词搜索（kw2-*.json，2026-10-05 采集）；来源名取自原文域名，一句话摘要只复述标题（手写，没有真实调用联网搜索模型）。
  // 中文关键词在 HN 上搜不到，按英文同义词检索：AI Agent → "AI agents"，本地优先软件 → "local-first"，开源大模型 → "open-weight"。
  'keyword-watch': { n2: () => { const a = kw2('kw-agent.json'), l = kw2('kw-localfirst.json'), o = kw2('kw-openllm.json'); return { items: [
    { keyword: 'AI Agent', title: a('49955068').title, url: a('49955068').url, source: '9to5Mac', publishedAt: a('49955068').created_at.slice(0, 10), summary: '苹果表示，随着 AI 智能体兴起，将收紧 macOS 隐私控制。' },
    { keyword: 'AI Agent', title: a('49955000').title, url: a('49955000').url, source: 'LukeW', publishedAt: a('49955000').created_at.slice(0, 10), summary: '讨论如何为 AI 智能体设计设计系统。' },
    { keyword: '本地优先软件', title: l('49926792').title, url: l('49926792').url, source: 'turbonotes.net', publishedAt: l('49926792').created_at.slice(0, 10), summary: '一款本地优先的 Markdown 笔记应用，界面仿 Turbo Pascal，可保存到 GitHub。' },
    { keyword: '本地优先软件', title: l('49909624').title, url: l('49909624').url, source: 'GitHub', publishedAt: l('49909624').created_at.slice(0, 10), summary: '本地优先、开源的邮件清理和隐私工具。' },
    { keyword: '开源大模型', title: o('49942706').title, url: o('49942706').url, source: 'Aleph Alpha', publishedAt: o('49942706').created_at.slice(0, 10), summary: 'Aleph Alpha 发布开放权重模型 Kolibri。' },
    { keyword: '开源大模型', title: o('49955908').title, url: o('49955908').url, source: 'Axios', publishedAt: o('49955908').created_at.slice(0, 10), summary: 'Axios 报道一款强大的开放模型可能改变 AI 竞争格局。' },
  ] }; } },
  'keyword-watch-en': { n2: () => { const a = kw2('kw-agent.json'), l = kw2('kw-localfirst.json'), w = kw2('kw-wasm.json'); return { items: [
    { keyword: 'AI agents', title: a('49955068').title, url: a('49955068').url, source: '9to5Mac', publishedAt: a('49955068').created_at.slice(0, 10), summary: 'Apple says it will tighten macOS privacy controls as AI agents spread.' },
    { keyword: 'AI agents', title: a('49955000').title, url: a('49955000').url, source: 'LukeW', publishedAt: a('49955000').created_at.slice(0, 10), summary: 'On designing design systems for AI agents.' },
    { keyword: 'local-first software', title: l('49926792').title, url: l('49926792').url, source: 'turbonotes.net', publishedAt: l('49926792').created_at.slice(0, 10), summary: 'Local-first Markdown notes with a Turbo Pascal look that save to GitHub.' },
    { keyword: 'local-first software', title: l('49909624').title, url: l('49909624').url, source: 'GitHub', publishedAt: l('49909624').created_at.slice(0, 10), summary: 'A local-first, open-source email cleanup and privacy tool.' },
    { keyword: 'WebAssembly', title: w('49950838').title, url: w('49950838').url, source: 'GitHub', publishedAt: w('49950838').created_at.slice(0, 10), summary: 'A research WebAssembly engine.' },
    { keyword: 'WebAssembly', title: w('49910668').title, url: w('49910668').url, source: 'fusor.build', publishedAt: w('49910668').created_at.slice(0, 10), summary: 'Painting a fractal in the browser with a pool of WebAssembly threads written in Rust.' },
  ] }; } },
  // 2026-10-05 产品经理新演示参数：《Rust 程序设计语言》前 20 章、每天 60 分钟。示例数据：进度和今日任务是编的（以“示例：”开头）；章节名取自原书第 4 章“认识所有权”。
  'study-plan': { n5: { tasks: [
    { text: '示例：读第 4 章 4.1 节“什么是所有权”', minutes: 30, units: 0 },
    { text: '示例：读 4.2 节“引用与借用”并运行书中示例', minutes: 20, units: 1 },
    { text: '示例：用 10 分钟整理今天的笔记', minutes: 10, units: 0 },
  ] } },
  'study-plan-en': { n5: { tasks: [
    { text: 'Sample: read section 4.1 "What Is Ownership?"', minutes: 30, units: 0 },
    { text: 'Sample: read section 4.2 "References and Borrowing" and run the examples', minutes: 20, units: 1 },
    { text: 'Sample: spend 10 minutes tidying today\'s notes', minutes: 10, units: 0 },
  ] } },
};
AI['daily-brief'] = { n7: (p) => (PRINT && console.log('--- daily-brief prompt ---\n' + p), readFileSync(fileURLToPath(new URL('./snapshot-ai/daily-brief.zh-CN.md', import.meta.url)), 'utf8').trim()) };
AI['daily-brief-en'] = { n7: (p) => (PRINT && console.log('--- daily-brief-en prompt ---\n' + p), readFileSync(fileURLToPath(new URL('./snapshot-ai/daily-brief.en.md', import.meta.url)), 'utf8').trim()) };

// ---------- 8 × 2 份快照的实例参数与说明 ----------
const TODO_ZH = ['示例：勾选我试试', '示例：点标题旁的菜单编辑卡片', '示例：填写 Key 后试试一句话生成'];
const TODO_EN = ['Example: check me off', 'Example: use the menu next to the title to edit this card', 'Example: add a key, then try one-sentence generation'];
const todoStore = (t) => ({ todos: { items: t.map((text, i) => ({ id: `demo-${i + 1}`, text, done: false })) } });
const GH = (n, repo) => [[`https://api.github.com/repos/${repo}/releases`, () => json2(`gh-${n}-rel.json`)], [`https://api.github.com/repos/${repo}/issues`, () => json2(`gh-${n}-iss.json`)], [`https://api.github.com/repos/${repo}`, () => json2(`gh-${n}.json`)]];
const PLAN = [
  { base: 'todo', zh: { store: todoStore(TODO_ZH), dataKind: 'sample', notes: '演示看板预置的 3 条“示例：”待办（PRD F-DM-02），不是任何人的真实数据。' },
    en: { store: todoStore(TODO_EN), dataKind: 'sample', notes: 'The 3 "Example:" to-dos preloaded on the demo board (PRD F-DM-02). Not anyone\'s real data.' } },
  { base: 'ai-usage', zh: { fixtures: { usage: { days: [], today: { calls: 0, tokens: 0, searchCalls: 0, callLimit: 200, searchLimit: 30, cost: null } } }, dataKind: 'captured', notes: '新访客的真实状态：没有任何 AI 调用记录（PRD F-DM-02：“不是示例数据，是真实的 0”）。' },
    en: { fixtures: { usage: { days: [], today: { calls: 0, tokens: 0, searchCalls: 0, callLimit: 200, searchLimit: 30, cost: null } } }, dataKind: 'captured', notes: 'The real state for a new visitor: no AI calls yet (PRD F-DM-02: a real zero, not sample data).' } },
  { base: 'github-repo', zh: { inputs: { repo: 'vuejs/core' }, run: { ...runZh1005, modelConfigured: false }, at: AT_1005_GH, http2: GH('vue', 'vuejs/core'), dataKind: 'captured', notes: 'GitHub 公开 API 实时数据（2026-10-05 采集）；演示模式没有模型，AI 小结按 enabledIf 跳过。第一次运行没有昨日数据，所以没有“较昨日”。' },
    en: { inputs: { repo: 'react/react' }, run: { ...runEn1005, modelConfigured: false }, at: AT_1005_GH, http2: GH('react', 'react/react'), dataKind: 'captured', notes: 'Live data from the public GitHub API, captured on 2026-10-05. The repo is react/react: the old name facebook/react answers with a 301 redirect, and cards do not follow redirects in direct mode. No model in demo mode, so the AI summary step is skipped. First run, so no "vs yesterday" delta.' } },
  { base: 'rss-digest', zh: { inputs: { feeds: ['https://sspai.com/feed', 'https://dev.to/feed', 'https://36kr.com/feed'] }, run: { ...runZh1005, modelConfigured: false }, at: AT_1005_FEEDS, rss2: RSS_1005, dataKind: 'captured', notes: '少数派、dev.to 真实条目（2026-10-05 采集，卡片 1.1.1）；36氪需要代理，演示访客没有配置代理，所以显示提示条（PRD F-DM-02）。AI 摘要跳过，副标题是原文开头。' },
    en: { inputs: { feeds: ['https://dev.to/feed', 'https://dev.to/feed/tag/ai', 'https://hnrss.org/frontpage'] }, run: { ...runEn1005, modelConfigured: false }, at: AT_1005_FEEDS, rss2: RSS_1005, dataKind: 'captured', notes: 'Real dev.to items captured on 2026-10-05 (card 1.1.1). hnrss.org needs a proxy and demo visitors have none, so the proxy notice shows (PRD AC-DM-02-7). AI summaries skipped; subtitles are the article openings.' } },
  { base: 'hot-topics', zh: { run: { ...runZh1005, modelConfigured: false }, at: AT_1005, http2: [['https://hn.algolia.com/api/v1/search?tags=front_page', () => json2('hn-1005.json')], ['https://zh.wikipedia.org/api/rest_v1/feed/featured/2026/10/04', () => json2('wm-zh-1005.json')]], dataKind: 'captured', notes: 'U11 改版后的 7 步结构：Hacker News 首页和中文维基百科昨日（2026-10-04 的 feed，统计 10-03）最多阅读，2026-10-05 采集。演示模式没有模型，所以是卡片自带的交错列表，不是 AI 挑选。' },
    en: { run: { ...runEn1005, modelConfigured: false }, at: AT_1005_WM_EN, http2: [['https://hn.algolia.com/api/v1/search?tags=front_page', () => json2('hn-1005.json')], ['https://en.wikipedia.org/api/rest_v1/feed/featured/2026/10/04', () => json2('wm-en-1005.json')]], dataKind: 'captured', notes: 'Hacker News front page and English Wikipedia most-read from the en.wikipedia.org REST feed (the 2026-10-04 feed, counting views on 2026-10-03), captured on 2026-10-05 (card 1.0.1; api.wikimedia.org/feed/v1 is being phased out). No model in demo mode, so this is the card\'s built-in interleaved list, not an AI pick.' } },
  { base: 'keyword-watch', zh: { inputs: { keywords: 'AI Agent\n本地优先软件\n开源大模型', window: '7 天' }, run: { ...runZh1005 }, at: AT_1005_KW, dataKind: 'mixed', notes: '产品经理 2026-10-05 的演示参数。标题、链接和日期来自 Hacker News 关键词搜索（2026-10-05 采集，近 7 天；中文关键词按英文同义词检索：AI agents、local-first、open-weight）；来源名与一句话摘要是手写的（没有真实调用联网搜索模型）。' },
    en: { inputs: { keywords: 'AI agents\nlocal-first software\nWebAssembly', window: '7 days' }, run: { ...runEn1005 }, at: AT_1005_KW, dataKind: 'mixed', notes: 'PM demo parameters of 2026-10-05. Titles, links and dates come from a Hacker News keyword search captured on 2026-10-05 (last 7 days). Source names and one-line summaries are handwritten (no real web-search model call).' } },
  { base: 'daily-brief', zh: { at: '2026-09-27T15:52:00Z', dataKind: 'mixed', notes: '资讯来自 Hacker News 首页和少数派，天气来自 wttr.in（Open-Meteo 采集时限流，卡片自动切到备用源），均为 2026-09-27 真实采集；简报正文是按提示词格式手写的（没有真实调用模型）。' },
    en: { run: runEn1005, at: AT_1005_FEEDS, rss2: RSS_1005, http2: [['https://hn.algolia.com/api/v1/search?tags=front_page', () => json2('hn-1005.json')], ['https://api.open-meteo.com/', () => json2('meteo-ny.json')], ['https://wttr.in/New York', () => json2('wttr-ny.json')]], dataKind: 'mixed', notes: 'News from the Hacker News front page and DEV, weather from Open-Meteo, all captured on 2026-10-05 (card 1.1.1). The brief text is handwritten in the prompt\'s format from those items (no real model call).' } },
  // 产品经理规格：截止日期 = 看板创建日 + 60 天、每天 60 分钟。快照不写 deadline，卡片 1.0.2 起留空时按“首次运行日（startDate）+ 60 天”计算，
  // 所以快照表示看板创建当天的状态：进度 0、距截止 60 天、建议每天 0.33 章，与采集日期无关，不会过期。
  { base: 'study-plan', zh: { inputs: { goal: '学完《Rust 程序设计语言》前 20 章', totalUnits: 20, unitName: '章', dailyMinutes: 60 }, run: { ...runZh1005 }, at: AT_1005_KW, store: {}, dataKind: 'sample', notes: '产品经理 2026-10-05 的演示参数（《Rust 程序设计语言》前 20 章、每天 60 分钟）。截止日期没有写死：参数留空，卡片按看板创建（首次运行）当天 + 60 天计算，所以这里始终是创建当天的状态（距截止 60 天）。今日任务是编的（以“示例：”开头），任务里的章节名取自原书。' },
    en: { inputs: { goal: 'Finish the first 20 chapters of The Rust Programming Language', totalUnits: 20, unitName: 'chapters', dailyMinutes: 60 }, run: { ...runEn1005 }, at: AT_1005_KW, store: {}, dataKind: 'sample', notes: 'PM demo parameters of 2026-10-05 (The Rust Programming Language, first 20 chapters, 60 minutes a day). The deadline is not hardcoded: the parameter is left empty and the card computes board creation (first run) day + 60 days, so this always shows the state on the creation day (60 days left). Today\'s tasks are made up (they start with "Sample:"); section names come from the book.' } },
];

const only = arg('only', '');
let failed = 0;
for (const p of PLAN) {
  if (only && p.base !== only) continue;
  for (const [loc, cfg] of [['zh-CN', p.zh], ['en', p.en]]) {
    if (LOCALE && loc !== LOCALE) continue;
    const id = loc === 'en' ? `${p.base}-en` : p.base;
    const card = load(id);
    const run = { ...(loc === 'en' ? runEn : runZh), ...(cfg.run || {}) };
    const fixtures = fixturesBase({ ai: AI[id] || AI[p.base], http2: cfg.http2, rss2: cfg.rss2, ...(cfg.fixtures || {}) });
    let r;
    try { r = await runCard(card, { inputs: cfg.inputs || {}, run, store: structuredClone(cfg.store || {}), fixtures }); }
    catch (e) { failed++; console.log(`跳过 ${p.base}.${loc}：${e.message}`); continue; }
    const inputs = Object.fromEntries(card.inputs.map((i) => [i.key, r.ctx.inputs[i.key]]).filter(([, v]) => v !== null && v !== undefined));
    const snap = {
      snapshotVersion: 1,
      meta: { id, version: card.meta.version },
      locale: loc,
      inputs,
      capturedAt: cfg.at || CAPTURED_AT,
      dataKind: cfg.dataKind,
      notes: cfg.notes,
      display: { component: card.display.component, bind: r.bind },
      ...(r.notices.length ? { notices: r.notices.map(({ code, host }) => ({ code, host })) } : {}),
    };
    const file = new URL(`${p.base}.${loc}.json`, OUT);
    writeFileSync(file, JSON.stringify(snap, null, 2) + '\n');
    console.log(`写入 demo-snapshots/${p.base}.${loc}.json  (${cfg.dataKind}${r.stats.errors.length ? '，步骤错误：' + r.stats.errors.join('; ') : ''})`);
  }
}
process.exit(failed ? 1 : 0);
// CAPTURE（原始数据采集，2026-09-27 UTC+8；请求头 Origin: https://example.com 用于顺带确认 CORS）：
//   hn.json      https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30
//   sspai.xml    https://sspai.com/feed        devto.xml  https://dev.to/feed        devto-ai.xml  https://dev.to/feed/tag/ai
//   wttr-ny.json https://wttr.in/New%20York?format=j1&lang=en      wttr-sh.json  https://wttr.in/%E4%B8%8A%E6%B5%B7?format=j1&lang=zh
//   wm-en.json   https://api.wikimedia.org/feed/v1/wikipedia/en/featured/2026/09/26
//   kw-cfw.json  https://hn.algolia.com/api/v1/search_by_date?query=%22Cloudflare%20Workers%22&tags=story&hitsPerPage=5
//   kw-deepseek.json  同上，query=DeepSeek
//   gh-vue*.json / gh-react*.json  https://api.github.com/repos/<repo>、/releases?per_page=1、/issues?state=open&sort=created&direction=desc&per_page=10
// CAPTURE-1005（2026-10-05 补采，缓存目录 /tmp/snapcache-1005，UTC+8 12:27–12:32）：
//   hn-1005.json     https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30
//   wm-zh-1005.json  https://zh.wikipedia.org/api/rest_v1/feed/featured/2026/10/04
//   wm-en-1005.json  https://en.wikipedia.org/api/rest_v1/feed/featured/2026/10/04（12:51）
//   gh-vue*.json     https://api.github.com/repos/vuejs/core、/releases?per_page=1、/issues?state=open&sort=created&direction=desc&per_page=10
//   sspai.xml / devto.xml / devto-ai.xml  https://sspai.com/feed、https://dev.to/feed、https://dev.to/feed/tag/ai（12:38）
//   meteo-ny.json    https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1
//   wttr-ny.json     https://wttr.in/New%20York?format=j1&lang=en（Open-Meteo 正常时不会用到）
//   kw-agent.json / kw-localfirst.json / kw-wasm.json / kw-openllm.json（12:48）  https://hn.algolia.com/api/v1/search_by_date?query=<词>&tags=story&hitsPerPage=10&numericFilters=created_at_i%3E<7 天前>
//                    词分别为 %22AI%20agents%22、%22local-first%22、WebAssembly、%22open-weight%22
//   gh-react*.json   同上，repos/react/react（repos/facebook/react 返回 301 → /repositories/10270250，直连模式不跟随跳转）
