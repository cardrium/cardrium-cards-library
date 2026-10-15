# 示范卡上架前安全审查：github-repo / keyword-watch（1.0.1）

- 审查人：安全测试　时间：2026-10-15 17:09–17:25（UTC+8）
- 证据：`qa/security/validator-cases/results/20261015-demo-review/`（validate.txt、repo-input-url.mjs/.txt、sha256.txt）
- 上架清单（manifest，在 /workspace/cards-library-push/）按要求**本次不审**；仓库内 `ops/scripts/build-card-index.mjs` 的门槛是“含代码的卡片必须有 securityReviewedBy”。

> **结论：两张卡都没有发现 Key/Cookie 外带、预检绕过、XSS 字面量或敏感数据。**
> 卡片本身可以上架；但“由数据填入的链接只允许 https/mailto”和“路径插值编码”这两项运行时兜底，在当前仓库里没有可测的实现（见 P2-1），上架前需要平台确认。

## 审查的文件与 sha256

| 文件 | sha256 |
|---|---|
| m0/card-examples/github-repo.json | a907d35718368812871ab955c47b1b30cbe1fcbb6d370d57c36fb6cc641bc0f3 |
| m0/card-examples/github-repo-en.json | e2c3c2908dfcff219bf5881a5177107eba85685ac78b2c9c2313e83e4fe516dc |
| m0/card-examples/keyword-watch.json | e0753ca0333295866e230b17a8d01d7b5e8d3eb5ab443ed709b248f78730ccad |
| m0/card-examples/keyword-watch-en.json | d1e7e30b478810303f40d1f0728d90e71f74b03e77a6ac2e7b4656ae5af88357 |
| m0/demo-snapshots/github-repo.zh-CN.json | 4bce73fd065e658d0b0a2ae0cbdb5b0995e3abefa3e0e1717530d096cfaa844e |
| m0/demo-snapshots/github-repo.en.json | 62b1ed41018ccc9781b4414386ceaf4c6ac0dfc0fb9256f4c20189e8132dce6b |
| m0/demo-snapshots/keyword-watch.zh-CN.json | 980d2d57faf96cd9448921928e827f22b150bf011826eb07431fd49a35543cd3 |
| m0/demo-snapshots/keyword-watch.en.json | f1763abbd61e7b276d6f8cc117510889d7d36a24a9ea03e292e3c60ab84e3bfe |

4 张卡片的 sha256 **与运维给出的值全部一致**；上架时拷成 `cards/<id>/card.json` 后应再核一次。

## 1. 是否含代码
- **github-repo（中/英）：不含**。`permissions.code: false`，8 个步骤：http×3、storage×2、transform（JSONata）、ai、output。
- **keyword-watch（中/英）：含**。`permissions.code: true`，步骤 n3 是 `type: code`（javascript，timeoutMs 2000，27 行）→ 按 ops/04 必须有 `securityReviewedBy`。

## 2. 校验器结果（未过滤）
`node validate.mjs` 跑 4 个文件：**全部“通过”，0 个错误码、0 个 W_ 警告码**（含 W_NET_UNUSED），退出码 0。`npm test`（快照校验 16/16）也通过。

## 3. 逐项审查

### 3.1 网络主机最小化
- github-repo：只有 `https://api.github.com/repos/*`，主机固定、限定在 `/repos/` 前缀；没有通配主机、隧道域名或本地地址 ✔
- keyword-watch：`network: []`，卡片自己不发请求；联网搜索由平台 ai_search 步骤完成 ✔

### 3.2 权限与实际使用一致
| 卡 | network | model | storage | code |
|---|---|---|---|---|
| github-repo | n1–n3 用到，前缀覆盖 ✔ | n7 ai ✔ | n4/n6 ✔ | false，确实没有代码 ✔ |
| keyword-watch | 空，确实没有 http ✔ | n2 ai_search ✔ | n1/n4 ✔ | n3 ✔ |
keyword-watch 的 `modelCallsPerRun: 2` 比实际 1 个模型步骤多 1，只是额度上限，P4。

