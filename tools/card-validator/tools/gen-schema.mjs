// 生成 card-schema-v1.json 的脚本（schema 以生成结果为准；修改 schema 请改这里后运行 npm run gen:schema，再跑 npm test）
import { writeFileSync } from 'node:fs';
const R = String.raw;
const SEG = R`(?:\.[A-Za-z_$][A-Za-z0-9_$\-]*|\[[0-9]+\])`;
const WHOLE = `^\\{\\{\\s*[a-z][A-Za-z0-9_]*${SEG}*\\s*\\}\\}$`;
const ID = R`^[a-z][A-Za-z0-9_]{0,31}$`;
const URLPAT = R`^https://(?:\*\.)?(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)*\.?|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?(?:/[^*?#\s]*\*?)?$`;
const INPUTREF = R`^\{\{\s*inputs\.[a-z][A-Za-z0-9_]*\s*\}\}$`;
const URLTPL = R`^(?:https://|\{\{)`;
const KEY = '^[A-Za-z0-9_.-]{1,64}$';

const ifThen = (key, map) => Object.entries(map).map(([v, then]) => ({ if: { properties: { [key]: { const: v } }, required: [key] }, then }));
const ref = (n) => ({ $ref: `#/$defs/${n}` });
const d = (description, s) => ({ ...s, description });

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:card-schema:v1',
  title: '卡片定义 v1',
  description: '卡片 = 元信息 + 权限声明 + 费用限制与预估 + 用户参数 + 工作流（触发 + 线性步骤）+ 展示配置。JSON Schema 只管结构；跨字段规则（网址是否已声明、引用是否存在、展示组件绑定是否完整等）由 card-validator 的语义校验负责，两者都通过才算合法卡片。',
  type: 'object',
  required: ['schemaVersion', 'meta', 'permissions', 'inputs', 'workflow', 'display'],
  additionalProperties: false,
  properties: {
    $schema: d('可选，编辑器提示用，平台忽略。', { type: 'string' }),
    schemaVersion: d('schema 版本（字符串）："<主>" 或 "<主>.<次>"，"1" 等同 "1.0"。主版本变化 = 不兼容；次版本 = 只加字段（旧卡片永远有效）。用到某次版本新增字段的卡片必须声明不低于该次版本；平台遇到高于自己支持的版本时拒绝导入并提示更新（语义校验 E_SCHEMA_VERSION）。当前平台支持到 1.0。', { type: 'string', pattern: '^[1-9][0-9]*(\\.(0|[1-9][0-9]*))?$' }),
    meta: ref('meta'),
    permissions: ref('permissions'),
    limits: ref('limits'),
    estimates: ref('estimates'),
    inputs: d('导入后由用户填写的参数。模板里只放默认值，不放任何私有数据。', { type: 'array', maxItems: 20, items: ref('input') }),
    workflow: ref('workflow'),
    display: ref('display'),
  },
  $defs: {
    id: d('步骤 id / 参数 key：小写字母开头，字母数字下划线，≤32。步骤 id 不能是 inputs、run 及 JSONata 保留字（语义校验）。', { type: 'string', pattern: ID }),
    template: d('模板字符串，可含 {{引用}}。引用对象/数组时按 JSON 文本插入；引用不存在的字段插入空字符串并在运行日志警告。写字面量 {{ 用 \\{{。', { type: 'string', maxLength: 30000 }),
    wholeRef: d('整值引用：字符串里只有一个 {{路径}}，取原始值（数组/对象/数字），不转成字符串。', { type: 'string', pattern: WHOLE }),
    expr: d('JSONata 表达式（受限用法见说明文档）。根上下文为 { inputs, run, <步骤id>: 输出 }；在过滤条件等内层上下文里访问根用 $$，如 $$.run.today。', { type: 'string', minLength: 1, maxLength: 5000 }),
    exprBinding: d('用表达式计算绑定值。', { type: 'object', required: ['expr'], additionalProperties: false, properties: { expr: ref('expr') } }),
    bindValue: d('绑定值：字面量、模板字符串（含 {{引用}}，整值引用保留原类型），或 { "expr": JSONata }。', { anyOf: [{ type: 'string', maxLength: 5000 }, { type: 'number' }, { type: 'boolean' }, ref('exprBinding')] }),
    bindArray: d('数组类绑定：整值引用或表达式。', { anyOf: [ref('wholeRef'), ref('exprBinding')] }),
    anyJson: d('任意 JSON；其中的字符串按模板处理。', {}),
    httpsUrl: d('规范的 https 网址：只允许 RFC 3986 的 ASCII 字符（非 ASCII 请用 punycode / 百分号编码），不允许引号、尖括号、反引号、反斜杠、空白和花括号（安全测试 VAL-05）。语义校验再用 URL 解析检查主机和 userinfo。', { type: 'string', pattern: "^https://[A-Za-z0-9._~:/?#\\[\\]@!$&()*+,;=%-]+$", maxLength: 500 }),
    storageKey: d('键名：字母、数字、.、-、_，≤64。只能是字面量，便于静态分析。', { type: 'string', pattern: KEY }),
    networkEntry: d('网络条目的对象写法，用于附加来源特性。requires: "proxy" 表示该来源已知不支持浏览器跨域（见 cors-matrix.md），必须经用户配置的代理访问：请求层直接走代理、不先试直连；未配置代理时按步骤的 onProxyMissing 降级，导入确认页标注“需代理”。', {
      type: 'object', additionalProperties: false, required: ['pattern'],
      properties: {
        pattern: ref('urlPattern'),
        requires: { enum: ['proxy'] },
        note: d('给用户看的说明，如“36氪 RSS 不支持跨域”。', { type: 'string', maxLength: 100 }),
      },
    }),
    urlPattern: d('网址模式：https + 主机 + 可选端口 + 可选路径前缀。* 只能在子域最左侧（https://*.example.com/…）或路径末尾（/repos/*）；不允许通配所有域名（*、https://*/* 等），子域通配规则：*.x 只有在 x 是可注册域名，并且公共后缀列表（含 PRIVATE 段）里没有任何以 .x 结尾的规则时才允许；x 也不能在动态 DNS / 内网穿透 / 免费托管的补充禁用名单里（*.github.com 可以；*.github.io、*.workers.dev、*.com.cn、*.amazonaws.com、*.core.windows.net、*.cpolar.top 不行；语义校验 E_NET_PATTERN_TOO_BROAD）；不写路径 = 该主机全部路径；路径不以 * 结尾 = 精确路径。主机须小写、IDN 用 punycode。只允许 https 和公网域名：本机、内网、链路本地地址、IP 字面量（含十进制/十六进制/八进制变形和 IPv4 映射的 IPv6）一律拒绝（语义校验）；本地服务（如 Ollama）只能在模型渠道里配置。', { type: 'string', pattern: URLPAT, maxLength: 300 }),
    urlTemplate: d('请求网址。scheme 与主机必须是字面量；{{引用}} 只能出现在主机之后。唯一例外：整值引用一个在 permissions.network 中以 "{{inputs.<key>}}" 声明过的 url-list 参数。', { type: 'string', pattern: URLTPL, maxLength: 2000 }),
    gridSize: { type: 'object', required: ['w', 'h'], additionalProperties: false, properties: { w: { type: 'integer', minimum: 1, maximum: 12 }, h: { type: 'integer', minimum: 1, maximum: 12 } } },

    meta: {
      type: 'object',
      required: ['id', 'name', 'description', 'author', 'version'],
      additionalProperties: false,
      properties: {
        id: d('模板标识（kebab-case）。同 id 视为同一模板，用于重复导入判断和以后的更新提示。实例 id 由平台另行生成。', { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,63}$' }),
        name: { type: 'string', minLength: 1, maxLength: 40 },
        description: { type: 'string', minLength: 1, maxLength: 200 },
        author: d('作者名或 GitHub 用户名。', { type: 'string', minLength: 1, maxLength: 60 }),
        version: d('模板版本，SemVer。', { type: 'string', pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$' }),
        icon: d('emoji（≤8 个字符）或内置图标 lucide:<name>。不允许外链图片。', { type: 'string', pattern: '^(?:lucide:[a-z0-9-]{1,40}|[^\\s<>"\'/\\\\:]{1,8})$' }),
        tags: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 20 } },
        locale: d('模板内容语言，如 zh-CN。', { type: 'string', pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' }),
        license: d('模板许可证（SPDX 标识）。缺省视为 MIT-0。', { type: 'string', pattern: '^[A-Za-z0-9.+-]{2,40}$' }),
        homepage: ref('httpsUrl'),
        source: d('来源标记：人工编写 / 一句话生成 / 生成后人工修改。', { enum: ['human', 'ai', 'ai+human'] }),
      },
    },

    permissions: d('与 INTERFACE-CONTRACT.md 第 1 节一致。导入时逐项展示给用户确认；运行时平台据此放行或拒绝。', {
      type: 'object',
      required: ['network', 'model', 'storage', 'code'],
      additionalProperties: false,
      properties: {
        network: d('允许访问的网址模式；或 "{{inputs.<key>}}"，表示“用户在该 url-list 参数里填写的网址”（用户保存参数时逐个确认新域名）。未声明的一律拒绝。', { type: 'array', maxItems: 20, uniqueItems: true, items: { anyOf: [ref('urlPattern'), { type: 'string', pattern: INPUTREF }, ref('networkEntry')] } }),
        model: d('是否调用模型（含 AI 联网搜索与代码里的 model.call）。渠道与 Key 由平台决定，卡片永远拿不到。', { type: 'boolean' }),
        storage: d('是否读写本卡片实例的本地存储（含待办组件的回写）。', { type: 'boolean' }),
        code: d('是否含代码步骤。true 时导入标红。', { type: 'boolean' }),
        usage: d('可选。是否只读平台 AI 用量汇总（storage 步骤 scope=platform.usage）。不含提示词与单次明细。', { type: 'boolean' }),
      },
    }),

    limits: d('运行时强制执行的上限。有模型调用时 modelCallsPerRun 必填（语义校验）。', {
      type: 'object', additionalProperties: false,
      properties: {
        modelCallsPerRun: d('一次运行最多调用模型几次（联网搜索、JSON 修复重试、代码步骤里的 model.call 都算），超出即 QUOTA_EXCEEDED。0 = 卡片从不调用模型：导入页显示“不使用 AI、不消耗额度”，没有配置任何 Key 也能运行，运行时调用 model.call 一律 PERMISSION_DENIED。没有 AI 步骤且 permissions.model=false 时可省略（按 0）；有 AI 步骤或 permissions.model=true 时必填且 ≥1（语义校验）。', { type: 'integer', minimum: 0, maximum: 20 }),
        modelCallsPerDay: d('可选，本卡片每日模型调用上限。实际生效 = min(本值, 用户全局每日上限)。', { type: 'integer', minimum: 1, maximum: 1000 }),
      },
    }),
    estimates: d('作者给出的每次运行预估，用于导入确认页和参数页显示；卡片运行后平台用最近 5 次实际值覆盖。', {
      type: 'object', additionalProperties: false,
      properties: {
        modelCalls: { type: 'integer', minimum: 0, maximum: 20 },
        searchCalls: { type: 'integer', minimum: 0, maximum: 50 },
        inputTokens: { type: 'integer', minimum: 0, maximum: 1000000 },
        outputTokens: { type: 'integer', minimum: 0, maximum: 1000000 },
      },
    }),

    input: {
      type: 'object',
      required: ['key', 'label', 'type'],
      properties: {
        key: ref('id'),
        label: { type: 'string', minLength: 1, maxLength: 40 },
        type: { enum: ['string', 'text', 'number', 'boolean', 'date', 'select', 'url-list'] },
        required: { type: 'boolean' },
        default: {},
        placeholder: { type: 'string', maxLength: 100 },
        help: { type: 'string', maxLength: 200 },
        options: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', required: ['value', 'label'], additionalProperties: false, properties: { value: { type: ['string', 'number'] }, label: { type: 'string', minLength: 1, maxLength: 40 } } } },
        min: { type: 'number' },
        max: { type: 'number' },
        pattern: d('string 类型的格式校验正则（表单用，≤200 字符）。', { type: 'string', maxLength: 200 }),
        maxItems: d('url-list 最多几行。', { type: 'integer', minimum: 1, maximum: 50 }),
        maxLines: d('text 最多几行（如“每行一个关键词，最多 5 个”）。', { type: 'integer', minimum: 1, maximum: 200 }),
      },
      allOf: ifThen('type', {
        string: { properties: { default: { type: 'string', maxLength: 500 } } },
        text: { properties: { default: { type: 'string', maxLength: 5000 } } },
        number: { properties: { default: { type: 'number' } } },
        boolean: { properties: { default: { type: 'boolean' } } },
        date: { properties: { default: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' } } },
        select: { required: ['options'], properties: { default: { type: ['string', 'number'] } } },
        'url-list': { properties: { default: { type: 'array', maxItems: 20, items: ref('httpsUrl') } } },
      }),
      unevaluatedProperties: false,
    },

    workflow: {
      type: 'object', required: ['trigger', 'steps'], additionalProperties: false,
      properties: {
        trigger: ref('trigger'),
        steps: d('线性步骤列表，从上到下顺序执行。有且只有一个 output 步骤，且必须是最后一步（位置由语义校验检查）。', {
          type: 'array', minItems: 1, maxItems: 20, items: ref('step'),
          contains: { type: 'object', properties: { type: { const: 'output' } }, required: ['type'] },
          minContains: 1, maxContains: 1,
        }),
      },
    },
    trigger: {
      type: 'object', additionalProperties: false,
      properties: {
        onOpen: d('打开站点或切到该看板时运行。true / false，或 { skipIfFreshMinutes: N }（距上次成功不足 N 分钟则只显示缓存），或 { oncePerDay: true }（本地日期内成功过就不再自动运行）。', {
          anyOf: [
            { type: 'boolean' },
            { type: 'object', required: ['skipIfFreshMinutes'], additionalProperties: false, properties: { skipIfFreshMinutes: { type: 'integer', minimum: 1, maximum: 10080 } } },
            { type: 'object', required: ['oncePerDay'], additionalProperties: false, properties: { oncePerDay: { const: true } } },
          ],
        }),
        manual: d('手动刷新按钮，始终开启，不允许关闭。可省略。', { const: true }),
        intervalMinutes: d('页面开着且可见时的定时间隔。硬下限 5；调用模型 ≥15、联网搜索 ≥60（平台常量，低于时导入自动上调并提示）。', { type: 'integer', minimum: 5, maximum: 1440 }),
      },
    },

    step: {
      type: 'object',
      required: ['id', 'type'],
      properties: {
        id: ref('id'),
        type: { enum: ['http', 'rss', 'ai', 'ai_search', 'transform', 'code', 'storage', 'condition', 'output'] },
        name: d('步骤显示名（编辑器）。', { type: 'string', maxLength: 60 }),
        description: { type: 'string', maxLength: 300 },
        onError: d('stop：整次运行失败（默认）；continue：本步输出记为 null，记录错误，继续后续步骤。', { enum: ['stop', 'continue'] }),
        disabled: d('禁用：跳过执行，引用它的地方得到 null 并警告。', { type: 'boolean' }),
        enabledIf: d('运行时开关：值为假（false、null、空字符串、0、"false"、空数组、空对象）时跳过本步，输出记为 null，显示“已跳过”，不算失败。整值引用（如 "{{inputs.showSummary}}"）或 { "expr": JSONata }（如 "inputs.summarize and $count(n4.pending) > 0"）。PRD 的 skipIfEmpty 用它表达。', { anyOf: [ref('wholeRef'), ref('exprBinding')] }),
      },
      allOf: ifThen('type', {
        http: ref('httpStep'), rss: ref('rssStep'), ai: ref('aiStep'), ai_search: ref('aiSearchStep'),
        transform: ref('transformStep'), code: ref('codeStep'), storage: ref('storageStep'),
        condition: ref('conditionStep'), output: ref('outputStep'),
      }),
      unevaluatedProperties: false,
    },

    httpStep: d('HTTP 请求。输出 { status, headers, body }；body 为对象时其字段同时平铺到输出根部（status/headers/body 三个名字除外），所以 {{n1.stargazers_count}} 等价于 {{n1.body.stargazers_count}}。', {
      required: ['url'],
      properties: {
        method: { enum: ['GET', 'POST'] },
        url: ref('urlTemplate'),
        headers: d('值为模板字符串。v1 只允许 Accept、Accept-Language、Content-Type 三个请求头（语义校验），避免自定义头让预检失败（如 Google 预检遇到未知请求头返回 403），也避免写入凭据。', { type: 'object', maxProperties: 20, propertyNames: { pattern: '^[A-Za-z0-9-]{1,64}$' }, additionalProperties: { type: 'string', maxLength: 2000 } }),
        body: d('POST 请求体，其中字符串按模板处理。对象和数组按 JSON 序列化，字符串原样作为请求体；缺省的 Content-Type 是 application/json（字符串 body 也一样，不再按文本发送）。schema v1.1 增量约束（文档第 15 节）：没写 Content-Type 时平台补 application/json，给警告 W_HTTP_CONTENT_TYPE_DEFAULTED；用 text/plain、application/x-www-form-urlencoded、multipart/form-data 报 E_HTTP_SIMPLE_CONTENT_TYPE，来源声明为 requires: "proxy" 也不例外；Content-Type 用模板报 E_HTTP_CONTENT_TYPE。运行时简单类型的请求只走代理，没有代理返回 PROXY_REQUIRED 并按 onProxyMissing 处理。', {}),
        responseType: d('缺省 auto：按 Content-Type 判断。', { enum: ['auto', 'json', 'text'] }),
        timeoutMs: d('单个请求的总时长上限，缺省且最大 30000（HTTP 请求总时长 30 秒，技术负责人第二轮拍板 F4）。', { type: 'integer', minimum: 1000, maximum: 30000 }),
        allowNon2xx: d('非 2xx 也视为成功（缺省 false）。', { type: 'boolean' }),
        onProxyMissing: d('目标来源需要代理（网络条目 requires: "proxy"，或平台内置的“已知需代理域名”清单命中）而用户没有配置代理时怎么办。notice（缺省）：不发请求，本步输出 null（rss 为把这些源记入 errors，code=PROXY_REQUIRED），卡片顶部显示“此来源需要代理 · 去设置”，后续步骤继续；fail：本次运行失败并显示同样的提示。', { enum: ['notice', 'fail'] }),
      },
    }),
    rssStep: d('拉取并解析 RSS 2.0 / Atom。输出 { items: [{ title, link, published, summary, source, feedUrl }], errors: [{ feedUrl, code, message }] }（code：PROXY_REQUIRED / NETWORK_ERROR（含跨域被拦）/ HTTP_ERROR / PARSE_ERROR / TIMEOUT）；单个源失败不影响其他源；多源按 published 倒序合并、按 link 去重；summary 为纯文本且 ≤300 字符。', {
      required: ['urls'],
      properties: {
        urls: d('网址数组，或整值引用一个 url-list 参数（如 "{{inputs.feeds}}"）。', { anyOf: [{ type: 'array', minItems: 1, maxItems: 20, items: ref('urlTemplate') }, { type: 'string', pattern: INPUTREF }] }),
        maxItemsPerFeed: d('缺省 10。', { type: 'integer', minimum: 1, maximum: 100 }),
        maxItems: d('合并后总数，缺省 20。', { type: 'integer', minimum: 1, maximum: 200 }),
        timeoutMs: d('每个源的请求总时长上限，缺省且最大 30000。', { type: 'integer', minimum: 1000, maximum: 30000 }),
        onProxyMissing: d('目标来源需要代理（网络条目 requires: "proxy"，或平台内置的“已知需代理域名”清单命中）而用户没有配置代理时怎么办。notice（缺省）：不发请求，本步输出 null（rss 为把这些源记入 errors，code=PROXY_REQUIRED），卡片顶部显示“此来源需要代理 · 去设置”，后续步骤继续；fail：本次运行失败并显示同样的提示。', { enum: ['notice', 'fail'] }),
      },
    }),
    modelSpec: d('模型档位与能力需求。不写模型名，用户在设置里把档位映射到自己的渠道和模型。', {
      type: 'object', additionalProperties: false,
      properties: {
        tier: d('缺省 fast。', { enum: ['fast', 'strong'] }),
        needs: { type: 'array', uniqueItems: true, items: { enum: ['json', 'web_search'] } },
      },
    }),
    aiCommon: {
      properties: {
        model: ref('modelSpec'),
        system: ref('template'),
        prompt: ref('template'),
        outputFormat: d('缺省 text。text → 输出 { text, _usage }；json → 输出解析后的对象，另加 _raw、_usage。', { enum: ['text', 'json'] }),
        jsonShape: d('outputFormat=json 时建议提供：期望结构的示例对象（顶层必须是对象）。平台写入提示词并校验顶层字段。', { type: 'object' }),
        maxTokens: d('缺省 1024。', { type: 'integer', minimum: 1, maximum: 16000 }),
        temperature: d('缺省 0.3。', { type: 'number', minimum: 0, maximum: 2 }),
        maxInputChars: d('引用内容插入后的提示词长度上限，缺省 24000，超出截断引用内容并警告。', { type: 'integer', minimum: 500, maximum: 200000 }),
        cacheKey: d('模板字符串。计算结果与上次成功时相同则复用上次输出、不调用模型。例："{{run.today}}" = 每天最多一次。', { type: 'string', maxLength: 500 }),
      },
    },
    aiStep: d('AI 调用。', { required: ['prompt'], allOf: [ref('aiCommon')] }),
    aiSearchStep: d('AI 联网搜索（type: ai_search）：用映射到支持联网的模型（三家官方渠道原生联网工具）先搜索再回答。输出同 ai，另加 _citations: [{ title, url }]。', {
      required: ['prompt'], allOf: [ref('aiCommon')],
      properties: {
        maxSearches: d('单次调用最多搜索几次，缺省 3。', { type: 'integer', minimum: 1, maximum: 8 }),
        verifyUrls: d('缺省 true：json 输出里名为 url 的字段必须出现在 _citations 中，否则该条加 _unverified: true。', { type: 'boolean' }),
      },
    }),
    transformStep: d('数据变换：一个 JSONata 表达式，结果即本步输出。不执行 JavaScript；在独立 Worker 中求值，每次求值超时 1 秒（平台常量，v1 不可配置），超时由终止 Worker 实现，本步按 TIMEOUT 失败并遵循 onError。condition.if、enabledIf、{expr} 绑定同样如此。', {
      required: ['expr'], properties: { expr: ref('expr') },
    }),
    codeStep: d('代码步骤（沙箱）。source 为 ES 模块文本，必须且只能有一处 export default async function run(input, platform)，不允许 import / 动态 import / 其他 export（语义校验，便于沙箱包装执行）；input = { inputs, run, <前面步骤id>: 输出 }；platform 的方法名与 INTERFACE-CONTRACT 的 postMessage 方法一一对应：platform.net.fetch({url,...})、platform.model.call({...})、platform.storage.get/set/delete/list、platform.usage.get({days})，按 permissions 放行。返回值须可 JSON 序列化且 ≤1MB', {
      required: ['source'],
      properties: {
        language: { const: 'javascript' },
        source: { type: 'string', minLength: 1, maxLength: 20000 },
        timeoutMs: d('纯计算时间上限，缺省 5000。', { type: 'integer', minimum: 100, maximum: 5000 }),
      },
    }),
    storageStep: d('读写本卡片实例的键值存储。输出：get → 值（不存在时为 default 或 null）；set → 新值；append → 追加后的数组；delete → null。scope=platform.usage 时只能 get，返回平台 AI 用量汇总（需 permissions.usage）。', {
      required: ['op'],
      properties: {
        op: { enum: ['get', 'set', 'append', 'delete'] },
        scope: d('缺省 card。', { enum: ['card', 'platform.usage'] }),
        key: ref('storageKey'),
        value: ref('anyJson'),
        default: ref('anyJson'),
        maxLength: d('append：最多保留条数，超出丢弃最早的。', { type: 'integer', minimum: 1, maximum: 1000 }),
        uniqueBy: d('append：按该字段去重，新值替换旧值（如按 date 每天一条）。', { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,39}$' }),
        days: d('scope=platform.usage：汇总最近几天，缺省 7。整数，或整值引用一个参数（运行时转整数并限制在 1–90）。', { anyOf: [{ type: 'integer', minimum: 1, maximum: 90 }, ref('wholeRef')] }),
      },
      allOf: [
        { if: { properties: { scope: { const: 'platform.usage' } }, required: ['scope'] }, then: { properties: { op: { const: 'get' } }, not: { anyOf: [{ required: ['key'] }, { required: ['value'] }, { required: ['maxLength'] }, { required: ['uniqueBy'] }] } }, else: { required: ['key'], not: { required: ['days'] } } },
        ...ifThen('op', {
          get: { not: { anyOf: [{ required: ['value'] }, { required: ['maxLength'] }, { required: ['uniqueBy'] }] } },
          set: { required: ['value'], not: { anyOf: [{ required: ['maxLength'] }, { required: ['uniqueBy'] }] } },
          append: { required: ['value'] },
          delete: { not: { anyOf: [{ required: ['value'] }, { required: ['default'] }, { required: ['maxLength'] }, { required: ['uniqueBy'] }] } },
        }),
      ],
    }),
    conditionStep: d('条件判断（P1：第一版末尾，可后移）。if 为真时执行 then；为假时继续下一步。输出为布尔值。', {
      required: ['if', 'then'],
      properties: {
        if: ref('expr'),
        then: {
          type: 'object', required: ['action'],
          properties: {
            action: { enum: ['stop', 'skipTo', 'status'] },
            message: d('stop：卡片保留上次结果并显示这句话。', { type: 'string', maxLength: 100 }),
            step: d('skipTo：跳到后面的哪个步骤（按 id，不按下标，调整顺序也不失效）。被跳过步骤的输出为 null。', ref('id')),
            status: d('status：设置卡片强调状态，组件据此显示黄/红色。', { enum: ['normal', 'warn', 'alert'] }),
          },
          allOf: ifThen('action', {
            stop: { not: { anyOf: [{ required: ['step'] }, { required: ['status'] }] } },
            skipTo: { required: ['step'], not: { anyOf: [{ required: ['message'] }, { required: ['status'] }] } },
            status: { required: ['status'], not: { anyOf: [{ required: ['step'] }, { required: ['message'] }] } },
          }),
          unevaluatedProperties: false,
        },
      },
    }),
    outputStep: d('输出：把数据绑定到 display.component 的属性。各组件可绑定的属性见 numberBind / listBind / textBind / chartBind / todoBind（语义校验按组件检查）。', {
      required: ['bind'],
      properties: { bind: { type: 'object', minProperties: 1, maxProperties: 20, additionalProperties: { anyOf: [ref('bindValue'), ref('bindArray')] } } },
    }),

    numberBind: d('数字组件绑定。status/link 为所有组件共有：status = normal|warn|alert 强调色；link = 点击卡片标题打开的 http(s) 地址。', { type: 'object', required: ['value'], additionalProperties: false, properties: { value: ref('bindValue'), label: ref('bindValue'), unit: ref('bindValue'), delta: ref('bindValue'), deltaLabel: ref('bindValue'), note: ref('bindValue'), status: ref('bindValue'), link: ref('bindValue') } }),
    listBind: d('列表组件绑定。items 每项：title（必填）、url、subtitle、badge、meta、source、_unverified；header 为顶部一行摘要；errors 为可展开的失败明细 [{ url, message }]（如 RSS 源读取失败，附“配置代理”入口）。', { type: 'object', required: ['items'], additionalProperties: false, properties: { items: ref('bindArray'), header: ref('bindValue'), errors: ref('bindArray'), status: ref('bindValue'), link: ref('bindValue') } }),
    textBind: d('文本组件绑定。citations 每项 { title, url }，显示在底部“来源”区；footer 为底部一行小字。', { type: 'object', required: ['content'], additionalProperties: false, properties: { content: ref('bindValue'), citations: ref('bindArray'), footer: ref('bindValue'), status: ref('bindValue'), link: ref('bindValue') } }),
    chartBind: d('图表组件绑定。series: [{ name, data: [{ x, y }] }]；饼图只取第一组，x 为分类名；headline 为图表上方一行摘要。', { type: 'object', required: ['series'], additionalProperties: false, properties: { series: ref('bindArray'), headline: ref('bindValue'), status: ref('bindValue'), link: ref('bindValue') } }),
    todoBind: d('待办组件绑定。items 每项：id（必填，用于回写）、text（必填）、done、due、priority（high|normal|low）、note，以及 options.badgeField 指定的字段；省略 items 时组件直接显示 storageKey 里的列表。', { type: 'object', additionalProperties: false, properties: { items: ref('bindArray'), header: ref('bindValue'), status: ref('bindValue'), link: ref('bindValue') } }),

    display: {
      type: 'object', required: ['component', 'size'],
      properties: {
        component: { enum: ['number', 'list', 'text', 'chart', 'todo'] },
        options: { type: 'object' },
        size: d('默认占用网格。', ref('gridSize')),
        minSize: ref('gridSize'),
        title: d('卡片标题，缺省用 meta.name。', { type: 'string', maxLength: 40 }),
      },
      allOf: ifThen('component', {
        number: { properties: { options: ref('numberOptions') } },
        list: { properties: { options: ref('listOptions') } },
        text: { properties: { options: ref('textOptions') } },
        chart: { required: ['options'], properties: { options: ref('chartOptions') } },
        todo: { required: ['options'], properties: { options: ref('todoOptions') } },
      }),
      unevaluatedProperties: false,
    },
    numberOptions: { type: 'object', additionalProperties: false, properties: { compact: d('≥10000 时缩写（1.2 万 / 12.3k），缺省 true。', { type: 'boolean' }), decimals: d('缺省 2。', { type: 'integer', minimum: 0, maximum: 6 }), invertColors: d('变化量颜色反转（如错误数增加是坏事）。', { type: 'boolean' }) } },
    listOptions: { type: 'object', additionalProperties: false, properties: { maxItems: d('缺省 10，其余折叠为“还有 N 条”。', { type: 'integer', minimum: 1, maximum: 100 }), showIndex: { type: 'boolean' }, emptyText: { type: 'string', maxLength: 100 } } },
    textOptions: { type: 'object', additionalProperties: false, properties: { format: d('缺省 plain；markdown 按白名单渲染（不渲染图片、HTML、表格）。', { enum: ['plain', 'markdown'] }), emptyText: { type: 'string', maxLength: 100 } } },
    chartOptions: { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { enum: ['line', 'bar', 'pie'] }, stacked: { type: 'boolean' }, xType: { enum: ['category', 'time'] }, yUnit: { type: 'string', maxLength: 10 }, emptyText: { type: 'string', maxLength: 100 } } },
    todoOptions: {
      type: 'object', required: ['storageKey'], additionalProperties: false,
      properties: {
        storageKey: d('用户勾选/新增/编辑/删除的结果由平台直接写回本卡片存储的这个键（需 permissions.storage），不经过工作流。', ref('storageKey')),
        itemsPath: d('存储值里待办数组所在的字段（如 "items"）；省略表示存储值本身就是数组。', { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,39}$' }),
        allowAdd: { type: 'boolean' }, allowDelete: { type: 'boolean' }, allowEdit: { type: 'boolean' },
        hideDoneAfterDays: d('缺省 1。', { type: 'integer', minimum: 0, maximum: 365 }),
        rerunOnChange: d('用户改动待办后重新运行一次工作流（防抖 1 秒；触发来源记为 change；AI 步骤照常走 cacheKey，未命中缓存的调用照常计数）。缺省 false。', { type: 'boolean' }),
        badgeField: d('每项右侧小标签取自该字段（如 units → “+1”）。', { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,39}$' }),
        emptyText: { type: 'string', maxLength: 100 },
      },
    },
  },
};
writeFileSync(process.argv[2] || new URL('../../card-schema-v1.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');
console.log('ok');
