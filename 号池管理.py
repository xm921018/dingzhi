# -*- coding: utf-8 -*-
"""
号池管理（管理员本地工具）
==========================
直连 Cloudflare KV（POOL 命名空间的 master 键）查看/增删改互听群号池，
改动后自动调用线上 Worker 的 /api/resync 把 KV 主池重算分片写回 GitHub Secrets。

用法（在本目录下运行）：
  list                              查看已登记账号（序号/名称(手机号)/实时昵称/歌曲名/歌曲ID/uid/日期/CK摘要）
  add <名称> <CK或CK文件路径> [歌曲ID]   添加账号；不填歌曲ID = 公益号（只听别人的歌，不绑单曲）
  del <名称或序号>                   删除账号（整条删除，含其绑定的歌）
  setck <名称或序号> <CK或CK文件路径>   单独替换某个账号的 CK
  setsong <名称或序号> <歌曲ID|none>    改绑/解除单曲绑定（none=改成公益号）
  check                             逐个验活（直连网易 account/get，显示昵称）
  resync                            手动把 KV 主池推回 GitHub Secrets（NB_POOL_1..5）

说明：
- CK 可以是完整 cookie 字符串，也可以只给 MUSIC_U 的值（脚本自动补前缀），
  也可以是保存了 cookie 的文本文件路径。
- add 默认 added=今天（次日生效）；加 --added=YYYY-MM-DD 可指定。
- list/add/del/setck/setsong 改动 KV 后都会自动 resync；失败时可手动跑 resync。
"""
import json
import os
import sys
import re
import argparse
from datetime import date
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor

import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(BASE_DIR, "cloudflare-API令牌.txt")
PASS_FILE = os.path.join(BASE_DIR, "群口令_本地备份.txt")

CF_ACCOUNT = "c60450bfb7f2c2becfd744ba2508a4f2"
CF_NS = "8251dadecfe64bba89f8d2e639d322e1"          # KV 命名空间 POOL-DZ（定制版独立号池）
KV_KEY = "master"
WORKER_URL = "https://dingzhi.listenmusic888.workers.dev"
# resync 走 Worker（workers.dev 国内需代理；先直连试一次，失败换本地代理）
PROXIES = {"https": "http://127.0.0.1:7897", "http": "http://127.0.0.1:7897"}
NETEASE_ACC_API = "https://music.163.com/api/nuser/account/get"


def cf_token():
    with open(TOKEN_FILE, encoding="utf-8") as f:
        m = re.search(r"cfat_[A-Za-z0-9]+", f.read())
    if not m:
        sys.exit("令牌文件里没找到 cfat_ 开头的 API 令牌：" + TOKEN_FILE)
    return m.group(0)


def group_pass():
    """口令真值在 KV 的 GROUP_PASS 键；读不到再从本地备份文件正则提取。"""
    try:
        url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/storage/kv/namespaces/{CF_NS}/values/GROUP_PASS"
        r = requests.get(url, headers=cf_headers(), timeout=30)
        if r.status_code == 200:
            v = r.text.strip().strip('"').strip("'")
            if v:
                return v
    except Exception:
        pass
    with open(PASS_FILE, encoding="utf-8") as f:
        m = re.search(r"当前口令[：:]\s*`?([^\s`]+)", f.read())
    if not m:
        sys.exit("取不到群口令（KV GROUP_PASS 和本地备份都没读到）")
    return m.group(1)


def cf_headers():
    return {"Authorization": "Bearer " + cf_token(), "Content-Type": "application/json"}


def _kv_url(key=""):
    return f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/storage/kv/namespaces/{CF_NS}/values/{key}"


def entry_key_of(e):
    """与 worker.js entryKeyOf 完全一致：uid 优先，无 uid 用 name。
    返回原始键名（如 entry:u123 / entry:nmanual%3A456）；请求 REST API 时再统一 quote。"""
    uid = e.get("uid")
    if uid not in (None, ""):
        return "entry:u" + str(uid)
    return "entry:n" + quote(str(e.get("name") or "unknown"), safe="!'()*")


