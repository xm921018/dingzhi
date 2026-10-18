# -*- coding: utf-8 -*-
"""
从运行环境读取加密分片 NB_POOL_1..5，按当前片 (NS / SLICE) 过滤出本片账号，
生成本片专用的 accounts.json，供 signin.py / notes.py 消费。

与 run.py 的分片规则一致：先过滤"当天新加入"的号（次日入池），再按 i % NS 分片。
每个账号只会被一个片处理，签到/笔记全局恰好执行一次，不会重复。

2026-10-13 修复：此前不过滤当天新号，与 run.py 的 active 口径不一致，
导致①死号/新号白跑登录验证；②播放片与签到片处理的号不同批、日志对不上。
（副作用：当天登记的号签到/笔记也次日生效，与播放同步，符合"次日入池"群规。）

角色：signin（每日签到+云贝+云豆） + notes（每 5 天发一条笔记）。
"""
import base64
import json
import os
from datetime import datetime, timedelta, timezone


def load_pool():
    entries = []
    for i in range(1, 6):
        raw = os.environ.get(f"NB_POOL_{i}")
        if not raw:
            continue
        try:
            chunk = json.loads(base64.b64decode(raw).decode("utf-8"))
            if isinstance(chunk, list):
                entries.extend(chunk)
        except Exception:
            pass
    return entries


def main():
    ns = max(1, int(os.environ.get("NS", "1")))
    slice_idx = int(os.environ.get("SLICE", "0"))

    entries = load_pool()
    pool_total = len(entries)
    # 与 run.py 完全一致的口径：北京时间"今天"之前加入的号才参与（次日入池）
    today = (datetime.now(timezone.utc) + timedelta(hours=8)).date().isoformat()
    entries = [e for e in entries if e.get("added", "") < today]
    mine = [e for i, e in enumerate(entries) if i % ns == slice_idx]

    accounts = []
    for e in mine:
        cookie = (e.get("ck") or "").strip()
        if not cookie:
            continue
        accounts.append({
            "name": e.get("name", "unknown"),
            "cookie": cookie,
            "email": e.get("email", ""),   # 2026-10-17：号主邮箱，账号不能正常刷播放时直邮提醒本人
            "roles": "signin,notes",
            "is_musician": True,   # 互助群成员均为音乐人账号；非音乐人会被接口自动跳过
            "enabled": True,
        })

    with open("accounts.json", "w", encoding="utf-8") as f:
        json.dump({"accounts": accounts}, f, ensure_ascii=False, indent=2)

    print(f"[slice {slice_idx}] 本片签到/笔记账号 {len(accounts)} 个 (号池总数 {pool_total}, 入池 {len(entries)}, NS={ns})")


if __name__ == "__main__":
    main()
