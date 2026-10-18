# -*- coding: utf-8 -*-
"""
定时任务执行体（与仓库对外用途无关的命名）。

职责：
1. 从运行环境读取加密分片 NB_POOL_1..5（每条 = [{ck, song, added, name}, ...]），
   本文件/仓库不落任何明文 cookie。
2. 校验每个账号是否存活（account/get），丢弃失效会话。
3. 过滤"当天新加入"的号（added == 今天 不参与，满足第 2 天入池）。
4. 当前 job 只处理自己分片 (i % NS == SLICE) 的账号；每个账号随机挑
   PLAYS_PER_ACCOUNT 个"别人的歌"播放，绝不播自己的歌。
   带有 noListen 标记的号（如群主大号）只进歌池被别人听，自己不播放。
5. 复用已验证可用的上报通道（weapi + eapi 双通道，time>=31s）。

配置见 cfg.json。运行参数来自环境变量 NS / SLICE（matrix 注入）。
"""
import json
import os
import sys
import time
import random
import base64
import string
from datetime import date, datetime, timedelta

import requests
from Crypto.Cipher import AES

BASE_URL = "https://music.163.com"

# ===== 加密参数（与历史实现一致，公开已知） =====
_NONCE = "0CoJUm6Qyw8W8jud"
_SECRETKEY = "TA3YiYCfY2dDJQgg"
_VI = "0102030405060708"
_ENCSECKEY = "84ca47bca10bad09a6b04c5c927ef077d9b9f1e37098aa3eac6ea70eb59df0aa28b691b7e75e4f1f9831754919ea784c8f74fbfadf2898b0be17849fd656060162857830e241aba44991601f137624094c114ea8d17bce815b0cd4e5b8e2fbaba978c6d1d14dc3d1faf852bdd28818031ccdaaa13a6018e1024e2aae98844210"

MOBILE_UAS = [
    "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.41 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; Redmi Note 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.73 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; Samsung Galaxy S22) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.71 Mobile Safari/537.36",
]

# 混听来源：云音乐热歌榜（公开歌单，真实在榜歌曲，随官方榜单变化）
MIX_HOT_PID = 3778678
# 登记页 Worker 地址（失效账号清理上报用）
WORKER_URL = "https://dingzhi.listenmusic888.workers.dev"
# 有效播放门槛为单次 >=30s，保底 35s 留余量（短歌按比例算不足 35s 时也报 35s）
MIN_PLAY_SECONDS = 35


def _pad(s):
    pad_len = 16 - len(s) % 16
    return s + chr(pad_len) * pad_len


def _aes_encrypt(text, key):
    cipher = AES.new(key.encode("utf-8"), AES.MODE_CBC, _VI.encode("utf-8"))
    return base64.b64encode(cipher.encrypt(_pad(text).encode("utf-8"))).decode("utf-8")


def weapi_encrypt(data):
    text = json.dumps(data)
    p = _aes_encrypt(text, _NONCE)
    p = _aes_encrypt(p, _SECRETKEY)
    return {"params": p, "encSecKey": _ENCSECKEY}


