// 代码步骤的静态检查（安全测试 VAL-10）。用 acorn 做真正的语法解析，不再用正则去注释。
// 注意：这是**提示性的纵深防御**。代码最终在沙箱里运行（不透明源 + CSP + Worker 里删掉危险全局），
// 真正的边界在运行时；这里的目的是让导入确认、官方库定级和人工联审拿到结构化的信号，尽早拦下明显的问题。
import * as acorn from 'acorn';

// 代码里不允许直接使用的全局名：网络、存储、DOM/窗口、消息、动态执行、Worker。
// 代码只能通过 platform 对象（platform.net.fetch / model.call / storage.* / usage.get）访问平台能力。
export const FORBIDDEN_GLOBALS = new Map(Object.entries({
  eval: '动态执行代码', Function: '动态构造函数', importScripts: '加载外部脚本', WebAssembly: '加载二进制代码',
  fetch: '直接联网（请用 platform.net.fetch）', XMLHttpRequest: '直接联网', WebSocket: '直接联网', EventSource: '直接联网',
  WebTransport: '直接联网', RTCPeerConnection: 'WebRTC 外传', webkitRTCPeerConnection: 'WebRTC 外传', RTCDataChannel: 'WebRTC 外传',
  navigator: '浏览器环境（sendBeacon 等）', localStorage: '浏览器存储', sessionStorage: '浏览器存储', indexedDB: '浏览器存储',
  caches: '浏览器存储', cookieStore: '浏览器存储', document: 'DOM', window: '窗口对象', self: '全局对象', globalThis: '全局对象',
  global: '全局对象', parent: '父窗口', top: '顶层窗口', opener: '打开者窗口', frames: '窗口对象', location: '页面地址',
  postMessage: '伪造平台消息', addEventListener: '监听平台消息', onmessage: '监听平台消息', close: '关闭 Worker',
  Worker: '启动 Worker', SharedWorker: '启动 Worker', ServiceWorker: 'Service Worker', BroadcastChannel: '跨上下文通信',
  MessageChannel: '跨上下文通信', setTimeout: '定时器（可接受字符串代码）', setInterval: '定时器（可接受字符串代码）',
  queueMicrotask: '绕过纯计算超时统计', Atomics: '共享内存', SharedArrayBuffer: '共享内存', Proxy: '元编程', Reflect: '元编程',
}));
// 通过属性访问也能拿到危险能力的属性名（例如 ({}).constructor.constructor('…') 等价于 Function）
const FORBIDDEN_PROPS = new Map(Object.entries({
  constructor: '通过 constructor 拿到 Function', __proto__: '修改原型', __defineGetter__: '元编程', __defineSetter__: '元编程',
  sendBeacon: '外传数据', importScripts: '加载外部脚本', postMessage: '伪造平台消息',
}));
const PLATFORM_OK = /^platform\.(net\.fetch|model\.call|storage\.(get|set|delete|list)|usage\.get)$/;

function memberPath(n) {
  const parts = [];
  while (n && n.type === 'MemberExpression' && !n.computed) { parts.unshift(n.property.name); n = n.object; }
  if (n && n.type === 'Identifier') { parts.unshift(n.name); return parts.join('.'); }
  return null;
}

/**
 * @returns { errors: [{code, message}], warnings: [{code, message}], urls: string[] }  urls = 源码里出现的 https?:// 字面量（调用方和网络权限比对）
 */
