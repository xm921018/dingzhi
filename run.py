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
import hashlib
import string
from concurrent.futures import ThreadPoolExecutor, as_completed
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
WORKER_URL = "https://dz.xx1031.xyz"
# 有效播放门槛：单曲播放进度需超过整首的一半，后台才计一次「有效播放」。
# 2026-10-20 修正：此前按 0.2~0.3 倍时长上报（4 分钟歌只报 48-72s），歌曲页 playCount 会涨，
# 但音乐人后台「近30日有效播放」一直是 0 —— 这是成员反馈「播放量涨、650 进度不涨」的直接原因。
# 绝对保底秒数：只用于极短歌（防报出过小的值），实际时长按下面的比例算，
# 且永不报超过歌曲自身时长（报超时长是最典型的机器特征）。
MIN_PLAY_SECONDS = 35
# 播放进度占比区间：过半即可，留少量随机（0.55~0.70）避免恒定比例成为机器特征
PLAY_RATIO_MIN, PLAY_RATIO_MAX = 0.55, 0.70

# 跨群互听（2026-10-20）：只向对端群拉「歌曲 id 列表」，双方的 KV 号池、人数、上限完全独立。
# 鉴权复用本群已有的群口令 NB_PASS：对端 worker 的 PEER_PASS 键里存的就是本群口令（管理员写成对穿的），
# 所以不需要新建任何 GitHub Secret。PEER_PASS 环境变量留作以后手工覆盖用。
PEER_WORKER_URL = os.environ.get("PEER_WORKER_URL", "").strip()
PEER_PASS = os.environ.get("PEER_PASS", "").strip() or os.environ.get("NB_PASS", "").strip()


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
            # 设备身份必须跨次运行稳定：此前用随机串，等于每个号每天换一部新手机，
            # 是风控最容易命中的特征（同账号+同IP+每天新设备）。改为按 cookie 派生、永久不变。
            device_id = "YD-" + hashlib.md5(cookie.encode("utf-8")).hexdigest()[:32]
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
        """模拟一次完整播放：startplay → 等够 t 秒 → play(time=t) → playend。

        2026-10-20 修正两处（解决「播放量涨、音乐人 650 进度不涨」）：
          ① 此前 startplay 与 play 是同一秒连发的，time 字段却写 48-72 秒，时间戳自相矛盾；
             现在按上报时长真实等待，请求时间与 time 对得上，与真实客户端一致。
          ② 补发 playend：真实播放器播完会发结束事件，此前只发 play，行为链不完整。
        """
        csrf = ""
        try:
            csrf = self.s.headers.get("Cookie", "").split("__csrf=")[-1].split(";")[0].strip()
        except Exception:
            pass
        try:
            start = [{"action": "startplay", "json": {"id": str(tid), "type": "song", "content": f"id={tid}"}}]
            self._weapi_post(f"{BASE_URL}/weapi/feedback/weblog", {"logs": json.dumps(start), "csrf_token": csrf})
            time.sleep(t + random.uniform(1, 3))
            play = [{"action": "play", "json": {
                "download": "0", "end": "playend", "id": str(tid),
                "sourceId": str(pid) if pid else str(tid), "time": str(t),
                "type": "song", "wifi": "0", "resource": f"R_SO_4_{tid}",
                "resourceid": str(tid), "page": page, "is_autoplay": "0",
                "mainsite": "1", "mainsiteWeb": "1", "content": f"id={tid}"}}]
            res = self._weapi_post(f"{BASE_URL}/weapi/feedback/weblog", {"logs": json.dumps(play), "csrf_token": csrf})
            end = [{"action": "playend", "json": {"id": str(tid), "type": "song", "content": f"id={tid}"}}]
            self._weapi_post(f"{BASE_URL}/weapi/feedback/weblog", {"logs": json.dumps(end), "csrf_token": csrf})
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


