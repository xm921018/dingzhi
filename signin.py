# -*- coding: utf-8 -*-
"""
网易云音乐每日签到工具

签到项目：
1. 每日签到 (point/dailyTask type=1) — 网页端签到 +2 积分
2. APP端签到尝试 (point/dailyTask type=0) — 已被网易云禁用，保留用于检测
3. 云贝签到验证 (act/modules/signin/v2/progress) — 确认云贝到账
4. 云贝任务领取 (usertool/task/todo/query + task/point/receive) — 领取已完成任务奖励
5. 音乐人云豆签到 (nmusician/workbench/mission/cycle/list + reward/obtain/new) — 领取云豆

关键技术点：
- weapi 加密：每次请求随机生成 encSecKey（标准方式）
- 每日签到：type=1（网页端签到+2积分）
- APP端签到：type=0 已被网易云禁用（返回"功能暂不支持"），APP端云贝签到通过RN JS bridge完成，无法HTTP调用
- csrf_token：每次请求从 cookie 提取 __csrf 注入
- 音乐人：status=20(可领取) 和 status=100(已完成)，通过 reward/obtain 领取云豆
- signed 字段：cloudbean/get 的 signed 始终为 False，不代表签到状态

多账号支持：通过 accounts.json 的 roles: signin 控制
"""

import json
import random
import smtplib
import sys
import time
import os
import string
import logging
import traceback
import base64
import binascii
from email.mime.text import MIMEText

import requests
from Crypto.Cipher import AES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("netease-signin")

BASE_URL = "https://music.163.com"

# ========== weapi 加密（标准方式，每次随机 encSecKey）==========
_MODULUS = (
    "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7"
    "b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280"
    "104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932"
    "575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b"
    "3ece0462db0a22b8e7"
)
_PUBKEY = "010001"
_NONCE = b"0CoJUm6Qyw8W8jud"
_VI = b"0102030405060708"


def _create_key(size=16):
    return binascii.hexlify(os.urandom(size))[:16]


def _aes_cbc(text_bytes, key):
    pad = 16 - len(text_bytes) % 16
    text_bytes = text_bytes + bytearray([pad] * pad)
    encryptor = AES.new(key, AES.MODE_CBC, _VI)
    return encryptor.encrypt(text_bytes)


def _rsa_encrypt(text, pubkey, modulus):
    text = text[::-1]
    rs = pow(int(binascii.hexlify(text), 16), int(pubkey, 16), int(modulus, 16))
    return format(rs, "x").zfill(256)


def weapi_encrypt(data):
    """标准 weapi 加密，每次随机生成 encSecKey"""
    text = json.dumps(data).encode("utf-8")
    secret = _create_key(16)
    params = base64.b64encode(_aes_cbc(base64.b64encode(_aes_cbc(text, _NONCE)), secret))
    encseckey = _rsa_encrypt(secret, _PUBKEY, _MODULUS)
    return {"params": params.decode("utf-8"), "encSecKey": encseckey}


