#!/usr/bin/env node
// production-gate：生产索引门禁 + 发布前摘要。由 CI 从 base 分支（PR）或当前 main（push）加载，不从 PR head 加载。
// 用法：node production-gate.mjs --repo <被检查的工作树> --preconditions <base 分支上的 preconditions.json> [--summary]
// 失败条件：含代码卡片前提未关闭/sha 不符；cards/ 下有符号链接、submodule（A5）。
import { readFileSync, readdirSync, lstatSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const repo = arg('--repo', '.'); const pre = JSON.parse(readFileSync(arg('--preconditions'), 'utf8')).cards || {};
const hasCodeStep = (n) => Array.isArray(n) ? n.some(hasCodeStep) : (n && typeof n === 'object') ? (n.type === 'code' || Object.values(n).some(hasCodeStep)) : false;
let bad = 0; const rows = []; const err = (m) => { bad++; console.log(`::error::${m}`); };
const ls = execFileSync('git', ['-C', repo, 'ls-files', '-s'], { encoding: 'utf8' });
for (const l of ls.split('\n')) { const m = /^(\d+) \S+ \d\t(.*)$/.exec(l); if (m && (m[1] === '120000' || m[1] === '160000')) err(`禁止符号链接/submodule：${m[2]}（mode ${m[1]}）`); }
if (existsSync(join(repo, '.gitmodules'))) err('禁止 .gitmodules');
const cdir = join(repo, 'cards');
for (const d of readdirSync(cdir).sort()) {
  const p = join(cdir, d); if (lstatSync(p).isSymbolicLink()) { err(`cards/${d} 是符号链接`); continue; } if (!lstatSync(p).isDirectory()) continue;
  const buf = readFileSync(join(p, 'card.json')); const card = JSON.parse(buf); const sha = createHash('sha256').update(buf).digest('hex');
  const code = card?.permissions?.code === true || hasCodeStep(card?.workflow) || hasCodeStep(card);
  const pc = pre[d]; const met = !code || (pc?.closed === true && pc?.cardSha256 === sha);
  if (!met) err(`[${d}] 含代码卡片，安全前提未关闭（${pc?.precondition || '未登记'}），拒绝进入生产索引`);
  rows.push({ id: d, version: card?.meta?.version, code, met, sha: sha.slice(0, 12), pre: pc?.precondition || (code ? '未登记' : '—') });
}
const md = ['### 将发布到生产索引的卡片（批准前请核对）', '', '| 卡片 | 版本 | 含代码 | 安全前提 | 前提满足 | card.json sha256 |', '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.version} | ${r.code ? '**是**' : '否'} | ${r.pre} | ${r.met ? '是' : '**否**'} | ${r.sha} |`), '',
  bad ? `**门禁失败 ${bad} 项：不得批准发布。**` : '门禁通过。批准即发布到 cardrium-templates 生产（唯一索引）。'].join('\n');
console.log(md); if (process.argv.includes('--summary') && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
process.exit(bad ? 1 : 0);