export function checkCode(source) {
  const errors = [];
  const E = (code, message, node) => errors.push({ code, message: node?.loc ? `第 ${node.loc.start.line} 行：${message}` : message });
  let ast;
  try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: false }); }
  catch (e) { return { errors: [{ code: 'E_CODE_SYNTAX', message: `代码无法解析：${e.message}` }], urls: [] }; }

  // 入口：有且只有一处 export default async function run(input, platform)，没有 import 和其他 export
  let entries = 0;
  for (const st of ast.body) {
    if (st.type === 'ImportDeclaration') E('E_CODE_ENTRY', 'v1 代码步骤不允许 import', st);
    else if (st.type === 'ExportDefaultDeclaration') {
      const d = st.declaration;
      if (d.type === 'FunctionDeclaration' && d.id?.name === 'run') entries++;
      else E('E_CODE_ENTRY', 'export default 必须是 function run(input, platform)', st);
    } else if (st.type === 'ExportNamedDeclaration' || st.type === 'ExportAllDeclaration') E('E_CODE_ENTRY', '除 export default run 外不允许其他 export', st);
  }
  if (entries !== 1) E('E_CODE_ENTRY', '代码必须有且只有一处 export default async function run(input, platform)');

  // ---------- 作用域（VAL-10 回归：块内 let fetch 不能让块外的全局 fetch 漏检） ----------
  // 每个作用域节点只收集“直接属于它”的声明：var / 函数参数 / 模块顶层声明挂在函数（或模块）作用域，
  // let / const / class / 块内函数声明（模块代码是严格模式，块内函数声明是块级的）挂在块作用域。
  const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
  const namesOf = (p, out) => {
    if (!p) return out;
    if (p.type === 'Identifier') out.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => namesOf(q.type === 'RestElement' ? q.argument : q.value, out));
    else if (p.type === 'ArrayPattern') p.elements.forEach((q) => namesOf(q, out));
    else if (p.type === 'RestElement') namesOf(p.argument, out);
    else if (p.type === 'AssignmentPattern') namesOf(p.left, out);
    return out;
  };
  const collectVar = (n, out) => {           // 函数体内所有 var（不进入嵌套函数）
    if (Array.isArray(n)) return n.forEach((c) => collectVar(c, out));
    if (!n || typeof n.type !== 'string' || FN.has(n.type) || n.type === 'ClassBody') return;
    if (n.type === 'VariableDeclaration' && n.kind === 'var') n.declarations.forEach((d) => namesOf(d.id, out));
    for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v && typeof v === 'object') collectVar(v, out);
  };
  const lexical = (stmts, out) => {          // 语句列表里直接出现的 let / const / class / function
    for (const st0 of stmts || []) {
      const st = st0?.type === 'ExportDefaultDeclaration' || st0?.type === 'ExportNamedDeclaration' ? st0.declaration : st0;
      if (!st) continue;
      if (st.type === 'VariableDeclaration' && st.kind !== 'var') st.declarations.forEach((d) => namesOf(d.id, out));
      else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) out.push(st.id.name);
    }
    return out;
  };
  const scopeOf = (n) => {                   // 返回这个节点引入的名字集合；不引入作用域返回 null
    switch (n.type) {
      case 'Program': { const o = lexical(n.body, []); collectVar(n.body, o); return new Set(o); }
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        const o = []; n.params.forEach((q) => namesOf(q, o));
        if (n.type === 'FunctionExpression' && n.id) o.push(n.id.name);
        if (n.body.type === 'BlockStatement') { lexical(n.body.body, o); collectVar(n.body, o); }
        return new Set(o);
      }
      case 'BlockStatement': return new Set(lexical(n.body, []));
      case 'StaticBlock': { const o = lexical(n.body, []); collectVar(n.body, o); return new Set(o); }
      case 'SwitchStatement': return new Set(lexical(n.cases.flatMap((c) => c.consequent), []));
      case 'ForStatement': return n.init?.type === 'VariableDeclaration' && n.init.kind !== 'var' ? new Set(n.init.declarations.flatMap((d) => namesOf(d.id, []))) : null;
      case 'ForInStatement': case 'ForOfStatement': return n.left.type === 'VariableDeclaration' && n.left.kind !== 'var' ? new Set(n.left.declarations.flatMap((d) => namesOf(d.id, []))) : null;
      case 'CatchClause': return new Set(namesOf(n.param, []));
      case 'ClassExpression': return n.id ? new Set([n.id.name]) : null;
      default: return null;
    }
  };
  const isDeclared = (chain, name) => chain.some((sc) => sc.has(name));

  // ---------- 计算属性名：能静态算出来的就按字面量检查，算不出来的给提示 ----------
  // 只折叠字面量、无插值模板串、字符串 + 拼接，以及同一作用域链上 const 绑定的这些表达式。
  const constInit = new Map();               // const 声明节点的 Identifier 名 → 初始化表达式（按名字，保守：同名多次声明则不折叠）
  const constCount = new Map();
  (function scan(n) {
    if (Array.isArray(n)) return n.forEach(scan);
    if (!n || typeof n.type !== 'string') return;
    const bump = (name) => constCount.set(name, (constCount.get(name) || 0) + 1); // 同名绑定出现不止一次（含参数、catch、解构）就不折叠
    if (n.type === 'VariableDeclarator') namesOf(n.id, []).forEach(bump);
    if (FN.has(n.type)) { n.params.forEach((q) => namesOf(q, []).forEach(bump)); if (n.id) bump(n.id.name); }
    if (n.type === 'CatchClause') namesOf(n.param, []).forEach(bump);
    if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) bump(n.id.name);
    if (n.type === 'VariableDeclaration' && n.kind === 'const') n.declarations.forEach((d) => { if (d.id.type === 'Identifier' && d.init) constInit.set(d.id.name, { init: d.init, isConst: true }); });
    for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v && typeof v === 'object') scan(v);
  })(ast);
  const fold = (e, depth = 0) => {
    if (!e || depth > 20) return undefined;
    if (e.type === 'Literal') return typeof e.value === 'string' || typeof e.value === 'number' ? String(e.value) : undefined;
    if (e.type === 'TemplateLiteral') {
      let out = e.quasis[0].value.cooked ?? '';
      for (let i = 0; i < e.expressions.length; i++) { const v = fold(e.expressions[i], depth + 1); if (v === undefined) return undefined; out += v + (e.quasis[i + 1].value.cooked ?? ''); }
      return out;
    }
    if (e.type === 'BinaryExpression' && e.operator === '+') { const a = fold(e.left, depth + 1); const b = fold(e.right, depth + 1); return a === undefined || b === undefined ? undefined : a + b; }
    if (e.type === 'Identifier') { const c = constInit.get(e.name); return c && c.isConst && constCount.get(e.name) === 1 ? fold(c.init, depth + 1) : undefined; }
    return undefined;
  };
  const isLiteralUrl = (e) => (e?.type === 'Literal' && typeof e.value === 'string') || (e?.type === 'TemplateLiteral' && e.expressions.length === 0);
  const dynamicUrlReason = (arg) => {
    if (!arg) return '没有传参数';
    if (arg.type !== 'ObjectExpression') return '参数对象不是字面量对象，看不到 url';
    if (arg.properties.some((q) => q.type === 'SpreadElement')) return '参数对象含展开（...），url 可能被覆盖';
    const urlProps = arg.properties.filter((q) => q.type === 'Property' && (q.computed ? fold(q.key) === 'url' || fold(q.key) === undefined : (q.key.name ?? q.key.value) === 'url'));
    if (!urlProps.length) return '参数对象里没有 url 字面量属性';
    const v = urlProps[urlProps.length - 1];
    if (v.computed && fold(v.key) === undefined) return '属性名是计算出来的';
    if (v.shorthand || !isLiteralUrl(v.value)) {
      const t = v.value.type;
      const kind = t === 'BinaryExpression' ? '字符串拼接' : t === 'TemplateLiteral' ? '带插值的模板串' : t === 'Identifier' ? `变量 ${v.value.name}` : t === 'CallExpression' ? (memberPath(v.value.callee) === 'String.fromCharCode' ? 'String.fromCharCode' : '函数调用结果') : '非字面量表达式';
      return `url 是${kind}`;
    }
    return null;
  };
  const dynamicUrls = [];
  const DESTRUCTURE_BAD = new Set(['constructor', '__proto__', 'prototype']);
  const urls = [];
  const reported = new Set();
  let dynamicMembers = 0; let firstDynamic = null;
  const reportProp = (prop, node, how) => {
    if (FORBIDDEN_PROPS.has(prop) && !reported.has('.' + prop)) { reported.add('.' + prop); E('E_CODE_FORBIDDEN_API', `不允许${how}${prop}（${FORBIDDEN_PROPS.get(prop)}）`, node); }
  };

  // ---------- platform 别名 / 间接调用（VAL-13 复核第 2 轮 P2-1，2026-10-15） ----------
  // 只承认一种写法：platform.<固定路径>(...) 直接调用。把 platform、platform.net 或 platform.net.fetch 赋给变量、解构、
  // 作为参数传出、返回、run 的第二个参数写成解构等，W_CODE_DYNAMIC_URL 都看不到调用处的网址，报 W_CODE_PLATFORM_ALIAS。
  // 对 platform / platform.* 的计算属性访问（platform.net['fe'+'tch']）即使能折叠成字符串，也计入 W_CODE_DYNAMIC_MEMBER。
  // 第 3 轮 P2-3：按**绑定**识别 platform，而不是按名字。run 的第二个形参叫什么都算（run(input, p)），
  // 内层作用域重新声明同名变量（{ const platform = … }）则不算。
  const runFn = ast.body.map((st) => (st.type === 'ExportDefaultDeclaration' ? st.declaration : null)).find((d) => d?.type === 'FunctionDeclaration' && d.id?.name === 'run');
  const platParam = runFn?.params?.[1];
  const platName = platParam?.type === 'Identifier' ? platParam.name : null;
  let runScope = null;                       // visit 进入 run 时记下 run 的作用域集合（引用比较）
  const isPlatformRef = (name, chain) => {
    if (!platName || name !== platName || !runScope) return false;
    const i = chain.indexOf(runScope);
    return i >= 0 && !chain.slice(0, i).some((sc) => sc.has(name));
  };
  // 把成员路径的根换成规范名 platform（根是 platform 绑定时）；否则返回 null
  const platPath = (n, chain) => {
    const path = memberPath(n); if (!path) return null;
    const root = path.split('.')[0];
    return isPlatformRef(root, chain) ? 'platform' + path.slice(root.length) : null;
  };
  const parents = new WeakMap();
  (function link(n, parent, key) {
    if (Array.isArray(n)) return n.forEach((c) => link(c, parent, key));
    if (!n || typeof n.type !== 'string') return;
    parents.set(n, { parent, key });
    for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v && typeof v === 'object') link(v, n, k);
  })(ast, null, null);
  const aliases = []; const reportedAlias = new Set(); const dynCounted = new Set();
  const platformUse = (id, chain) => {             // id：引用 platform 的 Identifier；返回 null（正常直接调用）或问题描述
    let n = id; let up = parents.get(n);
    while (up?.parent?.type === 'MemberExpression' && up.key === 'object') {
      if (up.parent.computed) return { dynMember: up.parent };
      n = up.parent; up = parents.get(n);
    }
    if (up?.parent?.type === 'ChainExpression') { n = up.parent; up = parents.get(n); }
    const path = n.type === 'MemberExpression' ? platPath(n, chain) : 'platform';
    if (up?.parent?.type === 'CallExpression' && up.key === 'callee' && n !== id) return null;   // 直接调用（是否合法由 PLATFORM_OK 检查）
    if (n !== id && up?.parent?.type !== 'AssignmentExpression' && !/^platform(\.net(\.fetch)?)?$/.test(path || '')) return null; // 读 platform.usage 等以外的普通属性值，不涉及网络
    return { alias: path || 'platform', node: n };
  };
  for (const st of ast.body) {               // run(input, { net }) 这种参数解构也算别名
    const d = st.type === 'ExportDefaultDeclaration' ? st.declaration : null;
    if (d !== runFn) continue;
    if (d.params[1] && d.params[1].type !== 'Identifier') aliases.push({ node: d.params[1], what: 'run 的第二个参数（platform）不是简单标识符（解构 / 默认值 / 剩余参数）' });
    if (d.params.some((q) => q.type === 'RestElement')) aliases.push({ node: d.params.find((q) => q.type === 'RestElement'), what: 'run 用剩余参数接收 platform' });
  }

  const visit = (n, parent, key, chain) => {
    if (Array.isArray(n)) return n.forEach((c) => visit(c, parent, key, chain));
    if (!n || typeof n.type !== 'string') return;
    const sc = scopeOf(n);
    if (sc) chain = [sc, ...chain];
    if (n === runFn) runScope = sc;
    switch (n.type) {
      case 'ImportExpression': E('E_CODE_ENTRY', 'v1 代码步骤不允许动态 import()', n); break;
      case 'MetaProperty': if (n.meta.name === 'import') E('E_CODE_ENTRY', 'v1 代码步骤不允许 import.meta', n); break;
      case 'Identifier': {
        const isPropKey = (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed)
          || (parent?.type === 'Property' && key === 'key' && !parent.computed)
          || (parent?.type === 'MethodDefinition' && key === 'key' && !parent.computed) || (parent?.type === 'PropertyDefinition' && key === 'key' && !parent.computed)
          || ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent?.type);
        // run 里用 arguments（不经过形参名就能拿到 platform）：箭头函数没有自己的 arguments，取最近的普通函数
        if (!isPropKey && n.name === 'arguments' && runFn && !isDeclared(chain, 'arguments')) {
          let f = n; let up;
          while ((up = parents.get(f)) && up.parent) { f = up.parent; if (f.type === 'FunctionDeclaration' || f.type === 'FunctionExpression') break; }
          if (f === runFn) aliases.push({ node: n, what: 'run 里使用 arguments（可借此拿到 platform）' });
        }
        if (!isPropKey && key !== 'params' && isPlatformRef(n.name, chain)) {
          const u = platformUse(n, chain);
          if (u?.dynMember) { if (!dynCounted.has(u.dynMember)) { dynCounted.add(u.dynMember); dynamicMembers++; firstDynamic ??= u.dynMember; } }
          else if (u?.alias && !reportedAlias.has(u.node)) { reportedAlias.add(u.node); aliases.push({ node: u.node, what: `${u.alias} 被赋值、解构或传出后间接使用` }); }
        }
        if (!isPropKey && FORBIDDEN_GLOBALS.has(n.name) && !isDeclared(chain, n.name) && !reported.has(n.name)) {
          reported.add(n.name); E('E_CODE_FORBIDDEN_API', `不允许使用 ${n.name}（${FORBIDDEN_GLOBALS.get(n.name)}）`, n);
        }
        break;
      }
      case 'MemberExpression': {
        let prop = !n.computed ? n.property.name ?? null : fold(n.property);
        if (!n.computed && n.property.type === 'PrivateIdentifier') prop = null;
        if (n.computed && prop === undefined) { dynamicMembers++; firstDynamic ??= n; dynCounted.add(n); }
        if (prop) reportProp(prop, n, '访问 .');
        const path = platPath(n, chain);
        if (path && path.startsWith('platform.') && parent?.type === 'CallExpression' && key === 'callee' && !PLATFORM_OK.test(path))
          E('E_CODE_FORBIDDEN_API', `${path} 不是 v1 的平台接口（可用：platform.net.fetch、platform.model.call、platform.storage.*、platform.usage.get；PRD v0.2 的 platform.fetch 已作废）`, n);
        break;
      }
      case 'CallExpression': {
        // W_CODE_DYNAMIC_URL（VAL-13 复核 2026-10-15）：platform.net.fetch 的 url 不是字面量时，校验器无法把它和 permissions.network 比对。
        // 只认纯字符串字面量和无插值模板串；拼接、插值、String.fromCharCode、变量（含 const）、函数返回值、整个参数对象来自变量等一律提示。
        // 这是尽力而为的静态提示；真正的边界是运行时请求层按 permissions.network 白名单检查（未声明返回 NOT_DECLARED）。
        if (n.callee.type === 'MemberExpression' && platPath(n.callee, chain) === 'platform.net.fetch') {
          const why = dynamicUrlReason(n.arguments[0]);
          if (why) dynamicUrls.push({ node: n, why });
        }
        break;
      }
      case 'ObjectPattern':                  // 解构取 constructor / __proto__ / prototype：const { constructor: F } = () => {}
        for (const q of n.properties) {
          if (q.type !== 'Property') continue;
          const k = q.computed ? fold(q.key) : q.key.type === 'Identifier' ? q.key.name : String(q.key.value);
          if (k === undefined) { dynamicMembers++; firstDynamic ??= q; continue; }
          if (DESTRUCTURE_BAD.has(k) && !reported.has('{' + k)) { reported.add('{' + k); E('E_CODE_FORBIDDEN_API', `不允许用解构取出 ${k}（可借此拿到 Function 或改原型）`, q); }
          else reportProp(k, q, '解构取出 ');
        }
        break;
      case 'Literal':
        if (typeof n.value === 'string' && /^(https?|wss?):\/\//i.test(n.value)) urls.push(n.value);
        break;
      case 'TemplateElement':
        if (/^(https?|wss?):\/\//i.test(n.value.cooked || '')) urls.push(n.value.cooked);
        break;
      default:
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v && typeof v === 'object') visit(v, n, k, chain);
  };
  visit(ast, null, null, []);
  const warnings = [];
  if (dynamicMembers) warnings.push({ code: 'W_CODE_DYNAMIC_MEMBER', message: `${firstDynamic?.loc ? `第 ${firstDynamic.loc.start.line} 行起` : ''}共 ${dynamicMembers} 处计算属性名（obj[变量]）无法静态确定，校验器看不出它会不会取到 constructor 等危险属性；官方库和人工联审时请逐处确认（真正的边界在沙箱运行时）` });
  if (aliases.length) {
    const f = aliases[0];
    warnings.push({ code: 'W_CODE_PLATFORM_ALIAS', message: `${f.node.loc ? `第 ${f.node.loc.start.line} 行起` : ''}共 ${aliases.length} 处没有直接写 platform.net.fetch(...) 等平台调用（${[...new Set(aliases.map((a) => a.what))].join('；')}），校验器无法检查经别名发出的请求网址；请直接调用 platform.<接口>(...)。这是尽力而为的静态检查，真正的拦截在运行时请求层（未声明网址返回 NOT_DECLARED）` });
  }
  if (dynamicUrls.length) {
    const f = dynamicUrls[0];
    warnings.push({ code: 'W_CODE_DYNAMIC_URL', message: `${f.node.loc ? `第 ${f.node.loc.start.line} 行起` : ''}共 ${dynamicUrls.length} 处 platform.net.fetch 的网址不是字面量（${[...new Set(dynamicUrls.map((d) => d.why))].join('；')}），校验器无法确认它落在 permissions.network 声明范围内；请改成字面量网址，或在人工联审时逐处确认。这是尽力而为的静态检查，真正的拦截在运行时请求层（未声明网址返回 NOT_DECLARED）` });
  }
  return { errors, warnings, urls };
}
