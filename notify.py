# -*- coding: utf-8 -*-
"""
号主直邮模块（2026-10-17 新增）。

账号出问题时，给成员本人发一封说人话的邮件（不是给群主、也不是 GitHub 那种
开发者日志），只讲三件事：发生了什么、不影响什么、要做哪一步。
语气保持平和，不使用"风控/拦截/异常"等刺激性措辞。

通道：QQ 邮箱 SMTP，凭据从环境变量读取（GitHub Secrets 注入）：
  EMAIL_FROM      发件 QQ 邮箱地址
  EMAIL_AUTH_CODE 该邮箱的 SMTP 授权码（16 位）
未配置或发送失败都只记日志，绝不影响刷量/签到主流程。

触发分工（避免同一个号一天收到多封重复提醒）：
  - cookie 登录失效   → signin.py 负责（每天签到先跑，最先发现）
  - 发动态需安全验证  → notes.py 负责（每 6 天最多轮到一次）
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr

DISPLAY_NAME = "互听群小助手"
SMTP_HOST = "smtp.qq.com"
SMTP_PORT = 465
# 成员接入登记页（邮件里给号主重新登录用）
JOIN_PAGE = "https://dz.xx1031.xyz"


def _cred():
    return (
        (os.environ.get("EMAIL_FROM", "") or "").strip(),
        (os.environ.get("EMAIL_AUTH_CODE", "") or "").strip(),
    )


def mail_ready():
    f, a = _cred()
    return bool(f and a)


def send_user_email(to_email, subject, body):
    """给成员本人发一封纯文本邮件。任何异常只记日志，不抛出、不影响主流程。"""
    to_email = (to_email or "").strip()
    if not to_email or "@" not in to_email:
        return False
    f, a = _cred()
    if not f or not a:
        print("[notify] 未配置 EMAIL_FROM/EMAIL_AUTH_CODE，跳过直邮")
        return False
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = formataddr((DISPLAY_NAME, f))
        msg["To"] = to_email
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.login(f, a)
            server.sendmail(f, [to_email], msg.as_string())
        print(f"[notify] 已直邮号主 {to_email}：{subject}")
        return True
    except Exception as e:
        print(f"[notify] 直邮失败 {to_email}：{e}")
        return False


def _who(nickname, name):
    who = (nickname or "").strip()
    if name:
        who = f"{who}（{name}）" if who else str(name)
    return who or "互听群成员"


def notify_verify(email, nickname, name):
    """发动态时网易要求完成一次安全验证。平和陈述，不吓人。"""
    if not (email or "").strip():
        return False
    subject = "【互听群】需要完成一次安全验证"
    body = (
        f"你好，{_who(nickname, name)}：\n\n"
        "今天自动发动态时，网易云需要完成一次安全验证，这条动态没有发出去。\n\n"
        "不影响你：听歌、签到、你的歌被大家播放，一切照常。\n\n"
        "需要你做一件事：\n"
        "打开网易云音乐 App → 点底部「云村」→ 手动发一条动态（随便写一句就行）\n"
        "→ 发送成功后验证即通过，下次自动发动态恢复正常。\n\n"
        "暂时不做也可以，系统每 6 天会自动再试一次。\n\n"
        "——互听群小助手"
    )
    return send_user_email(email, subject, body)


def notify_relogin(email, nickname, name):
    """自动登录凭证过期，需要重新登录一次。平和陈述，不吓人。"""
    if not (email or "").strip():
        return False
    subject = "【互听群】账号需要重新登录一次"
    body = (
        f"你好，{_who(nickname, name)}：\n\n"
        "你的网易云账号自动登录需要更新一次。\n\n"
        "更新之前，听歌任务和你的歌被播放会先暂停；重新登录后自动恢复。\n\n"
        "只需一分钟：打开登记页 " + JOIN_PAGE + " ，用手机号登录一次即可。\n\n"
        "如果不再想参加互听，忽略本邮件即可，7 天后自动移除。\n\n"
        "——互听群小助手"
    )
    return send_user_email(email, subject, body)


if __name__ == "__main__":
    # 本地/CI 自测：python notify.py 收件邮箱
    import sys
    if len(sys.argv) >= 2:
        ok = send_user_email(
            sys.argv[1],
            "【互听群】发件通道测试",
            "如果你收到这封邮件，说明直邮通道工作正常。\n\n——互听群小助手",
        )
        sys.exit(0 if ok else 1)
    print("usage: python notify.py <to_email>")
    sys.exit(2)
