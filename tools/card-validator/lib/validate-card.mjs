import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import localize from 'ajv-i18n';
import { semanticCheck } from './semantic.mjs';

const schemaPath = fileURLToPath(new URL('../../card-schema-v1.json', import.meta.url));
export const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

// strictTypes / strictRequired 关闭：if/then 子模式里不重复写 type、required 引用父级属性是 2020-12 的常规写法
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
ajv.addSchema(schema);
const validateSchema = ajv.getSchema(schema.$id);
const bindValidators = Object.fromEntries(['number', 'list', 'text', 'chart', 'todo'].map((c) => [c, ajv.getSchema(`${schema.$id}#/$defs/${c}Bind`)]));

// if/then、anyOf 失败时 Ajv 会附带“应当匹配 then/某个模式”之类的汇总错误，对用户无信息量
const NOISE = new Set(['if', 'anyOf', 'oneOf']);

// 每种步骤类型合法的属性名：用来过滤“某个子条件失败 → 该步骤全部属性被报 unevaluated”的连带噪音
function collectProps(node, acc = new Set()) {
  if (!node || typeof node !== 'object') return acc;
  if (node.$ref?.startsWith('#/$defs/')) collectProps(schema.$defs[node.$ref.slice(8)], acc);
  Object.keys(node.properties || {}).forEach((k) => acc.add(k));
  (node.allOf || []).forEach((n) => collectProps(n, acc));
  return acc;
}
const STEP_DEF = { http: 'httpStep', rss: 'rssStep', ai: 'aiStep', ai_search: 'aiSearchStep', transform: 'transformStep', code: 'codeStep', storage: 'storageStep', condition: 'conditionStep', output: 'outputStep' };
const STEP_PROPS = Object.fromEntries(Object.entries(STEP_DEF).map(([t, d]) => [t, collectProps(schema.$defs[d], collectProps({ properties: schema.$defs.step.properties }))]));

const FRIENDLY = [
  [/\/urlPattern\//, '网络权限条目格式不对：只允许 https://主机[:端口][/路径前缀*]、https://*.主机/...、整值 "{{inputs.参数}}"，或对象 { "pattern": ..., "requires": "proxy" }。卡片不能访问本机或内网（http://localhost、127.0.0.1 都不行）；本地服务（如 Ollama）只能在“模型渠道”里配置'],
  [/\/urlTemplate\//, '网址格式不对：必须以 https:// 开头，协议和主机名要写死。卡片不能访问本机或内网（http://localhost、127.0.0.1 都不行）；本地服务（如 Ollama）只能在“模型渠道”里配置'],
];
const fmtAjv = (errs, data) => {
  let list = errs.filter((e) => !NOISE.has(e.keyword));
  if (!list.length) list = errs;
  list = list.filter((e) => {
    if (e.keyword === 'type' && /^\/permissions\/network\/\d+$/.test(e.instancePath)) return false;
    if (e.keyword !== 'unevaluatedProperties') return true;
    const m = /^\/workflow\/steps\/(\d+)$/.exec(e.instancePath);
    const t = m && data?.workflow?.steps?.[m[1]]?.type;
    return !(t && STEP_PROPS[t]?.has(e.params.unevaluatedProperty));
  });
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const f = e.keyword === 'pattern' && FRIENDLY.find(([re]) => re.test(e.schemaPath));
    const f2 = e.keyword === 'pattern' && /^\/permissions\/network\/\d+$/.test(e.instancePath) ? FRIENDLY[0] : null;
    let message;
    if (f || f2) message = (f2 || f)[1];
    else if (e.keyword === 'unevaluatedProperties' || e.keyword === 'additionalProperties') message = `未知字段 "${e.params.unevaluatedProperty ?? e.params.additionalProperty}"（拼写错误？v1 不接受未定义的字段）`;
    else { localize.zh([e]); message = `${e.message}${e.params && Object.keys(e.params).length ? ' ' + JSON.stringify(e.params) : ''}`; }
    const k = `${e.instancePath}|${message}`;
    if (!seen.has(k)) { seen.add(k); out.push({ path: e.instancePath || '', message }); }
  }
  return out;
};

function validateBind(component, bind) {
  const v = bindValidators[component];
  return v(bind) ? [] : fmtAjv(v.errors);
}

import { wildcardRisk } from './netmatch.mjs';
import { siteOriginIssues } from './siteorigin.mjs';
export const SUPPORTED_MINOR = 0;

// opts.siteOrigins：当前部署的主站、沙箱站 origin（来自运行时 __APP_ENV__ 与 location.origin），传入时检查 E_SITE_ORIGIN_LINK
export function validateCard(card, opts = {}) {
  // 先看版本：主版本必须是 1；次版本不能高于本平台支持的 SUPPORTED_MINOR
  if (card && typeof card === 'object' && card.schemaVersion !== undefined) {
    const m = /^([1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?$/.exec(String(card.schemaVersion));
    if (!m || m[1] !== '1' || Number(m[2] ?? 0) > SUPPORTED_MINOR)
      return { valid: false, errors: [{ level: 'error', code: 'E_SCHEMA_VERSION', path: '/schemaVersion', message: `这个卡片需要 schema ${card.schemaVersion}，当前平台只支持到 1.${SUPPORTED_MINOR}，请更新到新版本的平台` }], warnings: [] };
  }
  // 通配所有域名的写法（*、*://*、https://*/*、*.com 等）多数过不了 schema 的模式检查；
  // 先单独检查，给出明确的 E_NET_PATTERN_TOO_BROAD，而不是笼统的 E_SCHEMA（第三轮拍板 G1）
  const net = card?.permissions?.network;
  if (Array.isArray(net)) {
    const broad = [];
    net.forEach((e, i) => { const r = wildcardRisk(typeof e === 'string' ? e : e?.pattern); if (r) broad.push({ level: 'error', code: r.code, path: `/permissions/network/${i}`, message: r.reason }); });
    if (broad.length) return { valid: false, errors: broad, warnings: [] };
  }
  if (!validateSchema(card)) {
    return { valid: false, errors: fmtAjv(validateSchema.errors, card).map((e) => ({ level: 'error', code: 'E_SCHEMA', path: e.path || '/', message: e.message })), warnings: [] };
  }
  const sem = semanticCheck(card, validateBind);
  for (const x of siteOriginIssues(card, opts.siteOrigins)) sem.push({ level: 'error', code: 'E_SITE_ORIGIN_LINK', path: x.path || '/', message: `卡片里出现了本站地址 ${x.host}：站点域名可能更换，卡片和模板不得写本站的绝对地址（分享链接由平台在运行时按当前站点生成）` });
  const errors = sem.filter((x) => x.level === 'error');
  return { valid: errors.length === 0, errors, warnings: sem.filter((x) => x.level === 'warning') };
}
