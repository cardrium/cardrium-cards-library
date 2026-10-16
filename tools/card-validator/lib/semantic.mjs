// 跨字段语义校验：JSON Schema 表达不了的规则都在这里。
// 前提：卡片已通过 card-schema-v1.json 的结构校验。
import { extractRefs, wholeRef, firstRefIndex, RUN_VARS, RESERVED_IDS } from './refs.mjs';
import { parsePattern, analyzeUrlTemplate, matchPattern, hostRisk, wildcardRisk, isTunnelHost } from './netmatch.mjs';
import { parseExpr, rootNames, forbiddenFunctions } from './expr.mjs';
import { checkCode } from './codecheck.mjs';
import { markupIssue, bindMarkupIssue, linkIssue, dangerousSchemePrefix, markdownTargets, SECRET_PARAM_NAMES, hasLiteral, queryParams, fragmentParams, SECRET_INPUT_WORDS } from './textcheck.mjs';

// 平台常量（PRD v0.2 F-ND-01 / F-CO-01 建议值）
export const INTERVAL_MIN = { plain: 5, model: 15, search: 60 };

const FORBIDDEN_HEADERS = /^(cookie|cookie2|set-cookie|host|origin|referer|user-agent|content-length|connection|keep-alive|transfer-encoding|upgrade|te|trailer|expect|date|via|dnt|proxy-connection|sec-.*|access-control-.*)$/i;
// 平台按主机的限流策略（与 INTERFACE-CONTRACT 3.7 一致；不是卡片字段，这里只用于给出提前警告）
export const HOST_POLICIES = { 'api.github.com': { minIntervalMinutes: 30, reason: 'GitHub 匿名每 IP 每小时 60 次，所有 GitHub 卡片共用' } };
const ALLOWED_HEADERS = /^(accept|accept-language|content-type)$/i;
// schema v1.1 增量约束（技术负责人拍板，2026-10-05）：直连模式下非 GET/HEAD 请求必须触发 CORS 预检，
// 所以不能用这三种"简单请求"内容类型，也不能省略 Content-Type（省略时平台按 application/json 发送）。
// 只按 MIME 本体（分号前、去空白、不区分大小写）判断，"text/plain; charset=utf-8" 同样算简单类型。
export const SIMPLE_CONTENT_TYPES = new Set(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']);
export const mimeEssence = (v) => String(v).split(';')[0].trim().toLowerCase();
const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|private-token)$/i;
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic Key'],
  [/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/, 'sk- 开头的 Key（OpenAI / DeepSeek / 通义千问 / Kimi / 硅基流动等）'],
  [/\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/, '智谱 API Key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API Key'],
  [/gh[pousr]_[A-Za-z0-9]{36}/, 'GitHub Token'],
  [/github_pat_[A-Za-z0-9_]{22,}/, 'GitHub Token'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack Token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS Access Key'],
  [/Bearer\s+(?!\{\{)[A-Za-z0-9._~+/-]{20,}/, 'Bearer 令牌'],
];
// 步骤顶层中不按模板扫描的字段
const NON_TEMPLATE_FIELDS = new Set(['id', 'type', 'name', 'description', 'source', 'jsonShape', 'expr', 'if', 'then', 'bind', 'enabledIf']);

const esc = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
function walkStrings(node, ptr, cb) {
  if (typeof node === 'string') return cb(node, ptr);
  if (Array.isArray(node)) return node.forEach((v, i) => walkStrings(v, `${ptr}/${i}`, cb));
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walkStrings(v, `${ptr}/${esc(k)}`, cb);
}
const isExprBinding = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.expr === 'string';
const isExprBindingPath = (ptr) => ptr.endsWith('/expr');

/**
 * @param card 已通过结构校验的卡片
 * @param validateBind (component, bind) => [{path, message}]，由调用方用 schema 的 $defs/<component>Bind 实现
 */
export function semanticCheck(card, validateBind) {
  const out = [];
  const err = (code, path, message) => out.push({ level: 'error', code, path, message });
  const warn = (code, path, message) => out.push({ level: 'warning', code, path, message });

  const perms = card.permissions;
  const steps = card.workflow.steps;
  const trigger = card.workflow.trigger;
  const inputs = new Map();
  const secretInputs = new Map();   // 看起来在要 Key/令牌的参数 key -> 路径

  // 展示文字：不允许任何 HTML 结构（VAL-04）
  const checkText = (text, ptr) => { const m = markupIssue(text); if (m) err('E_TEXT_MARKUP', ptr, `文字里不允许出现${m}；所有文字都按纯文本显示，写 HTML 没有意义，还可能被利用`); };
  // 查询串 / 请求体里的凭据参数（VAL-07）
  const checkSecretParams = (url, ptr) => {
    for (const [k, v] of queryParams(url)) if (SECRET_PARAM_NAMES.test(k) && hasLiteral(v))
      err('E_SECRET_PARAM', ptr, `网址参数 ${k}= 带有字面量值，疑似 Key/令牌/签名。模板里不允许出现任何凭据（导入者会共用它，泄露后无法收回）；v1 请使用无需凭据的公开接口`);
    for (const [k, v] of fragmentParams(url)) if (SECRET_PARAM_NAMES.test(k) && hasLiteral(v))
      err('E_SECRET_PARAM', ptr, `网址片段（# 后面）的参数 ${k}= 带有字面量值，疑似 Key/令牌。片段虽然不随请求发出，但它写在模板里、所有导入者共享，同样不允许（VAL-17）`);
  };
  // 请求体里的凭据（VAL-07）。ct 是 Content-Type 的 MIME 本体；缺省时字符串 body 按 application/json 发送（schema v1.1 增量约束）。
  // 只有经代理的步骤才可能是 form-urlencoded / multipart / text/plain；为了纵深防御，解析不成 JSON 的字符串仍按 key=value 扫一遍。
  const checkSecretBody = (body, ptr, ct = 'application/json') => {
    if (typeof body === 'string') {
      let parsed; try { parsed = JSON.parse(body); } catch { /* 不是 JSON */ }
      if (parsed && typeof parsed === 'object') return checkSecretBody(parsed, ptr);
      if (ct === 'multipart/form-data') for (const [, k, v] of body.matchAll(/name="([^"]+)"\r?\n(?:[^\r\n]*\r?\n)*?\r?\n([^\r\n]*)/g))
        if (SECRET_PARAM_NAMES.test(k) && hasLiteral(v)) err('E_SECRET_PARAM', ptr, `请求体表单字段 ${k} 带有字面量值，疑似凭据`);
      if (body.includes('=')) for (const [k, v] of queryParams('?' + body)) if (SECRET_PARAM_NAMES.test(k) && hasLiteral(v))
        err('E_SECRET_PARAM', ptr, `请求体参数 ${k}= 带有字面量值，疑似凭据${ct === 'application/x-www-form-urlencoded' ? '' : '（按 key=value 形式检查）'}`);
      return;
    }
    if (Array.isArray(body)) return body.forEach((v, i) => checkSecretBody(v, `${ptr}/${i}`, ct));
    if (body && typeof body === 'object') for (const [k, v] of Object.entries(body)) {
      if (SECRET_PARAM_NAMES.test(k) && (typeof v === 'number' || (typeof v === 'string' && hasLiteral(v))))
        err('E_SECRET_PARAM', `${ptr}/${esc(k)}`, `请求体字段 ${k} 带有字面量值，疑似 Key/令牌/密码。模板里不允许出现任何凭据`);
      else checkSecretBody(v, `${ptr}/${esc(k)}`, ct);
    }
  };

  // ---------- 元信息和展示文字 ----------
  for (const f of ['name', 'description', 'author']) if (typeof card.meta[f] === 'string') checkText(card.meta[f], `/meta/${f}`);
  (card.meta.tags || []).forEach((t, k) => checkText(t, `/meta/tags/${k}`));
  if (typeof card.meta.homepage === 'string') {
    // VAL-05：只接受规范的 https 网址（schema 已限制字符集，这里再做语义解析）
    let u = null; try { u = new URL(card.meta.homepage); } catch { /* 下面报错 */ }
    const risk = u ? hostRisk(u.hostname) : null;
    if (!u || u.protocol !== 'https:' || u.username || u.password || risk || u.href.replace(/\/$/, '') !== card.meta.homepage.replace(/\/$/, ''))
      err('E_URL_FORMAT', '/meta/homepage', `homepage 必须是规范的公网 https 网址（不带用户名密码、不含需要转义的字符）${risk ? '：' + risk.reason : ''}`);
  }
  walkStrings(card.display, '/display', (str, ptr) => checkText(str, ptr));

  // ---------- 参数 ----------
  card.inputs.forEach((inp, i) => {
    const p = `/inputs/${i}`;
    if (inputs.has(inp.key)) err('E_DUP_INPUT_KEY', `${p}/key`, `参数 key "${inp.key}" 重复`);
    inputs.set(inp.key, inp);
    if (inp.type === 'select' && inp.default !== undefined && !inp.options.some((o) => o.value === inp.default))
      err('E_INPUT_DEFAULT', `${p}/default`, `默认值 "${inp.default}" 不在可选项中`);
    if (inp.min !== undefined && inp.max !== undefined && inp.min > inp.max) err('E_INPUT_RANGE', p, 'min 大于 max');
    if (inp.type === 'number' && typeof inp.default === 'number' &&
      ((inp.min !== undefined && inp.default < inp.min) || (inp.max !== undefined && inp.default > inp.max)))
      err('E_INPUT_DEFAULT', `${p}/default`, '默认值超出 min/max 范围');
    if (inp.options && inp.type !== 'select') warn('W_INPUT_IGNORED', `${p}/options`, '只有 select 类型使用 options');
    if (inp.type === 'url-list' && Array.isArray(inp.default)) inp.default.forEach((u, k) => {
      const info = typeof u === 'string' ? analyzeUrlTemplate(u, -1) : { ok: false, code: 'E_INPUT_DEFAULT', reason: '不是字符串' };
      if (!info.ok) err(info.code === 'E_NET_TEMPLATED_HOST' ? 'E_INPUT_DEFAULT' : info.code, `${p}/default/${k}`, `默认网址 ${u}：${info.reason}`);
      checkSecretParams(u, `${p}/default/${k}`);
    });
    // 展示给用户的文字（VAL-04）
    for (const f of ['label', 'help', 'placeholder']) if (typeof inp[f] === 'string') checkText(inp[f], `${p}/${f}`);
    (inp.options || []).forEach((o, k) => { if (typeof o.label === 'string') checkText(o.label, `${p}/options/${k}/label`); if (typeof o.value === 'string') checkText(o.value, `${p}/options/${k}/value`); });
    if (typeof inp.default === 'string') checkText(inp.default, `${p}/default`);
    // 诱导用户填写 Key 的参数（VAL-09）：v1 不支持数据源凭据，模板不能让用户填 Key 或令牌
    const said = [inp.key, inp.label, inp.help, inp.placeholder].filter((x) => typeof x === 'string').join(' ');
    if (SECRET_INPUT_WORDS.test(said) || SECRET_PARAM_NAMES.test(inp.key)) secretInputs.set(inp.key, p);
  });

  // ---------- 网络权限声明 ----------
  const usedHosts = new Set();   // 步骤实际访问的主机（用于主机策略提示）
  const patterns = [];           // 字面量网址模式
  const inputGrants = new Map(); // "{{inputs.x}}" 声明
  perms.network.forEach((entry, i) => {
    const p = `/permissions/network/${i}`;
    const raw = typeof entry === 'string' ? entry : entry.pattern;
    const wr = typeof entry === 'string' ? wholeRef(raw) : null;
    if (wr) {
      const inp = wr.root === 'inputs' && !wr.rest ? inputs.get(wr.name) : null;
      if (!inp) err('E_NET_INPUT_UNKNOWN', p, `网络声明引用了不存在的参数 ${raw}`);
      else if (inp.type !== 'url-list') err('E_NET_INPUT_TYPE', p, `网络声明 ${raw} 只能引用 url-list 类型参数`);
      inputGrants.set(wr.name, { index: i, used: false });
      return;
    }
    const pat = parsePattern(raw);
    if (!pat) { err('E_NET_PATTERN', p, `网址模式 "${raw}" 无法解析`); return; }
    if (pat.scheme !== 'https:') { err('E_NET_PATTERN', p, `网址模式 "${raw}" 只允许 https`); return; }
    const risk = hostRisk(pat.host);
    if (risk) { err(risk.code, p, `网址模式 "${raw}"：${risk.reason}。本地服务（如 Ollama）只能在「设置 → 模型渠道」里配置，不能写进卡片权限`); return; }
    const wr2 = wildcardRisk(raw);
    if (wr2) { err(wr2.code, p, wr2.reason); return; }
    if (isTunnelHost(pat.host)) warn('W_NET_TUNNEL_HOST', p, `${pat.host} 属于免费隧道 / 托管 / 请求收集服务，地址可能随时换主人；请人工确认这是作者自己的服务`);
    patterns.push({ pat, index: i, used: false, requires: typeof entry === 'object' ? entry.requires : undefined });
  });

  // ---------- 步骤 id ----------
  const idIndex = new Map();
  steps.forEach((s, i) => {
    const p = `/workflow/steps/${i}/id`;
    if (RESERVED_IDS.has(s.id)) err('E_STEP_ID_RESERVED', p, `步骤 id 不能用保留字 "${s.id}"`);
    if (idIndex.has(s.id)) err('E_DUP_STEP_ID', p, `步骤 id "${s.id}" 重复`);
    else idIndex.set(s.id, i);
  });
  const lastIdx = steps.length - 1;
  steps.forEach((s, i) => { if (s.type === 'output' && i !== lastIdx) err('E_OUTPUT_NOT_LAST', `/workflow/steps/${i}`, 'output 步骤必须是最后一步'); });

  const active = steps.filter((s) => !s.disabled);
  const count = (t) => active.filter((s) => s.type === t).length;
  const nAi = count('ai');
  const nSearch = count('ai_search');
  const nModel = nAi + nSearch;
  const hasCode = count('code') > 0;
  // permissions.code 必须与"是否含代码步骤"完全一致（包括 disabled 的代码步骤：用户在编辑器里随时可以打开它）。
  // 平台据此做导入提示，以及 Safari v1 禁止导入/运行含代码卡片（技术负责人第二轮拍板 F8）。
  const hasCodeAny = steps.some((s) => s.type === 'code');
  // 权限一致性按**全部步骤**统计（VAL-01）：被停用的步骤照样随模板分发，用户随时可以在编辑器里重新打开。
  // "是否实际执行、计费"（上限、预估、间隔下限）才用 active。
  const nModelAll = steps.filter((s) => s.type === 'ai' || s.type === 'ai_search').length;
  const storageAll = steps.filter((s) => s.type === 'storage' && s.scope !== 'platform.usage').length;
  const usageAll = steps.some((s) => s.type === 'storage' && s.scope === 'platform.usage');
  const output = steps.find((s) => s.type === 'output');
  const component = card.display.component;

  // 引用检查：模板
  const checkRef = (r, i, ptr) => {
    if (r.root === 'step') {
      const j = idIndex.get(r.name);
      if (j === undefined) err('E_REF_UNKNOWN_STEP', ptr, `引用了不存在的步骤 "${r.name}"（${r.raw}）`);
      else if (j >= i) err('E_REF_FORWARD', ptr, `只能引用前面步骤的输出，"${r.name}" 在当前步骤之后或就是自身（${r.raw}）`);
    } else if (r.root === 'inputs') {
      if (!inputs.has(r.name)) err('E_REF_UNKNOWN_INPUT', ptr, `引用了未定义的参数 "${r.name}"（${r.raw}）`);
    } else if (!RUN_VARS.includes(r.name)) {
      err('E_REF_UNKNOWN_RUNVAR', ptr, `未知运行变量 run.${r.name}，可用：${RUN_VARS.join(', ')}`);
    }
  };
  const checkTemplate = (str, i, ptr) => {
    const { refs, errors } = extractRefs(str);
    errors.forEach((e) => err('E_REF_SYNTAX', ptr, `引用 ${e.raw} 语法错误：${e.reason}`));
    refs.forEach((r) => checkRef(r, i, ptr));
  };
  // 引用检查：JSONata 表达式
  const checkExpr = (src, i, ptr) => {
    const { ast, error } = parseExpr(src);
    if (error) { err('E_EXPR_SYNTAX', ptr, `表达式语法错误：${error}`); return; }
    for (const b of forbiddenFunctions(ast)) err('E_EXPR_FORBIDDEN_FN', ptr, b.reason);
    for (const { name } of rootNames(ast)) {
      if (name === 'inputs' || name === 'run') continue;
      const j = idIndex.get(name);
      if (j === undefined) err('E_EXPR_UNKNOWN_REF', ptr, `表达式在根上下文引用了 "${name}"，它既不是前面的步骤 id，也不是 inputs/run（内层条件里访问根请用 $$.${name}）`);
      else if (j >= i) err('E_REF_FORWARD', ptr, `表达式引用了后面的步骤 "${name}"`);
    }
  };
  // 网址检查
  const checkUrl = (url, ptr) => {
    const wr = wholeRef(url);
    if (wr) {
      const g = wr.root === 'inputs' && !wr.rest ? inputGrants.get(wr.name) : null;
      if (!g) err('E_NET_INPUT_NOT_GRANTED', ptr, `网址整体来自 ${url}，但 permissions.network 中没有声明 "${url}"`);
      else {
        g.used = true;
        // 参数默认值命中的字面量模式也算“被使用”（导入确认页把默认源和“你之后填写的网址”一起展示）
        for (const u of inputs.get(wr.name)?.default || []) {
          const info = analyzeUrlTemplate(u, -1);
          if (info.ok) patterns.forEach((pp) => { if (matchPattern(info, pp.pat)) pp.used = true; });
        }
      }
      return [];   // 用户填写的网址：静态无法知道走不走代理，按直连处理
    }
    const info = analyzeUrlTemplate(url, firstRefIndex(url));
    if (!info.ok) { err(info.code, ptr, `${info.reason}：${url}`); return []; }
    const hit = patterns.filter((pp) => matchPattern(info, pp.pat));
    if (hit.length === 0) err('E_NOT_DECLARED', ptr, `网址 ${url} 未在 permissions.network 中声明（或无法静态证明落在已声明范围内）`);
    hit.forEach((pp) => { pp.used = true; });
    usedHosts.add(info.host);
    if (hit.some((pp) => pp.requires === 'proxy')) warn('W_NEEDS_PROXY', ptr, `来源 ${url} 需要代理：用户未配置代理时按 onProxyMissing 降级（缺省显示“此来源需要代理 · 去设置”）`);
    return hit;
  };

  steps.forEach((s, i) => {
    const sp = `/workflow/steps/${i}`;
    for (const [k, v] of Object.entries(s)) if (!NON_TEMPLATE_FIELDS.has(k)) walkStrings(v, `${sp}/${esc(k)}`, (str, ptr) => checkTemplate(str, i, ptr));
    for (const f of ['name', 'description']) if (typeof s[f] === 'string') checkText(s[f], `${sp}/${f}`);
    // 用户可能被诱导填写的 Key 被发到网络上（VAL-09）
    if (s.type === 'http' || s.type === 'rss' || s.type === 'ai' || s.type === 'ai_search') walkStrings(s, sp, (str, ptr) => {
      for (const r of extractRefs(str).refs) if (r.root === 'inputs' && secretInputs.has(r.name))
        err('E_INPUT_SECRET', ptr, `参数 ${r.name} 看起来是在让用户填写 Key/令牌/密码（${secretInputs.get(r.name)}），并被发送出去。v1 不支持数据源凭据（P1 由平台设置统一管理，卡片代码永远看不到）；模板不能要求用户填写凭据`);
    });

    if (s.enabledIf !== undefined) {
      if (isExprBinding(s.enabledIf)) checkExpr(s.enabledIf.expr, i, `${sp}/enabledIf/expr`);
      else checkTemplate(s.enabledIf, i, `${sp}/enabledIf`);
    }
    switch (s.type) {
      case 'http':
        const hits = checkUrl(s.url, `${sp}/url`) || [];
        checkSecretParams(s.url, `${sp}/url`);
        // schema v1.1 增量约束：请求体类型（技术负责人 2026-10-05：声明简单类型一律报错，requires: "proxy" 的来源也不例外；省略时平台补 application/json，只警告）。
        const ctKey = Object.keys(s.headers || {}).find((h) => /^content-type$/i.test(h));
        const ctRaw = ctKey ? s.headers[ctKey] : undefined;
        const ct = ctRaw === undefined ? 'application/json' : mimeEssence(ctRaw);
        const method = (s.method ?? 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          // 统一规则（技术负责人措辞：不允许省略 Content-Type + 字符串 body 默认按 application/json 发送）：
          // 线上的请求永远带 Content-Type。卡片省略时平台补 application/json，只给警告；声明简单类型一律报错（没有经代理的例外），
          // 运行时对仍然出现的简单类型请求（例如代码步骤的 net.fetch）只走代理，没有代理返回 PROXY_REQUIRED。
          const ctp = `${sp}/headers/${esc(ctKey || 'Content-Type')}`;
          if (ctRaw !== undefined && /\{\{/.test(ctRaw))
            err('E_HTTP_CONTENT_TYPE', ctp, `${method} 请求的 Content-Type 必须是字面量（schema v1.1 增量约束）：模板值可能在运行时变成 text/plain 等简单类型，绕过 CORS 预检`);
          else if (ctRaw === undefined)
            warn('W_HTTP_CONTENT_TYPE_DEFAULTED', ctp, `${method} 请求没写 Content-Type：平台会按 application/json 发送（字符串 body 原样作为请求体，对象和数组按 JSON 序列化），请求一定带 Content-Type、会触发 CORS 预检。建议显式写 "Content-Type": "application/json"`);
          else if (SIMPLE_CONTENT_TYPES.has(ct))
            err('E_HTTP_SIMPLE_CONTENT_TYPE', ctp, `${method} 请求不能使用 ${ct}（schema v1.1 增量约束）：这是浏览器的“简单请求”类型，不会触发 CORS 预检，本机或内网服务即使不允许本站访问也会收到并执行这次写操作。请用 JSON（对象、数组或 JSON 字符串）并写 Content-Type: application/json，或者不写（平台按 application/json 发送）。来源声明为 requires: "proxy" 也一样报错；运行时这类请求只会经代理发出，没有代理返回 PROXY_REQUIRED`);
          if (typeof s.body === 'string' && !/\{\{/.test(s.body) && ct === 'application/json') {
            let okJson = true; try { JSON.parse(s.body); } catch { okJson = false; }
            if (!okJson) warn('W_HTTP_BODY_NOT_JSON', `${sp}/body`, '字符串 body 按 application/json 发送，但这段内容不是合法 JSON；建议直接写成 JSON 对象或数组');
          }
        }
        if (s.body !== undefined) checkSecretBody(s.body, `${sp}/body`, ct);
        for (const [h, v] of Object.entries(s.headers || {})) {
          const hp = `${sp}/headers/${esc(h)}`;
          if (FORBIDDEN_HEADERS.test(h)) err('E_HEADER_FORBIDDEN', hp, `不允许设置请求头 ${h}`);
          else if (!ALLOWED_HEADERS.test(h)) err('E_HEADER_NOT_ALLOWED', hp, SENSITIVE_HEADERS.test(h)
            ? `v1 不支持凭据类请求头 ${h}（secret 参数为 P1）；请使用无需凭据的公开接口`
            : `v1 只允许 Accept、Accept-Language、Content-Type 请求头；自定义头 ${h} 会触发预检，部分服务（如 Google）遇到未知头直接拒绝`);
        }
        if ((s.method ?? 'GET') === 'GET' && s.body !== undefined) err('E_HTTP_BODY_ON_GET', `${sp}/body`, 'GET 请求不能带 body');
        break;
      case 'rss':
        if (typeof s.urls === 'string') checkUrl(s.urls, `${sp}/urls`);
        else s.urls.forEach((u, k) => { checkUrl(u, `${sp}/urls/${k}`); checkSecretParams(u, `${sp}/urls/${k}`); });
        break;
      case 'ai': case 'ai_search':
        if (s.jsonShape && (s.outputFormat ?? 'text') !== 'json') warn('W_JSONSHAPE_IGNORED', `${sp}/jsonShape`, 'jsonShape 只在 outputFormat=json 时生效');
        if (s.outputFormat === 'json' && !s.jsonShape) warn('W_JSONSHAPE_MISSING', sp, 'outputFormat=json 时建议提供 jsonShape，生成与解析更稳定');
        if (s.type === 'ai' && s.model?.needs?.includes('web_search')) err('E_AI_NEEDS_SEARCH', `${sp}/model/needs`, '需要联网搜索请使用 ai_search 步骤');
        break;
      case 'transform':
        checkExpr(s.expr, i, `${sp}/expr`);
        break;
      case 'code': {
        // acorn 语法解析（VAL-10）；属于提示性的纵深防御，真正的边界是沙箱运行时
        const r = checkCode(s.source);
        r.errors.forEach((e) => err(e.code, `${sp}/source`, e.message));
        (r.warnings || []).forEach((w) => warn(w.code, `${sp}/source`, w.message));
        for (const u of r.urls) {
          const info = analyzeUrlTemplate(u, /^https:\/\/[^/?#]+$/i.test(u) ? -1 : u.length);
          if (!info.ok) { err(info.code === 'E_NET_TEMPLATED_HOST' || info.code === 'E_NET_BAD_URL' ? 'E_NOT_DECLARED' : info.code, `${sp}/source`, `代码里的网址 ${u}：${info.reason}`); continue; }
          const hit = patterns.filter((pp) => matchPattern({ ...info, pathComplete: false }, pp.pat) || matchPattern(info, pp.pat));
          if (!hit.length && !inputGrants.size) err('E_NOT_DECLARED', `${sp}/source`, `代码里的网址 ${u} 没有在 permissions.network 中声明（运行时 platform.net.fetch 同样会返回 NOT_DECLARED）`);
          hit.forEach((pp) => { pp.used = true; });
        }
        break;
      }
      case 'condition':
        warn('W_CONDITION_RUNTIME', sp, 'condition 步骤的格式在 v1 已固定，但运行时是 M1 的 P1：不支持它的平台版本导入时会明确提示“当前版本暂不支持条件步骤”，不会静默跳过；官方示范卡片不依赖它');
        checkExpr(s.if, i, `${sp}/if`);
        if (s.then.action === 'skipTo') {
          const j = idIndex.get(s.then.step);
          if (j === undefined || j <= i) err('E_SKIP_TARGET', `${sp}/then/step`, `skipTo 必须指向后面已存在的步骤（"${s.then.step}"）`);
        }
        break;
      case 'storage':
        if (s.scope === 'platform.usage' && !perms.usage) err('E_PERM_USAGE', `${sp}/scope`, '读取 platform.usage 需要声明 permissions.usage: true');
        break;
      case 'output':
        for (const [k, v] of Object.entries(s.bind)) {
          const bp = `${sp}/bind/${esc(k)}`;
          if (isExprBinding(v)) checkExpr(v.expr, i, `${bp}/expr`);
          else if (typeof v === 'string') checkTemplate(v, i, bp);
        }
        // 绑定里的字面量文字和链接（VAL-06）。运行时渲染层仍然对所有 href 做协议白名单、markdown 不渲染图片
        walkStrings(s.bind, `${sp}/bind`, (str, ptr) => {
          if (isExprBindingPath(ptr)) return;
          const literal = str.replace(/\{\{[^}]*\}\}/g, '\u0000');
          const lit0 = literal.split('\u0000')[0];
          const sch = dangerousSchemePrefix(lit0);
          if (sch && lit0.trim()) err('E_LINK_SCHEME', ptr, `绑定值以 ${sch}: 开头，不允许；链接只允许 https:（和 mailto:）`);
          const key = ptr.split('/').pop();
          if (/^(link|url|href)$/i.test(key) && lit0.trim() && !sch) { const li = linkIssue(lit0 + (literal.includes('\u0000') ? 'x' : '')); if (li) err('E_LINK_SCHEME', ptr, `${key} 的值：${li}`); }
          const bm = bindMarkupIssue(literal.replace(/\u0000/g, ''));
          if (bm) err('E_TEXT_MARKUP', ptr, `绑定的字面量文字里不允许出现${bm}（所有内容按纯文本或白名单 markdown 渲染）`);
          const md = markdownTargets(literal);
          if (md.images) err('E_MARKDOWN_IMAGE', ptr, 'v1 的 markdown 不渲染图片；图片网址还可能把数据带到外部（例如 ![x](https://…?d={{…}})），请删除图片语法');
          for (const t of md.links) if (t && !t.startsWith('\u0000')) { const li = linkIssue(t.replace(/\u0000.*$/, 'x')); if (li) err('E_LINK_SCHEME', ptr, `markdown 链接 ${t.replace(/\u0000/g, '{{…}}')}：${li}`); }
        });
        break;
      default:
    }
  });

  // ---------- 展示组件绑定 ----------
  if (output) {
    const oi = steps.indexOf(output);
    for (const e of validateBind(component, output.bind)) err('E_BIND', `/workflow/steps/${oi}/bind${e.path}`, `${component} 组件绑定：${e.message}`);
    if (component === 'todo' && !perms.storage) err('E_PERM_STORAGE', '/permissions/storage', '待办组件需要回写存储，permissions.storage 必须为 true');
  }

  // ---------- 权限一致性（平台推导 vs 声明） ----------
  if (nModelAll > 0 && !perms.model) err('E_PERM_MODEL', '/permissions/model', `工作流含 ${nModelAll} 个 AI 步骤（包括已停用的），但 permissions.model 为 false`);
  if (hasCodeAny && !perms.code) err('E_PERM_CODE', '/permissions/code', '工作流含代码步骤（包括已停用的），但 permissions.code 为 false（声明与内容不符）');
  if (!hasCodeAny && perms.code) err('E_PERM_CODE', '/permissions/code', 'permissions.code 为 true，但工作流没有代码步骤（声明与内容不符；平台按这个字段决定导入提示和 Safari 是否可用）');
  if (storageAll > 0 && !perms.storage) err('E_PERM_STORAGE', '/permissions/storage', '工作流含存储步骤（包括已停用的），但 permissions.storage 为 false');
  if (perms.model && nModelAll === 0 && !hasCodeAny) warn('W_PERM_UNUSED', '/permissions/model', '声明了 model 但没有用到');
  if (perms.storage && storageAll === 0 && component !== 'todo' && !hasCodeAny) warn('W_PERM_UNUSED', '/permissions/storage', '声明了 storage 但没有用到');
  if (perms.usage && !usageAll && !hasCodeAny) warn('W_PERM_UNUSED', '/permissions/usage', '声明了 usage 但没有用到');
  const inputGrantUsed = [...inputGrants.values()].some((g) => g.used);
  {
    // VAL-13 复核（2026-10-15）：含代码的卡片也检查 W_NET_UNUSED（以前跳过，代码里用非字面量网址就能让多余声明不被发现；
    // 非字面量网址另报 W_CODE_DYNAMIC_URL）。
    // 有生效的 {{inputs.x}} 授权时，未被步骤直接使用的字面量模式视为“预先声明的常用源”（用户填写它们时不需要再确认域名），不警告
    // 带 note 的对象条目是作者写明用途的预先声明（例如重定向目标 https://api.github.com/repositories/*），不警告
    const noted = (i) => { const e = perms.network?.[i]; return !!(e && typeof e === 'object' && e.note); };
    if (!inputGrantUsed) patterns.forEach((pp) => { if (!pp.used && !noted(pp.index)) warn('W_NET_UNUSED', `/permissions/network/${pp.index}`, `网址模式 ${pp.pat.raw} 没有被任何步骤使用`); });
    inputGrants.forEach((g, k) => { if (!g.used) warn('W_NET_UNUSED', `/permissions/network/${g.index}`, `{{inputs.${k}}} 没有被任何步骤使用`); });
  }

  // ---------- 费用：限制与预估 ----------
  // 规则：modelCallsPerRun = 0 ⇔ 卡片从不调用模型 ⇔ 没有 ai/ai_search 步骤且 permissions.model = false。
  // 不用模型的卡片可以省略 limits（按 0 处理）；用模型的卡片必须写 ≥ AI 步骤数（且 ≥1）。
  const mayCallModel = nModelAll > 0 || perms.model;
  const lim = card.limits || {};
  const effRun = lim.modelCallsPerRun ?? (mayCallModel ? undefined : 0);
  if (!mayCallModel) {
    if (lim.modelCallsPerRun > 0) err('E_LIMIT_MODEL_MISMATCH', '/limits/modelCallsPerRun', `卡片不调用模型（没有 AI 步骤且 permissions.model=false），modelCallsPerRun 只能是 0 或省略，当前为 ${lim.modelCallsPerRun}`);
    if (lim.modelCallsPerDay !== undefined) err('E_LIMIT_MODEL_MISMATCH', '/limits/modelCallsPerDay', '卡片不调用模型，不能设置 modelCallsPerDay');
  } else if (lim.modelCallsPerRun === 0) {
    err('E_LIMIT_MODEL_MISMATCH', '/limits/modelCallsPerRun', nModel > 0
      ? `modelCallsPerRun=0 表示卡片从不调用模型，但工作流含 ${nModel} 个 AI 步骤`
      : 'modelCallsPerRun=0 表示卡片从不调用模型，但 permissions.model 为 true（请把 model 改为 false，或给出 ≥1 的上限）');
  } else if (mayCallModel) {
    if (lim.modelCallsPerRun === undefined) err('E_LIMIT_MISSING', '/limits', '调用模型的卡片（有 AI 步骤或 permissions.model=true）必须填写 limits.modelCallsPerRun（≥1）');
    else if (lim.modelCallsPerRun < nModel) err('E_LIMIT_TOO_LOW', '/limits/modelCallsPerRun', `modelCallsPerRun=${lim.modelCallsPerRun} 小于 AI 步骤数 ${nModel}，卡片注定运行失败`);
    else {
      const jsonSteps = active.filter((s) => (s.type === 'ai' || s.type === 'ai_search') && s.outputFormat === 'json').length;
      if (jsonSteps > 0 && lim.modelCallsPerRun === nModel) warn('W_LIMIT_NO_RETRY_ROOM', '/limits/modelCallsPerRun', 'JSON 解析失败的修复重试也计入次数，建议留出余量（+1）');
    }
    if (!card.estimates) warn('W_ESTIMATES_MISSING', '/', '调用模型的卡片建议填写 estimates，导入确认页才能显示预估消耗');
  }
  if (card.estimates) {
    const e = card.estimates;
    if (e.modelCalls !== undefined && e.modelCalls < nModel) err('E_ESTIMATE_INCONSISTENT', '/estimates/modelCalls', `预估模型调用 ${e.modelCalls} 次，少于 AI 步骤数 ${nModel}`);
    if (e.searchCalls !== undefined && nSearch === 0 && e.searchCalls > 0 && !hasCode) err('E_ESTIMATE_INCONSISTENT', '/estimates/searchCalls', '没有 ai_search 步骤却预估了联网搜索次数');
    const maxSearch = active.filter((s) => s.type === 'ai_search').reduce((a, s) => a + (s.maxSearches ?? 3), 0);
    if (e.searchCalls !== undefined && nSearch > 0 && e.searchCalls > maxSearch) warn('W_ESTIMATE_SEARCH', '/estimates/searchCalls', `预估搜索 ${e.searchCalls} 次，超过各 ai_search 步骤 maxSearches 之和 ${maxSearch}`);
    if (effRun !== undefined && e.modelCalls !== undefined && e.modelCalls > effRun) err('E_ESTIMATE_INCONSISTENT', '/estimates/modelCalls', `预估调用次数 ${e.modelCalls} 超过 modelCallsPerRun（${effRun}${lim.modelCallsPerRun === undefined ? '，省略按 0' : ''}）`);
  }

  // ---------- 触发 ----------
  if (trigger.onOpen === false && trigger.intervalMinutes === undefined) warn('W_TRIGGER_MANUAL_ONLY', '/workflow/trigger', '只能手动刷新');
  if (trigger.intervalMinutes !== undefined) {
    const floor = nSearch > 0 ? INTERVAL_MIN.search : mayCallModel ? INTERVAL_MIN.model : INTERVAL_MIN.plain;
    if (trigger.intervalMinutes < floor) warn('W_INTERVAL_RAISED', '/workflow/trigger/intervalMinutes', `间隔 ${trigger.intervalMinutes} 分钟低于下限 ${floor}，导入时会自动调整为 ${floor}`);
    for (const [host, pol] of Object.entries(HOST_POLICIES)) {
      if (usedHosts.has(host) && trigger.intervalMinutes < pol.minIntervalMinutes)
        warn('W_INTERVAL_RAISED', '/workflow/trigger/intervalMinutes', `访问 ${host} 的卡片最短刷新间隔为 ${pol.minIntervalMinutes} 分钟（平台按主机的限流策略：${pol.reason}），导入时会自动调整`);
    }
  }

  // ---------- 布局 ----------
  const d = card.display;
  if (d.minSize && (d.minSize.w > d.size.w || d.minSize.h > d.size.h)) err('E_DISPLAY_SIZE', '/display/minSize', 'minSize 不能大于 size');

  // ---------- 疑似密钥（全文） ----------
  walkStrings(card, '', (str, ptr) => {
    for (const [re, label] of SECRET_PATTERNS) if (re.test(str)) { err('E_SECRET_LITERAL', ptr, `疑似包含${label}。模板中不允许出现任何 Key/令牌`); break; }
  });

  return out;
}