class Client:
    def __init__(self, cookie, device_id=None):
        self.s = requests.Session()
        self.uid = None
        self.nickname = None
        self.account_name = ""
        if not device_id:
            device_id = "YD-" + "".join(random.choices(string.ascii_letters + string.digits, k=32))
        enriched = (
            f"{cookie}; deviceId={device_id}; os=pc; appver=2.10.11.200601; "
            f"osver=Microsoft-Windows-10-Professional-build-19045-64bit; channel=netease; MUSIC_A_T=1"
        )
        self.s.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://music.163.com",
            "Origin": "https://music.163.com",
            "Cookie": enriched,
        })

    def _weapi_post(self, url, data):
        r = self.s.post(url, data=weapi_encrypt(data), timeout=30)
        try:
            return r.json()
        except Exception:
            return {"_raw": r.text[:200], "status_code": r.status_code}

    def login_by_cookie(self, cookie, name=""):
        """三态判定：True=活号 / False=明确失效 / None=网络异常无法判定。
        2026-10-13 修复：此前任何异常都返回 False，一次超时/连接错误就会把活号
        误报成死号并被 Worker 从 KV+Secrets 真删，成员得重新登记。"""
        self.account_name = name
        try:
            info = self._weapi_post(f"{BASE_URL}/weapi/w/nuser/account/get", {})
        except Exception:
            return None
        # _weapi_post 请求层失败时返回无 code 的 dict（含 _raw/status_code）→ 网络问题，不是号的问题
        if "code" not in info:
            return None
        prof = (info.get("profile") or info.get("data", {}).get("profile") or {})
        self.uid = prof.get("userId")
        self.nickname = prof.get("nickname")
        if info.get("code") == 200 and self.uid:
            return True
        # 明确未登录的业务码，直接判死，不必再试
        if info.get("code") in (301, 302):
            return False
        # 受限会话：profile 隐藏但会话可能仍活，用每日推荐二次验证。
        # 注意必须用 api v1 明文接口：weapi v3 对未登录会话也返回歌单（2026-10-11 实测，
        # 匿名/死号 v3 照样有歌 → 无区分度会把死号误判成活号）；v1 实测活号 30+ 首、死号/匿名 0 首。
        try:
            r1 = self.s.get(f"{BASE_URL}/api/v1/discovery/recommend/songs", timeout=20)
            d1 = r1.json()
        except Exception:
            return None  # 二次验证也网络失败，无法判定
        return d1.get("code") == 200 and len((d1.get("data") or {}).get("dailySongs") or []) > 0

    def song_detail(self, ids):
        out = {}
        # 分批，避免单请求过大
        for i in range(0, len(ids), 200):
            batch = ids[i:i + 200]
            try:
                r = self._weapi_post(f"{BASE_URL}/weapi/v3/song/detail", {"c": json.dumps([{"id": x} for x in batch])})
                for t in (r.get("songs") or []):
                    out[t.get("id")] = (t.get("dt") or 0) // 1000
            except Exception:
                pass
            time.sleep(random.uniform(0.5, 1.5))
        return out

    def playlist_tracks(self, pid, limit=200):
        """公开歌单的前 limit 首歌。返回 [(id, 时长秒)]，失败返回 []。"""
        try:
            r = self._weapi_post(f"{BASE_URL}/weapi/v6/playlist/detail", {"id": pid, "n": limit})
            pl = r.get("playlist") or {}
            ids = [t.get("id") for t in (pl.get("trackIds") or [])[:limit] if t.get("id")]
            if not ids:
                return []
            durs = self.song_detail(ids)
            return [(i, durs.get(i) or 240) for i in ids]
        except Exception:
            return []

    def scrobble(self, tid, t, pid=None, page="playlist"):
        csrf = ""
        try:
            csrf = self.s.headers.get("Cookie", "").split("__csrf=")[-1].split(";")[0].strip()
        except Exception:
            pass
        try:
            start = [{"action": "startplay", "json": {"id": str(tid), "type": "song", "content": f"id={tid}"}}]
            self._weapi_post(f"{BASE_URL}/weapi/feedback/weblog", {"logs": json.dumps(start), "csrf_token": csrf})
            play = [{"action": "play", "json": {
                "download": "0", "end": "playend", "id": str(tid),
                "sourceId": str(pid) if pid else str(tid), "time": str(t),
                "type": "song", "wifi": "0", "resource": f"R_SO_4_{tid}",
                "resourceid": str(tid), "page": page, "is_autoplay": "0",
                "mainsite": "1", "mainsiteWeb": "1", "content": f"id={tid}"}}]
            res = self._weapi_post(f"{BASE_URL}/weapi/feedback/weblog", {"logs": json.dumps(play), "csrf_token": csrf})
            return res.get("code") == 200
        except Exception:
            return False


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
    cfg = json.load(open("cfg.json", encoding="utf-8"))
    plays = int(cfg.get("plays_per_account", 28))
    skip_prob = float(cfg.get("skip_prob", 0.08))
    mixed_min = int(cfg.get("mixed_plays_min", 6))
    mixed_max = int(cfg.get("mixed_plays_max", 10))
    ns = max(1, int(os.environ.get("NS", "1")))
    slice_idx = int(os.environ.get("SLICE", "0"))

    entries = load_pool()
    if not entries:
        print(f"[slice {slice_idx}] 号池为空，跳过")
        return

    # 1) 校验存活（三态：True=活 / False=明确死 / None=网络异常无法判定）。
    # None 时本次跳过该号：不播放，也绝不上报死号——一次网络抖动不该把活号清理出池（2026-10-13 修复）
    active = []
    dead = 0
    unknown = 0
    dead_names = []
    for e in entries:
        c = Client(e.get("ck", ""))
        v = c.login_by_cookie(e.get("ck", ""), e.get("name", "?"))
        if v is True:
            active.append(e)
        elif v is False:
            dead += 1
            dead_names.append(e.get("name", ""))
        else:
            unknown += 1
            print(f"  [{e.get('name','?')}] 网络异常无法判定，本次跳过（不报失效）")
        time.sleep(random.uniform(1, 3))

    # 2) 过滤当天新加入（第 2 天入池）
    # "今天"必须按北京时间算：runner 时区是 UTC，定时任务常被 GitHub 延迟到 UTC 晚间执行
    # （实测延迟 4.5h），此时 UTC 日期比北京晚一天，曾导致全池被误判"当天新号"而白跑（2026-10-11 实锤）
    today = (datetime.utcnow() + timedelta(hours=8)).date().isoformat()
    active = [e for e in active if e.get("added", "") < today]
    print(f"[slice {slice_idx}] 总数 {len(entries)} 存活 {len(active)} 失效 {dead} 网络异常 {unknown} 今日新号剔除后 {len(active)}")

    n = len(active)
    if n < 2:
        print("活跃号不足 2 个，无法互刷")
        return

    # noListen 号（如群主大号）仍留在 active 里：它的歌继续进别人的互听歌池、CK 照常验活，
    # 但不分配"去听别人"的播放任务 —— 只收不听。
    my_accounts = [active[i] for i in range(n) if i % ns == slice_idx and not active[i].get("noListen")]
    n_listen = sum(1 for e in active if e.get("noListen"))
    print(f"[slice {slice_idx}] 本片处理 {len(my_accounts)}/{n} 个号 (NS={ns}，其中只收不听 {n_listen} 个不参与播放)")

    # 3) 预取所有歌时长（换号重试：单个号的会话受限/请求失败就换下一个，不再静默全空）
    song_ids = [e["song"] for e in active if e.get("song")]
    dur_map = {}
    if song_ids:
        for e in active:
            try:
                dur_map = Client(e["ck"]).song_detail(song_ids)
            except Exception:
                dur_map = {}
            if dur_map:
                break

    # 3.5) 预取混听歌池（云音乐热歌榜，全片共享一份；只听群外的歌）
    hot = []
    if mixed_max > 0 and active:
        group_songs = {e.get("song") for e in active}
        for e in active:
            try:
                hot = [(i, d) for (i, d) in Client(e["ck"]).playlist_tracks(MIX_HOT_PID)
                       if i not in group_songs]
            except Exception:
                hot = []
            if hot:
                break
        print(f"[slice {slice_idx}] 混听歌池（热歌榜，剔除群内歌后）{len(hot)} 首")

    done = 0
    for idx, acc in enumerate(my_accounts):
        i = active.index(acc)
        others = [j for j in range(n) if j != i]
        random.shuffle(others)
        picks = others[:plays]
        client = Client(acc["ck"])
        chk = client.login_by_cookie(acc["ck"], acc.get("name", "?"))
        if chk is None:
            print(f"  [{acc.get('name','?')}] 播放前复验网络异常，跳过（不报失效）")
            continue
        if chk is False:
            print(f"  [{acc.get('name','?')}] 本次失效，跳过")
            dead_names.append(acc.get("name", ""))
            continue

        # 4) 组建播放任务：互听（pid=歌曲id）与混听（pid=热歌榜）合并后随机穿插执行，
        #    让"听群内歌"和"听群外热歌"混在一起，而不是先刷完互听再补混听
        tasks = []
        for j in picks:
            sid = active[j].get("song")
            if sid:
                tasks.append((sid, dur_map.get(sid) or 240, sid))
        if hot:
            n_mix = random.randint(mixed_min, mixed_max)
            for sid, dur in random.sample(hot, min(len(hot), n_mix)):
                tasks.append((sid, dur or 240, MIX_HOT_PID))
        random.shuffle(tasks)
        for sid, dur, pid in tasks:
            if random.random() < skip_prob:
                continue  # 模拟切歌
            t = max(MIN_PLAY_SECONDS, int(dur * random.uniform(0.2, 0.3)))
            ok = client.scrobble(sid, t, pid=pid, page="playlist")
            done += 1 if ok else 0
            time.sleep(t + random.uniform(1, 2))

    print(f"[slice {slice_idx}] 完成，本次有效上报约 {done} 次")

    # 5) 把失效账号上报给 Worker，从 KV 号池与 GitHub Secrets 中清理（失败不影响主任务）
    dead_names = sorted({x for x in dead_names if x})
    if dead_names:
        try:
            r = requests.post(WORKER_URL + "/api/report_dead", json={
                "pass": os.environ.get("NB_PASS", ""),
                "dead": dead_names,
            }, timeout=30)
            print(f"[slice {slice_idx}] 失效账号清理上报 {len(dead_names)} 个: HTTP {r.status_code} {r.text[:120]}")
        except Exception as e:
            print(f"[slice {slice_idx}] 失效账号清理上报失败(不影响任务): {e}")


if __name__ == "__main__":
    main()
