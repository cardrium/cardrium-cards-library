#!/usr/bin/env node
// 把 data/public_suffix_list.dat（MPL-2.0）预处理成纯 ESM 数据模块 lib/data/psl-data.mjs：
// 规则已转成 ASCII（punycode），分 ICANN / PRIVATE 两段。校验器和平台运行时原样导入同一份文件（浏览器里不需要 node:fs）。
// 更新 PSL：下载新的 .dat 覆盖 data/public_suffix_list.dat → node tools/build-psl.mjs → npm test（selftest 会核对两者版本一致）。
import { readFileSync, writeFileSync } from 'node:fs';
import { domainToASCII } from 'node:url';
const text = readFileSync(new URL('../data/public_suffix_list.dat', import.meta.url), 'utf8');
const version = (/^\/\/ VERSION: (\S+)/m.exec(text) || [])[1] || 'unknown';
const commit = (/^\/\/ COMMIT: (\S+)/m.exec(text) || [])[1] || 'unknown';
const out = { ICANN: [], PRIVATE: [] };
let section = 'ICANN';
for (const line0 of text.split('\n')) {
  const line = line0.trim();
  if (line.includes('===BEGIN PRIVATE DOMAINS===')) section = 'PRIVATE';
  if (!line || line.startsWith('//')) continue;
  const rule = line.split(/\s/)[0];
  const bang = rule.startsWith('!') ? '!' : '';
  const body = rule.slice(bang.length).split('.').map((l) => (l === '*' ? '*' : domainToASCII(l) || l)).join('.').toLowerCase();
  out[section].push(bang + body);
}
const js = `// 自动生成，勿手改：node tools/build-psl.mjs（来源 data/public_suffix_list.dat，Public Suffix List，MPL-2.0，https://publicsuffix.org/）
export const PSL_VERSION = ${JSON.stringify(version)};
export const PSL_COMMIT = ${JSON.stringify(commit)};
export const PSL_ICANN = ${JSON.stringify(out.ICANN.join('\n'))};
export const PSL_PRIVATE = ${JSON.stringify(out.PRIVATE.join('\n'))};
`;
writeFileSync(new URL('../lib/data/psl-data.mjs', import.meta.url), js);
console.log(`lib/data/psl-data.mjs：PSL ${version}，ICANN ${out.ICANN.length} 条，PRIVATE ${out.PRIVATE.length} 条，${(js.length / 1024).toFixed(0)} KB`);
