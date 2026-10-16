#!/usr/bin/env node
// 内容变更分类（建议 2）：本脚本由 CI 从 base 分支检出后执行，PR head 无法修改判定逻辑。
// 输出 copy-only | needs-codeowner。只有全部改动落在纯文案白名单内才是 copy-only；任何其他路径、改名、mode 变化都 needs-codeowner。
// 注意：分类结果只用于标注/摘要，不用于跳过审核（审核始终由 ruleset 的 CODEOWNER Approve 决定，建议 3）。
import { execFileSync } from 'node:child_process';
const [base, head, repo = '.'] = process.argv.slice(2);
const WHITELIST = [/^docs\/[^]*\.md$/, /^README\.md$/];
const out = execFileSync('git', ['-C', repo, 'diff', '--raw', '--no-renames', `${base}...${head}`], { encoding: 'utf8' }).trim();
let copyOnly = true;
for (const l of out.split('\n').filter(Boolean)) {
  const m = /^:(\d+) (\d+) \S+ \S+ (\S)\t(.+)$/.exec(l); if (!m) { copyOnly = false; continue; }
  const [, om, nm, , path] = m; if (om !== nm && om !== '000000' && nm !== '000000') copyOnly = false;
  if (!(nm === '100644' || nm === '000000') || !WHITELIST.some((r) => r.test(path))) { copyOnly = false; console.log(`needs-codeowner: ${path}`); }
}
console.log(copyOnly ? 'RESULT=copy-only' : 'RESULT=needs-codeowner');
