# 架构师审核记录：官方示范卡片 1.0.1（2026-10-15）

> 拷进卡片库时建议放在 `reviews/architect-20261015.md`，manifest 的 `review.records` 指向这个路径。
> 下面 `review-record` 段落里的 JSON 是 review-gate 读取的机器可读部分，**不要改字段名**。

- 评审人：architect（架构师）
- 日期：2026-10-15
- 范围：相对 1.0.0（tech-lead 2026-09-27 审核），1.0.1 的改动
  - github-repo：布局 h 2→3；repo 输入框加 help 说明。
  - keyword-watch：关键词输入框的 placeholder 改成中文示例。
- 结论：**仅文案/布局，权限、步骤、代码未动**。m0/card-validator 校验 0 错误 0 警告。
- 技术负责人确认（单独记录，不算评审人）：技术负责人 2026-10-15 确认上述结论。
- 安全审核：keyword-watch 含自定义代码（permissions.code=true），需要 security 另出一份记录（`reviews/security-<日期>.md`），本记录不代替安全审核。

<!-- review-record:start -->
```json
{
  "recordVersion": 1,
  "role": "architect",
  "date": "2026-10-15",
  "conclusion": "仅文案/布局，权限、步骤、代码未动",
  "confirmedBy": { "role": "tech-lead", "date": "2026-10-15" },
  "cards": [
    { "id": "github-repo",   "version": "1.0.1", "cardSha256": "a907d35718368812871ab955c47b1b30cbe1fcbb6d370d57c36fb6cc641bc0f3" },
    { "id": "keyword-watch", "version": "1.0.1", "cardSha256": "e0753ca0333295866e230b17a8d01d7b5e8d3eb5ab443ed709b248f78730ccad" }
  ]
}
```
<!-- review-record:end -->

核对依据：两张卡的 card.json 与 ai-workbench/m0/card-examples/{github-repo,keyword-watch}.json 逐字节相同，sha256 与上面一致，也就是 ai-workbench/app ops/scripts/test-build-card-index.sh 用的 1.0.1 样例。
