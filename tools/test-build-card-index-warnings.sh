#!/usr/bin/env bash
# 反向测试（契约 §2.8 / 架构师审查 P1-2）：校验器警告必须让构建失败。
# 用一个桩校验器（只返回指定警告）跑 build-card-index 严格模式，每个反例都必须 exit≠0，对照组必须 exit 0。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
cat > "$T/stub.mjs" <<'JS'
export function validateCard() { return { errors: [], warnings: JSON.parse(process.env.STUB_WARNINGS || '[]') }; }
JS
run() { # 名称 期望(pass|fail) status 警告JSON
  rm -rf "$T/cards" "$T/out"; cp -r "$ROOT/cards" "$T/cards"
  for m in "$T"/cards/*/manifest.json; do node -e 'const f=process.argv[1],s=process.argv[2];const m=JSON.parse(require("fs").readFileSync(f));m.status=s;require("fs").writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$m" "$3"; done
  (cd "$ROOT" && STUB_WARNINGS="$4" node tools/build-card-index.mjs --cards "$T/cards" --out "$T/out" --check \
     --manifest-schema tools/card-manifest.schema.json --card-validator "$T/stub.mjs" >"$T/log" 2>&1); rc=$?
  if { [ "$2" = pass ] && [ $rc -eq 0 ]; } || { [ "$2" = fail ] && [ $rc -ne 0 ]; }; then echo "ok    $1 (exit $rc)"; else echo "FAIL  $1 (exit $rc)"; cat "$T/log"; fail=1; fi
}
run "对照：官方卡无警告"            pass official  '[]'
run "官方卡带已知警告 W_NET_TUNNEL_HOST" fail official  '[{"code":"W_NET_TUNNEL_HOST","path":"/x","message":"t"}]'
run "官方卡带 W_CODE_DYNAMIC_URL"   fail official  '[{"code":"W_CODE_DYNAMIC_URL","path":"/x","message":"t"}]'
run "社区卡未知 W_ 码"              fail community '[{"code":"W_UNKNOWN_FOO","path":"/x","message":"t"}]'
run "社区卡无码警告"                fail community '[{"path":"/x","message":"t"}]'
run "社区卡非 W_ 前缀码"            fail community '[{"code":"X_FOO","path":"/x","message":"t"}]'
exit $fail