def load_config(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def send_email(cfg, subject, body):
    try:
        ec = cfg.get("email_config", {})
        if not ec.get("enabled", False):
            return
        to_list = ec.get("to_list", [])
        if not to_list:
            return
        from_email = ec.get("from_email", "")
        auth_code = ec.get("auth_code", "")
        if not from_email or not auth_code:
            return
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = ", ".join(to_list)
        with smtplib.SMTP_SSL("smtp.qq.com", 465) as server:
            server.login(from_email, auth_code)
            server.sendmail(from_email, to_list, msg.as_string())
        logger.info("邮件发送成功")
    except Exception as e:
        logger.error(f"邮件发送失败: {e}")


def notify_fail(cfg, reason, detail=""):
    body = f"网易云签到工具运行异常。\n\n原因：{reason}"
    if detail:
        body += f"\n\n详细信息：\n{detail}"
    send_email(cfg, "网易云签到工具：运行异常，请检查", body)


class NeteaseClient:
    def __init__(self, cookie, device_id=None):
        self.s = requests.Session()
        self.uid = None
        self.nickname = None

        if not device_id:
            device_id = "YD-" + "".join(random.choices(string.ascii_letters + string.digits, k=32))

        # 解析原始 cookie 并注入到 session cookies 中
        for part in cookie.split(";"):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                self.s.cookies.set(k.strip(), v.strip(), domain="music.163.com", path="/")

        # 注入设备指纹 cookie（签到必须）
        self.s.cookies.set("__remember_me", "true", domain="music.163.com", path="/")
        self.s.cookies.set("deviceId", device_id, domain="music.163.com", path="/")
        self.s.cookies.set("os", "pc", domain="music.163.com", path="/")
        self.s.cookies.set("appver", "2.10.11.200601", domain="music.163.com", path="/")
        self.s.cookies.set("osver",
            "Microsoft-Windows-10-Professional-build-19045-64bit",
            domain="music.163.com", path="/")
        self.s.cookies.set("channel", "netease", domain="music.163.com", path="/")
        self.s.cookies.set("MUSIC_A_T", "1", domain="music.163.com", path="/")

        self.s.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://music.163.com",
            "Origin": "https://music.163.com",
            "Content-Type": "application/x-www-form-urlencoded",
        })

    def _get_csrf(self):
        return self.s.cookies.get("__csrf", "")

    def weapi_post(self, path, data=None):
        if data is None:
            data = {}
        data["csrf_token"] = self._get_csrf()
        enc = weapi_encrypt(data)
        try:
            r = self.s.post(f"{BASE_URL}{path}", data=enc, timeout=30)
            return r.json()
        except Exception as e:
            # 网络/HTTP 异常不再炸穿整个签到循环（2026-10-13 修复：此前 raise_for_status
            # 会让单次 5xx/超时直接抛到 main，导致该片后续所有账号当天不签到）。
            # 统一降级为 code=-1，由调用方按账号粒度处理。
            logger.warning(f"请求失败 {path}: {str(e)[:120]}")
            return {"code": -1, "message": f"请求失败: {str(e)[:120]}"}

    def login_check(self, name):
        """验证 cookie 是否有效。返回三态：True=有效 / False=明确失效 / None=网络异常无法判定。"""
        body = self.weapi_post("/weapi/point/dailyTask", {"type": 1})
        code = body.get("code", -1)
        if code == -2:
            logger.info(f"[{name}] Cookie 有效（今日已签到）")
            return True
        if code == 200:
            logger.info(f"[{name}] Cookie 有效，签到接口正常")
            return True
        # 备用验证
        body2 = self.weapi_post("/weapi/act/modules/signin/v2/progress",
                                {"moduleId": "1207signin-1207signin"})
        if body2.get("code") == 200:
            logger.info(f"[{name}] Cookie 有效（云贝进度查询成功）")
            return True
        # 两次请求都 code=-1 = 请求层失败（网络/HTTP 错误），不是 cookie 本身的问题，
        # 返回 None 让主程序跳过本次而非误判过期（2026-10-13 修复）
        if code == -1 and body2.get("code", -1) == -1:
            logger.warning(f"[{name}] 网络异常，无法判定 cookie 状态（明天重试）")
            return None
        logger.error(f"[{name}] Cookie 无效或已过期: code={code}")
        return False

    def daily_sign(self, name):
        """
        每日签到：/weapi/point/dailyTask type=1
        type=0 返回"功能暂不支持"，type=1 才是正确的签到接口
        返回 code=-2 表示"重复签到"（今天已签过）
        """
        body = self.weapi_post("/weapi/point/dailyTask", {"type": 1})
        code = body.get("code", -1)
        msg = body.get("msg", body.get("message", ""))

        if code == 200:
            point = body.get("point", "")
            return True, f"每日签到成功 (+{point}积分)" if point else "每日签到成功"
        elif code == -2:
            return True, "今日已签到（重复签到）"
        else:
            return False, f"每日签到失败: code={code} msg={msg}"

    def yunbei_sign(self, name):
        """
        APP端云贝签到尝试：/weapi/point/dailyTask type=0 + os=android
        注意：网易云已禁用 type=0 接口（返回"功能暂不支持"）。
        APP端云贝签到通过 React Native JS bridge (doSignInTask) 完成，
        无法通过简单 HTTP API 调用实现。
        保留此方法用于检测接口状态变化。
        """
        original_os = self.s.cookies.get("os", "pc")
        self.s.cookies.set("os", "android", domain="music.163.com", path="/")
        try:
            body = self.weapi_post("/weapi/point/dailyTask", {"type": 0})
            code = body.get("code", -1)
            msg = body.get("msg", body.get("message", ""))
            # code=200 + msg="功能暂不支持" = 接口已禁用
            if code == 200 and "不支持" in msg:
                return False, f"APP端签到(type=0)已禁用: {msg}"
            if code == 200:
                point = body.get("point", "")
                return True, f"APP端签到成功 (+{point}积分)" if point else "APP端签到成功"
            elif code == -2:
                return True, "APP端今日已签到（重复）"
            else:
                return False, f"APP端签到失败: code={code} msg={msg}"
        finally:
            self.s.cookies.set("os", original_os, domain="music.163.com", path="/")

    def yunbei_sign_confirm(self, name):
        """
        查询云贝签到进度，确认签到是否生效
        todaySignedIn=True 表示今天已签到
        """
        body = self.weapi_post("/weapi/act/modules/signin/v2/progress",
                               {"moduleId": "1207signin-1207signin"})
        code = body.get("code", -1)
        if code != 200:
            return False, f"云贝签到查询失败: code={code}", []

        data = body.get("data", {})
        today = data.get("today", {})
        signed = today.get("todaySignedIn", False)
        total_yunbei = 0
        details = []

        if signed:
            stats = today.get("todayStats", [])
            for stat in stats:
                current = stat.get("currentProgress", 0)
                for prize in stat.get("prizes", []):
                    if prize.get("obtained") and prize.get("progress") == current:
                        amount = prize.get("amount", 0)
                        total_yunbei += amount
                        details.append(f"已获得 +{amount}云贝 (进度{current}天)")
            if total_yunbei > 0:
                status = f"云贝签到确认: 已签到, 今日共获{total_yunbei}云贝"
            else:
                status = "云贝签到确认: 已签到（今日云贝已领完）"
        else:
            status = "云贝签到确认: 未签到"

        return signed, status, details

    def yunbei_task_claim(self, name):
        """
        领取云贝任务奖励
        优先查 todo 列表（已完成待领取），再兜底查全量列表
        """
        claimed = []

        # 方式1：查询 todo 列表（已完成待领取的任务）
        body = self.weapi_post("/weapi/usertool/task/todo/query")
        if body.get("code") == 200:
            for task in body.get("data", []):
                if task.get("userTaskId", 0) > 0:
                    task_name = task.get("taskName", "未知任务")
                    tid = task["userTaskId"]
                    deposit = task.get("depositCode", 0)
                    r = self.weapi_post("/weapi/usertool/task/point/receive",
                                        {"userTaskId": tid, "depositCode": deposit})
                    if r.get("code") == 200:
                        point = task.get("taskPoint", 0)
                        claimed.append(f"{task_name}(+{point}云贝)")
                        logger.info(f"[{name}] 云贝任务已领取: {task_name} +{point}云贝")
                    time.sleep(random.uniform(0.5, 1.5))

        # 方式2：兜底查全量任务列表
        if not claimed:
            body2 = self.weapi_post("/weapi/usertool/task/list/all")
            if body2.get("code") == 200:
                for t in body2.get("data", []):
                    if t.get("status") == 100 and t.get("userTaskId", 0) > 0:
                        task_name = t.get("name", t.get("taskName", "未知"))
                        tid = t["userTaskId"]
                        r = self.weapi_post("/weapi/usertool/task/point/receive",
                                            {"userTaskId": tid, "depositCode": 0})
                        if r.get("code") == 200:
                            claimed.append(task_name)
                            logger.info(f"[{name}] 云贝任务奖励已领取: {task_name}")
                        time.sleep(random.uniform(0.5, 1.5))

        return claimed

    def musician_sign(self, name):
        """
        音乐人签到：领取云豆
        流程：
        1. 验证音乐人身份 (/weapi/creator/user/access)
        2. 获取周期任务 (/weapi/nmusician/workbench/mission/cycle/list)
        3. 获取阶段任务 (/weapi/nmusician/workbench/mission/stage/list)
        4. 领取可领取的云豆 (/weapi/nmusician/workbench/mission/reward/obtain/new)
        
        status 含义: 0=未完成, 10=可领取, 20=可领取(签到类), 100=已完成
        """
        # 验证是否是音乐人
        access = self.weapi_post("/weapi/creator/user/access")
        if access.get("code") != 200 or access.get("data") is not True:
            return None, "非音乐人账号，跳过"

        results = []
        total_beans = 0

        # 获取周期任务列表
        cycle = self.weapi_post("/weapi/nmusician/workbench/mission/cycle/list")
        time.sleep(random.uniform(0.5, 1))

        # 获取阶段任务列表
        stage = self.weapi_post("/weapi/nmusician/workbench/mission/stage/list")
        time.sleep(random.uniform(0.5, 1))

        # 合并任务
        missions = []
        if cycle.get("code") == 200:
            missions.extend(cycle.get("data", {}).get("list", []))
        if stage.get("code") == 200:
            for m in stage.get("data", {}).get("list", []):
                for target in m.get("userStageTargetList", []):
                    mission = m.copy()
                    mission["status"] = target.get("status", 0)
                    mission["rewardWorth"] = target.get("worth", 0)
                    if "userMissionId" in target:
                        mission["userMissionId"] = target["userMissionId"]
                    missions.append(mission)

        # 领取可领取的云豆（status=10 或 status=20 都是可领取）
        for mission in missions:
            status = mission.get("status", 0)
            description = mission.get("description", mission.get("displayDescription", "未知任务"))
            worth = mission.get("rewardWorth", 0)
            user_mission_id = mission.get("userMissionId", 0)
            period = mission.get("period", "")

            if status in (10, 20) and user_mission_id:
                r = self.weapi_post("/weapi/nmusician/workbench/mission/reward/obtain/new",
                                    {"userMissionId": user_mission_id, "period": str(period)})
                if r.get("code") == 200:
                    try:
                        worth_int = int(worth)
                    except (ValueError, TypeError):
                        worth_int = 0
                    total_beans += worth_int
                    results.append(f"{description}: 云豆+{worth}")
                    logger.info(f"[{name}] 音乐人任务完成: {description} +{worth}云豆")
                else:
                    msg = r.get("msg", r.get("message", ""))
                    results.append(f"{description}: 领取失败({msg})")
                time.sleep(random.uniform(0.5, 1.5))

        # 查询云豆余额
        bean = self.weapi_post("/weapi/cloudbean/get")
        if bean.get("code") == 200:
            balance = bean.get("data", {}).get("cloudBean", 0)
            results.append(f"当前云豆余额: {balance}")

        # 查询音乐人数据概览
        overview = self.weapi_post("/weapi/creator/musician/statistic/data/overview/get")
        if overview.get("code") == 200:
            data = overview.get("data", {})
            play_count = data.get("playCount", "--")
            follower_inc = data.get("followerCountIncrement", "--")
            results.append(f"昨日播放量: {play_count}, 昨日新增粉丝: {follower_inc}")

        if total_beans > 0:
            return True, f"音乐人签到完成: 共领{total_beans}云豆", results
        elif results:
            return True, "音乐人签到: 无可领取云豆", results
        else:
            return False, "音乐人签到失败", results


