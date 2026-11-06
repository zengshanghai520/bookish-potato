# -*- coding: utf-8 -*-
"""信创/云计算 30分 MACD 金叉监控。

读取 data/alerts/gold_cross_watch.txt 的监控池，
对每只用 min30_indicators.analyze 计算 30分 MACD/KDJ，
判定是否触发 30分双金叉（=T2确认档位）。

触发条件：30分双金叉(macd_gold 且 kdj_gold)，level 达 pullback/strong/medium 任一。
输出末尾打印 `GOLDCROSS_TRIGGER: N`，供自动化解析是否弹提示。
"""
import sys, os, json, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
from min30_indicators import analyze

_HERE = os.path.dirname(os.path.abspath(__file__))
_ALERTS = os.path.join(os.path.dirname(_HERE), "data", "alerts")
_WATCH = os.path.join(_ALERTS, "gold_cross_watch.txt")


def load_watch():
    out = []
    if not os.path.exists(_WATCH):
        return out
    for line in open(_WATCH, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        code = line.split("#")[0].strip()
        name = line.split("#")[1].strip() if "#" in line else ""
        if code:
            out.append((code, name))
    return out


def main():
    items = load_watch()
    if not items:
        print("金叉监控池为空（gold_cross_watch.txt）")
        return
    print("🔍 信创/云计算 30分金叉监控（%d只 · %s）"
          % (len(items), datetime.datetime.now().strftime("%Y-%m-%d %H:%M")))
    triggers, lead_triggers, rows = [], [], []
    for code, name in items:
        try:
            r = analyze(code, 12)
        except Exception as e:
            rows.append((code, name, "ERR", "-", "-", "-", "-", str(e)[:24]))
            continue
        if not r.get("ok"):
            rows.append((code, name, "数据不足", "-", "-", "-", "-", r.get("reason", "")[:20]))
            continue
        j = r.get("j")
        lv = r.get("level")
        mg = r.get("macd_gold")
        kg = r.get("kdj_gold")
        below = r.get("below_zero")
        ltier = r.get("lead_tier")
        llabel = r.get("lead_label")
        lreal = r.get("lead_realtime")
        lcross = r.get("lead_bars_to_cross")
        # ===== 2026-09-03 新增：lead 提前预警（领先双金叉 1~2 根K）=====
        if ltier in ("strong", "medium"):
            lead_triggers.append((code, name, j, ltier, llabel, lreal, lcross))
            status = "🔥 提前信号·%s" % llabel
        # 触发 = 30分双金叉确认（pullback/strong/medium）
        elif bool(mg and kg) or (lv in ("strong", "pullback", "medium")):
            status = "🎯 双金叉触发·可建仓"
            triggers.append((code, name, j, lv))
        elif mg or kg:
            status = "🟡 单金叉·未确认"
        elif below:
            status = "🟦 真筑底·零轴下等金叉(T3)"
        else:
            status = "🟢 强势上涨·零轴上等回踩"
        rows.append((code, name, status, "J=%.1f" % j if j is not None else "-",
                     lv or "-", "零轴下" if below else "零轴上",
                     "双金叉" if (mg and kg) else "未",
                     llabel or "-"))
    print("-" * 64)
    for code, name, status, j, lv, bz, gc, ld in rows:
        print(f"  {name}({code}): {status} | {j} | {bz} | 30分{gc} | lead:{ld}")
    print("-" * 64)
    print("GOLDCROSS_LEAD: %d" % len(lead_triggers))
    if lead_triggers:
        print("🔥 以下出现「双金叉前兆」提前信号（可在金叉确认前布局）：")
        for code, name, j, ltier, llabel, lreal, lcross in lead_triggers:
            if lreal:
                eta = "🔥盘中实时·本窗口收盘前可建仓"
            elif lcross:
                eta = "预计%d根30分K内金叉" % lcross
            else:
                eta = "等下一根K确认"
            print(f"   - {name}({code}) J={j} → {ltier} | {eta}")
    print("GOLDCROSS_TRIGGER: %d" % len(triggers))
    if triggers:
        print("🎯 以下已触发30分双金叉，可建仓：")
        for code, name, j, lv in triggers:
            if lv == "pullback":
                tier = "T1/T2(零轴上回踩)"
                note = " ⚠高位钝化·小仓回踩确认" if (j is not None and j >= 80) else ""
            elif lv == "strong":
                tier = "T3(零轴下深坑)"
                note = ""
            else:
                tier = "T2(通用双金叉)"
                note = ""
            print(f"   - {name}({code}) J={j} level={lv} → 建议{tier}{note}")
    out = {
        "checked_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "lead_count": len(lead_triggers),
        "lead_triggers": [{"code": c, "name": n, "j": j, "tier": lv,
                           "label": lb, "realtime": rt, "bars_to_cross": bc}
                          for c, n, j, lv, lb, rt, bc in lead_triggers],
        "trigger_count": len(triggers),
        "triggers": [{"code": c, "name": n, "j": j, "level": lv} for c, n, j, lv in triggers],
        "rows": [{"code": c, "name": n, "status": s, "j": j, "level": lv,
                  "below_zero": bz, "gold": g, "lead": ld}
                 for c, n, s, j, lv, bz, g, ld in rows],
    }
    json.dump(out, open(os.path.join(_ALERTS, "gold_cross_latest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
