// 每日收盘 ETF 分层扫描入口（现行口径 v3，2026-11-05 海哥确认）
//   v3 = 取消 MACD 背离 + J 降为 P1/P2/P3 排序标记 + 周线降为环境标签 + 「结构全过」不含周线
// 用法：
//   node daily_etf_scan.js                                   → 今天，在线抓池 + 抓 K 线
//   node daily_etf_scan.js --date 2026-11-05               → 指定日期
//   node daily_etf_scan.js --kl data_1105close             → 复用已有 K 线目录（不联网抓 K 线）
//   node daily_etf_scan.js --pool etf_list_1105.json       → 复用缓存池（不联网抓名单）
//   node daily_etf_scan.js --out D:/xxx/daily-review       → 指定输出根目录
// 输出：<out>/<YYYYMMDD>/{pool.json,scan.json,summary.json,全市场ETF建仓扫描_<date>.html}
// 全程无买卖建议、无止损价、不预测涨跌。
const https = require('https'), fs = require('fs'), path = require('path');
const HERE = __dirname;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const cnNow = new Date(Date.now() + 8 * 3600 * 1000);
const DATE = arg('--date', cnNow.toISOString().slice(0, 10));
const TAG = DATE.replace(/-/g, '');
const OUT = path.resolve(arg('--out', path.join(HERE, 'daily-etf')), TAG);
const KLARG = arg('--kl', '');
const POOLARG = arg('--pool', '');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ---------- 网络 ----------
function get(u, ms = 15000) {
  return new Promise(r => {
    const t = setTimeout(() => r(null), ms);
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { clearTimeout(t); try { r(JSON.parse(d)); } catch (e) { r(null); } });
    }).on('error', () => { clearTimeout(t); r(null); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BAD = /货币|债|短融|国债|政金|理财|同业存单|信用债|现金|保证金|城投|金融债|公司债|可转债|转债|REIT|日利|添益|快线|财富宝|现金宝/i;
const FS = ['b:MK0021', 'b:MK0022', 'b:MK0023', 'b:MK0024'];

async function fetchPool() {
  if (POOLARG) { const p = path.resolve(POOLARG); const l = JSON.parse(fs.readFileSync(p, 'utf8')); return { list: l, raw: l.length, src: '缓存池 ' + path.basename(p) }; }
  let all = [];
  for (const f of FS) {
    let got = 0;
    for (let pn = 1; pn <= 10; pn++) {
      const j = await get(`https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=200&po=1&np=1&fltt=2&invt=2&fid=f6&fs=${f}&fields=f2,f3,f6,f12,f14`);
      if (!j || !j.data || !j.data.diff) break;
      const arr = j.data.diff;
      all = all.concat(arr); got += arr.length;
      // got 是「本分类」累计，不能用 all.length 与单分类 total 比（会提前 break）
      if (all.length >= 4000 || got >= (j.data.total || 0)) break;
    }
  }
  const seen = new Set(), rows = [];
  for (const x of all) {
    if (!x.f12 || !x.f14 || seen.has(x.f12)) continue;
    seen.add(x.f12);
    rows.push({ code: x.f12, name: x.f14, amt: x.f6 });
  }
  // 与历史定版同口径：剔债货 + 当日成交额 ≥ 2000 万，否则池翻倍会让 hard 数量失真、跨日不可比
  const liq = rows.filter(r => !BAD.test(r.name) && (r.amt || 0) >= 2e7).sort((a, b) => (b.amt || 0) - (a.amt || 0));
  if (liq.length >= 400) return { list: liq, raw: rows.length, src: '东财全分类四类合并（在线，剔债货+成交额≥2000万）' };
  // 回退顺序：最近一次成功跑出的池 → 11/05 全分类缓存池
  const base = path.join(HERE, 'daily-etf');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^\d{8}$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const p = path.join(base, d, 'pool.json');
    if (fs.existsSync(p)) {
      const l = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (l.length >= 400) return { list: l, raw: rows.length, src: '在线名单不足，回退 ' + d + ' 已验证全分类池' };
    }
  }
  const fb = path.join(HERE, 'etf_list_1105.json');
  return { list: JSON.parse(fs.readFileSync(fb, 'utf8')), raw: rows.length, src: '在线名单不足，回退 11/05 全分类缓存池' };
}

function sid(c) { return (c.startsWith('5') ? '1.' : '0.') + c; }   // 5/6 开头沪市，1 开头深市
async function grabOne(it, dir) {
  for (let k = 0; k < 4; k++) {
    const j = await get(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${sid(it.code)}&klt=101&fqt=1&end=20500101&lmt=340&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57`, 12000);
    const kl = j && j.data && j.data.klines;
    if (kl && kl.length > 70) {
      const rows = kl.map(s => { const p = s.split(','); return [p[0], +p[1], +p[2], +p[3], +p[4], +p[5], +p[6]]; });
      fs.writeFileSync(path.join(dir, 'k_' + it.code + '.json'), JSON.stringify({ code: it.code, name: it.name, kl: rows }));
      return true;
    }
    await sleep(400 * (k + 1));
  }
  return false;
}

// ---------- 指标（与 calc_1105close.js 完全一致） ----------
function ema(a, n) { const k = 2 / (n + 1); let e = a[0]; const o = [e]; for (let i = 1; i < a.length; i++) { e = a[i] * k + e * (1 - k); o.push(e); } return o; }
function macd(c) { const e12 = ema(c, 12), e26 = ema(c, 26); const dif = c.map((_, i) => e12[i] - e26[i]); const dea = ema(dif, 9); return { dif, dea }; }
function kdj(kl, n = 9) { let K = 50, D = 50; const Js = [];
  for (let i = 0; i < kl.length; i++) { const s = Math.max(0, i - n + 1); let hh = -1e9, ll = 1e9; for (let j = s; j <= i; j++) { hh = Math.max(hh, +kl[j][3]); ll = Math.min(ll, +kl[j][4]); }
    const rsv = hh === ll ? 50 : (+kl[i][2] - ll) / (hh - ll) * 100; K = (2 / 3) * K + (1 / 3) * rsv; D = (2 / 3) * D + (1 / 3) * K; Js.push(3 * K - 2 * D); }
  return Js; }
function ma(a, n) { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
function week(kl) { const w = [], m = {};
  kl.forEach(r => { const dt = new Date(r[0]); const mon = new Date(dt); const day = (dt.getDay() + 6) % 7; mon.setDate(dt.getDate() - day);
    const key = mon.toISOString().slice(0, 10);
    if (!m[key]) { m[key] = { o: +r[1], h: +r[3], l: +r[4], c: +r[2], v: +r[5], d: r[0] }; w.push(key); }
    else { const x = m[key]; x.h = Math.max(x.h, +r[3]); x.l = Math.min(x.l, +r[4]); x.c = +r[2]; x.v += +r[5]; x.d = r[0]; } });
  return w.map(k => [m[k].d, m[k].o, m[k].c, m[k].h, m[k].l, m[k].v]); }

// ---------- 主题 / 五行（与 theme_1105close.js 一致） ----------
const RULES = [
  [/纳指生物|标普生物|纳斯达克生物|生物科技/, '海外·生物科技'], [/标普油气|油气|原油|石油基金/, '海外·油气能源'],
  [/标普消费|美国消费/, '海外·消费'], [/纳斯达克|纳指|标普500|标普|道琼斯|美国|德国|法国|日经|越南|东南亚|中韩|亚太/, '海外·美股宽基'],
  [/恒生|港股|中概|香港/, '跨境·港股亚太'], [/黄金|白银/, '商品·贵金属'], [/豆粕|农产品|有色期货|能源化工|商品期货/, '商品·期货'],
  [/红利|低波|央企|国企|价值|股息/, '红利低波'], [/半导体|芯片|集成电路|光刻/, '半导体芯片'],
  [/机器人|机械|高端装备|工业母机|智能制造|工程机械/, '机器人高端制造'], [/金融科技|证券|券商|银行|保险|非银|金融/, '大金融'],
  [/医药|医疗|创新药|疫苗|CXO|中药|器械|健康|生物医药/, '医药医疗'], [/军工|航天|国防|航空|兵器/, '军工航天'],
  [/人工智能|AI|软件|云计算|计算机|大数据|算力|数字经济|信创|网络安全/, 'AI算力软件'],
  [/传媒|游戏|影视|动漫|文娱|出版|教育/, '传媒游戏'], [/光伏|储能|电池|新能源|风电|电力|电网|碳中和|锂电|绿电/, '新能源电力'],
  [/有色|稀土|锂|铜|铝|资源/, '有色资源'], [/煤炭|钢铁|化工|材料|能源/, '周期材料'], [/地产|基建|建筑|建材|水泥/, '地产基建'],
  [/消费电子|电子|通信|5G|光模块|PCB|面板|元器件/, '消费电子通信'], [/消费|白酒|食品|饮料|家电|旅游|酒店|农业|养殖|畜牧|零售|商贸/, '食品饮料消费'],
  [/创业板|沪深300|中证500|中证1000|中证2000|科创50|科创100|科创200|A500|A50|上证50|上证180|深证100|中证A|宽基|全指|综指|MSCI/, 'A股宽基']
];
const WX = { 'AI算力软件': '火', '半导体芯片': '火', '消费电子通信': '火', '机器人高端制造': '火', '新能源电力': '火', '军工航天': '火', '传媒游戏': '火',
  '医药医疗': '木', '食品饮料消费': '木', '海外·生物科技': '木', '海外·消费': '木', '大金融': '金', '有色资源': '金', '商品·贵金属': '金',
  '红利低波': '土', 'A股宽基': '土', '地产基建': '土', '周期材料': '土', '商品·期货': '水', '海外·油气能源': '水', '海外·美股宽基': '土', '跨境·港股亚太': '木', '其他': '土' };
const themeOf = name => { for (const [re, t] of RULES) if (re.test(name)) return t; return '其他'; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

// ---------- 计算 ----------
function calc(files) {
  const out = [], excl = [];
  for (const f of files) {
    const kl = f.kl.filter(r => r && r.length >= 6 && isFinite(+r[2]));
    if (kl.length < 70) { excl.push(f.code + ' 数据不足'); continue; }
    const c = kl.map(r => +r[2]), v = kl.map(r => +r[5]);
    const n = c.length, last = c[n - 1], i = n - 1;
    // 兜底：货币/净值型 ETF 常以 100 元面值计价，会污染 J 与涨幅；场内 ETF 净值普遍 <50
    if (last > 50) { excl.push(f.code + ' ' + f.name + ' 疑似货币/净值型(价=' + last + ')'); continue; }
    const m20 = ma(c, 20), m60 = ma(c, 60);
    const { dif, dea } = macd(c); const J = kdj(kl);
    const wkl = week(kl), wc = wkl.map(r => +r[2]), wm20 = ma(wc, 20);
    const { dif: wdif, dea: wdea } = macd(wc);
    const high60 = Math.max(...kl.slice(-60).map(r => +r[3]));
    const d20 = (last - c[n - 21]) / c[n - 21] * 100, d60 = (last - c[n - 61]) / c[n - 61] * 100;
    const dt = (last - c[n - 2]) / c[n - 2] * 100;
    const amtOf = idx => (+kl[idx][6] > 0) ? +kl[idx][6] : (v[idx] * 100 * c[idx]);
    const avg5 = (amtOf(i) + amtOf(i - 1) + amtOf(i - 2) + amtOf(i - 3) + amtOf(i - 4)) / 5;
    const ma20ok = last >= m20[i];
    const zeroOn = dif[i] > 0 && dea[i] > 0;
    const gapHigh = (last - high60) / high60 * 100;
    const wma20ok = wm20[wm20.length - 1] ? wc[wc.length - 1] >= wm20[wm20.length - 1] : false;
    const wtrend = wm20.length > 5 && wm20[wm20.length - 1] && wm20[wm20.length - 6] ? wm20[wm20.length - 1] > wm20[wm20.length - 6] : false;
    const widxUp = wdif[wdif.length - 1] > wdea[wdea.length - 1];
    const hard = d20 > 0 && d60 > 0 && ma20ok && gapHigh > -27;
    // ===== 现行口径 v3 =====
    const grade = !hard ? 'C' : (avg5 >= 5e7 ? 'A' : 'B');
    const prio = J[i] < 80 ? 'P1' : (J[i] < 120 ? 'P2' : 'P3');
    const wEnv = (wtrend && wma20ok) ? '周上' : ((wtrend || wma20ok) ? '分歧' : '周下');
    const structFull = grade === 'A' && zeroOn && ma20ok;
    const theme = themeOf(f.name);
    out.push({ code: f.code, name: f.name, close: last, date: kl[i][0], dt, d20, d60, J: J[i],
      ma20: m20[i], ma20ok, gapHigh, zeroOn, difAboveDea: dif[i] > dea[i], avg5,
      hard, grade, prio, wEnv, wtrend, wma20ok, widxUp, structFull,
      theme, region: /^(海外|跨境|商品)/.test(theme) ? '跨境商品' : 'A股', wx: WX[theme] || '土' });
  }
  return { rows: out, excl };
}
function aggregate(S) {
  const T = {}; S.forEach(r => (T[r.theme] = T[r.theme] || []).push(r));
  const sectors = Object.entries(T).map(([t, a]) => ({ t, n: a.length, wx: a[0].wx, region: a[0].region,
    A: a.filter(r => r.grade === 'A').length, hard: a.filter(r => r.hard).length, full: a.filter(r => r.structFull).length,
    dtMed: med(a.map(r => r.dt)), d20Med: med(a.map(r => r.d20)), d60Med: med(a.map(r => r.d60)), jMed: med(a.map(r => r.J)),
    dualPct: a.filter(r => r.d20 > 0 && r.d60 > 0).length / a.length * 100,
    ma20Pct: a.filter(r => r.ma20ok).length / a.length * 100,
    zeroPct: a.filter(r => r.zeroOn).length / a.length * 100,
    wUpPct: a.filter(r => r.wEnv === '周上').length / a.length * 100 })).sort((x, y) => y.full - x.full || y.A - x.A || y.n - x.n);
  const W = {}; S.forEach(r => (W[r.wx] = W[r.wx] || []).push(r));
  const wx = Object.entries(W).map(([w, a]) => ({ wx: w, n: a.length, hard: a.filter(r => r.hard).length,
    A: a.filter(r => r.grade === 'A').length, full: a.filter(r => r.structFull).length,
    dualPct: a.filter(r => r.d20 > 0 && r.d60 > 0).length / a.length * 100,
    wUpPct: a.filter(r => r.wEnv === '周上').length / a.length * 100, jMed: med(a.map(r => r.J)) })).sort((x, y) => y.full - x.full || y.A - x.A);
  return { sectors, wx };
}

// ---------- HTML 看板 ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function html(D) {
  const S = D.scan, M = D.meta, C = D.counts;
  const f = (x, d = 1) => (x == null || !isFinite(x)) ? '—' : Number(x).toFixed(d);
  const pc = (x, d = 1) => (x == null || !isFinite(x)) ? '—' : (x > 0 ? '+' : '') + Number(x).toFixed(d) + '%';
  const cl = x => x > 0 ? 'up' : (x < 0 ? 'dn' : '');
  const A = S.filter(r => r.grade === 'A').sort((a, b) => a.J - b.J || b.d20 - a.d20);
  const p1 = A.filter(r => r.prio === 'P1'), p2 = A.filter(r => r.prio === 'P2'), p3 = A.filter(r => r.prio === 'P3');
  const hard = S.filter(r => r.hard);
  const H = [];
  H.push('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>全市场ETF建仓扫描 ' + esc(DATE) + '</title>');
  H.push('<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"><' + '/script>');
  H.push('<style>*{box-sizing:border-box}body{margin:0;background:#f8f9fa;color:#1a1a1a;font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.wrap{max-width:1240px;margin:0 auto;padding:26px 22px 60px}h1{font-size:25px;margin:0 0 4px;color:#1e3a5f}h2{font-size:17px;margin:30px 0 12px;padding-left:10px;border-left:4px solid #1e3a5f}.sub{color:#5a6472;font-size:12.5px;margin-bottom:18px}.card{background:#fff;border:1px solid #e3e7ed;border-radius:10px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.03)}.tldr{background:linear-gradient(135deg,#fff,#f2f6fb);border-left:5px solid #1e3a5f}.tldr p{margin:6px 0}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}.k{background:#fff;border:1px solid #e3e7ed;border-radius:8px;padding:11px 12px}.k .v{font-size:21px;font-weight:700;color:#1e3a5f}.k .l{font-size:12px;color:#5a6472;margin-top:2px}.k .s{font-size:11px;color:#8b95a3;margin-top:2px}.up{color:#c0392b}.dn{color:#1a9c5b}.b{font-weight:700}.c{text-align:center}.sm{font-size:11.5px;color:#6b7480}table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff}th,td{padding:7px 8px;border-bottom:1px solid #edf0f4;text-align:right;white-space:nowrap}th{background:#f1f4f8;color:#3d4756;font-weight:600;position:sticky;top:0}td:first-child,th:first-child,td.l,th.l{text-align:left}tr:hover td{background:#fafbfd}.tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600}.p1{background:#fde9e7;color:#c0392b}.p2{background:#fff3dc;color:#a9700d}.p3{background:#eceef1;color:#5a6472}.wa{background:#e8f3ec;color:#1a7a4c}.wm{background:#fff3dc;color:#a9700d}.wd{background:#f0f1f3;color:#6b7480}.scroll{max-height:520px;overflow:auto;border:1px solid #e3e7ed;border-radius:8px}#sc{height:380px;width:100%}.note{background:#f4f7fb;border-left:3px solid #8aa4c8;padding:10px 13px;font-size:12.5px;color:#3d4756;border-radius:0 6px 6px 0;margin:12px 0}.warn{background:#fff7ed;border-left-color:#d99a2b}.foot{margin-top:26px;font-size:11.5px;color:#7a8493;border-top:1px solid #e3e7ed;padding-top:14px}code{background:#eef1f5;padding:1px 4px;border-radius:3px;font-size:11.5px}</style></head><body><div class="wrap">');
  H.push('<h1>全市场 ETF 建仓扫描 · 现行口径 v3</h1><div class="sub">基准日 <b>' + esc(M.baseDate) + '</b> ｜ 生成 ' + esc(M.genAt) + ' ｜ 池 ' + M.poolN + ' 只' + (M.poolRawN > M.poolN ? '（在线原始 ' + M.poolRawN + ' 只，剔债货与成交额&lt;2000万）' : '') + ' / 有效 ' + C.valid + ' 只 ｜ 数据源：' + esc(M.poolSrc) + ' + 东财前复权日线' + (M.stale ? ' ｜ <b class="up">注意：K 线最后日期非指定日，已按实际基准日输出</b>' : '') + '</div>');
  H.push('<div class="card tldr"><h2 style="margin-top:0;border:0;padding:0;font-size:16px">TL;DR</h2><p>过硬门槛 <b>' + C.hard + '</b> 只，<b>A 级 ' + C.A + '</b> 只（P1 ' + C.p1 + ' / P2 ' + C.p2 + ' / P3 ' + C.p3 + '），B 级（日均额不足）' + C.B + ' 只，<b>结构全过 ' + C.structFull + '</b> 只。A 级里周线环境：周上 ' + C.wEnv.up + ' / 分歧 ' + C.wEnv.mid + ' / 周下 ' + C.wEnv.dn + '。</p>');
  H.push('<p>J 与周线<b>都不再否决单信号</b>：J 只做 P1/P2/P3 优先档排序，周线只标环境；能否进 A 级由硬门槛与日均额决定。扩容或缩容是口径与市场共同结果，不等于机会变多。</p>');
  H.push('<p class="sm">口径 v3（2026-11-05 生效）：取消 MACD 背离要求 → J 降为排序标记 → 周线降为环境标签 → 「结构全过 = A ∩ 零轴上 ∩ 站MA20」不含周线。旧 A/B/C/D/E 分层表与「三层全过」已作废。</p></div>');
  H.push('<div class="kpis"><div class="k"><div class="v">' + C.valid + '</div><div class="l">有效 ETF</div><div class="s">覆盖率 ' + f(M.coverage * 100, 1) + '% ' + (M.coverageOk ? '达标' : '<span class="up">不足 85%</span>') + '</div></div>');
  H.push('<div class="k"><div class="v">' + C.hard + '</div><div class="l">过硬门槛</div><div class="s">20&60双正+站MA20+非深坑</div></div>');
  H.push('<div class="k"><div class="v">' + C.A + '</div><div class="l">A 级</div><div class="s">hard 且日均额≥5000万</div></div>');
  H.push('<div class="k"><div class="v">' + C.structFull + '</div><div class="l">结构全过</div><div class="s">A ∩ 零轴上 ∩ 站MA20</div></div>');
  H.push('<div class="k"><div class="v">' + S.filter(r => r.dt > 0).length + '</div><div class="l">当日上涨</div><div class="s">全池 ' + f(S.filter(r => r.dt > 0).length / (C.valid || 1) * 100, 0) + '%</div></div>');
  H.push('<div class="k"><div class="v">' + S.filter(r => r.zeroOn).length + '</div><div class="l">日线零轴上</div><div class="s">DIF>0 且 DEA>0</div></div></div>');

  H.push('<h2>一 · A 级清单（按 J 升序，P 档优先序）</h2><div class="note">P1 = J&lt;80，P2 = 80–120，P3 = ≥120，<b>只标注不踢层</b>。周线列是环境标签，不参与准入。同指数多版本 ETF 属同一机会，不按只数计。</div>');
  H.push('<div class="scroll"><table><thead><tr><th class="l">代码</th><th class="l">名称</th><th class="l">主题</th><th>五行</th><th>现价</th><th>当日</th><th>20日</th><th>60日</th><th>J</th><th>P档</th><th>周线环境</th><th>零轴上</th><th>日均额</th><th>结构全过</th></tr></thead><tbody>');
  A.forEach(r => H.push('<tr><td class="l"><code>' + esc(r.code) + '</code></td><td class="l">' + esc(r.name) + '</td><td class="l sm">' + esc(r.theme) + '</td><td>' + esc(r.wx) + '</td><td>' + f(r.close, 3) + '</td><td class="' + cl(r.dt) + ' b">' + pc(r.dt, 2) + '</td><td class="' + cl(r.d20) + '">' + pc(r.d20, 1) + '</td><td class="' + cl(r.d60) + '">' + pc(r.d60, 1) + '</td><td>' + f(r.J, 0) + '</td><td><span class="tag ' + r.prio.toLowerCase() + '">' + r.prio + '</span></td><td><span class="tag ' + (r.wEnv === '周上' ? 'wa' : r.wEnv === '分歧' ? 'wm' : 'wd') + '">' + r.wEnv + '</span></td><td>' + (r.zeroOn ? '<span class="up">是</span>' : '否') + '</td><td>' + f(r.avg5 / 1e8, 2) + '亿</td><td>' + (r.structFull ? '<b class="up">✓</b>' : '—') + '</td></tr>'));
  H.push('</tbody></table></div>');
  if (!A.length) H.push('<div class="note warn">本日 A 级 0 只，按规则如实报 0，不硬凑候选。</div>');

  H.push('<h2>二 · 板块层（按结构全过数排序）</h2><div class="scroll"><table><thead><tr><th class="l">板块</th><th>五行</th><th>只数</th><th>hard</th><th>A</th><th>结构全过</th><th>当日中位</th><th>20日中位</th><th>60日中位</th><th>J中位</th><th>双正率</th><th>站MA20率</th><th>零轴上率</th><th>周上率</th></tr></thead><tbody>');
  D.sectors.forEach(s => H.push('<tr><td class="l"><b>' + esc(s.t) + '</b></td><td>' + esc(s.wx) + '</td><td>' + s.n + '</td><td>' + s.hard + '</td><td>' + s.A + '</td><td class="b">' + s.full + '</td><td class="' + cl(s.dtMed) + '">' + pc(s.dtMed, 2) + '</td><td class="' + cl(s.d20Med) + '">' + pc(s.d20Med, 1) + '</td><td class="' + cl(s.d60Med) + '">' + pc(s.d60Med, 1) + '</td><td>' + f(s.jMed, 0) + '</td><td>' + f(s.dualPct, 0) + '%</td><td>' + f(s.ma20Pct, 0) + '%</td><td>' + f(s.zeroPct, 0) + '%</td><td>' + f(s.wUpPct, 0) + '%</td></tr>'));
  H.push('</tbody></table></div>');

  H.push('<h2>三 · 五行方向层（季度视角，不因单日改判）</h2><table><thead><tr><th class="l">五行</th><th>只数</th><th>hard</th><th>A</th><th>结构全过</th><th>双正率</th><th>周上率</th><th>J中位</th></tr></thead><tbody>');
  D.wx.forEach(w => H.push('<tr><td class="l"><b>' + esc(w.wx) + '</b></td><td>' + w.n + '</td><td>' + w.hard + '</td><td>' + w.A + '</td><td class="b">' + w.full + '</td><td>' + f(w.dualPct, 0) + '%</td><td>' + f(w.wUpPct, 0) + '%</td><td>' + f(w.jMed, 0) + '</td></tr>'));
  H.push('</tbody></table>');

  H.push('<h2>四 · 硬门槛品种 20日 / 60日 象限</h2><div class="card"><div id="sc"></div></div><div class="note">横轴 20 日涨幅、纵轴 60 日涨幅，点大小＝日均额；颜色按 J 优先档（P1 红 / P2 橙 / P3 灰）。第一象限为「双正」区，硬门槛还要求站 MA20 且距 60 日高 &gt; −27%。</div>');

  H.push('<h2>五 · 条件 → 验证窗口 → 信号</h2><table><thead><tr><th class="l">观察条件</th><th class="l">验证窗口</th><th class="l">需看到的信号（不预测、不构成操作建议）</th></tr></thead><tbody>');
  const grow = D.sectors.filter(s => ['半导体芯片', 'AI算力软件', '机器人高端制造', '消费电子通信', '新能源电力', '军工航天', '传媒游戏'].includes(s.t));
  const gN = grow.reduce((a, b) => a + b.n, 0), gHard = grow.reduce((a, b) => a + b.hard, 0), gFull = grow.reduce((a, b) => a + b.full, 0);
  H.push('<tr><td class="l">A 股成长链（火系 ' + gN + ' 只，hard ' + gHard + ' / 结构全过 ' + gFull + '）</td><td class="l">后续 5–10 个交易日</td><td class="l">板块双正率升过 20%、站 MA20 率过 50%、周上率破零，才算趋势结构修复</td></tr>');
  H.push('<tr><td class="l">P3 高 J 品种（' + C.p3 + ' 只，J≥120）</td><td class="l">后续 3–5 个交易日</td><td class="l">J 回落至 120 下方且回踩 MA20 不破、DIF 仍在 DEA 上方，视为超买消化而非破位</td></tr>');
  H.push('<tr><td class="l">A 级中「周下」环境（' + C.wEnv.dn + ' 只）</td><td class="l">后续 2–3 周</td><td class="l">周 MA20 转上行且收盘站上周 MA20，环境标签由「周下」转「分歧/周上」</td></tr>');
  H.push('<tr><td class="l">跨境 / QDII 品种</td><td class="l">每次场内价与净值披露后</td><td class="l">溢价率收敛、成交额维持 ≥5000 万，场内价与净值脱节风险才算缓解</td></tr>');
  H.push('</tbody></table>');

  H.push('<div class="foot"><b>口径</b>：东财 push2his 前复权日线（klt=101 / fqt=1 / lmt=340），MACD(12,26,9)、KDJ(9,3,3)、MA20/MA60 全序列递推，周线由日线按 ISO 周聚合；日均额取含基准日在内的 5 个完整交易日。失败/数据不足 ' + M.failN + ' 只已剔除。' + (M.stale ? ' 本次 K 线最后日期为 ' + esc(M.baseDate) + '，与指定日期 ' + esc(DATE) + ' 不一致，可能为休市或数据未更新，已按实际日期输出。' : '') + '<br><b>红线</b>：全文无买卖建议、无止损价、不预测涨跌；J 与周线按 11/05 参数有效性检验结果降为排序/环境标记（J&lt;80 组 10 日超额差 −0.05%、t=−0.34；5 种周线定义 |t|≤0.63），不构成收益增强。<br><b>局限</b>：事件研究非策略回测，未计成本与折溢价；仅当前存续 ETF，有幸存者偏差；口径变化会导致分层数量跳变，跨日比较须同口径。<br>以上分析基于公开数据和量化统计，仅供参考，不构成投资建议。市场有风险，投资需谨慎。</div>');
  H.push('</div><script>window.__D__=' + JSON.stringify({ pts: hard.map(r => ({ v: [+r.d20.toFixed(2), +r.d60.toFixed(2), +(r.avg5 / 1e8).toFixed(2)], p: r.prio, n: r.code + ' ' + r.name })) }) + ';<' + '/script>');
  H.push('<script>(function(){var D=window.__D__||{pts:[]},el=document.getElementById("sc");if(!el||!window.echarts){if(el)el.textContent="图表库未加载，象限图降级为文字：硬门槛品种共 "+D.pts.length+" 只，详见上表。";return;}var C={P1:"#c0392b",P2:"#d99a2b",P3:"#8b95a3"};var c=echarts.init(el);c.setOption({backgroundColor:"transparent",grid:{left:56,right:22,top:24,bottom:46},tooltip:{formatter:function(p){return p.data.n+"<br/>20日 "+p.data.value[0]+"% · 60日 "+p.data.value[1]+"% · 日均额 "+p.data.value[2]+"亿"}},xAxis:{name:"20日涨幅%",nameLocation:"middle",nameGap:28,axisLine:{lineStyle:{color:"#9aa4b2"}},splitLine:{lineStyle:{color:"#eef1f5"}}},yAxis:{name:"60日涨幅%",nameLocation:"middle",nameGap:40,axisLine:{lineStyle:{color:"#9aa4b2"}},splitLine:{lineStyle:{color:"#eef1f5"}}},series:[{type:"scatter",data:D.pts.map(function(x){return{value:x.v,n:x.n,itemStyle:{color:C[x.p]||"#8b95a3",opacity:.78}}}),symbolSize:function(v){return Math.max(7,Math.min(30,7+Math.sqrt(v[2]||0)*4))},markLine:{silent:true,symbol:"none",lineStyle:{color:"#b6bec9",type:"dashed"},data:[{xAxis:0},{yAxis:0}]}}]});window.addEventListener("resize",function(){c.resize()});})();<' + '/script>');
  H.push('</body></html>');
  return H.join('\n');
}

// ---------- 主流程 ----------
(async () => {
  const pool = await fetchPool();
  fs.writeFileSync(path.join(OUT, 'pool.json'), JSON.stringify(pool.list));
  let files = [], fail = [];
  const KLDIR = KLARG ? path.resolve(KLARG) : path.join(OUT, 'kl');
  if (KLARG) {
    files = fs.readdirSync(KLDIR).filter(f => /^k_.*\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(KLDIR, f), 'utf8')));
  } else {
    if (!fs.existsSync(KLDIR)) fs.mkdirSync(KLDIR, { recursive: true });
    let i = 0;
    async function worker() {
      while (i < pool.list.length) {
        const it = pool.list[i++];
        const ok = await grabOne(it, KLDIR);
        if (!ok) fail.push(it.code + ' ' + it.name);
        await sleep(130);
      }
    }
    await Promise.all(Array.from({ length: 3 }, worker));
    files = fs.readdirSync(KLDIR).filter(f => /^k_.*\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(KLDIR, f), 'utf8')));
  }
  const { rows: S, excl } = calc(files);
  const lastDates = {}; S.forEach(r => lastDates[r.date] = (lastDates[r.date] || 0) + 1);
  const baseDate = Object.entries(lastDates).sort((a, b) => b[1] - a[1])[0][0];
  const { sectors, wx } = aggregate(S);
  const A = S.filter(r => r.grade === 'A');
  const counts = { valid: S.length, hard: S.filter(r => r.hard).length, A: A.length,
    B: S.filter(r => r.grade === 'B').length, C: S.filter(r => r.grade === 'C').length,
    structFull: S.filter(r => r.structFull).length,
    p1: A.filter(r => r.prio === 'P1').length, p2: A.filter(r => r.prio === 'P2').length, p3: A.filter(r => r.prio === 'P3').length,
    wEnv: { up: A.filter(r => r.wEnv === '周上').length, mid: A.filter(r => r.wEnv === '分歧').length, dn: A.filter(r => r.wEnv === '周下').length } };
  const coverage = pool.list.length ? S.length / pool.list.length : 0;
  const genAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).replace(/\//g, '-');
  const meta = { date: DATE, baseDate, genAt: genAt + ' (UTC+8)',
    poolN: pool.list.length, poolRawN: pool.raw == null ? pool.list.length : pool.raw, poolSrc: pool.src,
    failN: fail.length + excl.length, fail: fail.slice(0, 20), excl: excl.slice(0, 20),
    coverage: +coverage.toFixed(4), coverageOk: coverage >= 0.85, stale: baseDate !== DATE,
    klSrc: KLARG ? '复用 ' + path.basename(KLDIR) : '东财 push2his 在线抓取',
    rules: 'v3: 取消MACD背离 / J为P1-P2-P3排序标记 / 周线为环境标签 / 结构全过不含周线' };
  const D = { meta, counts, scan: S, sectors, wx };
  fs.writeFileSync(path.join(OUT, 'scan.json'), JSON.stringify(S));
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ meta, counts, sectors, wx,
    aList: A.sort((a, b) => a.J - b.J).map(r => ({ code: r.code, name: r.name, theme: r.theme, wx: r.wx, prio: r.prio, wEnv: r.wEnv, J: r.J, d20: r.d20, d60: r.d60, structFull: r.structFull })),
    fullList: S.filter(r => r.structFull).map(r => r.code + ' ' + r.name) }));
  const H = html(D);
  const HTML = path.join(OUT, '全市场ETF建仓扫描_' + DATE + '.html');
  fs.writeFileSync(HTML, H, 'utf8');

  // 自检：内联 JS 语法（new Function）、残留占位、图表数据有限性
  const scripts = [...H.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let syntax = 'PASS'; try { scripts.forEach(s => new Function(s)); } catch (e) { syntax = 'FAIL ' + e.message; }
  const bad = H.match(/undefined|NaN|\[object Object\]|__DATA__|%%/g) || [];
  const finite = S.every(r => isFinite(r.d20) && isFinite(r.d60) && isFinite(r.J) && isFinite(r.avg5));
  const ok = syntax === 'PASS' && bad.length === 0 && finite;
  console.log('===== 每日 ETF 分层扫描（v3）=====');
  console.log('日期', DATE, '| 基准日', baseDate, meta.stale ? '(非指定日)' : '', '| 池', meta.poolN, '| 有效', counts.valid, '| 覆盖率', (coverage * 100).toFixed(1) + '%', meta.coverageOk ? 'OK' : '不足85%');
  console.log('hard', counts.hard, '| A', counts.A, '(P1 ' + counts.p1 + '/P2 ' + counts.p2 + '/P3 ' + counts.p3 + ')', '| B', counts.B, '| 结构全过', counts.structFull, '| A级周线 周上/分歧/周下', counts.wEnv.up + '/' + counts.wEnv.mid + '/' + counts.wEnv.dn);
  console.log('板块', sectors.length, '| 五行', wx.length, '| 失败', meta.failN);
  if (meta.coverageOk === false) console.log('⚠ coverage_ok=false：取数完整度不足，复盘里不要推送 A 级结论，仅报告数据缺口。');
  console.log('A 级 TOP10（按 J 升序）:');
  A.slice(0, 10).forEach(r => console.log('  ', r.code, r.name, r.prio, r.wEnv, 'J=' + r.J.toFixed(0), r.theme));
  console.log('SELF_CHECK', ok ? 'PASS' : 'FAIL', '| syntax', syntax, '| bad tokens', bad.length, '| finite', finite);
  console.log('OUT', OUT);
  console.log('HTML', HTML);
  if (!ok) process.exitCode = 1;
})();