### 3.3 Key / 令牌
- 两张卡**没有任何 Key、令牌、secret 类参数或认证头**；GitHub 走匿名公开 API。请求层规定 `credentials:'omit'`、`no-referrer`、平台不加认证头（request-layer.mjs 文件头）。没有出现在 URL 查询串、日志或展示输出里的 Key ✔
- 第三方数据流（不是外带，只需告知用户）：github-repo 把仓库名和 issue 标题发给用户配置的模型；keyword-watch 把关键词、排除词发给模型 / 搜索服务。

### 3.4 用户输入拼进 URL（github-repo）
- 输入 `repo` 有 `pattern: ^[\w.-]+/[\w.-]+$`：排除了 `@ ? # \ % :`，只能有一个 `/`，**不能改写主机**。
- 用原型请求层 `checkUrl()` 实测（repo-input-url.txt）：
  - `../..`、`../users` → 规范化后跑出 `/repos/`，NOT_DECLARED ✔
  - `a@evil.com/x` 这类值，pattern 已经拒绝；就算绕过 pattern，`@` 也落在路径里，主机仍是 api.github.com ✔
  - **`a/..`、`evil.com/..`、`.../x` 能通过 pattern**，规范化后变成 `https://api.github.com/repos/`、`/repos/releases?per_page=1` 之类，仍在已声明前缀内。匿名请求、只读，影响只是拿到错误数据或 404 → **P3-1**。
- 规范（card-schema-v1 2.3）要求：路径插值按段百分号编码，值里出现 `..` 段、`?`、`#`、`\` 时本次请求失败。原型里没有 http 步骤插值器，**无法实测** → 列入 P2-1 前提。
- keyword-watch 的用户输入只进模型提示词，不进 URL。

### 3.5 展示组件 XSS / javascript:
- 卡片里的字面量文本、`deltaLabel`、`emptyText`、header 表达式都没有标记、实体或脚本协议（校验器 E_TEXT_MARKUP / E_LINK_SCHEME 都没报）✔
- **运行时数据填进来的链接**：
  - github-repo：`link` 来自 GitHub 响应的 `n1.html_url`；
  - keyword-watch：`items[].url` 来自 AI 搜索结果（可能被网页内容做提示词注入）。n3 代码用 `new URL()` 规范化，但**不检查协议**：`javascript:alert(1)` 能通过 `new URL()`，原样进入输出。
  - 契约 2.7 VAL-06 规定渲染层对所有 href（包括运行时填入的值）解码后用 `new URL()` 解析，只允许 https/mailto。但 `app/src` 和 sandbox-prototype 里**找不到这个列表 / 数字组件的链接过滤实现**，无法实测 → **P2-1**。
  - title / subtitle / note 也是外部数据（GitHub issue 标题、模型输出），渲染层必须按纯文本输出，不能当 HTML，同样归入 P2-1 前提。
- 建议 keyword-watch 的 n3 自己只保留 `https:` 链接（纵深防御，P3-2）。

### 3.6 演示快照
- 4 个快照只包含公开数据：GitHub 公开计数、`https://github.com/...` 链接、HN 上公开文章的 https 链接，以及手写的摘要。
- 搜 `sk-`、`ghp_`、`github_pat`、token/key/password、邮箱、内网 IP、localhost、.internal/.local：**零命中**（只命中了 inputTokens/maxTokens 这类字段名）✔
- notes 里写着“产品经理 2026-10-05 的演示参数”，不含个人姓名 ✔

### 3.7 中英两版一致性
逐字段对比：两版差异只在文案、id（加 `-en`）、locale、占位符、select 的取值，以及 transform / 代码里的界面文字（`'新'`↔`'New'`、说明文字）。permissions、limits、url、headers、pattern、onError、verifyUrls、trigger、代码逻辑**完全一致** ✔

## 4. 代码逐行审查（keyword-watch n3，中英只有第 23 行 badge 文案不同）

