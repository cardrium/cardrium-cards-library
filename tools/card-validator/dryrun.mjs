#!/usr/bin/env node
// 用夹具把 16 个示范卡片（中文 8 个 + 英文 8 个）各跑一到多次，检查 JSONata 表达式、引用、绑定能算出预期结果。
// 用法：node dryrun.mjs    （npm test 会先跑 validate --selftest 再跑本脚本）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runCard } from './lib/mini-runtime.mjs';

const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../card-examples/${id}.json`, import.meta.url)), 'utf8'));
const day = (d) => ({ today: d, now: `${d}T08:00:00+08:00`, weekday: '周一' });
const dayEn = (d) => { const y = new Date(Date.parse(d + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10); return { today: d, yesterday: y, now: `${d}T08:00:00-04:00`, weekday: 'Monday', locale: 'en-US', timezone: 'America/New_York' }; };

const scenarios = {
  async 'study-plan'() {
    const card = load('study-plan'); const store = {}; const fx = { ai: { n5: { tasks: [{ text: '读第 1 章', minutes: 30, units: 1 }, { text: '做 1.1 习题', minutes: 20, units: 0 }, { text: '复习笔记', minutes: 10, units: 0 }] } } };
    const inputs = { goal: '学完 CSAPP 前 9 章', totalUnits: 9, deadline: '2026-10-10' };
    let r = await runCard(card, { inputs, run: day('2026-09-28'), store, fixtures: fx });
    assert.equal(r.bind.items.length, 3); assert.equal(r.stats.modelCalls, 1);
    assert.match(r.bind.header, /^进度 0\/9 章（0%）· 距截止 12 天/);
    store.plan.items[0].done = true;                              // 用户勾选（平台直接写回 storageKey）
    r = await runCard(card, { inputs, run: day('2026-09-28'), store, fixtures: fx }); // rerunOnChange
    assert.equal(r.stats.modelCalls, 0); assert.match(r.bind.header, /^进度 1\/9/);
    r = await runCard(card, { inputs, run: day('2026-09-29'), store, fixtures: fx }); // 第二天：结算昨日
    assert.equal(store.progress.doneUnits, 1); assert.equal(r.stats.modelCalls, 1);
    r = await runCard(card, { inputs, run: day('2026-09-29'), store, fixtures: fx }); // 同日再刷新：不重复累计
    assert.equal(store.progress.doneUnits, 1); assert.equal(r.stats.modelCalls, 0);
    assert.equal(r.bind.header, '进度 1/9 章（11%）· 距截止 11 天 · 建议每天 0.73 章');
    // 截止日期留空：按首次运行日（看板创建日）+ 60 天；startDate 记在 progress 里，之后每天倒数
    const rel = {}; const relInputs = { goal: '学完《Rust 程序设计语言》前 20 章', totalUnits: 20, unitName: '章', dailyMinutes: 60 };
    r = await runCard(card, { inputs: relInputs, run: day('2026-10-05'), store: rel, fixtures: fx });
    assert.equal(r.bind.header, '进度 0/20 章（0%）· 距截止 60 天 · 建议每天 0.33 章'); assert.equal(rel.progress.startDate, '2026-10-05');
    r = await runCard(card, { inputs: relInputs, run: day('2026-10-06'), store: rel, fixtures: fx });
    assert.equal(rel.progress.startDate, '2026-10-05'); assert.match(r.bind.header, /距截止 59 天/);
    r = await runCard(card, { inputs: { ...relInputs, deadline: '2026-10-16' }, run: day('2026-10-06'), store: rel, fixtures: fx }); // 用户填了就用填的
    assert.match(r.bind.header, /距截止 10 天/);
    return r.bind.header;
  },
  async todo() {
    const card = load('todo');
    const store = { todos: { items: [{ id: 'a', text: '写周报', done: false, priority: 'low' }, { id: 'b', text: '交房租', done: false, due: '2026-09-27', priority: 'high' }, { id: 'c', text: '买牛奶', done: true }] } };
    const r = await runCard(card, { run: day('2026-09-28'), store, fixtures: {} });
    assert.deepEqual(r.bind.items.map((i) => i.id), ['b', 'a', 'c']);
    assert.equal(r.bind.header, '未完成 2 项，逾期 1 项'); assert.equal(r.bind.status, 'warn');
    const empty = await runCard(card, { run: day('2026-09-28'), store: {}, fixtures: {} });
    assert.deepEqual(empty.bind.items, []);
    return r.bind.header;
  },
  async 'ai-usage'() {
    const card = load('ai-usage');
    const usage = { days: [
      { date: '2026-09-26', byModel: { 'gpt-x': { calls: 3, inputTokens: 1000, outputTokens: 200 } }, byCard: { 简报: { calls: 3, inputTokens: 1000, outputTokens: 200 } } },
      { date: '2026-09-27', byModel: {}, byCard: {} },
      { date: '2026-09-28', byModel: { 'gpt-x': { calls: 2, inputTokens: 500, outputTokens: 100 }, 'claude-y': { calls: 1, inputTokens: 300, outputTokens: 50 } }, byCard: { 热点: { calls: 3, inputTokens: 800, outputTokens: 150 } } },
    ], today: { calls: 170, tokens: 41000, searchCalls: 3, callLimit: 200, searchLimit: 30, cost: null } };
    const r = await runCard(card, { run: day('2026-09-28'), store: {}, fixtures: { usage } });
    assert.equal(r.bind.series.length, 2); assert.deepEqual(r.bind.series[0].data.map((d) => d.y), [3, 0, 2]);
    assert.equal(r.bind.status, 'warn'); assert.equal(r.bind.headline, '今天 170/200 次调用 · 41,000 tokens · 联网搜索 3/30 次');
    const t = await runCard(card, { inputs: { metric: 'tokens', groupBy: 'card' }, run: day('2026-09-28'), store: {}, fixtures: { usage } });
    assert.deepEqual(t.bind.series.map((s) => s.name), ['简报', '热点']); assert.deepEqual(t.bind.series[1].data.map((d) => d.y), [0, 0, 950]);
    return r.bind.headline;
  },
  async 'hot-topics'() {
    // U11：与英文版同样的 7 步结构，Wikimedia 英文 feed 换成中文维基百科 REST feed（zh.wikipedia.org/api/rest_v1，api.wikimedia.org 的 feed 已进入逐步弃用）
    const card = load('hot-topics');
    const zd = { ...day('2026-09-28'), yesterday: '2026-09-27', locale: 'zh-CN' };
    const hn = { match: 'https://hn.algolia.com/api/v1/search', body: { hits: [{ title: 'Show HN: A', url: 'https://a.example', points: 300, num_comments: 120, objectID: '1' }, { title: 'Ask HN: B', url: null, points: 90, num_comments: 80, objectID: '2' }] } };
    let wikiUrl = '';
    const wiki = { match: 'https://zh.wikipedia.org/api/rest_v1/feed/featured/', body: (u) => { wikiUrl = u; return { mostread: { articles: [
      { title: 'Wikipedia:首页', titles: { normalized: 'Wikipedia:首页' }, views: 9e6, content_urls: { desktop: { page: 'https://zh.wikipedia.org/wiki/Wikipedia:%E9%A6%96%E9%A1%B5' } } },
      { title: 'Special:搜索', titles: { normalized: 'Special:搜索' }, views: 8e6, content_urls: { desktop: { page: 'x' } } },
      { title: '2026年亚洲运动会', titles: { normalized: '2026年亚洲运动会' }, views: 29600, description: '在日本爱知县和名古屋举行的综合性运动会', content_urls: { desktop: { page: 'https://zh.wikipedia.org/wiki/2026%E5%B9%B4%E4%BA%9A%E6%B4%B2%E8%BF%90%E5%8A%A8%E4%BC%9A' } } },
      { title: '示例条目', titles: { normalized: '示例条目' }, views: 1234, content_urls: { desktop: { page: 'https://zh.wikipedia.org/wiki/%E7%A4%BA%E4%BE%8B' } } },
    ] } }; } };
    // 1) 没有模型：HN 与维基百科交错显示，过滤掉首页和特殊页面
    let r = await runCard(card, { inputs: { count: 5 }, run: { ...zd, modelConfigured: false }, store: {}, fixtures: { http: [hn, wiki] } });
    assert.equal(wikiUrl, 'https://zh.wikipedia.org/api/rest_v1/feed/featured/2026/09/27');
    assert.deepEqual(r.bind.items.map((i) => i.title), ['Show HN: A', '2026年亚洲运动会', 'Ask HN: B', '示例条目']);
    assert.equal(r.bind.items[0].meta, 'Hacker News · 300 分 · 120 条评论'); assert.equal(r.bind.items[1].meta, '维基百科 · 29,600 次阅读');
    assert.equal(r.bind.items[2].url, 'https://news.ycombinator.com/item?id=2'); assert.equal(r.stats.modelCalls, 0); assert.equal(r.bind.status, 'normal');
    // 2) 有模型：只保留网址在候选里的条目（编造的链接被丢掉）
    const ai = { n5: { items: [{ title: '亚运会', summary: '亚运会在日本举行。', url: 'https://zh.wikipedia.org/wiki/2026%E5%B9%B4%E4%BA%9A%E6%B4%B2%E8%BF%90%E5%8A%A8%E4%BC%9A', source: '维基百科', heat: '29,600 次阅读' }, { title: '编造', summary: 'x', url: 'https://fake.example', source: 'x', heat: 'x' }] } };
    r = await runCard(card, { inputs: { count: 5 }, run: zd, store: {}, fixtures: { http: [hn, wiki], ai } });
    assert.deepEqual(r.bind.items.map((i) => i.title), ['亚运会']); assert.equal(r.stats.modelCalls, 1);
    // 3) 只看 HN：不请求维基百科
    wikiUrl = '';
    r = await runCard(card, { inputs: { count: 5, region: '科技社区' }, run: { ...zd, modelConfigured: false }, store: {}, fixtures: { http: [hn, wiki] } });
    assert.equal(wikiUrl, ''); assert.equal(r.bind.items.length, 2); assert.ok(r.stats.skipped.includes('n3'));
    // 4) 两个来源都失败：空列表 + warn
    r = await runCard(card, { inputs: { count: 5 }, run: { ...zd, modelConfigured: false }, store: {}, fixtures: { http: [{ match: 'https://hn.algolia.com/', body: {} }, { match: 'https://zh.wikipedia.org/', body: {} }] } });
    assert.equal(r.bind.items.length, 0); assert.equal(r.bind.status, 'warn');
    return 'HN + 中文维基 交错 → AI 挑选（丢弃编造链接）→ 只看 HN → 全失败 warn';
  },
  async 'keyword-watch'() {
    const card = load('keyword-watch'); const store = {};
    const items = [
      { keyword: 'Deno', title: 'Deno 3 发布', url: 'https://www.deno.com/blog/v3?utm_source=x', source: 'Deno', publishedAt: '2026-09-27', summary: '…' },
      { keyword: 'Deno', title: '重复', url: 'https://deno.com/blog/v3/', source: 'Deno', publishedAt: '2026-09-27', summary: '…' },
      { keyword: 'Workers', title: 'Workers 更新', url: 'https://blog.example/w', source: 'CF', publishedAt: '2026-09-26', summary: '…' },
    ];
    let r = await runCard(card, { inputs: { keywords: 'Deno\nWorkers' }, run: day('2026-09-28'), store, fixtures: { ai: { n2: { items } } } });
    assert.equal(r.bind.items.length, 2); assert.equal(r.bind.header, '2 条新动态');
    r = await runCard(card, { inputs: { keywords: 'Deno\nWorkers' }, run: day('2026-09-28'), store, fixtures: { ai: { n2: { items } } } });
    assert.equal(r.bind.header, '没有新动态'); assert.ok(r.bind.items.every((i) => i.badge === ''));
    return r.bind.header;
  },
  async 'daily-brief'() {
    const card = load('daily-brief');
    const hn = { match: 'https://hn.algolia.com/api/v1/search', body: { hits: [{ title: 'Show HN: X', url: null, points: 100, num_comments: 40, objectID: '1' }, { title: 'Y', url: 'https://y.example', points: 50, num_comments: 3, objectID: '2' }] } };
    const meteo = { match: 'https://api.open-meteo.com/v1/forecast', body: { current: { temperature_2m: 21.4, weather_code: 3 }, daily: { temperature_2m_min: [18.2], temperature_2m_max: [25.6], precipitation_probability_max: [40] } } };
    const wttr = { match: 'https://wttr.in/', body: { current_condition: [{ temp_C: '20', 'lang_zh-cn': [{ value: '小雨' }], weatherDesc: [{ value: 'Light rain' }] }], weather: [{ mintempC: '17', maxtempC: '23' }] } };
    const rss = { 'https://sspai.com/feed': [{ title: '少数派文章', link: 'https://sspai.com/post/1', published: '2026-09-28T00:00:00Z', summary: '正文', source: '少数派' }] };
    let prompt = '';
    const ai = { n7: (p) => { prompt = p; return '**今日**…'; } };
    // 1) 全部直连：HN + 少数派 + Open-Meteo，不请求备用天气源，不需要代理
    let r = await runCard(card, { run: day('2026-09-28'), store: {}, fixtures: { http: [hn, meteo, wttr], rss, ai } });
    assert.match(prompt, /上海：多云，现在 21°C，今天 18～26°C，降水概率 40%/); assert.match(prompt, /news\.ycombinator\.com\/item\?id=1/); assert.match(prompt, /少数派文章/);
    assert.ok(r.stats.skipped.includes('n4') && r.stats.skipped.includes('n5')); assert.equal(r.notices.length, 0);
    assert.equal(r.bind.footer, '来源：Hacker News、少数派 · 天气 Open-Meteo · 更新于 08:00');
    // 2) Open-Meteo 限流（429）→ 自动改用 wttr.in；用户加了 36氪（内置清单：需代理）但没配代理 → 跳过并提示
    r = await runCard(card, { inputs: { extraFeeds: ['https://36kr.com/feed'] }, run: day('2026-09-29'), store: {},
      fixtures: { http: [hn, { match: 'https://api.open-meteo.com/', error: 'HTTP 429' }, wttr], rss, ai, knownProxyHosts: ['36kr.com'] } });
    assert.match(prompt, /上海：小雨，现在 20°C，今天 17～23°C/); assert.equal(r.bind.footer, '来源：Hacker News、少数派 · 天气 wttr.in · 更新于 08:00');
    assert.deepEqual(r.notices, [{ code: 'PROXY_REQUIRED', host: '36kr.com', action: 'open-proxy-settings' }]);
    // 3) 所有来源都失败 → 跳过 AI 步骤（enabledIf），显示兜底文案，不调用模型（示范卡片不依赖 condition 步骤）
    let calls = 0;
    r = await runCard(card, { run: day('2026-09-30'), store: {}, fixtures: { http: [{ match: 'https://', error: 'TypeError: Failed to fetch' }], rss: {}, ai: { n7: () => { calls++; return ''; } } } });
    assert.equal(r.bind.content, '今天的资讯来源都没有读到内容，稍后再试。'); assert.equal(r.bind.status, 'warn'); assert.equal(calls, 0);
    return '直连默认源 + 天气备用源 + 代理缺失提示';
  },
  async 'github-repo'() {
    const card = load('github-repo'); const store = {};
    const repo = (stars) => ({ match: 'https://api.github.com/repos/vuejs/core', body: { stargazers_count: stars, forks_count: 1, open_issues_count: 2, pushed_at: '2026-09-27T10:00:00Z', html_url: 'https://github.com/vuejs/core' } });
    const fx = (stars) => ({ http: [
      { match: 'https://api.github.com/repos/vuejs/core/releases', body: [{ tag_name: 'v3.6.0', published_at: '2026-09-25T00:00:00Z' }] },
      { match: 'https://api.github.com/repos/vuejs/core/issues', body: [{ title: 'bug A', created_at: '2026-09-27T20:00:00Z' }, { title: 'PR B', created_at: '2026-09-27T21:00:00Z', pull_request: {} }, { title: '旧 issue', created_at: '2026-09-01T00:00:00Z' }] },
      repo(stars)], ai: { n7: '仓库今天很平静。' }, cache: {} });
    let r = await runCard(card, { inputs: { repo: 'vuejs/core' }, run: day('2026-09-27'), store, fixtures: fx(100) });
    assert.equal(r.bind.value, 100); assert.equal(r.bind.delta, null);
    r = await runCard(card, { inputs: { repo: 'vuejs/core', showSummary: false }, run: day('2026-09-28'), store, fixtures: fx(108) });
    assert.equal(r.bind.delta, 8); assert.equal(r.stats.modelCalls, 0);
    assert.equal(r.bind.note, '最新版本 v3.6.0（2026-09-25） · 24 小时内新 issue 1 个 · 最近推送 2026-09-27');
    r = await runCard(card, { inputs: { repo: 'vuejs/core' }, run: day('2026-09-28'), store, fixtures: fx(109) });
    assert.equal(r.bind.note, '仓库今天很平静。'); assert.equal(store.history.length, 2);
    const noModel = await runCard(card, { inputs: { repo: 'vuejs/core' }, run: { ...day('2026-09-28'), modelConfigured: false }, store, fixtures: fx(109) });
    assert.equal(noModel.stats.modelCalls, 0); assert.ok(noModel.stats.skipped.includes('n7'));
    return `${r.bind.value} ★ Δ${r.bind.delta}`;
  },
  async 'rss-digest'() {
    const card = load('rss-digest'); const store = {};
    const rss = { 'https://sspai.com/feed': [{ title: 'A', link: 'https://sspai.com/a', published: '2026-09-28T01:00:00Z', summary: '正文 A', source: '少数派' }], 'https://dev.to/feed': [{ title: 'B', link: 'https://dev.to/b', published: '2026-09-27T01:00:00Z', summary: '正文 B', source: 'DEV' }] };
    let calls = 0;
    const fx = { rss, ai: { n5: (p) => { calls++; return { items: [{ link: 'https://sspai.com/a', summary: 'A 的摘要' }, { link: 'https://fake.example', summary: '编造' }] }; } } };
    let r = await runCard(card, { run: day('2026-09-28'), store, fixtures: fx });
    assert.equal(calls, 1); assert.equal(r.bind.items[0].subtitle, 'A 的摘要'); assert.equal(r.bind.items[1].subtitle, '正文 B'); assert.ok(!('https://fake.example' in store.summaries));
    r = await runCard(card, { run: day('2026-09-28'), store, fixtures: fx });
    assert.equal(r.stats.modelCalls, 1, '只有 B 还没摘要，应再调用 1 次');
    fx.ai.n5 = () => ({ items: [{ link: 'https://dev.to/b', summary: 'B 的摘要' }] });
    r = await runCard(card, { run: day('2026-09-28'), store, fixtures: fx });
    r = await runCard(card, { run: day('2026-09-28'), store, fixtures: fx });
    assert.equal(r.stats.modelCalls, 0); assert.ok(r.stats.skipped.includes('n5'));
    const bad = await runCard(card, { inputs: { feeds: ['https://sspai.com/feed', 'https://36kr.com/feed', 'https://blocked.example/rss'] }, run: day('2026-09-28'), store, fixtures: fx });
    assert.equal(bad.bind.header, '1 个源需要代理，1 个源读取失败'); assert.equal(bad.bind.errors.length, 2);
    assert.deepEqual(bad.notices.map((n) => n.host), ['36kr.com']);
    fx.proxyConfigured = true; fx.rss['https://36kr.com/feed'] = [{ title: 'K', link: 'https://36kr.com/p/1', published: '2026-09-28T02:00:00Z', summary: '快讯', source: '36氪' }];
    const ok = await runCard(card, { inputs: { feeds: ['https://sspai.com/feed', 'https://36kr.com/feed'] }, run: day('2026-09-28'), store, fixtures: fx });
    assert.equal(ok.bind.header, ''); assert.equal(ok.notices.length, 0); assert.equal(ok.bind.items[0].title, 'K');
    return bad.bind.header + ' → 配置代理后正常';
  },

  // ---------- 英文版（PRD F-I18N-06）：同样的夹具思路，run.locale = en-US ----------
  async 'study-plan-en'() {
    const card = load('study-plan-en'); const store = {}; const fx = { ai: { n5: { tasks: [{ text: 'Read chapter 1', minutes: 30, units: 1 }, { text: 'Do exercise 1.1', minutes: 20, units: 0 }] } } };
    const inputs = { goal: 'Finish CS:APP chapters 1-9', totalUnits: 9, deadline: '2026-10-10' };
    let r = await runCard(card, { inputs, run: dayEn('2026-09-28'), store, fixtures: fx });
    assert.equal(r.bind.items[0].text, 'Read chapter 1 (about 30 min)');
    assert.match(r.bind.header, /^Progress 0\/9 chapters \(0%\) · 12 days left · about 0\.75 chapters a day$/);
    store.plan.items[0].done = true;
    r = await runCard(card, { inputs, run: dayEn('2026-09-29'), store, fixtures: fx });
    assert.equal(store.progress.doneUnits, 1); assert.equal(r.bind.header, 'Progress 1/9 chapters (11%) · 11 days left · about 0.73 chapters a day');
    return r.bind.header;
  },
  async 'todo-en'() {
    const card = load('todo-en');
    const store = { todos: { items: [{ id: 'a', text: 'Example: check me off', done: false, priority: 'low' }, { id: 'b', text: 'Example: pay rent', done: false, due: '2026-09-27', priority: 'high' }, { id: 'c', text: 'Example: done item', done: true }] } };
    const r = await runCard(card, { run: dayEn('2026-09-28'), store, fixtures: {} });
    assert.deepEqual(r.bind.items.map((i) => i.id), ['b', 'a', 'c']); assert.equal(r.bind.header, '2 open, 1 overdue'); assert.equal(r.bind.status, 'warn');
    return r.bind.header;
  },
  async 'ai-usage-en'() {
    const card = load('ai-usage-en');
    const usage = { days: [{ date: '2026-09-27', byModel: { 'gpt-x': { calls: 2, inputTokens: 500, outputTokens: 100 } }, byCard: {} }, { date: '2026-09-28', byModel: {}, byCard: {} }], today: { calls: 12, tokens: 4100, searchCalls: 0, callLimit: 200, searchLimit: 30, cost: null } };
    const r = await runCard(card, { run: dayEn('2026-09-28'), store: {}, fixtures: { usage } });
    assert.equal(r.bind.headline, 'Today 12/200 calls · 4,100 tokens · web search 0/30'); assert.equal(r.bind.status, 'normal');
    return r.bind.headline;
  },
  async 'hot-topics-en'() {
    const card = load('hot-topics-en');
    const hn = { match: 'https://hn.algolia.com/api/v1/search', body: { hits: [{ title: 'Show HN: A', url: 'https://a.example', points: 300, num_comments: 120, objectID: '1' }, { title: 'Ask HN: B', url: null, points: 90, num_comments: 80, objectID: '2' }] } };
    let wikiUrl = '';
    const wiki = { match: 'https://en.wikipedia.org/api/rest_v1/feed/featured/', body: (u) => { wikiUrl = u; return { news: [{ story: '<b>x</b>', links: [{ titles: { normalized: '2026 Example Summit' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/2026_Example_Summit' } }, description: 'Diplomatic meeting' }] }], mostread: { articles: [{ title: 'Main_Page', titles: { normalized: 'Main Page' }, views: 9e6, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Main_Page' } } }, { title: 'Special:Search', titles: { normalized: 'Special:Search' }, views: 8e6, content_urls: { desktop: { page: 'x' } } }, { title: 'Lizzie_Borden', titles: { normalized: 'Lizzie Borden' }, views: 421359, description: 'American woman', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Lizzie_Borden' } } }] } }; } };
    // 1) 没有模型：HN 与 Wikipedia 交错显示，过滤掉 Main_Page / Special:
    let r = await runCard(card, { inputs: { count: 5 }, run: { ...dayEn('2026-09-28'), modelConfigured: false }, store: {}, fixtures: { http: [hn, wiki] } });
    assert.equal(wikiUrl, 'https://en.wikipedia.org/api/rest_v1/feed/featured/2026/09/27');
    assert.deepEqual(r.bind.items.map((i) => i.title), ['Show HN: A', '2026 Example Summit', 'Ask HN: B', 'Lizzie Borden']);
    assert.equal(r.bind.items[0].meta, 'Hacker News · 300 points · 120 comments'); assert.equal(r.bind.items[3].meta, 'Wikipedia · 421,359 views');
    assert.equal(r.bind.items[2].url, 'https://news.ycombinator.com/item?id=2'); assert.equal(r.stats.modelCalls, 0);
    // 2) 有模型：只保留网址在候选里的条目（编造的链接被丢掉）
    const ai = { n5: { items: [{ title: 'Summit', summary: 'Leaders met.', url: 'https://en.wikipedia.org/wiki/2026_Example_Summit', source: 'Wikipedia', heat: 'In the news' }, { title: 'Fake', summary: 'x', url: 'https://fake.example', source: 'x', heat: 'x' }] } };
    r = await runCard(card, { inputs: { count: 5 }, run: dayEn('2026-09-28'), store: {}, fixtures: { http: [hn, wiki], ai } });
    assert.deepEqual(r.bind.items.map((i) => i.title), ['Summit']); assert.equal(r.stats.modelCalls, 1);
    // 3) 只看 HN：不请求 Wikimedia
    wikiUrl = '';
    r = await runCard(card, { inputs: { count: 5, region: 'Tech community' }, run: { ...dayEn('2026-09-28'), modelConfigured: false }, store: {}, fixtures: { http: [hn, wiki] } });
    assert.equal(wikiUrl, ''); assert.equal(r.bind.items.length, 2); assert.ok(r.stats.skipped.includes('n3'));
    return 'HN + Wikipedia 交错 → AI 挑选（丢弃编造链接）→ 只看 HN';
  },
  async 'keyword-watch-en'() {
    const card = load('keyword-watch-en'); const store = {};
    const items = [{ keyword: 'Deno', title: 'Deno 3', url: 'https://deno.com/blog/v3?utm_source=x', source: 'Deno', publishedAt: '2026-09-27', summary: '…' }, { keyword: 'Deno', title: 'dup', url: 'https://www.deno.com/blog/v3/', source: 'Deno', publishedAt: '2026-09-27', summary: '…' }];
    let r = await runCard(card, { inputs: { keywords: 'Deno' }, run: dayEn('2026-09-28'), store, fixtures: { ai: { n2: { items } } } });
    assert.equal(r.bind.items.length, 1); assert.equal(r.bind.items[0].badge, 'New'); assert.equal(r.bind.header, '1 new');
    r = await runCard(card, { inputs: { keywords: 'Deno' }, run: dayEn('2026-09-28'), store, fixtures: { ai: { n2: { items } } } });
    assert.equal(r.bind.header, 'Nothing new');
    return r.bind.header;
  },
  async 'daily-brief-en'() {
    const card = load('daily-brief-en');
    const hn = { match: 'https://hn.algolia.com/api/v1/search', body: { hits: [{ title: 'Show HN: X', url: null, points: 100, num_comments: 40, objectID: '1' }] } };
    const meteo = { match: 'https://api.open-meteo.com/v1/forecast', body: { current: { temperature_2m: 21.4, weather_code: 3 }, daily: { temperature_2m_min: [18.2], temperature_2m_max: [25.6], precipitation_probability_max: [40] } } };
    let wttrUrl = '';
    const wttr = { match: 'https://wttr.in/', body: (u) => { wttrUrl = u; return { current_condition: [{ temp_C: '20', weatherDesc: [{ value: 'Light rain' }] }], weather: [{ mintempC: '17', maxtempC: '23' }] }; } };
    const rss = { 'https://dev.to/feed': [{ title: 'DEV post', link: 'https://dev.to/p/1', published: '2026-09-28T00:00:00Z', summary: 'Body', source: 'DEV Community' }] };
    let prompt = ''; const ai = { n7: (p) => { prompt = p; return '**Today**…'; } };
    // 1) 美国英语：华氏；HN + DEV + Open-Meteo 全部直连
    let r = await runCard(card, { run: dayEn('2026-09-28'), store: {}, fixtures: { http: [hn, meteo, wttr], rss, ai } });
    assert.match(prompt, /New York: cloudy, now 71°F, today 65°F to 78°F, 40% chance of precipitation/); assert.match(prompt, /DEV post/); assert.match(prompt, /Write a morning brief in English/);
    assert.equal(r.bind.footer, 'Sources: Hacker News, DEV · Weather Open-Meteo · Updated 08:00'); assert.equal(r.notices.length, 0);
    // 2) 英式英语：摄氏；Open-Meteo 限流 → wttr.in（lang=en）；hnrss 需代理没配 → 跳过并提示
    r = await runCard(card, { inputs: { extraFeeds: ['https://hnrss.org/frontpage'] }, run: { ...dayEn('2026-09-29'), locale: 'en-GB' }, store: {},
      fixtures: { http: [hn, { match: 'https://api.open-meteo.com/', error: 'HTTP 429' }, wttr], rss, ai, knownProxyHosts: ['hnrss.org'] } });
    assert.match(prompt, /New York: Light rain, now 20°C, today 17°C to 23°C/); assert.match(wttrUrl, /^https:\/\/wttr\.in\/New.York\?format=j1&lang=en$/); // 真实运行时按段百分号编码（New%20York），参考运行时不编码
    assert.deepEqual(r.notices, [{ code: 'PROXY_REQUIRED', host: 'hnrss.org', action: 'open-proxy-settings' }]);
    // 3) 全部失败：不调用模型，英文兜底文案
    let calls = 0;
    r = await runCard(card, { run: dayEn('2026-09-30'), store: {}, fixtures: { http: [{ match: 'https://', error: 'TypeError: Failed to fetch' }], rss: {}, ai: { n7: () => { calls++; return ''; } } } });
    assert.equal(r.bind.content, 'None of the news sources returned anything today. Try again later.'); assert.equal(r.bind.status, 'warn'); assert.equal(calls, 0);
    return '°F/°C 按地区 + 天气备用源 + hnrss 代理提示';
  },
  async 'github-repo-en'() {
    const card = load('github-repo-en'); const store = {};
    const fx = (stars) => ({ http: [
      { match: 'https://api.github.com/repos/react/react/releases', body: [{ tag_name: 'v19.3.0', published_at: '2026-09-25T00:00:00Z' }] },
      { match: 'https://api.github.com/repos/react/react/issues', body: [{ title: 'bug A', created_at: '2026-09-27T20:00:00Z' }, { title: 'bug B', created_at: '2026-09-27T21:00:00Z' }] },
      { match: 'https://api.github.com/repos/react/react', body: { stargazers_count: stars, forks_count: 1, open_issues_count: 2, pushed_at: '2026-09-27T10:00:00Z', html_url: 'https://github.com/react/react' } }], ai: { n7: 'Quiet day.' }, cache: {} });
    let r = await runCard(card, { inputs: { repo: 'react/react', showSummary: false }, run: dayEn('2026-09-27'), store, fixtures: fx(250771) });
    r = await runCard(card, { inputs: { repo: 'react/react', showSummary: false }, run: dayEn('2026-09-28'), store, fixtures: fx(250800) });
    assert.equal(r.bind.delta, 29); assert.equal(r.bind.deltaLabel, 'vs yesterday');
    assert.equal(r.bind.note, 'Latest release v19.3.0 (2026-09-25) · 2 new issues in 24h · Last push 2026-09-27');
    return `${r.bind.label} ${r.bind.value} ★ Δ${r.bind.delta}`;
  },
  async 'rss-digest-en'() {
    const card = load('rss-digest-en'); const store = {};
    const rss = { 'https://dev.to/feed': [{ title: 'A', link: 'https://dev.to/a', published: '2026-09-28T01:00:00Z', summary: 'Body A', source: 'DEV Community' }], 'https://dev.to/feed/tag/ai': [{ title: 'B', link: 'https://dev.to/b', published: '2026-09-27T01:00:00Z', summary: 'Body B', source: 'DEV Community: ai' }] };
    const fx = { rss, ai: { n5: () => ({ items: [{ link: 'https://dev.to/a', summary: 'A in one line' }] }) } };
    let r = await runCard(card, { run: dayEn('2026-09-28'), store, fixtures: fx });
    assert.equal(r.bind.items.length, 2); assert.equal(r.bind.items[0].subtitle, 'A in one line'); assert.equal(r.bind.header, '');
    // 演示实例额外加入 hnrss.org /frontpage：没配代理 → 提示条，dev.to 照常
    const feeds = ['https://dev.to/feed', 'https://dev.to/feed/tag/ai', 'https://hnrss.org/frontpage'];
    r = await runCard(card, { inputs: { feeds }, run: dayEn('2026-09-28'), store, fixtures: fx });
    assert.equal(r.bind.header, '1 source needs a proxy'); assert.deepEqual(r.notices.map((n) => n.host), ['hnrss.org']); assert.equal(r.bind.items.length, 2);
    fx.proxyConfigured = true; fx.rss['https://hnrss.org/frontpage'] = [{ title: 'HN', link: 'https://news.ycombinator.com/item?id=9', published: '2026-09-28T03:00:00Z', summary: 'x', source: 'Hacker News' }];
    r = await runCard(card, { inputs: { feeds }, run: dayEn('2026-09-28'), store, fixtures: fx });
    assert.equal(r.bind.header, ''); assert.equal(r.notices.length, 0); assert.equal(r.bind.items[0].title, 'HN');
    return '1 source needs a proxy → 配置代理后正常';
  },
  // schema v1.1 增量约束在参考运行时上的行为（不是示范卡片，用 daily-brief 改出的临时卡片）
  async 'v1.1-body-rule'() {
    const base = load('daily-brief');
    const mk = (headers, body) => { const c = structuredClone(base); Object.assign(c.workflow.steps.find((x) => x.id === 'n1'), { method: 'POST', ...(headers ? { headers } : {}), body, onError: 'continue' }); return c; };
    const hn = { match: 'https://hn.algolia.com/api/v1/search', body: { hits: [] } };
    const fx = (proxy) => ({ http: [hn, { match: 'https://api.open-meteo.com/', body: {} }, { match: 'https://wttr.in/', body: {} }], rss: {}, ai: { n7: 'x' }, proxyConfigured: proxy, usage: { days: [], today: {} } });
    const req = (r) => r.stats.requests.find((q) => q.step === 'n1');
    // 1) 字符串 body + Content-Type: application/json → 直连
    let r = await runCard(mk({ 'Content-Type': 'application/json' }, '{"q":"x"}'), { run: day('2026-09-28'), store: {}, fixtures: fx(false) });
    assert.deepEqual([req(r).contentType, req(r).transport], ['application/json', 'direct']); assert.equal(r.notices.length, 0);
    // 2) 省略 Content-Type → 平台补 application/json，照常直连（字符串和对象 body 都一样），没有提示条
    r = await runCard(mk(null, '{"q":"x"}'), { run: day('2026-09-28'), store: {}, fixtures: fx(false) });
    assert.deepEqual([req(r).contentType, req(r).transport], ['application/json', 'direct']); assert.equal(r.notices.length, 0);
    r = await runCard(mk(null, { q: 'x' }), { run: day('2026-09-28'), store: {}, fixtures: fx(false) });
    assert.deepEqual([req(r).contentType, req(r).transport], ['application/json', 'direct']); assert.equal(r.notices.length, 0);
    // 3) text/plain、没有代理 → 不发请求，PROXY_REQUIRED；onProxyMissing=fail 时步骤失败
    r = await runCard(mk({ 'Content-Type': 'text/plain;charset=utf-8' }, 'x'), { run: day('2026-09-28'), store: {}, fixtures: fx(false) });
    assert.equal(req(r).transport, 'proxy'); assert.deepEqual(r.notices.map((n) => n.host), ['hn.algolia.com']);
    const failCard = mk({ 'Content-Type': 'multipart/form-data; boundary=x' }, 'x'); Object.assign(failCard.workflow.steps.find((x) => x.id === 'n1'), { onProxyMissing: 'fail' });
    r = await runCard(failCard, { run: day('2026-09-28'), store: {}, fixtures: fx(false) });
    assert.ok(r.stats.errors.some((e) => /n1: PROXY_REQUIRED/.test(e)));
    // 3b) 配置了代理 → 经代理，没有提示条
    r = await runCard(mk({ 'Content-Type': 'text/plain' }, 'x'), { run: day('2026-09-28'), store: {}, fixtures: fx(true) });
    assert.equal(req(r).transport, 'proxy'); assert.equal(r.notices.length, 0);
    // 4) GET 不受影响
    r = await runCard(structuredClone(base), { run: day('2026-09-28'), store: {}, fixtures: fx(false) });
    assert.deepEqual([req(r).contentType, req(r).transport], [null, 'direct']);
    return 'JSON 直连 · 省略类型补 application/json 直连 · 简单类型只走代理（无代理 PROXY_REQUIRED，onProxyMissing 生效）· GET 不受影响';
  },
};

let failed = 0;
console.log('== 示范卡片 dry-run（夹具数据） ==');
for (const [id, fn] of Object.entries(scenarios)) {
  try { const note = await fn(); console.log(`通过  ${id}  → ${note}`); }
  catch (e) { failed++; console.log(`失败  ${id}：${e.message}`); }
}
console.log(`\n结果：${Object.keys(scenarios).length - failed}/${Object.keys(scenarios).length} 通过`);
process.exit(failed ? 1 : 0);
