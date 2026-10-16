// JSONata 表达式静态检查：语法 + 根上下文引用。
// 根上下文 = { inputs, run, <步骤id>: 输出 }。只检查“在根上下文求值”的名字：
//   顶层路径的第一步、对象/数组构造器与函数参数里的顶层路径、$$.xxx。
// 过滤条件、排序、映射等内层上下文里的名字是相对当前元素的，不检查。
import jsonata from 'jsonata';

export function parseExpr(src) {
  try { return { ast: jsonata(src).ast() }; }
  catch (e) { return { error: `${e.code || ''} ${e.message}（位置 ${e.position ?? '?'}）`.trim() }; }
}

export function rootNames(ast) {
  const names = [];
  const visitStages = (n) => {
    for (const st of n.stages || []) visit(st.expr, false);
    for (const st of n.predicate || []) visit(st.expr, false);
    if (n.group) for (const [k, v] of n.group.lhs) { visit(k, false); visit(v, false); }
  };
  function visit(n, atRoot) {
    if (!n || typeof n !== 'object') return;
    switch (n.type) {
      case 'path': {
        const [first, ...rest] = n.steps;
        if (first.type === 'variable' && first.value === '$' && rest[0]?.type === 'name') {
          names.push({ name: rest[0].value, position: rest[0].position });
          visitStages(first); rest.forEach((s) => { visit(s, false); });
        } else {
          visit(first, atRoot);
          rest.forEach((s) => visit(s, false));
        }
        visitStages(n);
        return;
      }
      case 'name':
        if (atRoot) names.push({ name: n.value, position: n.position });
        visitStages(n);
        return;
      case 'sort':
        (n.terms || []).forEach((t) => visit(t.expression, false));
        visitStages(n);
        return;
      case 'binary': visit(n.lhs, atRoot); visit(n.rhs, atRoot); return;
      case 'apply': visit(n.lhs, atRoot); visit(n.rhs, atRoot); return;
      case 'bind': visit(n.rhs, atRoot); return;
      case 'condition': visit(n.condition, atRoot); visit(n.then, atRoot); visit(n.else, atRoot); return;
      case 'block': (n.expressions || []).forEach((e) => visit(e, atRoot)); return;
      case 'unary':
        if (n.value === '{') n.lhs.forEach(([k, v]) => { visit(k, atRoot); visit(v, atRoot); });
        else if (n.value === '[') (n.expressions || []).forEach((e) => visit(e, atRoot));
        else visit(n.expression, atRoot);
        visitStages(n);
        return;
      case 'function': case 'partial':
        (n.arguments || []).forEach((a) => visit(a, atRoot));
        visitStages(n);
        return;
      case 'lambda': visit(n.body, false); return;
      case 'transform': visit(n.pattern, false); visit(n.update, false); visit(n.delete, false); return;
      default: visitStages(n);
    }
  }
  visit(ast, true);
  return names;
}

// ---------- 函数允许清单（安全测试 VAL-11） ----------
// 卡片表达式只能调用下面这些 JSONata 内置函数，以及表达式里自己用 := 或 function($x){…} 定义的变量。
// $eval 会把数据源返回的字符串当表达式执行，使审核时看到的逻辑不等于运行时逻辑，一律禁止；
// 清单外的名字（包括以后 JSONata 新增的函数）默认不允许，需要时再加法式放开。
export const JSONATA_ALLOWED_FUNCTIONS = new Set([
  // 聚合 / 数值
  'sum', 'count', 'max', 'min', 'average', 'number', 'floor', 'ceil', 'round', 'abs', 'sqrt', 'power', 'random',
  'formatNumber', 'formatBase', 'formatInteger', 'parseInteger',
  // 字符串
  'string', 'substring', 'substringBefore', 'substringAfter', 'lowercase', 'uppercase', 'length', 'trim', 'pad',
  'match', 'contains', 'replace', 'split', 'join', 'base64encode', 'base64decode',
  'encodeUrlComponent', 'encodeUrl', 'decodeUrlComponent', 'decodeUrl',
  // 布尔 / 类型
  'boolean', 'not', 'exists', 'type', 'error', 'assert',
  // 数组 / 对象 / 高阶函数
  'map', 'zip', 'filter', 'single', 'reduce', 'sift', 'keys', 'lookup', 'append', 'spread', 'merge', 'reverse',
  'each', 'sort', 'shuffle', 'distinct', 'clone',
  // 时间
  'now', 'millis', 'toMillis', 'fromMillis',
]);
export const JSONATA_FORBIDDEN_FUNCTIONS = new Set(['eval']);

/** 返回 [{ name, reason }]：表达式里引用了禁止或不在允许清单中的 $变量/函数 */
export function forbiddenFunctions(ast) {
  const used = new Map();   // name -> position
  const bound = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n.type === 'variable' && typeof n.value === 'string' && n.value !== '' && n.value !== '$') { if (!used.has(n.value)) used.set(n.value, n.position); }
    if (n.type === 'bind' && n.lhs?.type === 'variable') bound.add(n.lhs.value);
    if (n.type === 'lambda') (n.arguments || []).forEach((a) => a?.type === 'variable' && bound.add(a.value));
    for (const [k, v] of Object.entries(n)) if (k !== 'position' && v && typeof v === 'object') walk(v);
  };
  walk(ast);
  const bad = [];
  for (const [name] of used) {
    if (JSONATA_FORBIDDEN_FUNCTIONS.has(name)) bad.push({ name, reason: `$${name} 会把运行时数据当作表达式执行，卡片表达式禁止使用` });
    else if (!bound.has(name) && !JSONATA_ALLOWED_FUNCTIONS.has(name)) bad.push({ name, reason: `$${name} 不在允许的 JSONata 函数清单中，也不是表达式里定义的变量` });
  }
  return bad;
}

/** 运行时用：编译表达式并把 $eval 覆盖成抛错（纵深防御，校验器已静态拒绝） */
export function compileSafe(src) {
  const e = jsonata(src);
  const bad = forbiddenFunctions(e.ast());
  if (bad.length) throw Object.assign(new Error(bad[0].reason), { code: 'E_EXPR_FORBIDDEN_FN' });
  e.registerFunction('eval', () => { throw Object.assign(new Error('$eval 已禁用'), { code: 'E_EXPR_FORBIDDEN_FN' }); });
  return e;
}