| 行 | 内容 | 结论 |
|---|---|---|
| 1 | `export default async function run(input)` | 只接一个形参，**没有拿 platform**，不可能发请求、读存储或调模型 ✔ |
| 2 | `new Set(input.n1 \|\| [])` | 读取上一步存储的已看链接；`input.n1` 不是可迭代对象时会抛错，只导致本次运行失败（P4） |
| 3–11 | `norm()`：`new URL`，删 utm_/ref 参数和 hash，去 www，转小写 | 纯计算。**不检查协议**（见 3.5，P3-2） |
| 12–19 | 遍历 `input.n2.items` 去重，标 isNew | 纯计算；`...it` 会把模型给的所有字段带进来，但第 23 行只挑固定字段输出 ✔ |
| 20 | 按 isNew、publishedAt 排序 | ✔ |
| 21 | 合并 seen，`slice(0, 500)` 封顶 | 存储量有上限 ✔ |
| 23 | 输出字段 title/url/subtitle/source/badge/meta/_unverified | `i.publishedAt.slice` 在 publishedAt 不是字符串时会抛错；`i.keyword` 缺失时显示 “undefined”（P4，只影响健壮性） |
| 24–25 | seen、newCount | ✔ |

对照契约 §2.8 失败清单（W_NET_TUNNEL_HOST、W_NEEDS_PROXY、W_CODE_DYNAMIC_MEMBER、W_CODE_DYNAMIC_URL、W_CODE_PLATFORM_ALIAS、W_SENSITIVE_HEADER、W_NET_LOCALHOST）：**一个都没有命中**；也没有 eval / Function / globalThis / 网络 API / 动态 import / constructor。

## 问题清单

| 编号 | 级别 | 卡 | 描述 | 建议 |
|---|---|---|---|---|
| P2-1 | P2（上架前提，平台侧） | 两张 | 运行时兜底在仓库里没有可测实现：①渲染层对数据填入的 link / url 只允许 https/mailto，文本按纯文本渲染（契约 VAL-06）；②http 步骤的路径插值编码，以及值里出现 `..`/`?`/`#`/`\` 时请求失败（schema 2.3）。github-repo 的 `html_url` 和 keyword-watch 的 AI 链接都依赖这两项 | 平台负责人确认上线版本已实现，并附测试（`javascript:` / 实体伪装 / `data:` 链接显示为纯文本；`a/..` 请求失败） |
| P3-1 | P3 | github-repo | `repo` 的 pattern 允许 `.`、`..`、`...` 段，`a/..` 能把请求落到 `/repos/`、`/repos/releases`（仍在 api.github.com 的已声明前缀内） | pattern 改为 `^(?!\.{1,2}/)[A-Za-z0-9_.-]+/(?!\.{1,2}$)[A-Za-z0-9_.-]+$`，或干脆禁止段以 `.` 开头。改了要升版本号并重审 |
| P3-2 | P3 | keyword-watch | n3 不过滤链接协议，`javascript:` 等链接原样输出，只靠渲染层兜底 | 在 `norm()` 里加 `if (x.protocol !== 'https:') return null;`（纵深防御，示范卡也起教学作用）。改了要升版本号 |
| P4-1 | P4 | keyword-watch | publishedAt 不是字符串、keyword 缺失、n1 不是数组时会抛错或显示 “undefined” | 加类型保护 |
| P4-2 | P4 | keyword-watch | modelCallsPerRun=2，实际只有 1 个模型步骤 | 改成 1（可选） |
| P4-3 | P4 | github-repo | AI 总结的提示词里放了 issue 标题（第三方可控），可能被提示词注入，输出误导性文字；模型没有工具，输出是纯文本 | 可接受；渲染层按纯文本输出即可 |

## 能否上架 / securityReviewedBy 建议
- **github-repo（不含代码）**：没有阻断问题，按门槛不需要 securityReviewedBy；如果要填，也可以填，前提同下面第 2、3 条。
- **keyword-watch（含代码）**：代码审查通过，**可以填 securityReviewedBy（reviewedVersion = 1.0.1）**，前提是：
  1. 上架拷贝的 `cards/keyword-watch/card.json`、`cards/keyword-watch-en/card.json` 的 sha256 分别等于 e0753ca0…ccad、d1e7e30b…8357（任何改动，包括修 P3-2，都要升版本号并重新审）；
  2. 平台确认 P2-1 的两项运行时兜底已在上线版本实现并通过测试；
  3. manifest（/workspace/cards-library-push/）本次没有审，填写时请由运维对照本报告核对 id、版本号和哈希。
- P3-1、P3-2 建议在 1.0.2 修复，不阻断 1.0.1 首推（影响已被已声明前缀 / 渲染层限制）。