_last_master_json = None   # 上次 load 的 master 原文
_last_entry_raw = {}       # 上次 load 的独立键原文 {原始键名: json文本}

DEAD_LOG_KEY = "dead_log"  # 删除墓碑：防 master 缓存旧快照复活已删账号（与 worker.js 约定一致）


def _get_dead_log():
    try:
        return set(json.loads(_kv_get(DEAD_LOG_KEY) or "[]"))
    except Exception:
        return set()


def _put_dead_log(names):
    requests.put(_kv_url(quote(DEAD_LOG_KEY, safe="")), headers=cf_headers(),
                 data=json.dumps(sorted(names)[-500:], ensure_ascii=False).encode("utf-8"), timeout=30)


def _kv_get(name):
    """按原始键名读值。"""
    r = requests.get(_kv_url(quote(name, safe="")), headers=cf_headers(), timeout=30)
    r.raise_for_status()
    return r.text


def _list_entry_keys():
    """列出 entry: 前缀的原始键名。"""
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/storage/kv/namespaces/{CF_NS}/keys"
    names, cursor = [], ""
    while True:
        params = {"prefix": "entry:", "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        r = requests.get(url, headers=cf_headers(), params=params, timeout=30)
        r.raise_for_status()
        d = r.json()
        names += [k["name"] for k in d.get("result", [])]
        info = d.get("result_info") or {}
        if info.get("list_complete") is False and info.get("cursor"):
            cursor = info["cursor"]
        else:
            break
    return names


def load_master():
    """读 master 缓存 + entry: 独立键（真实来源），合并自愈；缺键的老数据自动回填。
    master 缓存即使被并发写坏，这里也会从独立键重建（与线上 worker.js mergePool 同逻辑）。"""
    global _last_master_json, _last_entry_raw
    try:
        base = json.loads(_kv_get(KV_KEY) or "[]")
        if not isinstance(base, list):
            base = []
    except Exception:
        base = []
    _last_master_json = json.dumps(base, ensure_ascii=False, sort_keys=True)

    by_name = {}
    for e in base:
        by_name.setdefault(entry_key_of(e), e)
    names = _list_entry_keys()
    vals = {}

    def _get_one(n):
        try:
            vals[n] = _kv_get(n)
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=10) as ex:
        list(ex.map(_get_one, names))
    _last_entry_raw = dict(vals)
    for n in names:
        if n in vals and n not in by_name:
            try:
                by_name[n] = json.loads(vals[n])
            except Exception:
                pass
    merged = list(by_name.values())
    # 回填缺失的独立键（首次升级时一次性迁移老数据）；墓碑内的是已删账号的缓存残留，跳过防复活
    dead = _get_dead_log()
    listed = set(names)
    missing = [entry_key_of(e) for e in merged
               if entry_key_of(e) not in listed and entry_key_of(e) not in dead]
    if missing:
        raw_map = {entry_key_of(e): json.dumps(e, ensure_ascii=False) for e in merged}

        def _put_one(n):
            requests.put(_kv_url(quote(n, safe="")), headers=cf_headers(),
                         data=raw_map[n].encode("utf-8"), timeout=30)

        with ThreadPoolExecutor(max_workers=10) as ex:
            list(ex.map(_put_one, missing))
    return merged


