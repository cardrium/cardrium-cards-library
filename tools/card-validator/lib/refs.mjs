// 模板引用语法：{{ 根(.字段|[下标])* }}
//   根 = inputs.<参数key> | run.<运行变量> | <步骤id>
// 只允许“路径”，不允许表达式/过滤器/函数——计算放到 transform 步骤或 { "expr": ... } 绑定里。
export const RUN_VARS = ['now', 'today', 'yesterday', 'weekday', 'timezone', 'locale', 'time', 'startedAt', 'lastSuccessAt', 'modelConfigured', 'proxyConfigured'];
// 不能用作步骤 id 的名字：两个内置根 + JSONata 运算符关键字
export const RESERVED_IDS = new Set(['inputs', 'run', 'and', 'or', 'in', 'true', 'false', 'null', 'function']);

const PATH_RE = /^([a-z][A-Za-z0-9_]*)((?:\.[A-Za-z_$][A-Za-z0-9_$-]*|\[[0-9]+\])*)$/;
const WHOLE_RE = /^\{\{\s*([^{}]+?)\s*\}\}$/;

export function parsePath(inner) {
  const m = PATH_RE.exec(inner);
  if (!m) return null;
  const root = m[1];
  const rest = m[2] || '';
  if (root === 'inputs' || root === 'run') {
    const m2 = /^\.([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_$][A-Za-z0-9_$-]*|\[[0-9]+\])*)$/.exec(rest);
    if (!m2) return null;
    return { root, name: m2[1], rest: m2[2] || '' };
  }
  return { root: 'step', name: root, rest };
}

/** 提取字符串中的全部引用。\{{ 表示字面量 {{。 */
export function extractRefs(str) {
  const refs = [];
  const errors = [];
  let i = 0;
  for (;;) {
    const start = str.indexOf('{{', i);
    if (start === -1) break;
    if (start > 0 && str[start - 1] === '\\') { i = start + 2; continue; }
    const end = str.indexOf('}}', start + 2);
    if (end === -1) { errors.push({ raw: str.slice(start, start + 40), reason: '缺少结尾 }}' }); break; }
    const raw = str.slice(start, end + 2);
    const inner = str.slice(start + 2, end).trim();
    const parsed = inner.includes('{') ? null : parsePath(inner);
    if (!parsed) errors.push({ raw, reason: '只能是路径：<步骤id>.字段、inputs.<key>、run.<变量>，不支持表达式' });
    else refs.push({ raw, ...parsed });
    i = end + 2;
  }
  return { refs, errors };
}

/** 整个字符串恰好是一个引用时返回解析结果，否则 null。 */
export function wholeRef(str) {
  if (typeof str !== 'string') return null;
  const m = WHOLE_RE.exec(str);
  if (!m) return null;
  const p = parsePath(m[1]);
  return p ? { raw: str, ...p } : null;
}

/** 第一个未转义 {{ 的位置，没有则 -1。 */
export function firstRefIndex(str) {
  let i = 0;
  for (;;) {
    const s = str.indexOf('{{', i);
    if (s === -1) return -1;
    if (s > 0 && str[s - 1] === '\\') { i = s + 2; continue; }
    return s;
  }
}