def main():
    cfg = None
    try:
        wait_seconds = random.randint(30, 300)
        logger.info(f"随机等待 {wait_seconds} 秒后开始签到...")
        time.sleep(wait_seconds)

        cfg = load_config("accounts.json")
        accounts = cfg.get("accounts", [])
        if not accounts:
            notify_fail(cfg, "accounts.json 中没有配置任何账号")
            sys.exit(1)

        signin_accounts = [a for a in accounts if "signin" in a.get("roles", "")]
        if not signin_accounts:
            logger.info("没有配置 roles 包含 signin 的账号，跳过签到")
            print("没有 signin 账号，跳过")
            sys.exit(0)

        success_count = 0
        fail_count = 0
        skipped_count = 0
        expired = []          # 明确过期的账号 [{name,email}]，聚合一封群主通知 + 逐个直邮号主（2026-10-17 起直邮）
        all_results = []

        for acc in signin_accounts:
            aname = acc.get("name", "未知")
            cookie = acc.get("cookie", "")
            is_musician = acc.get("is_musician", False)
            results = [f"\n===== {aname} ====="]

            client = NeteaseClient(cookie)
            chk = client.login_check(aname)
            if chk is None:
                logger.warning(f"[{aname}] 网络异常，跳过本次签到（明天自动重试）")
                skipped_count += 1
                continue
            if chk is False:
                expired.append(aname)
                fail_count += 1
                continue

            time.sleep(random.uniform(1, 3))

            # 1. 每日签到
            ok, msg = client.daily_sign(aname)
            logger.info(f"[{aname}] {msg}")
            results.append(f"  {msg}")
            time.sleep(random.uniform(1, 2))

            # 2. APP端云贝签到
            ok, msg = client.yunbei_sign(aname)
            logger.info(f"[{aname}] {msg}")
            results.append(f"  {msg}")
            time.sleep(random.uniform(1, 2))

            # 3. 云贝签到确认（查询是否到账）
            ok, msg, details = client.yunbei_sign_confirm(aname)
            logger.info(f"[{aname}] {msg}")
            results.append(f"  {msg}")
            for d in details:
                results.append(f"    {d}")
            time.sleep(random.uniform(1, 2))

            # 4. 云贝任务奖励领取
            claimed = client.yunbei_task_claim(aname)
            if claimed:
                results.append(f"  云贝任务已领取: {', '.join(claimed)}")
            else:
                results.append("  云贝任务: 无可领取奖励")
            time.sleep(random.uniform(1, 2))

            # 5. 音乐人签到（仅音乐人账号）
            if is_musician:
                ok, msg, detail_list = client.musician_sign(aname)
                logger.info(f"[{aname}] {msg}")
                results.append(f"  {msg}")
                for d in detail_list:
                    results.append(f"    {d}")
            else:
                logger.info(f"[{aname}] 非音乐人账号，跳过音乐人签到")

            success_count += 1
            all_results.extend(results)
            time.sleep(random.uniform(2, 5))

        logger.info(f"签到完成: 成功 {success_count} 个, 失败 {fail_count} 个, 网络异常跳过 {skipped_count} 个")
        print("\n".join(all_results))

        # 过期账号聚合成一封邮件（2026-10-13 修复：此前每个过期号单独发一封，全过期时邮件轰炸）
        if expired:
            notify_fail(cfg, f"{len(expired)} 个账号 Cookie 已过期", "、".join(expired))

        if fail_count > 0 and success_count == 0:
            notify_fail(cfg, f"所有账号签到失败 (共 {fail_count} 个)")
            sys.exit(1)

    except Exception as e:
        logger.error(f"程序异常: {e}")
        if cfg:
            notify_fail(cfg, f"程序异常: {e}", traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()