def save_master(master):
    """写 master 缓存 + 同步 entry: 独立键（真实来源）：新/改的写键，删除的删键。
    内容未变的键跳过写入，省 KV 写额度。"""
    r = requests.put(_kv_url(KV_KEY), headers=cf_headers(),
                     data=json.dumps(master, ensure_ascii=False).encode("utf-8"), timeout=30)
    r.raise_for_status()
    if not r.json().get("success"):
        sys.exit("KV 写入失败: " + r.text[:300])
    new_raw = {}
    for e in master:
        new_raw[entry_key_of(e)] = json.dumps(e, ensure_ascii=False, sort_keys=True)
    old_names = set(_list_entry_keys())
    to_put = [n for n, raw in new_raw.items() if _last_entry_raw.get(n) != raw]
    to_del = [n for n in old_names if n not in new_raw]

    def _put_one(n):
        rr = requests.put(_kv_url(quote(n, safe="")), headers=cf_headers(),
                          data=new_raw[n].encode("utf-8"), timeout=30)
        rr.raise_for_status()

    def _del_one(n):
        rr = requests.delete(_kv_url(quote(n, safe="")), headers=cf_headers(), timeout=30)
        rr.raise_for_status()

    with ThreadPoolExecutor(max_workers=10) as ex:
        list(ex.map(_put_one, to_put))
        list(ex.map(_del_one, to_del))
    # 墓碑同步：删掉的记账（防缓存复活），新加/恢复的销账
    if to_del or to_put:
        dead = _get_dead_log()
        changed = False
        for n in to_del:
            if n not in dead:
                dead.add(n)
                changed = True
        for n in to_put:
            if n in dead:
                dead.discard(n)
                changed = True
        if changed:
            _put_dead_log(dead)


def norm_cookie(s):
    s = s.strip().strip('"').strip("'")
    if not s:
        sys.exit("CK 为空")
    if "MUSIC_U=" in s:
        return s
    return "MUSIC_U=" + s


def read_cookie_arg(arg):
    """参数可能是文件路径，也可能是裸 cookie 字符串。"""
    if os.path.isfile(arg):
        with open(arg, encoding="utf-8", errors="ignore") as f:
            return norm_cookie(f.read())
    return norm_cookie(arg)


def find_entry(master, key):
    """按序号（list 显示的序号，1 起）或名称精确/包含匹配。返回 (下标, entry)。"""
    for i, e in enumerate(master):
        if str(i + 1) == str(key):
            return i, e
    for i, e in enumerate(master):
        if str(e.get("name", "")) == str(key):
            return i, e
    hits = [i for i, e in enumerate(master) if str(key) in str(e.get("name", ""))]
    if len(hits) == 1:
        return hits[0], master[hits[0]]
    if len(hits) > 1:
        sys.exit(f"名称 '{key}' 匹配到 {len(hits)} 条，请用更精确名称或序号。")
    sys.exit(f"没找到 '{key}'，先 list 看一下。")


def do_resync(quiet=False):
    """调 Worker 的 /api/resync：KV master → 重算分片 → 写 GitHub Secrets。"""
    body = {"pass": group_pass()}
    last = None
    for use_proxy in (False, True):
        try:
            r = requests.post(WORKER_URL + "/api/resync", json=body, timeout=25,
                              proxies=PROXIES if use_proxy else None)
            txt = r.text[:200]
            if r.status_code == 200:
                if not quiet:
                    print("resync 成功：", txt)
                return True
            last = f"HTTP {r.status_code} {txt}"
        except Exception as e:
            last = str(e)[:200]
    if not quiet:
        print("resync 失败（KV 已改好，Secrets 未同步；可稍后手动跑 resync）:", last)
    return False


def netease_get(url, cookie=None, params=None):
    """直连网易 API（国内直连，不走本地代理）。"""
    s = requests.Session()
    s.trust_env = False
    headers = {"Referer": "https://music.163.com",
               "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    if cookie:
        headers["Cookie"] = cookie
    r = s.get(url, headers=headers, params=params, timeout=15)
    return r.json()


def fetch_song_names(song_ids):
    """批量查歌曲名：ids 列表 -> {id: 歌名}；失败返回空 dict。"""
    ids = [int(s) for s in song_ids if s]
    if not ids:
        return {}
    try:
        d = netease_get("https://music.163.com/api/song/detail",
                        params={"ids": json.dumps(ids)})
        return {s.get("id"): (s.get("name") or "?")
                for s in d.get("songs", []) if s.get("id")}
    except Exception:
        return {}


def fetch_profile(ck):
    """用 CK 取当前账号昵称/uid；失败返回 (None, None)。"""
    try:
        d = netease_get(NETEASE_ACC_API, cookie=ck)
        if d.get("code") == 200:
            prof = d.get("profile") or {}
            acc = d.get("account") or {}
            return prof.get("nickname"), acc.get("id") or prof.get("userId")
    except Exception:
        pass
    return None, None


def load_run_client():
    """复用 run.py 的 Client（weapi），用于受限会话兜底取昵称。"""
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("runmod", os.path.join(BASE_DIR, "run.py"))
        runmod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runmod)
        return runmod.Client
    except Exception:
        return None


