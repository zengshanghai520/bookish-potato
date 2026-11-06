#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
30分钟级别 MACD/KDJ 金叉买入信号
数据源：westock-data `kline --period m30 --raw`（新版CLI直接返回30分钟OHLC JSON，
       旧版 `minute` 命令已于 2026-08 WorkBuddy 升级后被移除）
判定：30分钟 MACD 金叉(DIF上穿DEA) + KDJ 金叉(K上穿D) = 盘中买入信号；
      按位置分档：零轴上回踩金叉(pullback)=T1/T2 主买点，零轴下深坑+超卖(strong)=T3 左侧。
注意：仅适用于场内可交易品种（ETF/LOF/股票），场外基金无分钟线。
"""
import subprocess, time, json as _json

import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from westock_cli import CLI_PATH as _WESTOCK_CLI_PATH, NODE  # 路径统一解析(2026-08-09)；NODE 动态解析，避免升级后节点改名失效(2026-10-06)
from data_fetcher import fetch as _fetch  # 统一取数层(2026-10-13)：限频识别+退避+当日缓存
WS = _WESTOCK_CLI_PATH

def normalize_code(code: str) -> str:
    """给代码加上 sh/sz/bj 前缀（如 510300 → sh510300）。
    2026-08-24 修复：westock 升级后 kline --period m30 不再自动识别纯数字代码，
    必须带交易所前缀，否则返回「分钟K线仅支持A股个股」导致30分数据全部失效。"""
    code = str(code).strip()
    if code.startswith(("sh", "sz", "bj")):
        return code
    if code.startswith(("5", "6", "9")):
        return f"sh{code}"
    if code.startswith(("0", "1", "2", "3")):
        return f"sz{code}"
    if code.startswith("4") or code.startswith("8"):
        return f"bj{code}"
    return code

def _node():
    return NODE


def _win_of(t):
    """CLI `kline --period m30` 返回的30分钟K线按【收盘时刻】打标签，
    每个交易日固定 8 根：1000/1030/1100/1130/1330/1400/1430/1500 → 窗口 0~7。

    ⚠ 2026-08-09 修复：旧版按「起始时刻」口径映射，导致
      ① 11:30 这根（11:00-11:30）被判 None 整根丢弃 → 每日少 1/8 K线；
      ② 14:30 与 15:00 双双映射为 w7 → 窗口编号撞车。
    两者都会让 MACD/KDJ 失真，故改为收盘时刻口径。
    """
    _END_WIN = {1000: 0, 1030: 1, 1100: 2, 1130: 3,
                1330: 4, 1400: 5, 1430: 6, 1500: 7}
    return _END_WIN.get(int(t))


def fetch_minute(code: str, days: int = 8):
    """获取30分钟K线数据。

    ⚠ 2026-10-13 接入统一取数层 data_fetcher：
      原实现在 westock 返回服务限频错误体（`{"success":false,"error":{"code":
      "SKILL_006_2","message":"服务限频"}}`）时，`json.loads` 得到 dict 而非 list，
      于是走 `if not raw or not isinstance(raw, list)` 分支直接重试——但限频时
      重试只会加重限频，且 5 次固定 sleep(2.5) 无退避、无全局协同，
      导致 TOP5 扫 537 只时 43% 取数失败（2026-10-12 事故根因）。
      现统一交给 data_fetcher：限频显式识别 + 指数退避抖动 + 全局冷却闸门
      + 当日磁盘缓存（TOP5 跑完后雷达/持仓/复盘直接读缓存，不再重复请求）。
      返回格式：[{date, w, open, high, low, close, vol, n}, ...] 时间升序。
    """
    import datetime as _dt
    code = normalize_code(code)
    # 日期范围：days 天 → 往前推 days*1.5 日历天覆盖周末，上限1个月
    today = _dt.date.today()
    end_date = today.strftime("%Y-%m-%d")
    calendar_back = min(int(days * 1.5), 28)  # 分钟K线仅支持近1个月
    start_date = (today - _dt.timedelta(days=calendar_back)).strftime("%Y-%m-%d")

    raw = _fetch(code, period="m30", start=start_date, end=end_date)
    if not raw:
        return []

    bars = []
    for item in raw:  # data_fetcher 已保证时间升序
        dt = item.get("datetime") or item.get("date", "")
        date_part = dt[:10]
        time_str = dt[11:16]  # "HH:MM"
        try:
            hh, mm = time_str.split(":")
            t = int(hh) * 100 + int(mm)
        except ValueError:
            continue

        w = _win_of(t)
        if w is None:
            continue

        bars.append({
            "date": date_part,
            "w": w,
            "open": float(item.get("open") or 0),
            "high": float(item.get("high") or 0),
            "low": float(item.get("low") or 0),
            "close": float(item.get("close") or 0),
            "vol": float(item.get("volume") or 0),
            # 尾盘窗口(1430-1500)含收盘竞价共31分钟，标 31 以匹配
            # analyze() 的 last_window_complete 判定口径
            "n": 31 if w == 7 else 30,
        })
    return bars


def aggregate_30m(rows):
    """1分钟序列 -> 30分钟K线 (OHLC)。返回按时间升序的 bar 列表。"""
    def win_of(t):
        h, m = divmod(t, 100)
        if h == 9 and m >= 30:
            return 0
        if h == 10:
            return 1 if m < 30 else 2
        if h == 11:
            return 3 if m < 30 else None
        if h == 13:
            return 4
        if h == 14:
            return 5 if m < 30 else 6
        if h == 15:
            return 7
        return None

    bars = {}
    for date, t, price, vol in rows:
        w = win_of(t)
        if w is None:
            continue
        key = (date, w)
        if key not in bars:
            bars[key] = {"open": price, "high": price, "low": price,
                         "close": price, "vol": vol, "n": 1}
        else:
            b = bars[key]
            b["high"] = max(b["high"], price)
            b["low"] = min(b["low"], price)
            b["close"] = price
            b["vol"] += vol
            b["n"] += 1
    seq = sorted(bars.keys())
    out = []
    for k in seq:
        b = bars[k]
        out.append({"date": k[0], "w": k[1], "open": b["open"], "high": b["high"],
                    "low": b["low"], "close": b["close"], "vol": b["vol"], "n": b["n"]})
    return out


def _ema(vals, n):
    k = 2 / (n + 1)
    e = vals[0]
    out = [e]
    for v in vals[1:]:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def calc_macd(closes, fast=12, slow=26, sig=9):
    ema_f = _ema(closes, fast)
    ema_s = _ema(closes, slow)
    dif = [a - b for a, b in zip(ema_f, ema_s)]
    dea = _ema(dif, sig)
    hist = [2 * (d - de) for d, de in zip(dif, dea)]
    return dif, dea, hist


def calc_kdj(bars, n=9):
    ks, ds, js = [], [], []
    K, D = 50.0, 50.0
    for i, b in enumerate(bars):
        window = bars[max(0, i - n + 1):i + 1]
        hh = max(x["high"] for x in window)
        ll = min(x["low"] for x in window)
        rsv = (b["close"] - ll) / (hh - ll) * 100 if hh > ll else 50.0
        K = 2 / 3 * K + 1 / 3 * rsv
        D = 2 / 3 * D + 1 / 3 * K
        J = 3 * K - 2 * D
        ks.append(K)
        ds.append(D)
        js.append(J)
    return ks, ds, js


def detect_top_divergence(closes, dif, hist, look=12):
    """顶背离（看跌）：价格接近或创出近期新高，但 MACD(DIF 或 柱) 未同步创新高。

    以最近 look 根 K 线（不含最后一根）为参照区间找价格高点。最后一根收盘价
    若 >= 前期高点 * 0.997（即接近/创出新高），而同时 DIF 或 MACD 柱低于前期高点值，
    即为顶背离——上涨动能衰竭、警惕回落。
    """
    n = len(closes)
    if n < look + 2:
        return False
    region_start = max(0, n - look - 1)
    region = range(region_start, n - 1)
    peak_i = max(region, key=lambda i: closes[i])
    peak_price = closes[peak_i]
    cur = n - 1
    price_ok = closes[cur] >= peak_price * 0.997  # 接近或创出新高
    if not price_ok:
        return False
    ind_lower = (dif[cur] < dif[peak_i] - 1e-9) or (hist[cur] < hist[peak_i] - 1e-9)
    return ind_lower


def analyze_volume(bars, closes):
    """量能分析：返回当前量能特征，用于卖出侧「放量滞涨 / 天量见顶」研判。"""
    vols = [b["vol"] for b in bars]
    cur_vol = vols[-1]
    prev = vols[-6:-1]
    vol_ma = sum(prev) / len(prev) if prev else cur_vol
    vol_ratio = cur_vol / vol_ma if vol_ma > 0 else 1.0
    price_chg = ((closes[-1] - closes[-2]) / closes[-2] * 100) if len(closes) > 1 and closes[-2] else 0.0
    return cur_vol, vol_ratio, price_chg


def detect_bull_divergence(closes, dif, hist, js, look=12):
    """底背离（看涨·提前信号）：价格在近期低点附近企稳/回升，但 MACD(DIF/柱) 或 KDJ(J)
    已先于价格走强（更高低点），即动能先于价格转好——双金叉之前的领先信号。"""
    n = len(closes)
    if n < look + 2:
        return False
    region_start = max(0, n - look - 1)
    region = range(region_start, n - 1)
    trough_i = min(region, key=lambda i: closes[i])   # 区间价格最低点
    trough_price = closes[trough_i]
    cur = n - 1
    # 价格回到低点附近或上方（未继续破位）
    price_ok = closes[cur] >= trough_price * 0.997
    if not price_ok:
        return False
    # 指标已先于价格走强（更高低点）
    ind_higher = (js[cur] > js[trough_i] + 1e-9) or \
                 (dif[cur] > dif[trough_i] + 1e-9) or \
                 (hist[cur] > hist[trough_i] + 1e-9)
    return ind_higher


def lead_signal(closes, dif, dea, hist, ks, ds, js, last_complete=True):
    """30分【提前信号】：在「双金叉已经发生」之前发出，解决金叉滞后、追高买不到的问题。
    领先逻辑（按强弱）：
      strong : J 自超卖区拐头向上 且 零轴下 且 动能转好(绿柱缩短 或 DIF上行)
               → 距双金叉仅 1~2 根K，左侧最强提前买点
      medium : J 拐头 且 (DIF/DEA 临界金叉 或 K/D 临界金叉) → 随时触发
      watch  : 仅 J 拐头 或 仅 MACD 动能转好 → 观察未确认
    实时性：last_complete=False（最后一根30分K未完成=盘中实时价驱动）→ 标注 realtime，
            此时信号即为「盘中已现、可在本窗口收盘前建仓」的最早提前量。
    返回 tier / label / realtime / bars_to_cross(预计几根K内金叉) / 明细布尔。"""
    n = len(closes)
    if n < 4:
        return {"tier": "none", "label": "", "realtime": False, "bars_to_cross": None,
                "j_turn": False, "j_turn_oversold": False, "macd_up": False,
                "macd_below": False, "imm_macd": False,
                "imm_kdj": False, "bull_div": False}
    Jc, Jp, Jpp = js[-1], js[-2], js[-3]
    Kc, Kp = ks[-1], ks[-2]
    Dc, Dp = ds[-1], ds[-2]
    Hc, Hp = hist[-1], hist[-2]
    DIFc, DIFp = dif[-1], dif[-2]
    DEAc, DEAp = dea[-1], dea[-2]

    # J 拐头：局部底(Jp<=Jpp)后回升(Jc>Jp)，且近期处低位(Jpp<55)、不在高位追(Jc<75)
    j_turn = (Jc > Jp) and (Jp <= Jpp) and (Jpp < 55) and (Jc < 75)
    j_turn_oversold = j_turn and (Jc < 25 or Jpp < 20)
    # MACD 动能转好：柱由缩到放（绿柱缩短或红柱放大）
    macd_up = Hc > Hp
    macd_below = Hc < 0
    dif_up = DIFc >= DIFp
    # 临界金叉 MACD：DIF-DEA 差收窄且 DIF 上行，且已接近交叉
    gap_now = DEAc - DIFc
    gap_prev = DEAp - DIFp
    imm_macd = (gap_now < gap_prev) and dif_up and (gap_now < (abs(DIFc) * 0.5 + 1e-6))
    # 临界金叉 KDJ：K-D 差收窄且 K 上行
    kdgap_now = Dc - Kc
    kdgap_prev = Dp - Kp
    imm_kdj = (kdgap_now < kdgap_prev) and (Kc >= Kp)
    bull = detect_bull_divergence(closes, dif, hist, js, look=12)

    # 距金叉距离估算（几根30分K）：用 DIF-DEA 差值 ÷ 近3根平均上行速度
    if dif_up and gap_now > 0:
        avg_chg = (DIFc - dif[-4]) / 3 if n >= 4 else 0
        bars_to_cross = int(gap_now / avg_chg) + 1 if avg_chg > 1e-9 else None
    else:
        bars_to_cross = None
    realtime = (not last_complete)

    if j_turn_oversold and macd_below and (macd_up or dif_up):
        pos = "零轴下" if DIFc < 0 else "零轴上"
        rt = "🔥盘中实时" if realtime else ""
        eta = ("·预计%d根内金叉" % bars_to_cross) if bars_to_cross else ""
        tier, label = "strong", "%s即将双金叉·左侧提前(%s)%s" % (rt, pos, eta)
    elif j_turn and (imm_macd or imm_kdj):
        tier, label = "medium", "⏳ 临界金叉·随时触发"
    elif j_turn or macd_up:
        tier, label = "watch", "👀 动能转好·观察未确认"
    else:
        tier, label = "none", ""
    return {"tier": tier, "label": label, "realtime": realtime, "bars_to_cross": bars_to_cross,
            "j_turn": j_turn, "j_turn_oversold": j_turn_oversold, "macd_up": macd_up,
            "macd_below": macd_below, "imm_macd": imm_macd,
            "imm_kdj": imm_kdj, "bull_div": bull}


def analyze(code: str, days: int = 12, daily_j=None, weekly_j=None, weekly_dir=None):
    # 2026-08-09 改造：fetch_minute 已改用 kline --period m30，直接返回30分钟OHLC bar
    bars = fetch_minute(code, days)
    if len(bars) < 30:
        return {"code": code, "ok": False, "reason": "30分钟K线不足(%d根)" % len(bars)}
    closes = [b["close"] for b in bars]
    dif, dea, hist = calc_macd(closes)
    ks, ds, js = calc_kdj(bars)

    cD, cDEA, cK, cDk, cJ = dif[-1], dea[-1], ks[-1], ds[-1], js[-1]
    pD, pDEA, pK, pDk, pJ = dif[-2], dea[-2], ks[-2], ds[-2], js[-2]

    macd_gold = (pD < pDEA) and (cD > cDEA)
    kdj_gold = (pK < pDk) and (cK > cDk)
    below_zero = cD < 0

    # ============ 买入信号分档（2026-08-28 重构）============
    # 核心修正：海哥选标 = 右侧真趋势（已站零轴），买点主战场应是
    #   「零轴上回踩金叉」(T1/T2)，原 strong 死卡 cJ<20 与强势票互斥 → 信号永不触发。
    # 档位定义：
    #   pullback : 零轴上双金叉（MACD 在零轴上方 DIF 回踩 DEA 后再金叉）= T1/T2 主买点
    #   strong   : 零轴下深坑双金叉 + KDJ 超卖(J<20) = T3 左侧深坑
    #   medium   : 其他双金叉（中性）
    #   weak     : 单金叉（未确认）
    #   none     : 无信号
    if macd_gold and kdj_gold:
        if cD >= 0:
            level = "pullback"      # 零轴上回踩金叉 = T1/T2 右侧主买点
        elif cJ < 20:
            level = "strong"        # 零轴下深坑 + 超卖 = T3 左侧
        else:
            level = "medium"
    elif macd_gold or (kdj_gold and cJ < 20):
        level = "weak"
    else:
        level = "none"

    # ============ 提前信号层（领先双金叉，2026-09-03 新增）============
    # 解决「等双金叉确认时价格已涨起、买不到好位置」的问题：
    # 在 macd_gold/kdj_gold 真正发生之前，用 J拐头/绿柱缩短/临界金叉/底背离 提前预警。
    # 实时性判定：最后一根30分K是否已完成（n满窗口）→ 未完成即盘中实时价驱动
    _last = bars[-1]
    last_complete = (_last["n"] >= 30) if _last["w"] != 7 else (_last["n"] >= 31)
    lead = lead_signal(closes, dif, dea, hist, ks, ds, js, last_complete)

    # ============ 卖出信号（卖点增强层）：量能 / 顶背离 / KDJ≥120 ============
    cur_vol, vol_ratio, price_chg = analyze_volume(bars, closes)
    top_div = detect_top_divergence(closes, dif, hist, look=12)
    j_overbought = cJ >= 100  # 超买极值(真·极端，原120过高漏判高位迟到金叉)
    j_high = cJ >= 80         # 高位区：双金叉视为迟到金叉/诱多，阻断买入tier

    sell_reasons = []
    if cJ >= 100:
        sell_reasons.append("KDJ超买极值(J≥100)")
    elif cJ >= 80:
        sell_reasons.append("KDJ偏高(J≥80)")
    if top_div:
        sell_reasons.append("顶背离(价新高·指标未新高)")
    # 量能：天量(量比≥2.5) 或 放量滞涨(量比≥1.8 且 价不涨)
    vol_blowoff_raw = vol_ratio >= 2.5
    vol_stall_raw = (vol_ratio >= 1.8) and (price_chg <= 0.1)

    # ---- 位置过滤（关键）----
    # 量能类信号必须结合 KDJ 位置解读：
    #   高位天量(J≥50) = 出货/见顶  -> 计入卖点
    #   低位天量(J<50)  = 恐慌抛售末端 / 放量启动 -> 不是卖点，反而是买方观察项
    # 否则 J<0 的极度超卖标的会因放量被误判为「强卖」，与三档建仓规则(T3: J<0极值)直接冲突。
    pos_high = cJ >= 50
    vol_blowoff = vol_blowoff_raw and pos_high
    vol_stall = vol_stall_raw and pos_high
    vol_low_surge = vol_blowoff_raw and (cJ < 20)   # 低位放量：疑似恐慌底/启动，买方参考

    if vol_blowoff:
        sell_reasons.append("高位天量警示(量比≥2.5·J≥50)")
    elif vol_stall:
        sell_reasons.append("高位放量滞涨(量比≥1.8·价不涨)")

    # 硬卖点（任一即触发减仓/离场）：KDJ≥100 / 顶背离 / 高位天量
    raw_hard = j_overbought or top_div or vol_blowoff

    # ===== 高周期确认闸门 v3（与买入侧「周线定方向」对称 · 2026-08-26 修复卖飞）=====
    # 优先级（任一命中即定档，不再下探）：
    #  ① 日线/周线 超卖(J<30)  -> 完全抑制：深套/低位反弹，不卖不减数（防卖在坑里）
    #  ② 周线向上(up)         -> 完全抑制：上升通道持有斩获涨幅，绝不诱导卖出（防上升趋势卖太早）
    #  ③ 周线向下(down)       -> 强卖降级「减仓观察」（熊途反弹减仓不追；非深套不清仓）
    #  ④ 周线中性/side或缺失  -> 日线J三档矩阵：超卖抑制 / 中性降级 / 超买强卖
    #  ⑤ 无任何高周期数据      -> 保持原30分判定（兼容旧调用）
    ht_high = ((daily_j is not None and daily_j >= 75) or
               (weekly_j is not None and weekly_j >= 75))
    ht_oversold = ((daily_j is not None and daily_j < 30) or
                   (weekly_j is not None and weekly_j < 30))
    have_ht_data = (daily_j is not None) or (weekly_j is not None)
    sell_gate = None
    if ht_oversold:
        # ① 高周期超卖：低位反弹/深套，完全抑制所有卖点
        hard = False
        sell_level = None
        sell = False
        sell_reasons = []
        dj = daily_j if daily_j is not None else weekly_j
        sell_gate = "抑制·高周期超卖(J=%.1f<30)·低位反弹不卖" % dj
    elif weekly_dir == "up":
        # ② 周线向上：上升通道，持有斩获涨幅，绝不诱导卖出
        hard = False
        sell_level = None
        sell = False
        sell_reasons = []
        sell_gate = "抑制·周线向上(上升通道)·持有斩获涨幅不卖"
    elif weekly_dir == "down":
        # ③ 周线向下：熊途反弹，强卖降级减仓观察
        hard = False
        sell_level = "watch" if raw_hard else ("watch" if sell_reasons else None)
        sell = bool(sell_reasons) or bool(raw_hard)
        if raw_hard:
            sell_gate = "降级·周线向下(熊途反弹)·强卖→减仓观察"
        elif sell_reasons:
            sell_gate = "降级·周线向下(熊途反弹)·减仓观察"
    elif have_ht_data:
        # ④ 周线中性/side/无方向：日线J三档矩阵
        if not ht_high:
            hard = False
            sell_level = "watch" if sell_reasons else None
            sell = bool(sell_reasons)
            dj = daily_j if daily_j is not None else weekly_j
            sell_gate = "降级·高周期未超买(日线J=%.1f)·强卖→减仓观察" % dj
        else:
            hard = True
            sell_level = "strong"
            sell = True
            dj = daily_j if daily_j is not None else weekly_j
            sell_gate = "通过·高周期超买确认(日线J=%.1f)" % dj
    else:
        # ⑤ 无高周期数据：保持原判定
        hard = raw_hard
        sell_level = "strong" if hard else ("watch" if sell_reasons else None)
        sell = bool(sell_reasons)
        if raw_hard:
            sell_gate = "通过·无高周期数据·按30分判定"

    last = bars[-1]
    return {
        "code": code, "ok": True,
        "bars": len(bars),
        "close": round(closes[-1], 4),
        "dif": round(cD, 4), "dea": round(cDEA, 4), "hist": round(hist[-1], 4),
        "k": round(cK, 2), "d": round(cDk, 2), "j": round(cJ, 2),
        "macd_gold": macd_gold, "kdj_gold": kdj_gold, "below_zero": below_zero,
        "level": level,
        # ---- 提前信号层（2026-09-03 新增，领先双金叉；2026-09-03 调灵敏+实时性）----
        "lead_tier": lead["tier"],
        "lead_label": lead["label"],
        "lead_realtime": lead["realtime"],
        "lead_bars_to_cross": lead["bars_to_cross"],
        "lead_j_turn": lead["j_turn"],
        "lead_macd_up": lead["macd_up"],
        "lead_imm_macd": lead["imm_macd"],
        "lead_imm_kdj": lead["imm_kdj"],
        "lead_bull_div": lead["bull_div"],
        "last_window": "%s/w%d" % (last["date"], last["w"]),
        "last_window_complete": last_complete,
        # ---- 卖点增强层 ----
        "vol": round(cur_vol, 2),
        "vol_ratio": round(vol_ratio, 2),
        "price_chg_pct": round(price_chg, 2),
        "top_divergence": top_div,
        "j_overbought": j_overbought,
        "j_high": j_high,
        "vol_blowoff": vol_blowoff,
        "vol_stall": vol_stall,
        "vol_low_surge": vol_low_surge,
        "sell": sell,
        "sell_level": sell_level,
        "sell_reasons": sell_reasons,
        # ---- 高周期确认闸门（2026-08-25 修复卖飞）----
        "sell_gate": sell_gate,
        "daily_j": daily_j,
        "weekly_j": weekly_j,
        "weekly_dir": weekly_dir,
    }


if __name__ == "__main__":
    import sys, json
    codes = sys.argv[1].split(",") if len(sys.argv) > 1 else ["sh588200"]
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    for c in codes:
        r = analyze(c, days)
        print(c, json.dumps(r, ensure_ascii=False))
