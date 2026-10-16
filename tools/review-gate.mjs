#!/usr/bin/env node
// review-gate：只读仓库内容，不调用 GitHub API。
// 对每张卡片检查：
//   1. 含代码（permissions.code=true，或 workflow 里任意层级有 type=code 的步骤）必须有 review.securityReviewedBy 与 securityReviewRecord；
//   2. reviewRecord / securityReviewRecord 指向仓库 reviews/ 下存在的普通文件；
//   3. 记录里有本卡的机器可读条目，id、version、card.json sha256 逐字精确相等（1.0.10 ≠ 1.0.1）。两种格式任选其一：
//      a. <!-- review-record:start --> ```json {"cards":[{"id","version","cardSha256"}]} ``` <!-- review-record:end -->
//      b. 独占一行：review: <id>@<version> sha256=<64 位小写十六进制>
// card-validator 没有导出“是否含代码”的判断函数，这里自行判断（不修改校验器）。
// 用法：node tools/review-gate.mjs [--cards <目录>]
import { readFileSync, readdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';

const i = process.argv.indexOf('--cards');
const cardsDir = i === -1 ? 'cards' : process.argv[i + 1];
if (!cardsDir) { console.log('::error::--cards 缺少值'); process.exit(2); }

const root = realpathSync(process.cwd());
const reviewsRoot = join(root, 'reviews') + sep;
let failed = 0;
const fail = (id, msg) => { failed++; console.log(`::error::[${id}] ${msg}`); };

const LINE_RE = /^review: (\S+)@(\S+) sha256=([0-9a-f]{64})$/;
const BLOCK_RE = /<!-- review-record:start -->\s*```json\s*\n([\s\S]*?)\n```\s*<!-- review-record:end -->/g;

export function recordEntries(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (m) out.push({ id: m[1], version: m[2], sha256: m[3], via: 'line' });
  }
  for (const m of text.matchAll(BLOCK_RE)) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    for (const c of Array.isArray(j?.cards) ? j.cards : []) {
      if (typeof c?.id === 'string' && typeof c?.version === 'string' && typeof c?.cardSha256 === 'string') out.push({ id: c.id, version: c.version, sha256: c.cardSha256, via: 'json' });
    }
  }
  return out;
}

export function hasCodeStep(node) {
  if (Array.isArray(node)) return node.some(hasCodeStep);
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'code') return true;
  return Object.values(node).some(hasCodeStep);
}

function checkRecord(id, kind, rel, version, cardSha) {
  if (typeof rel !== 'string' || !rel) { fail(id, `缺少 review.${kind}`); return; }
  const abs = resolve(root, rel);
  if (!abs.startsWith(reviewsRoot)) { fail(id, `${kind}（${rel}）必须位于仓库 reviews/ 目录下`); return; }
  if (!existsSync(abs) || !lstatSync(abs).isFile()) { fail(id, `${kind} 指向的文件不存在或不是普通文件：${rel}`); return; }
  const entries = recordEntries(readFileSync(abs, 'utf8')).filter((e) => e.id === id);
  if (!entries.length) { fail(id, `${kind}（${rel}）没有本卡的机器可读条目（review: ${id}@<version> sha256=<hash> 或 review-record JSON 段）`); return; }
  const ok = entries.find((e) => e.version === version && e.sha256 === cardSha);
  if (ok) console.log(`[${id}] ${kind} OK（${ok.via}）：${rel}`);
  else fail(id, `${kind}（${rel}）中本卡条目与当前不符：需要 ${id}@${version} sha256=${cardSha}，记录中为 ${entries.map((e) => `${e.version} ${e.sha256}`).join('；')}`);
}

const names = readdirSync(cardsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
if (!names.length) { console.log('::error::cards 目录为空'); process.exit(1); }
for (const id of names) {
  const dir = join(cardsDir, id);
  let card, manifest, cardBuf;
  try {
    cardBuf = readFileSync(join(dir, 'card.json'));
    card = JSON.parse(cardBuf.toString('utf8'));
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  } catch (e) { fail(id, `无法读取 card.json / manifest.json：${e.message}`); continue; }
  const cardSha = createHash('sha256').update(cardBuf).digest('hex');
  const version = typeof card?.meta?.version === 'string' ? card.meta.version : '';
  if (!version) { fail(id, 'card.json 缺少 meta.version'); continue; }
  const hasCode = card?.permissions?.code === true || hasCodeStep(card?.workflow);
  const review = manifest.review || {};
  if (review.reviewedVersion !== version) fail(id, `reviewedVersion（${review.reviewedVersion}）≠ meta.version（${version}）`);
  if (!(Array.isArray(review.reviewedBy) && review.reviewedBy.length)) fail(id, '缺少 review.reviewedBy');
  checkRecord(id, 'reviewRecord', review.reviewRecord, version, cardSha);
  if (hasCode) {
    if (!(Array.isArray(review.securityReviewedBy) && review.securityReviewedBy.length)) fail(id, '含代码的卡片必须有 review.securityReviewedBy');
    checkRecord(id, 'securityReviewRecord', review.securityReviewRecord, version, cardSha);
  } else if (review.securityReviewRecord !== undefined) {
    checkRecord(id, 'securityReviewRecord', review.securityReviewRecord, version, cardSha);
  }
}
if (failed) { console.log(`review-gate 失败：${failed} 项`); process.exit(1); }
console.log('review-gate 通过');