def cmd_list(_):
    master = load_master()
    # 批量拿歌名（一次请求），再逐条实时拿昵称（直连失败用 run.py Client 兜底）
    song_names = fetch_song_names([e.get("song") for e in master])
    run_client = load_run_client()
    print(f"号池共 {len(master)} 条：")
    print(f"{'序号':<4} {'名称/手机号':<22} {'昵称':<24} {'歌曲名':<36} {'歌曲ID':<12} {'uid':<14} {'added':<12} CK摘要")
    for i, e in enumerate(master):
        ck = str(e.get("ck", ""))
        mu = ""
        m = re.search(r"MUSIC_U=([^;]+)", ck)
        if m:
            mu = m.group(1)
        snippet = (mu[:12] + "..." + f"(len{len(mu)})") if mu else "(无MUSIC_U)"
        song = e.get("song")
        if song:
            song_disp = f"{song_names.get(int(song), '?')}"
        else:
            song_disp = "—(公益号)"
        nick, live_uid = fetch_profile(e.get("ck", ""))
        if not nick and run_client:
            try:  # 受限会话直连 account/get 拿不到，用 weapi Client 兜底
                c = run_client(ck)
                if c.login_by_cookie(ck, str(e.get("name", "?"))):
                    nick, live_uid = c.nickname, c.uid
            except Exception:
                pass
        nick_disp = nick if nick else "?(取不到)"
        uid_disp = str(e.get("uid") or live_uid or "-")
        name_disp = str(e.get('name','')) + ("[只收]" if e.get("noListen") else "")
        mail_disp = f"[邮箱 {e.get('email')}]" if e.get("email") else "[无邮箱]"
        print(f"{i+1:<4} {name_disp:<26} {nick_disp:<24} {song_disp:<36} {str(song or '-'):<12} {uid_disp:<14} {str(e.get('added','')):<12} {snippet} {mail_disp}")


def cmd_add(a):
    ck = read_cookie_arg(a.ck)
    master = load_master()
    if any(str(e.get("name", "")) == a.name for e in master) and not a.force:
        sys.exit(f"已存在同名 '{a.name}'（同名会被去重/误清理），如确要覆盖用 --force。")
    entry = {
        "ck": ck,
        "song": int(a.song) if a.song else None,
        "added": a.added or date.today().isoformat(),
        "name": a.name,
        "uid": a.uid,
    }
    if a.force:
        master = [e for e in master if str(e.get("name", "")) != a.name]
    master.append(entry)
    save_master(master)
    tag = "公益号（不绑单曲）" if not entry["song"] else f"歌曲 {entry['song']}"
    print(f"已添加：{a.name}（{tag}，added={entry['added']}，{'' if entry['added'] < date.today().isoformat() else '次日生效'}）")
    do_resync()


def cmd_del(a):
    master = load_master()
    i, e = find_entry(master, a.key)
    print(f"将删除第 {i+1} 条：{e.get('name')}（歌={e.get('song') or '公益号'}）")
    if not a.yes:
        c = input("确认删除? [y/N] ").strip().lower()
        if c != "y":
            print("已取消。")
            return
    del master[i]
    save_master(master)
    print("已删除。")
    do_resync()


def cmd_setck(a):
    master = load_master()
    i, e = find_entry(master, a.key)
    e["ck"] = read_cookie_arg(a.ck)
    save_master(master)
    print(f"已替换 CK：{e.get('name')}")
    do_resync()


def cmd_setsong(a):
    master = load_master()
    i, e = find_entry(master, a.key)
    e["song"] = None if a.song.lower() == "none" else int(a.song)
    save_master(master)
    tag = "公益号（不绑单曲）" if not e["song"] else f"歌曲 {e['song']}"
    print(f"已更新 {e.get('name')} → {tag}")
    do_resync()


