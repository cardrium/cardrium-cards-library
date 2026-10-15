// 补充禁用名单（安全测试 VAL-03 / VAL-13）：任何人都能免费或低成本开子域的服务。
// 用途：① 不允许在这些域名上通配（*.x 报 E_NET_PATTERN_TOO_BROAD）；② 写这些域名下的具体主机时给 W_NET_TUNNEL_HOST 提示。
// 维护规则：
//   - 纯数据文件，没有任何依赖，校验器和平台运行时（sites/main/lib）原样导入同一份；随平台版本更新。
//   - 每条写 category（ddns 动态 DNS / tunnel 内网穿透 / hosting 免费托管 / collector 请求收集）、source（出处）、verified（是否核实过“免费用户能拿到子域”）。
//   - 公共后缀列表（PSL）已收录的域名本来就会被拦，这里仍列出（inPsl: true），防止 PSL 快照更新时被移除后出现缺口。
//   - 名单做不到完整；最终由《模板审核流程》3.7 D3 人工判断兜底。
// 本次（2026-09-27）加入的 56 个动态 DNS / 内网穿透域名来自安全测试探测清单
// qa/security/validator-cases/bypass/results/20260927T234300-r2342/_ddns-tunnel-wildcard-probe.txt。
const QA = 'qa/security 探测清单 20260927T234300-r2342（未逐一核实）';
const QAV = 'qa/security 回归报告 5.6 VAL-13（已核实：免费用户有子域）';
const PSL = 'PSL PRIVATE 段已收录';
// 2026-10-05（安全复测 VAL-13）：对 12 个候选逐一查官方来源（查询时间 2026-10-05 11:20 前后 Asia/Shanghai）。
// 官方页面能证明“免费/低价用户能拿到该域名下子域”的才加入（verified: true，source 写官方网址）；
// 查不到官方证据的先不加，列在本文件末尾的 VAL13_UNVERIFIED，等人工核实（注意：它们**不在**拦截名单里）。
// 2026-10-15（安全测试 VAL-13 复核，qa/security/VAL-13复核-20261015.md）：sunny-ngrok.com 预防性加入（tunnel）。
export const RISKY_HOSTING_VERSION = '2026-10-15.1';
export const RISKY_HOSTING = [
  // ---- 动态 DNS（ddns） ----
  { domain: '3322.org', category: 'ddns', source: `${QA}；希网 https://www.3322.org/`, verified: false },
  { domain: 'f3322.net', category: 'ddns', source: `${QAV}；希网`, verified: true },
  { domain: '8866.org', category: 'ddns', source: `${QA}；希网`, verified: false },
  { domain: '3utilities.com', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  { domain: 'afraid.org', category: 'ddns', source: `${QA}；FreeDNS https://freedns.afraid.org/`, verified: false },
  { domain: 'mooo.com', category: 'ddns', source: `${QA}；FreeDNS 共享域名`, verified: false },
  { domain: 'changeip.com', category: 'ddns', source: `${QA}；https://www.changeip.com/`, verified: false },
  { domain: 'cloudns.net', category: 'ddns', source: `${QA}；ClouDNS https://www.cloudns.net/`, verified: false },
  { domain: 'ddns.net', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  { domain: 'dedyn.io', category: 'ddns', source: `${PSL}；deSEC`, verified: true, inPsl: true },
  { domain: 'desec.io', category: 'ddns', source: `${QA}；deSEC https://desec.io/`, verified: false },
  { domain: 'dnshome.de', category: 'ddns', source: PSL, verified: true, inPsl: true },
  { domain: 'duckdns.org', category: 'ddns', source: `${PSL}；https://www.duckdns.org/`, verified: true, inPsl: true },
  { domain: 'dyndns.org', category: 'ddns', source: PSL, verified: true, inPsl: true },
  { domain: 'dynu.com', category: 'ddns', source: `${QA}；Dynu https://www.dynu.com/`, verified: false },
  { domain: 'dynu.net', category: 'ddns', source: PSL, verified: true, inPsl: true },
  { domain: 'dynv6.net', category: 'ddns', source: PSL, verified: true, inPsl: true },
  { domain: 'freeddns.org', category: 'ddns', source: PSL, verified: true, inPsl: true },
  { domain: 'hopto.org', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  { domain: 'ipv64.net', category: 'ddns', source: PSL, verified: true, inPsl: true },
  { domain: 'kozow.com', category: 'ddns', source: PSL, verified: true, inPsl: true },
  { domain: 'myftp.org', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  { domain: 'no-ip.com', category: 'ddns', source: `${QA}；No-IP https://www.noip.com/`, verified: false },
  { domain: 'no-ip.org', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  { domain: 'now-dns.com', category: 'ddns', source: `${QA}；https://now-dns.com/`, verified: false },
  { domain: 'nsupdate.info', category: 'ddns', source: PSL, verified: true, inPsl: true },
  { domain: 'serveftp.com', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  { domain: 'servehttp.com', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  { domain: 'sytes.net', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  { domain: 'ydns.eu', category: 'ddns', source: `${QA}；https://ydns.io/`, verified: false },
  { domain: 'zapto.org', category: 'ddns', source: `${PSL}；No-IP`, verified: true, inPsl: true },
  // 花生壳（贝锐 Oray）系列：oicp / xicp / vicp / gicp / eicp / iask
  { domain: 'oray.com', category: 'ddns', source: `${QA}；花生壳 https://hsk.oray.com/`, verified: false },
  { domain: 'oicp.net', category: 'ddns', source: `${QAV}；花生壳`, verified: true },
  { domain: 'xicp.net', category: 'ddns', source: `${QAV}；花生壳（不在 56 个探测域名里，回归报告点名）`, verified: true },
  { domain: 'vicp.net', category: 'ddns', source: `${QA}；花生壳`, verified: false },
  { domain: 'vicp.io', category: 'ddns', source: `${QA}；花生壳`, verified: false },
  { domain: 'gicp.net', category: 'ddns', source: `${QA}；花生壳`, verified: false },
  { domain: 'eicp.net', category: 'ddns', source: `${QA}；花生壳`, verified: false },
  { domain: 'iask.in', category: 'ddns', source: `${QA}；花生壳旧域名`, verified: false },
  // ---- 内网穿透（tunnel） ----
  { domain: 'cpolar.cn', category: 'tunnel', source: `${QAV}；cpolar 官方文档：免费版分配随机子域 https://www.cpolar.com/`, verified: true },
  { domain: 'cpolar.top', category: 'tunnel', source: `${QAV}；cpolar`, verified: true },
  { domain: 'cpolar.io', category: 'tunnel', source: `${QA}；cpolar`, verified: false },
  { domain: 'natapp.cc', category: 'tunnel', source: `${QA}；https://natapp.cn/`, verified: false },
  { domain: 'sakurafrp.com', category: 'tunnel', source: `${QA}；SakuraFrp https://www.natfrp.com/`, verified: false },
  { domain: 'frp.one', category: 'tunnel', source: QA, verified: false },
  { domain: 'localto.net', category: 'tunnel', source: `${QA}；LocalToNet https://localtonet.com/`, verified: false },
  { domain: 'loophole.site', category: 'tunnel', source: `${QA}；Loophole https://loophole.cloud/`, verified: false },
  { domain: 'pinggy.link', category: 'tunnel', source: `${QA}；Pinggy https://pinggy.io/`, verified: false },
  { domain: 'pinggy.online', category: 'tunnel', source: `${QA}；Pinggy`, verified: false },
  { domain: 'playit.gg', category: 'tunnel', source: `${QA}；https://playit.gg/`, verified: false },
  { domain: 'zrok.io', category: 'tunnel', source: `${QA}；zrok https://zrok.io/（含 share.zrok.io）`, verified: false },
  { domain: 'ts.net', category: 'tunnel', source: `${PSL}；Tailscale Funnel`, verified: true, inPsl: true },
  { domain: 'gitee.io', category: 'hosting', source: 'VAL-03 回归', verified: true },
  { domain: 'ngrok.io', category: 'tunnel', source: `${PSL}；ngrok`, verified: true, inPsl: true },
  { domain: 'ngrok.app', category: 'tunnel', source: `${PSL}；ngrok`, verified: true, inPsl: true },
  { domain: 'ngrok.dev', category: 'tunnel', source: 'ngrok', verified: true },
  { domain: 'ngrok-free.app', category: 'tunnel', source: 'ngrok 免费版', verified: true },
  { domain: 'ngrok-free.dev', category: 'tunnel', source: 'ngrok 免费版', verified: true },
  { domain: 'ngrok.pizza', category: 'tunnel', source: 'ngrok', verified: false },
  { domain: 'trycloudflare.com', category: 'tunnel', source: `${PSL}；Cloudflare Quick Tunnel`, verified: true, inPsl: true },
  { domain: 'cfargotunnel.com', category: 'tunnel', source: 'Cloudflare Tunnel', verified: true },
  { domain: 'loca.lt', category: 'tunnel', source: 'localtunnel', verified: true },
  { domain: 'localtunnel.me', category: 'tunnel', source: 'localtunnel', verified: true },
  { domain: 'serveo.net', category: 'tunnel', source: 'Serveo', verified: true },
  { domain: 'serveousercontent.com', category: 'tunnel', source: 'Serveo', verified: true },
  { domain: 'localhost.run', category: 'tunnel', source: 'localhost.run', verified: true },
  { domain: 'lhr.life', category: 'tunnel', source: 'localhost.run', verified: true },
  { domain: 'lhr.rocks', category: 'tunnel', source: 'localhost.run', verified: true },
  { domain: 'pagekite.me', category: 'tunnel', source: 'PageKite', verified: true },
  { domain: 'telebit.io', category: 'tunnel', source: 'Telebit', verified: false },
  { domain: 'bore.pub', category: 'tunnel', source: 'bore', verified: true },
  { domain: 'tunnelmole.net', category: 'tunnel', source: `${PSL}；Tunnelmole`, verified: true, inPsl: true },
  { domain: 'tunnelto.dev', category: 'tunnel', source: 'tunnelto', verified: false },
  { domain: 'localxpose.io', category: 'tunnel', source: 'LocalXpose', verified: false },
  { domain: 'loclx.io', category: 'tunnel', source: 'LocalXpose', verified: false },
  { domain: 'devtunnels.ms', category: 'tunnel', source: 'Microsoft Dev Tunnels', verified: true },
  // ---- 免费托管（hosting） ----
  { domain: 'neocities.org', category: 'hosting', source: `${QAV}；https://neocities.org/`, verified: true },
  { domain: 'r2.dev', category: 'hosting', source: 'Cloudflare R2 公共桶', verified: true },
  { domain: 'workers.dev', category: 'hosting', source: 'Cloudflare Workers', verified: true },
  { domain: 'pages.dev', category: 'hosting', source: 'Cloudflare Pages', verified: true },
  { domain: 'deno.dev', category: 'hosting', source: 'Deno Deploy', verified: true },
  { domain: 'deno.net', category: 'hosting', source: 'Deno Deploy', verified: true },
  { domain: 'vercel.app', category: 'hosting', source: 'Vercel', verified: true },
  { domain: 'netlify.app', category: 'hosting', source: 'Netlify', verified: true },
  { domain: 'bitballoon.com', category: 'hosting', source: 'Netlify 旧域名（qa bypass BP-03-hosting-bitballoon 观察项）', verified: false },
  { domain: 'glitch.me', category: 'hosting', source: 'Glitch', verified: true },
  { domain: 'repl.co', category: 'hosting', source: 'Replit', verified: true },
  { domain: 'replit.dev', category: 'hosting', source: 'Replit', verified: true },
  { domain: 'replit.app', category: 'hosting', source: 'Replit', verified: true },
  { domain: 'onrender.com', category: 'hosting', source: 'Render', verified: true },
  { domain: 'fly.dev', category: 'hosting', source: 'Fly.io', verified: true },
  { domain: 'surge.sh', category: 'hosting', source: 'Surge', verified: true },
  { domain: 'github.io', category: 'hosting', source: 'GitHub Pages（PSL 也收录）', verified: true, inPsl: true },
  { domain: 'gitlab.io', category: 'hosting', source: 'GitLab Pages', verified: true },
  { domain: 'codeberg.page', category: 'hosting', source: 'Codeberg Pages', verified: true },
  { domain: 'pythonanywhere.com', category: 'hosting', source: 'PythonAnywhere', verified: true },
  // 对象存储：任何人都能开桶，桶名直接成为子域（bucket.oss-cn-hangzhou.aliyuncs.com、bucket.cos.ap-guangzhou.myqcloud.com）；PSL 未收录
  { domain: 'aliyuncs.com', category: 'hosting', source: '架构师补充（阿里云 OSS 桶子域）；待安全测试核实', verified: false },
  { domain: 'myqcloud.com', category: 'hosting', source: '架构师补充（腾讯云 COS 桶子域）；待安全测试核实', verified: false },
  // ---- 请求收集 / 带外探测（collector） ----
  { domain: 'webhook.site', category: 'collector', source: 'Webhook.site', verified: true },
  { domain: 'requestbin.com', category: 'collector', source: 'RequestBin', verified: true },
  { domain: 'requestcatcher.com', category: 'collector', source: 'Request Catcher', verified: true },
  { domain: 'pipedream.net', category: 'collector', source: 'Pipedream', verified: true },
  { domain: 'beeceptor.com', category: 'collector', source: 'Beeceptor', verified: true },
  { domain: 'hookbin.com', category: 'collector', source: 'Hookbin', verified: false },
  { domain: 'mockbin.org', category: 'collector', source: 'Mockbin', verified: false },
  { domain: 'interact.sh', category: 'collector', source: 'ProjectDiscovery interactsh', verified: true },
  { domain: 'oast.fun', category: 'collector', source: 'interactsh', verified: true },
  { domain: 'oast.pro', category: 'collector', source: 'interactsh', verified: true },
  { domain: 'oast.live', category: 'collector', source: 'interactsh', verified: true },
  { domain: 'oast.site', category: 'collector', source: 'interactsh', verified: true },
  { domain: 'oast.online', category: 'collector', source: 'interactsh', verified: true },
  { domain: 'oast.me', category: 'collector', source: 'interactsh', verified: true },
  { domain: 'burpcollaborator.net', category: 'collector', source: 'Burp Collaborator', verified: true },
  { domain: 'dnslog.cn', category: 'collector', source: 'DNSLog', verified: true },
  { domain: 'ceye.io', category: 'collector', source: 'CEYE', verified: true },
  // ---- 2026-10-05 VAL-13 复测核实后加入 ----
  { domain: 'f3322.org', category: 'ddns', source: '公云（3322）官方公告 https://www.pubyun.com/p/notice/ “给免费用户推出了专门的域名：动态域名 f3322.org”', verified: true },
  { domain: 'x3322.net', category: 'ddns', source: '公云官方产品页 https://pubyun.com/products/dyndns/product/ “x3322.net 为免费测试试用”（VAL-13 复测顺带发现）', verified: true },
  { domain: 'natapp1.cc', category: 'tunnel', source: 'NATAPP 官方文档 https://natapp.cn/article/wildcard_domain “若 natapp 分配的域名为 xxx.natapp1.cc”', verified: true },
  { domain: 'natappfree.cc', category: 'tunnel', source: 'NATAPP 官方教程 https://natapp.cn/article 免费隧道示例 ywy9n8.natappfree.cc（VAL-13 复测顺带发现）', verified: true },
  { domain: 'mynatapp.cc', category: 'tunnel', source: 'NATAPP 官方文档 https://natapp.cn/article/https 二级域名示例 test.mynatapp.cc（VAL-13 复测顺带发现）', verified: true },
  { domain: 'idcfengye.com', category: 'tunnel', source: 'Sunny-Ngrok 官方文档 https://www.ngrok.cc/_book/general/open.html 免费前置域名 sunny.free.idcfengye.com（候选 ngrok.cc 的实际赠送域名）', verified: true },
  { domain: 'ticp.net', category: 'ddns', source: '花生壳官网 https://hsk.oray.com/zt/3321 示例地址 vp-youuserna-051.ticp.net（VAL-13 复测顺带发现）', verified: true },
  { domain: 'tunnel.pyjam.as', category: 'tunnel', source: '官方页面 https://tunnel.pyjam.as/ “https://<unique_slug>.tunnel.pyjam.as/”', verified: true },
  { domain: 'meibu.com', category: 'ddns', source: '青岛每步科技官网 http://www.meibu.com/ meibu.com 二级域名动态解析（IPv4 免费 2 天试用）', verified: true },
  { domain: 'requestbin.net', category: 'collector', source: 'RequestBin.net 官方帮助 https://requestbin.net/help-center 免费 DNS bin（子域收集）', verified: true },
  // ---- 2026-10-05 第二轮（技术负责人：黄色人工名单清零）：7 个未核实候选逐一定案，查询时间 2026-10-05 12:30–12:45 Asia/Shanghai ----
  // 证据分两类：official = 运营方官方文档/官网文字；operator = 运营方自己的服务器对任意子域给出的响应或根域名自述（实测，可复现）。
  { domain: 'oicp.io', category: 'ddns', source: 'operator：http://oicp.io/ 根页面自称“花生壳动态域名解析服务”，与已核实的 oicp.net、vicp.io 页面相同、同一备案号 粤ICP备14062640号-10；任意子域（abc123xyz.oicp.io）解析为 0.0.0.0，与 vicp.io 未分配子域的行为一致（2026-10-05 实测）。贝锐官方文档未列出此后缀', verified: true, evidence: 'operator' },
  { domain: 'xicp.io', category: 'ddns', source: 'operator：http://xicp.io/ 根页面“花生壳动态域名解析服务”，备案号 粤ICP备14062640号-10，与 oicp.io/zicp.io/zicp.net 同一 IP 175.178.202.111；任意子域解析为 0.0.0.0（2026-10-05 实测）', verified: true, evidence: 'operator' },
  { domain: 'zicp.io', category: 'ddns', source: 'operator：http://zicp.io/ 根页面“花生壳动态域名解析服务”，备案号 粤ICP备14062640号-10；任意子域解析为 0.0.0.0（2026-10-05 实测）', verified: true, evidence: 'operator' },
  { domain: 'zicp.net', category: 'ddns', source: 'operator：zicp.net 与 oicp.io/xicp.io/zicp.io 同一 IP 175.178.202.111，任意子域解析为 0.0.0.0（2026-10-05 实测）；website.informer 收录其站名“花生壳动态域名解析服务”。根页面当天返回 403/502，没有拿到页面原文', verified: true, evidence: 'operator' },
  { domain: 'nat123.top', category: 'tunnel', source: 'operator：任意子域 http://abc123xyz.nat123.top/ 由 nat123 自己的服务器（Server: nat123web, 23.95.34.138）应答“abc123xyz.nat123.top域名未被端口映射 - powered by nat123”（2026-10-05 实测）；官网 http://www.nat123.com/Pages_74_1133.jsp 写明免费用户可用自动生成或自定义的免费二级域名', verified: true, evidence: 'operator' },
  { domain: 'nat123.net', category: 'tunnel', source: 'operator：任意子域与 nat123.top 指向同一台 nat123 映射服务器 23.95.34.138（2026-10-05 实测）；官网免费二级域名说明同上（顺带发现）', verified: true, evidence: 'operator' },
  { domain: 'nat123.cc', category: 'tunnel', source: 'operator：http://abc123xyz.nat123.cc/ 应答“abc123xyz.nat123.cc域名未被端口映射 - powered by nat123”（2026-10-05 实测，顺带发现）', verified: true, evidence: 'operator' },
  { domain: 'ngrok.cc', category: 'tunnel', source: 'official（历史）：Sunny-Ngrok 官网 2015-12-08 存档 http://web.archive.org/web/20151208193205/http://www.ngrok.cc/ “意为将本地的80端口链接到 sunny.ngrok.cc 上”。现行文档 https://www.ngrok.cc/_book/general/open.html 的赠送域名已改为 *.free.idcfengye.com（已收录），但旧用户的 *.ngrok.cc 子域可能仍在使用，通配一律拒绝', verified: true, evidence: 'official' },
  // 贝锐官方页面列出的其他壳域名后缀（顺带发现，官方文字证据）
  { domain: 'hsk.top', category: 'ddns', source: 'official：贝锐花生壳官网 https://hsk.oray.com/news/61042.html “壳域名后缀包括 hsk.top、zicp.fun、yicp.fun 等”', verified: true, evidence: 'official' },
  { domain: 'zicp.fun', category: 'ddns', source: 'official：https://hsk.oray.com/news/61042.html、https://hsk.oray.com/news/60855.html', verified: true, evidence: 'official' },
  { domain: 'yicp.fun', category: 'ddns', source: 'official：https://hsk.oray.com/news/61042.html、https://hsk.oray.com/news/61296.html', verified: true, evidence: 'official' },
  { domain: 'oray.net', category: 'ddns', source: 'official：https://hsk.oray.com/news/58253.html “系统自动赠送一个 .oray.net 或 .xicp.net 结尾的壳域名”', verified: true, evidence: 'official' },
  { domain: 'vicp.cc', category: 'ddns', source: 'official：贝锐《域名服务用户手册》http://www.oray.com/doc/domain_user_manual.pdf 第 2.2 节免费域名后缀', verified: true, evidence: 'official' },
  { domain: '51vip.biz', category: 'ddns', source: 'official：同上手册第 2.2 节', verified: true, evidence: 'official' },
  { domain: 'uicp.net', category: 'ddns', source: 'official：同上手册第 2.2 节（专业域名）', verified: true, evidence: 'official' },
  { domain: 'imwork.net', category: 'ddns', source: 'official：同上手册第 2.2 节（专业域名）', verified: true, evidence: 'official' },
  // ---- 2026-10-15 安全测试 VAL-13 复核后预防性加入 ----
  { domain: 'sunny-ngrok.com', category: 'tunnel', source: 'preventive：预防性加入，域名未注册（Verisign RDAP 404、DNS NXDOMAIN，2026-10-15 安全测试复核 qa/security/VAL-13复核-20261015.md）。名字与 Sunny-Ngrok 品牌高度相似，任何人都能注册后对外发子域；该域名上没有合法数据源，加入无误伤。通配报 E_NET_PATTERN_TOO_BROAD，根域和任意子域报 W_NET_TUNNEL_HOST', verified: false, evidence: 'preventive' },
];

// VAL-13 七个候选的最终处理（2026-10-05 第二轮定案，2026-10-15 按安全测试复核修订）：
//   加入拦截名单：oicp.io、xicp.io、zicp.io、zicp.net、nat123.top、ngrok.cc（证据见上面各条 source）
//   sunny-ngrok.com：10-05 曾因 NXDOMAIN 不加入；10-15 安全测试复核（RDAP 404，未注册、任何人可注册）后预防性加入（evidence: preventive）。
//   名单复查：由运维每周运行 tools/recheck-tunnel-blocklist.mjs（DoH 查根域 / 随机子域 + RDAP 注册状态），
//   结果写入 qa/security/tunnel-blocklist-recheck/<日期>.md，异常由安全测试和架构师判断是否调整名单。
export const VAL13_DECISIONS = {
  blocked: ['oicp.io', 'xicp.io', 'zicp.io', 'zicp.net', 'nat123.top', 'ngrok.cc', 'sunny-ngrok.com'],
  notBlocked: {},
};
export const VAL13_UNVERIFIED = [];   // 黄色人工名单：已清零