def load_peer_songs():
    """拉对端群「可以被听到的歌曲 id」（不含任何账号/cookie 信息）。

    失败/未配置时返回空列表，本群照常跑 —— 跨群互听是锦上添花，绝不能因为它挂掉整个任务。
    """
    if not PEER_WORKER_URL or not PEER_PASS:
        print("[peer] 未配置跨群互听（缺 PEER_WORKER_URL / PEER_PASS），本次只听本群")
        return []
    try:
        r = requests.get(PEER_WORKER_URL.rstrip("/") + "/api/songs",
                         params={"pass": PEER_PASS}, timeout=45)
        d = r.json()
        songs = [str(s) for s in (d.get("songs") or []) if s]
        print(f"[peer] 对端群可听歌曲 {len(songs)} 首（HTTP {r.status_code}）")
        return songs
    except Exception as e:
        print(f"[peer] 拉取对端歌单失败，本次只听本群: {e}")
        return []


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
    # 有效期（exp）到期剔除：'YYYY-MM-DD' 过了北京时间当天即不再参与；'forever'/缺省 = 永久
    expired = [e for e in active if e.get("exp") and e.get("exp") != "forever" and str(e["exp"]) < today]
    if expired:
        active = [e for e in active if not (e.get("exp") and e.get("exp") != "forever" and str(e["exp"]) < today)]
        print(f"[slice {slice_idx}] 另有 {len(expired)} 个账号已过有效期（exp），自动剔除")
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

    # 3) 跨群互听：拉对端群的歌曲 id（只有 id、不含任何账号信息），与本群歌曲合并成一个歌池。
    #    两个群的 KV 号池、人数、上限完全独立 —— 这里只共享「听谁的歌」，不合并「谁是谁的号」。
    peer_songs = load_peer_songs()
    own_songs = [str(e["song"]) for e in active if e.get("song")]
    song_pool = sorted(set(own_songs) | {s for s in peer_songs if s})
    print(f"[slice {slice_idx}] 歌池：本群 {len(set(own_songs))} 首 + 对端 {len(peer_songs)} 首 → 去重后 {len(song_pool)} 首")

    # 3.1) 预取所有歌时长（换号重试：单个号的会话受限/请求失败就换下一个，不再静默全空）
    dur_map = {}
    if song_pool:
        for e in active:
            try:
                dur_map = Client(e["ck"]).song_detail(song_pool)
            except Exception:
                dur_map = {}
            if dur_map:
                break

    # 3.5) 预取混听歌池（云音乐热歌榜，全片共享一份；只听歌池以外的歌）
    hot = []
    if mixed_max > 0 and active:
        pool_set = set(song_pool)
        for e in active:
            try:
                hot = [(i, d) for (i, d) in Client(e["ck"]).playlist_tracks(MIX_HOT_PID)
                       if i not in pool_set]
            except Exception:
                hot = []
            if hot:
                break
        print(f"[slice {slice_idx}] 混听歌池（热歌榜，剔除群内歌后）{len(hot)} 首")

    parallel = max(1, int(os.environ.get("ACCOUNT_PARALLEL", "3")))

    def process_account(acc):
        """单个账号的完整播放流程（供线程池并行调用，每号一个独立 Client）。"""
        name = acc.get("name", "?")
        mine = acc.get("song")
        client = Client(acc["ck"])
        chk = client.login_by_cookie(acc["ck"], name)
        if chk is None:
            print(f"  [{name}] 播放前复验网络异常，跳过（不报失效）")
            return name, 0, [], False
        if chk is False:
            print(f"  [{name}] 本次失效，跳过")
            return name, 0, [], True

        # 4) 组建播放任务：互听（pid=歌曲id）与混听（pid=热歌榜）合并后随机穿插执行，
        #    让"听群内歌"和"听群外热歌"混在一起，而不是先刷完互听再补混听。
        #    候选来自整个歌池（含对端群），但一定剔除自己的歌 —— 绝不听自己。
        cand = [s for s in song_pool if s != mine]
        picks = random.sample(cand, plays) if len(cand) > plays else cand
        tasks = [(sid, dur_map.get(sid) or 240, sid) for sid in picks]
        if hot:
            n_mix = random.randint(mixed_min, mixed_max)
            for sid, dur in random.sample(hot, min(len(hot), n_mix)):
                tasks.append((sid, dur or 240, MIX_HOT_PID))
        random.shuffle(tasks)

        cnt, secs = 0, []
        for sid, dur, pid in tasks:
            if random.random() < skip_prob:
                continue  # 模拟切歌（切歌即不计有效播放，和真实用户行为一致）
            # 播放进度取整首的 55%~70%：必须越过「听过半才计有效播放」的门槛，
            # 否则 playCount 会涨、音乐人后台的有效播放一直是 0。短歌不能报超过自身时长。
            base = dur if dur and dur > 30 else 240
            t = int(base * random.uniform(PLAY_RATIO_MIN, PLAY_RATIO_MAX))
            t = min(t, base - 3)                              # 绝不报超过歌曲自身时长
            t = max(t, min(MIN_PLAY_SECONDS, base - 3))       # 保底 35s，短歌以歌长为界
            if client.scrobble(sid, t, pid=pid, page="playlist"):
                cnt += 1
                secs.append(t)
            time.sleep(random.uniform(1, 3))
        print(f"  [{name}] 完成 {cnt} 次播放" + (f"，平均 {sum(secs)//len(secs)}s/首" if secs else ""))
        return name, cnt, secs, False

    done = 0
    reported_secs = []   # 记录实际上报时长，日志里能一眼看出新规则（过半）是否生效
    if my_accounts:
        # 并行处理本片账号：单号绝大部分时间在 sleep 等播放时长，并行不占 CPU。
        # 这是「播放时长提到过半」之后仍能在 6h job 上限内跑完的关键。
        with ThreadPoolExecutor(max_workers=min(parallel, len(my_accounts))) as ex:
            futs = [ex.submit(process_account, acc) for acc in my_accounts]
            for f in as_completed(futs):
                try:
                    name, cnt, secs, is_dead = f.result()
                except Exception as e:
                    print(f"  [线程异常] {e}")
                    continue
                done += cnt
                reported_secs.extend(secs)
                if is_dead:
                    dead_names.append(name)

    avg = f"，平均上报 {sum(reported_secs)//len(reported_secs)} 秒/首（过半口径）" if reported_secs else ""
    print(f"[slice {slice_idx}] 完成，本次有效上报约 {done} 次{avg}")

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
