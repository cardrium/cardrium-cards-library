#!/usr/bin/env node
// 官方示范卡片仓库：校验每张卡片目录并生成静态索引 index.json（草案，运维）
//
// 目录约定（每张卡片一个目录）：
//   cards/<id>/card.json      卡片定义，必须符合 m0/card-schema-v1.json（架构师定稿为准）
//   cards/<id>/manifest.json  上架清单，符合 ops/schemas/card-manifest.schema.json
//   cards/<id>/README.md      说明（数据源、权限解释、测试说明）
//   cards/<id>/preview.png|webp 预览图
//
// 用法：
//   node build-card-index.mjs --cards ./cards --out ./dist \
//        [--manifest-schema ./schemas/card-manifest.schema.json] \
//        [--card-validator ./node_modules/.../validate-card.mjs] \
//        [--allow-unreviewed] [--check] [--base-path v1] [--public-base-url https://cards.example.com]
//
//   --check             只校验不输出
//   --allow-unreviewed  PR 阶段使用：审核字段缺失/过期降级为警告（合入 main 后的发布构建不得使用）
//   --card-validator    指向导出 validateCard(card) 的模块（M0 的 card-validator/lib/validate-card.mjs）；
//                       未提供时只做本脚本内置的最小检查，并给出警告
//   环境变量 GITHUB_SHA / SOURCE_DATE_EPOCH 会写入索引的 source / generatedAt（不设置则省略，保证输出可复现）
//
// 退出码：0 通过；1 有错误；2 参数错误
// 只依赖 Node ≥ 18 内置模块；manifest 的 JSON Schema 校验在能解析到 ajv 时启用（ajv 从 --card-validator 所在目录或当前目录解析）。

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const INDEX_VERSION = 1;
const SUPPORTED_SCHEMA_VERSIONS = new Set(['1']);
const MAX_CARD_BYTES = 1024 * 1024;        // 与 PRD F-TP-01 导入上限一致
const MAX_PREVIEW_BYTES = 300 * 1024;
const MAX_README_BYTES = 64 * 1024;
const ALLOWED_FILES = new Set(['card.json', 'manifest.json', 'README.md', 'preview.png', 'preview.webp']);
// 疑似密钥（与 PRD F-TP-01/02 的“疑似 Key 检查”同一思路；正式规则以前端实现为准）
const SECRET_PATTERNS = [
  [/sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/, 'OpenAI/Anthropic 风格 Key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API Key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub Token'],
  [/github_pat_[A-Za-z0-9_]{40,}/, 'GitHub 细粒度 Token'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack Token'],
  [/Bearer\s+[A-Za-z0-9._~+/-]{24,}=*/, 'Bearer 凭证'],
];

// ---------- 参数 ----------
function parseArgs(argv) {
  const o = { cards: 'cards', out: 'dist', basePath: 'v1', check: false, allowUnreviewed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) { console.error(`参数 ${a} 缺少值`); process.exit(2); } return v; };
    if (a === '--cards') o.cards = next();
    else if (a === '--out') o.out = next();
    else if (a === '--base-path') o.basePath = next().replace(/^\/+|\/+$/g, '');
    else if (a === '--manifest-schema') o.manifestSchema = next();
    else if (a === '--card-validator') o.cardValidator = next();
    else if (a === '--public-base-url') o.publicBaseUrl = next().replace(/\/+$/, '');
    else if (a === '--check') o.check = true;
    else if (a === '--allow-unreviewed') o.allowUnreviewed = true;
    else if (a === '-h' || a === '--help') { console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0); }
    else { console.error(`未知参数：${a}`); process.exit(2); }
  }
  return o;
}

// ---------- 工具 ----------
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const readJson = (file, errors, label) => {
  const buf = readFileSync(file);
  try { return { buf, data: JSON.parse(buf.toString('utf8')) }; }
  catch (e) { errors.push(`${label}：JSON 语法错误（${e.message}）`); return { buf, data: null }; }
};