def cmd_setmail(a):
    """补录/更新号主邮箱（2026-10-17 直邮功能配套：老号无 email 时异常提醒只进日志）。"""
    master = load_master()
    i, e = find_entry(master, a.key)
    mail = (a.email or "").strip()
    if mail.lower() in ("none", "del", "-", "clear", "清除"):
        e.pop("email", None)
        print(f"已清除 {e.get('name')} 的邮箱（异常将不再直邮该号主）")
    else:
        if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", mail):
            sys.exit(f"邮箱格式不对：{mail}")
        e["email"] = mail
        print(f"已更新 {e.get('name')} → 邮箱 {mail}（账号异常将直邮该号主）")
    save_master(master)
    do_resync()


def cmd_check(_):
    master = load_master()
    # 优先复用 run.py 的权威判活（weapi + 受限会话每日推荐二次验证，与 Actions 一致）
    run_client = None
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("runmod", os.path.join(BASE_DIR, "run.py"))
        runmod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runmod)
        run_client = runmod.Client
    except Exception:
        pass
    print(f"逐个验活（共 {len(master)} 条）：")
    alive = 0
    for i, e in enumerate(master):
        name = e.get("name", "?")
        try:
            if run_client:
                c = run_client(e.get("ck", ""))
                v = c.login_by_cookie(e.get("ck", ""), name)
                info = (c.nickname or "?") + (f" (uid={c.uid})" if c.uid else " [受限会话但可听歌]")
                # 三态判定（2026-10-13 与 run.py 对齐）：None=网络异常，不算失效
                mark = "✓ 有效" if v is True else ("✗ 失效" if v is False else "？网络异常，无法判定")
            else:
                s = requests.Session(); s.trust_env = False
                r = s.get(NETEASE_ACC_API, headers={"Cookie": e.get("ck", ""), "Referer": "https://music.163.com"}, timeout=20)
                d = r.json(); prof = d.get("profile") or {}; acc = d.get("account") or {}
                v = d.get("code") == 200 and (prof.get("userId") or acc.get("id"))
                info, mark = prof.get("nickname") or "?", ("✓ 有效" if v else "✗ 失效 code=" + str(d.get("code")))
            alive += 1 if v is True else 0
            print(f"  {i+1}. {name}: {mark} {info}")
        except Exception as ex:
            print(f"  {i+1}. {name}: ？网络异常 {str(ex)[:80]}")
    print(f"存活 {alive}/{len(master)}")


def cmd_resync(_):
    do_resync()


def main():
    p = argparse.ArgumentParser(description="互听群号池管理（管理员）")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list").set_defaults(fn=cmd_list)
    sp = sub.add_parser("add")
    sp.add_argument("name")
    sp.add_argument("ck")
    sp.add_argument("song", nargs="?", default=None, help="歌曲ID；不填=公益号")
    sp.add_argument("--uid", default=None)
    sp.add_argument("--added", default=None, help="YYYY-MM-DD，默认今天（次日生效）")
    sp.add_argument("--force", action="store_true", help="同名已存在时覆盖")
    sp.set_defaults(fn=cmd_add)
    sp = sub.add_parser("del")
    sp.add_argument("key")
    sp.add_argument("--yes", action="store_true", help="跳过确认")
    sp.set_defaults(fn=cmd_del)
    sp = sub.add_parser("setck")
    sp.add_argument("key")
    sp.add_argument("ck")
    sp.set_defaults(fn=cmd_setck)
    sp = sub.add_parser("setsong")
    sp.add_argument("key")
    sp.add_argument("song", help="歌曲ID 或 none")
    sp.set_defaults(fn=cmd_setsong)
    sp = sub.add_parser("setmail")
    sp.add_argument("key")
    sp.add_argument("email", help="号主邮箱；填 none 清除")
    sp.set_defaults(fn=cmd_setmail)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    sub.add_parser("resync").set_defaults(fn=cmd_resync)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