function imageInfo(buf) {
  // PNG: 8 字节签名 + IHDR（宽高各 4 字节大端）
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
    if (chunk === 'VP8 ') return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function hostsFromNetwork(patterns = []) {
  const hosts = new Set();
  for (const p of patterns) {
    if (/^\{\{\s*inputs\./.test(p)) { hosts.add('(用户自填)'); continue; }
    const m = /^[a-z]+:\/\/([^/]+)/i.exec(p);
    if (m) hosts.add(m[1].toLowerCase());
  }
  return [...hosts].sort();
}

async function loadAjv(fromDirs) {
  for (const d of fromDirs) {
    try {
      const req = createRequire(join(resolve(d), 'noop.js'));
      const Ajv2020 = req('ajv/dist/2020.js');
      let addFormats = null;
      try { addFormats = req('ajv-formats'); } catch { /* 可选 */ }
      return { Ajv2020: Ajv2020.default || Ajv2020, addFormats: addFormats && (addFormats.default || addFormats) };
    } catch { /* 尝试下一个目录 */ }
  }
  return null;
}

// ---------- 主流程 ----------
async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const cardsDir = resolve(opt.cards);
  if (!existsSync(cardsDir) || !statSync(cardsDir).isDirectory()) { console.error(`找不到卡片目录：${cardsDir}`); process.exit(2); }

  const globalWarnings = [];
  let validateCard = null;
  if (opt.cardValidator) {
    const mod = await import(pathToFileURL(resolve(opt.cardValidator)).href);
    validateCard = mod.validateCard;
    if (typeof validateCard !== 'function') { console.error('--card-validator 模块没有导出 validateCard(card)'); process.exit(2); }
  } else {
    globalWarnings.push('未提供 --card-validator：只做内置最小检查，未按卡片 schema v1 完整校验（发布构建必须提供）');
  }

  let validateManifest = null;
  if (opt.manifestSchema) {
    const ajvLib = await loadAjv([opt.cardValidator ? dirname(resolve(opt.cardValidator)) : null, process.cwd(), dirname(resolve(opt.manifestSchema))].filter(Boolean));
    if (ajvLib) {
      const ajv = new ajvLib.Ajv2020({ allErrors: true, strict: true, strictRequired: false });
      if (ajvLib.addFormats) ajvLib.addFormats(ajv); else ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
      validateManifest = ajv.compile(JSON.parse(readFileSync(resolve(opt.manifestSchema), 'utf8')));
    } else {
      globalWarnings.push('解析不到 ajv：manifest.json 只做内置检查（安装 ajv 后可启用完整 JSON Schema 校验）');
    }
  }

  const dirs = readdirSync(cardsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name).sort();

  const entries = [];
  const report = [];
  const seenIds = new Set();
  let errorCount = 0;

  for (const name of dirs) {
    const dir = join(cardsDir, name);
    const errors = [];
    const warnings = [];
    const reviewProblem = (msg) => (opt.allowUnreviewed ? warnings : errors).push(msg);

    // 1. 文件清单
    const files = readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      if (f.isDirectory()) errors.push(`不允许子目录：${f.name}/（代码写在 card.json 的 code 步骤里，保证“审核的就是用户导入的”）`);
      else if (!ALLOWED_FILES.has(f.name)) errors.push(`不允许的文件：${f.name}（只允许 ${[...ALLOWED_FILES].join('、')}；禁止 .svg/.html/.js 等可执行内容）`);
    }
    for (const req of ['card.json', 'manifest.json', 'README.md']) if (!existsSync(join(dir, req))) errors.push(`缺少 ${req}`);
    if (errors.length) { report.push({ name, errors, warnings }); errorCount += errors.length; continue; }

    // 2. 读取与大小
    const cardStat = statSync(join(dir, 'card.json'));
    if (cardStat.size > MAX_CARD_BYTES) errors.push(`card.json 超过 1MB（${cardStat.size} 字节）`);
    const { buf: cardBuf, data: card } = readJson(join(dir, 'card.json'), errors, 'card.json');
    const { data: manifest } = readJson(join(dir, 'manifest.json'), errors, 'manifest.json');
    const readmeSize = statSync(join(dir, 'README.md')).size;
    if (readmeSize > MAX_README_BYTES) warnings.push(`README.md 较大（${readmeSize} 字节）`);
    if (!card || !manifest) { report.push({ name, errors, warnings }); errorCount += errors.length; continue; }

    // 3. 卡片定义校验
    if (!SUPPORTED_SCHEMA_VERSIONS.has(card.schemaVersion)) errors.push(`card.json schemaVersion=${JSON.stringify(card.schemaVersion)} 不在支持列表 ${[...SUPPORTED_SCHEMA_VERSIONS]}`);
    if (validateCard) {
      const r = validateCard(card);
      for (const e of r.errors || []) errors.push(`card.json ${e.code ? `[${e.code}] ` : ''}${e.path || ''} ${e.message}`);
      for (const w of r.warnings || []) warnings.push(`card.json ${w.code ? `[${w.code}] ` : ''}${w.path || ''} ${w.message}`);
    } else {
      if (!card.meta || typeof card.meta !== 'object') errors.push('card.json 缺少 meta');
      if (!card.permissions || typeof card.permissions !== 'object') errors.push('card.json 缺少 permissions');
      if (!Array.isArray(card.workflow?.steps)) errors.push('card.json 缺少 workflow.steps');
    }
    const meta = card.meta || {};
    const perms = card.permissions || {};
    const steps = Array.isArray(card.workflow?.steps) ? card.workflow.steps : [];

    // 4. manifest 校验
    if (validateManifest && !validateManifest(manifest)) {
      for (const e of validateManifest.errors) errors.push(`manifest.json ${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? `：${e.params.additionalProperty}` : ''}`);
    } else if (!validateManifest) {
      for (const k of ['id', 'status', 'preview', 'review']) if (manifest[k] === undefined) errors.push(`manifest.json 缺少 ${k}`);
    }

    // 5. 跨文件一致性
    if (manifest.id !== name) errors.push(`manifest.id（${manifest.id}）必须等于目录名（${name}）`);
    if (meta.id !== name) errors.push(`card.json meta.id（${meta.id}）必须等于目录名（${name}）`);
    if (seenIds.has(name)) errors.push(`重复的 id：${name}`);
    seenIds.add(name);
    const hasCodeStep = steps.some((s) => s?.type === 'code');
    if (hasCodeStep !== (perms.code === true)) errors.push(`permissions.code=${perms.code} 与实际是否含代码步骤（${hasCodeStep}）不一致`);

    // 6. 审核门槛
    const review = manifest.review || {};
    if (review.reviewedVersion !== meta.version) reviewProblem(`审核版本 review.reviewedVersion（${review.reviewedVersion}）≠ 当前版本 meta.version（${meta.version}）：改动后需重新审核`);
    if (perms.code === true && !(Array.isArray(review.securityReviewedBy) && review.securityReviewedBy.length)) reviewProblem('含自定义代码的卡片必须有安全审核人（review.securityReviewedBy）');

    // 7. 预览图
    let preview = null;
    if (manifest.preview) {
      const p = join(dir, manifest.preview);
      if (!existsSync(p)) errors.push(`找不到预览图 ${manifest.preview}`);
      else {
        const buf = readFileSync(p);
        const info = imageInfo(buf);
        if (!info) errors.push(`${manifest.preview} 不是有效的 PNG/WebP 文件（按文件头判断）`);
        else {
          if (`.${info.type}` !== extname(p)) errors.push(`${manifest.preview} 扩展名与实际格式（${info.type}）不符`);
          if (buf.length > MAX_PREVIEW_BYTES) errors.push(`${manifest.preview} 超过 ${MAX_PREVIEW_BYTES / 1024}KB（${Math.round(buf.length / 1024)}KB）`);
          const ratio = info.width / info.height;
          if (info.width < 600 || Math.abs(ratio - 1.6) > 0.05) warnings.push(`预览图建议 1200×750（16:10），当前 ${info.width}×${info.height}`);
          preview = { file: manifest.preview, width: info.width, height: info.height, sha256: sha256(buf) };
        }
      }
    }
    for (const f of files) if (f.name.startsWith('preview.') && f.name !== manifest.preview) errors.push(`多余的预览图 ${f.name}（manifest 只引用 ${manifest.preview}）`);

    // 8. 疑似密钥
    const text = cardBuf.toString('utf8');
    for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) errors.push(`card.json 含疑似密钥（${label}）——不得提交任何真实凭证`);

    if (errors.length === 0) {
      const cardSha = sha256(cardBuf);
      const base = `cards/${name}`;
      entries.push({
        order: manifest.order ?? 1000,
        entry: {
          id: name,
          name: meta.name,
          description: meta.description,
          author: meta.author,
          version: meta.version,
          tags: meta.tags || [],
          icon: meta.icon,
          locale: meta.locale,
          license: meta.license || 'MIT-0',
          status: manifest.status,
          schemaVersion: card.schemaVersion,
          minAppVersion: manifest.minAppVersion,
          // PRD F-TP-03 要求的标记
          requiresModel: perms.model === true,
          requiresWebSearch: steps.some((s) => s?.type === 'ai_search'),
          hasCode: perms.code === true,
          noKey: perms.model !== true,
          networkHosts: hostsFromNetwork(perms.network),
          // ?v=<sha 前 12 位>：浏览器缓存键随内容变化，可对卡片文件设较长缓存；站点下载后再用 sha256 校验完整性
          path: `${base}/card.json?v=${cardSha.slice(0, 12)}`,
          sha256: cardSha,
          size: cardBuf.length,
          readme: `${base}/README.md`,
          preview: preview ? { path: `${base}/${preview.file}?v=${preview.sha256.slice(0, 12)}`, width: preview.width, height: preview.height } : undefined,
          review: {
            reviewedVersion: review.reviewedVersion,
            reviewedAt: review.reviewedAt,
            securityReviewed: Array.isArray(review.securityReviewedBy) && review.securityReviewedBy.length > 0,
          },
          deprecated: manifest.deprecated,
        },
        dir,
        previewFile: preview?.file,
      });
    }
    report.push({ name, errors, warnings });
    errorCount += errors.length;
  }

  // ---------- 报告 ----------
  for (const w of globalWarnings) console.log(`警告  ${w}`);
  for (const r of report) {
    console.log(`${r.errors.length ? '失败' : '通过'}  ${r.name}${r.warnings.length ? `（${r.warnings.length} 条警告）` : ''}`);
    r.errors.forEach((e) => console.log(`    ✗ ${e}`));
    r.warnings.forEach((w) => console.log(`    ! ${w}`));
  }
  if (dirs.length === 0) { console.log('没有找到任何卡片目录'); errorCount++; }
  console.log(`\n共 ${dirs.length} 张卡片，${errorCount === 0 ? '全部通过' : `${errorCount} 个错误`}`);
  if (errorCount > 0) process.exit(1);
  if (opt.check) return;

  // ---------- 输出 ----------
  entries.sort((a, b) => a.order - b.order || a.entry.id.localeCompare(b.entry.id));
  const index = {
    indexVersion: INDEX_VERSION,
    schemaVersions: [...SUPPORTED_SCHEMA_VERSIONS],
    ...(process.env.SOURCE_DATE_EPOCH ? { generatedAt: new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString() } : {}),
    ...(process.env.GITHUB_SHA ? { source: { repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA } } : {}),
    ...(opt.publicBaseUrl ? { baseUrl: `${opt.publicBaseUrl}/${opt.basePath}/` } : {}),
    count: entries.length,
    cards: entries.map((e) => JSON.parse(JSON.stringify(e.entry))), // 去掉 undefined 字段
  };

  const outRoot = resolve(opt.out);
  const outBase = join(outRoot, opt.basePath);
  rmSync(outBase, { recursive: true, force: true });
  mkdirSync(outBase, { recursive: true });
  for (const e of entries) {
    const target = join(outBase, 'cards', e.entry.id);
    mkdirSync(target, { recursive: true });
    copyFileSync(join(e.dir, 'card.json'), join(target, 'card.json'));
    copyFileSync(join(e.dir, 'README.md'), join(target, 'README.md'));
    if (e.previewFile) copyFileSync(join(e.dir, e.previewFile), join(target, e.previewFile));
  }
  writeFileSync(join(outBase, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  writeFileSync(join(outRoot, '_headers'), headersFile(opt.basePath));
  console.log(`已生成 ${join(outBase, 'index.json')}（${entries.length} 张）和 ${join(outRoot, '_headers')}`);
}

// 卡片静态站点的响应头（Cloudflare Pages / Workers static assets 的 _headers 语法）
function headersFile(base) {
  return `# 由 build-card-index.mjs 生成。卡片站点只提供数据，不执行任何脚本。
/*
  Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cross-Origin-Resource-Policy: cross-origin
  Access-Control-Allow-Origin: *

/${base}/index.json
  Cache-Control: public, max-age=300, stale-while-revalidate=3600

/${base}/cards/*
  Cache-Control: public, max-age=86400
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
