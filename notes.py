# -*- coding: utf-8 -*-
"""
网易云音乐笔记自动发布工具（拟人版）

反检测特性：
- 发布间隔平均 3-5 天（脚本内部掷骰子决定是否发布）
- 随 relay 每晚北京 22:23 触发，脚本内部随机等待 1-5 分钟后开始
- 文案从超大文案库随机选取，长度随机（保底 8 字，避免截出太短的残句）
- 图片完全随机生成（背景色、装饰、字体大小、文字位置每次都不同）
- 操作间加入随机延迟，模拟人类行为
- 不发布时静默退出，不发邮件
"""

import json
import random
import smtplib
import sys
import logging
import traceback
import hashlib
import uuid
import re
import time
import math
from email.mime.text import MIMEText
from io import BytesIO

import requests
from PIL import Image, ImageDraw, ImageFont
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("netease-notes")

BASE_URL = "https://music.163.com"
EAPI_KEY = "e82ckenh8dichen8"
NOBODY = "36cd479b6b5"

# ========== 超大文案库（80+ 条，涵盖多种风格） ==========
QUOTES = [
    # 励志类
    "愿你保持热爱，奔赴山海。",
    "日拱一卒，功不唐捐。",
    "今天也要元气满满。",
    "把每一天都当作新的开始。",
    "先努力让自己发光，对的人才会迎光而来。",
    "慢慢来，谁还没有一个光明的未来。",
    "保持耐心，保持温柔，保持前进。",
    "种一棵树最好的时间是十年前，其次是现在。",
    "自律给我自由。",
    "所有努力都不被辜负。",
    "生活明朗，万物可爱。",
    "你现在的努力，是未来的底气。",
    "做自己的太阳，无需借谁的光。",
    "每一步都算数。",
    "愿所有的后会有期，都是他日的别来无恙。",
    "你要悄悄努力，然后惊艳所有人。",
    "没有伞的孩子，必须努力奔跑。",
    "星光不负赶路人，时光不负有心人。",
    "越努力，越幸运。",
    "既然选择了远方，便只顾风雨兼程。",
    # 生活感悟类
    "日子很长，过客很多，也不差你一个。",
    "人间烟火气，最抚凡人心。",
    "今天的风，甚是温柔。",
    "想把生活过成一首诗。",
    "平淡日子里，也有小小的欢喜。",
    "生活就是一半烟火，一半诗意。",
    "偶尔停下来，看看沿途的风景。",
    "世界很大，幸福很小。",
    "认真生活，就能找到被人生偷藏起来的糖果。",
    "日子很慢，生活很暖。",
    # 心情随笔类
    "今天心情不错，记录一下。",
    "又是美好的一天。",
    "阳光正好，微风不燥。",
    "闲下来的时候，总觉得时间过得好慢。",
    "突然想听一首老歌。",
    "有些事情，放在心里就好。",
    "生活需要仪式感。",
    "简单一点，快乐一点。",
    "好想去旅行啊。",
    "此刻的心情，就像窗外的阳光。",
    # 哲理类
    "人生如逆旅，我亦是行人。",
    "世间万物皆有裂痕，那是光照进来的地方。",
    "山高水长，怕什么来不及，慌什么到不了。",
    "人生没有白走的路，每一步都算数。",
    "所谓无底深渊，下去也是前程万里。",
    "万物皆有裂痕，不必太过完美。",
    "人生海海，山山而川。",
    "但行好事，莫问前程。",
    "知世故而不世故，是最善良的成熟。",
    "温柔半两，从容一生。",
    # 温暖治愈类
    "你值得被温柔以待。",
    "愿你被这个世界温柔以待。",
    "希望你的可爱，可以治愈一切不可爱。",
    "总会有人山高路远，为你而来。",
    "冬天从这里夺去的，春天会交还给你。",
    "不管多晚，总有一盏灯为你而亮。",
    "你笑起来真好看，像春天的花一样。",
    "愿所有的不安，都是虚惊一场。",
    "世界那么大，人生那么长，总会有对的人。",
    "你很好，你值得。",
    # 短句类
    "今日份的开心。",
    "记录生活。",
    "周末愉快。",
    "晚安，世界。",
    "早安，新的一天。",
    "小确幸。",
    "日常碎片。",
    "简单快乐。",
    "岁月静好。",
    "一切都会好起来的。",
    # 意境类
    "山中何事？松花酿酒，春水煎茶。",
    "春水初生，春林初盛，春风十里不如你。",
    "人间忽晚，山河已秋。",
    "浮生若梦，为欢几何。",
    "且将新火试新茶，诗酒趁年华。",
    "落花人独立，微雨燕双飞。",
    "当时明月在，曾照彩云归。",
    "吹灭读书灯，一身都是月。",
    "掬水月在手，弄花香满衣。",
    "行到水穷处，坐看云起时。",
    # 日常分享类
    "今天的天空好好看。",
    "吃到了很好吃的东西，开心。",
    "听了一首很棒的歌，分享给大家。",
    "好久没这么放松了。",
    "突然觉得，平凡的日子也挺好。",
    "给自己放个假，什么都不想。",
    "有些路，要一个人走。",
    "生活嘛，开心最重要。",
    "愿你眼里有光，心中有爱。",
    "每一天都值得被记录。",
    # ===== 生活化日常类（2026-10-17 扩充：稀释鸡汤感，更像真人动态） =====
    # 美食/饮品
    "今天的奶茶三分糖刚刚好。",
    "楼下新开的面馆出乎意料地好吃。",
    "自己下厨做顿饭，成就感拉满。",
    "半夜饿醒，煮了包泡面。",
    "这家的烧烤真的绝了。",
    # 天气/季节
    "今天的晚霞染红了半边天。",
    "下雨天最适合窝在家里发呆。",
    "降温了，出门记得多穿一件。",
    "秋风已经有了凉凉的意味。",
    "久违的太阳终于露脸了。",
    # 通勤/工作
    "地铁上挤成沙丁鱼，也是日常。",
    "今天又是准时打卡的一天。",
    "摸鱼半小时，瞬间神清气爽。",
    "加班到这个点，路上的风很安静。",
    "不用定闹钟的周末太爽了。",
    # 追剧/影视/游戏
    "新一集更新了，赶紧去追。",
    "这部剧的结局把我看哭了。",
    "又熬夜打游戏，罪恶感满满。",
    "重温一部老电影，还是那么好。",
    "今晚的球赛看得心惊肉跳。",
    # 宠物/生活小物
    "我家猫主子今天格外粘人。",
    "遛狗遇上一只超可爱的柴犬。",
    "养了盆绿植，每天看它长高。",
    "窗台上的花开了，心情都亮了。",
    # 读书/音乐
    "睡前翻几页书，特别治愈。",
    "单曲循环一首歌停不下来。",
    "戴上耳机，外面的喧嚣就远了。",
    # 闲碎/心情
    "没什么特别的事，就是想发条动态。",
    "今天也和往常一样，挺好。",
    "偶尔放空一下，也是一种奢侈。",
    "收到了一个意外的好消息。",
    "和老朋友聊了很久，很开心。",
    "把房间收拾干净，整个人都轻了。",
]


# ========== eapi 加密 ==========

def _generate_key(key_bytes):
    gen = bytearray(16)
    copy_len = min(16, len(key_bytes))
    gen[:copy_len] = key_bytes[:copy_len]
    for i in range(16, len(key_bytes)):
        gen[i % 16] ^= key_bytes[i]
    return bytes(gen)


def eapi_encrypt(plaintext):
    key = _generate_key(EAPI_KEY.encode("utf-8"))
    cipher = AES.new(key, AES.MODE_ECB)
    data = pad(plaintext.encode("utf-8"), AES.block_size)
    encrypted = cipher.encrypt(data)
    return encrypted


def eapi_params(path, json_str):
    msg = f"nobody{path}use{json_str}md5forencrypt"
    md5_hex = hashlib.md5(msg.encode("utf-8")).hexdigest()
    data = f"{path}-{NOBODY}-{json_str}-{NOBODY}-{md5_hex}"
    encrypted = eapi_encrypt(data)
    return {"params": encrypted.hex().upper()}


# ========== 网易云客户端 ==========

class NeteaseClient:
    def __init__(self, cookie_str):
        self.s = requests.Session()
        self.cookie_str = cookie_str
        self.cookies = {}
        for item in cookie_str.split(";"):
            item = item.strip()
            if "=" in item:
                k, v = item.split("=", 1)
                self.cookies[k.strip()] = v.strip()
        self.csrf = self.cookies.get("__csrf", "")
        self.device_id = "".join(random.choices("0123456789abcdefghijklmnopqrstuvwxyz", k=32))
        self.buildver = str(int(time.time()))[:10]

    def _build_cookie_header(self, extra=None):
        c = dict(self.cookies)
        c["deviceId"] = self.device_id
        c["appver"] = "9.3.40"
        c["buildver"] = self.buildver
        c["resolution"] = "1920x1080"
        c["os"] = "Android"
        if extra:
            c.update(extra)
        parts = [f"{k}={v}" for k, v in c.items()]
        return "; ".join(parts)

    def _eapi_post(self, path, payload_dict, max_retries=3):
        url = f"{BASE_URL}{path.replace('/api/', '/eapi/')}"
        json_str = json.dumps(payload_dict, separators=(",", ":"))
        params = eapi_params(path, json_str)
        ua_list = [
            "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.41 Mobile Safari/537.36",
            "Mozilla/5.0 (Linux; Android 11; Redmi Note 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.73 Mobile Safari/537.36",
            "Mozilla/5.0 (Linux; Android 10; HUAWEI P30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.98 Mobile Safari/537.36",
            "Mozilla/5.0 (Linux; Android 13; Samsung Galaxy S22) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.71 Mobile Safari/537.36",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Linux; Android 9; MIX 2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36",
        ]
        headers = {
            "User-Agent": random.choice(ua_list),
            "Referer": "https://music.163.com",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": self._build_cookie_header(),
        }
        body = f"params={params['params']}"
        for attempt in range(max_retries):
            try:
                r = self.s.post(url, data=body, headers=headers, timeout=30)
                break
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 5
                    logger.warning(f"请求失败 (尝试 {attempt + 1}/{max_retries}): {e}")
                    logger.info(f"等待 {wait_time} 秒后重试...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"请求失败，已重试 {max_retries} 次: {e}")
                    return {"code": -1, "message": f"请求失败: {e}"}
        try:
            return r.json()
        except Exception:
            try:
                from Crypto.Cipher import AES as _AES
                key = _generate_key(EAPI_KEY.encode("utf-8"))
                cipher = _AES.new(key, _AES.MODE_ECB)
                decrypted = cipher.decrypt(bytes.fromhex(r.text))
                pad_len = decrypted[-1]
                decrypted = decrypted[:-pad_len]
                return json.loads(decrypted.decode("utf-8"))
            except Exception:
                logger.error(f"响应解密失败: {r.text[:300]}")
                return {"code": -1, "message": "响应解密失败"}

    def login_check(self, name=""):
        logger.info(f"[{name}] 验证登录状态...")
        resp = self._eapi_post("/api/w/nuser/account/get", {})
        code = resp.get("code", -1)
        if code == 200:
            profile = resp.get("profile") or resp.get("data", {}).get("profile")
            # 2026-10-19 修复：eapi 通道对失效会话也返回 code=200 但 profile 为空
            # （实测：死号打"登录成功! 用户: 未知"后发布动态 301）。无 profile.userId 一律判过期。
            if not profile or not profile.get("userId"):
                logger.warning(f"[{name}] code=200 但无 profile（会话已失效），判过期")
                return False
            nickname = profile.get("nickname", "未知")
            logger.info(f"[{name}] 登录成功! 用户: {nickname}")
            return True
        logger.warning(f"[{name}] Cookie 已过期或无效, code={code}")
        return False

    def upload_image(self, image_bytes):
        logger.info("Step 1: 获取 NOS token...")
        md5_hex = hashlib.md5(image_bytes).hexdigest()
        alloc_payload = {
            "filename": "note.jpg",
            "local": "false",
            "nos_product": 0,
            "fileSize": len(image_bytes),
            "md5": md5_hex,
            "ext": ".jpg",
            "type": "image",
        }
        alloc_resp = self._eapi_post("/api/nos/token/alloc", alloc_payload)
        if alloc_resp.get("code") != 200:
            logger.error(f"获取 NOS token 失败: {alloc_resp}")
            return None

        result = alloc_resp.get("result", {})
        object_key = result.get("objectKey", "")
        token = result.get("token", "")
        doc_id = result.get("docId", "")
        bucket = result.get("bucket", "yyimgs")

        # 模拟人类：上传前随机等待
        time.sleep(random.uniform(0.5, 2.0))

        logger.info("Step 2: 上传图片到 NOS...")
        try:
            lbs_resp = requests.get("https://wanproxy.127.net/lbs?version=1.0&bucketname=cloudmusic", timeout=10).json()
            upload_host = lbs_resp.get("upload", ["https://nosup-hz1.127.net"])[0]
        except Exception:
            upload_host = "https://nosup-hz1.127.net"

        nos_url = f"{upload_host}/{bucket}/{object_key}?version=1.0&offset=0&complete=true"
        nos_headers = {"x-nos-token": token, "Content-Type": "image/jpeg", "User-Agent": "Mozilla/5.0"}
        nos_resp = requests.post(nos_url, headers=nos_headers, data=image_bytes, timeout=60)
        if nos_resp.status_code not in (200, 201):
            logger.error(f"NOS 上传失败: {nos_resp.status_code}")
            return None

        # 模拟人类：上传后随机等待
        time.sleep(random.uniform(0.3, 1.5))

        logger.info("Step 3: 获取动态图片信息...")
        event_img_payload = {"imgid": doc_id, "format": "jpeg"}
        event_resp = self._eapi_post("/api/upload/event/img/v1", event_img_payload)
        if event_resp.get("code") != 200:
            logger.error(f"获取动态图片信息失败: {event_resp}")
            return None

        pic_info = event_resp.get("picInfo", {})
        return {
            "originId": pic_info.get("originId"),
            "squareId": pic_info.get("squareId"),
            "rectangleId": pic_info.get("rectangleId"),
            "format": pic_info.get("format", "jpeg"),
        }

    def publish_event(self, msg, pic_data=None):
        logger.info("发布动态...")
        event_uuid = uuid.uuid4().hex
        payload = {
            "msg": msg,
            "type": "noresource",
            "uuid": event_uuid,
            "addComment": "false",
        }
        if pic_data:
            pics = [{
                "originId": pic_data["originId"],
                "squareId": pic_data["squareId"],
                "rectangleId": pic_data["rectangleId"],
                "format": pic_data["format"],
            }]
            payload["pics"] = json.dumps(pics, separators=(",", ":"))
        else:
            payload["pics"] = "[]"
        return self._eapi_post("/api/share/friends/resource", payload)


# ========== 随机图片生成（每次完全不同） ==========

def _pick_font(min_size=42, max_size=72):
    """随机选字体 + 随机字号。
    Windows 本地路径与 GitHub ubuntu runner 路径（fonts-arphic-uming / fonts-noto-cjk，
    由 run.yml 的 brush job 安装）都列在这里，逐个 try，哪边能用哪边的。"""
    font_paths = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "C:/Windows/Fonts/STKAITI.TTF",
        "C:/Windows/Fonts/STXINWEI.TTF",
        "C:/Windows/Fonts/FZSTK.TTF",
        "C:/Windows/Fonts/FZYBKSJW.TTF",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    random.shuffle(font_paths)
    size = random.randint(min_size, max_size)
    for fp in font_paths:
        try:
            return ImageFont.truetype(fp, size)
        except Exception:
            continue
    try:
        return ImageFont.truetype("arial.ttf", size)
    except Exception:
        return ImageFont.load_default()


def random_local_image(text="今天也要加油呀"):
    """生成高度随机的图片：背景、装饰、字体、布局每次都不同"""
    w, h = 1080, 1080

    # 随机背景：纯色 / 渐变
    bg_mode = random.choice(["solid", "gradient_v", "gradient_h", "gradient_d"])
    c1 = tuple(random.randint(220, 255) for _ in range(3))
    c2 = tuple(random.randint(200, 255) for _ in range(3))
    img = Image.new("RGB", (w, h), c1)
    draw = ImageDraw.Draw(img)

    if bg_mode == "gradient_v":
        for y in range(h):
            r = int(c1[0] + (c2[0] - c1[0]) * y / h)
            g = int(c1[1] + (c2[1] - c1[1]) * y / h)
            b = int(c1[2] + (c2[2] - c1[2]) * y / h)
            draw.line([(0, y), (w, y)], fill=(r, g, b))
    elif bg_mode == "gradient_h":
        for x in range(w):
            r = int(c1[0] + (c2[0] - c1[0]) * x / w)
            g = int(c1[1] + (c2[1] - c1[1]) * x / w)
            b = int(c1[2] + (c2[2] - c1[2]) * x / w)
            draw.line([(x, 0), (x, h)], fill=(r, g, b))
    elif bg_mode == "gradient_d":
        for y in range(h):
            for x in range(w):
                t = (x + y) / (w + h)
                r = int(c1[0] + (c2[0] - c1[0]) * t)
                g = int(c1[1] + (c2[1] - c1[1]) * t)
                b = int(c1[2] + (c2[2] - c1[2]) * t)
                img.putpixel((x, y), (r, g, b))

    # 随机装饰：线条 / 圆点 / 圆圈 / 无装饰
    deco_count = random.randint(0, 12)
    for _ in range(deco_count):
        deco_type = random.choice(["line", "dot", "circle", "rect"])
        color = tuple(random.randint(180, 240) for _ in range(3))
        if deco_type == "line":
            x1, y1 = random.randint(0, w), random.randint(0, h)
            x2, y2 = random.randint(0, w), random.randint(0, h)
            draw.line([(x1, y1), (x2, y2)], fill=color, width=random.randint(1, 5))
        elif deco_type == "dot":
            x, y = random.randint(0, w), random.randint(0, h)
            r = random.randint(5, 30)
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)
        elif deco_type == "circle":
            x, y = random.randint(0, w), random.randint(0, h)
            r = random.randint(30, 200)
            draw.ellipse([x - r, y - r, x + r, y + r], outline=color, width=random.randint(1, 4))
        elif deco_type == "rect":
            x1, y1 = random.randint(0, w - 100), random.randint(0, h - 100)
            x2, y2 = x1 + random.randint(50, 300), y1 + random.randint(50, 300)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=random.randint(1, 3))

    # 随机文字颜色（深色系）
    text_color = (random.randint(30, 100), random.randint(30, 100), random.randint(30, 100))

    # 随机字体
    font = _pick_font()

    # 计算文字尺寸
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    # 随机位置（居中附近随机偏移）
    max_offset_x = max(0, (w - tw) // 2 - 50)
    max_offset_y = max(0, (h - th) // 2 - 50)
    tx = (w - tw) // 2 + random.randint(-max_offset_x, max_offset_x)
    ty = (h - th) // 2 + random.randint(-max_offset_y, max_offset_y)
    tx = max(60, min(tx, w - tw - 60))
    ty = max(60, min(ty, h - th - 60))

    draw.text((tx, ty), text, fill=text_color, font=font)

    bio = BytesIO()
    img.save(bio, format="JPEG", quality=random.randint(85, 95))
    return bio.getvalue()


# ========== 工具函数 ==========

def load_config(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        raw = json.load(f)
    return _strip(raw)


def _strip(obj):
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if not k.startswith("_")}
    if isinstance(obj, list):
        return [_strip(i) for i in obj]
    return obj


def send_email(cfg, subject, body):
    try:
        ec = cfg.get("email_config", {})
        if not ec.get("enabled", False):
            return
        to_list = ec.get("to_list", [])
        from_email = ec.get("from_email", "")
        auth_code = ec.get("auth_code", "")
        if not to_list or not from_email or not auth_code:
            return
        if "qq.com" in from_email:
            srv, port = "smtp.qq.com", 465
        elif "163.com" in from_email:
            srv, port = "smtp.163.com", 465
        else:
            srv, port = "smtp.qq.com", 465
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = ",".join(to_list)
        if port == 587:
            s = smtplib.SMTP(srv, port)
            s.starttls()
        else:
            s = smtplib.SMTP_SSL(srv, port)
        s.login(from_email, auth_code)
        s.sendmail(from_email, to_list, msg.as_string())
        s.quit()
    except Exception as e:
        logger.warning(f"邮件发送失败: {e}")


def notify_fail(cfg, reason, detail=""):
    body = f"网易云笔记工具运行异常。\n\n原因：{reason}"
    if detail:
        body += f"\n\n详细信息：\n{detail}"
    body += "\n\n请检查并修复后重新运行。"
    send_email(cfg, "网易云笔记工具：运行异常，请检查", body)


# ========== 主程序 ==========

def main():
    cfg = None
    try:
        cfg = load_config("accounts.json")

        accounts = cfg.get("accounts", [])
        if not accounts:
            # 本片没有账号（号池小、分片多时正常），静默退出
            print("accounts.json 为空，跳过")
            sys.exit(0)

        # 按 roles 过滤账号，只选 roles 包含 "notes" 的账号
        notes_accounts = [a for a in accounts if "notes" in a.get("roles", "listen,notes")]

        # ===== 核心：每账号错开发布日 =====
        # offset = md5(账号名) % 6，(当年第几天 + offset) % 6 == 0 时该账号发布。
        # → 每号每 6 天一条（一个月约 5 次，满足音乐人"30 天内笔记天数≥4"），且各号分散在不同日子，不会同天扎堆
        # 第几天按北京时间算（runner 是 UTC，直接用 now() 会差一天，2026-10-13 修复）
        from datetime import datetime, timezone, timedelta
        day_of_year = (datetime.now(timezone.utc) + timedelta(hours=8)).timetuple().tm_yday

        def publish_today(name):
            offset = int(hashlib.md5(str(name).encode("utf-8")).hexdigest(), 16) % 6
            return (day_of_year + offset) % 6 == 0

        todo = [a for a in notes_accounts if publish_today(a.get("name", "未知"))]
        logger.info(f"notes 账号 {len(notes_accounts)} 个，今日应发布 {len(todo)} 个 (第{day_of_year}天)")
        if not todo:
            logger.info("今日没有轮到发布的账号，静默退出")
            print("今日无发布任务")
            sys.exit(0)

        # 触发后随机等待 1-5 分钟再开始
        wait_seconds = random.randint(60, 300)
        logger.info(f"随机等待 {wait_seconds // 60} 分 {wait_seconds % 60} 秒后开始...")
        time.sleep(wait_seconds)
        success_count = 0
        fail_count = 0
        for acc in todo:
            aname = acc.get("name", "未知")
            cookie = acc.get("cookie", "")
            logger.info(f"本次使用账号: {aname}")

            # 模拟人类：登录后随机等待
            client = NeteaseClient(cookie)
            if not client.login_check(aname):
                logger.warning(f"账号 [{aname}] 的 Cookie 已过期，跳过该账号")
                fail_count += 1
                continue
            time.sleep(random.uniform(2, 8))

            # 随机选文案；长句优先在标点处自然截断（保底 8 字），避免生硬半句，2026-10-17 优化
            text = random.choice(QUOTES)
            if len(text) > 12:
                cut = random.randint(8, len(text))
                # 从 cut 往前找最近的中文/英文标点作为截断点；找不到则保留整句，不硬截断
                best = None
                for i in range(cut, max(7, cut - 7), -1):
                    if i <= len(text) and text[i - 1] in "，。、；！？,.!?…":
                        best = i
                        break
                if best:
                    text = text[:best]
            logger.info(f"[{aname}] 准备发布文案：{text}")

            # 模拟人类：想文案的时间
            time.sleep(random.uniform(3, 15))

            # 生成随机图片
            logger.info(f"[{aname}] 生成随机图片...")
            img_bytes = random_local_image(text)
            logger.info(f"[{aname}] 图片大小：{len(img_bytes)} bytes")

            # 模拟人类：选图的时间
            time.sleep(random.uniform(2, 10))

            # 上传图片
            pic_data = client.upload_image(img_bytes)
            if pic_data:
                logger.info(f"[{aname}] 图片上传成功")
            else:
                logger.warning(f"[{aname}] 图片上传失败，将发布纯文字动态")

            # 模拟人类：编辑的时间
            time.sleep(random.uniform(1, 5))

            # 发布动态
            resp = client.publish_event(text, pic_data)
            code = resp.get("code", -1)
            logger.info(f"[{aname}] 发布响应: code={code}")

            if code == 200:
                event = resp.get("event", {})
                event_id = event.get("id", "")
                user = event.get("user", {})
                nickname = user.get("nickname", "")
                logger.info(f"[{aname}] 发布成功! 动态ID={event_id}, 用户={nickname}")
                success_count += 1
            else:
                logger.error(f"[{aname}] 发布失败: {json.dumps(resp, ensure_ascii=False)[:300]}")
                fail_count += 1
                # 2026-10-17：需安全验证类失败（code=250）直邮号主本人，平和告知"做一次验证即可"；
                # 未登记邮箱的号只记日志。登录失效由 signin.py 负责，这里只管发布环节，不重复发
                if code == 250:
                    try:
                        import notify
                        notify.notify_verify(acc.get("email", ""), client.nickname, aname)
                    except Exception as _e:
                        logger.warning(f"[{aname}] 直邮号主失败（不影响主流程）: {_e}")

            # 账号之间随机等待，模拟人类切换账号
            time.sleep(random.uniform(5, 15))

        logger.info(f'全部完成: 成功 {success_count} 个, 失败 {fail_count} 个, 今日应发 {len(todo)} 个账号')
        if success_count == 0 and fail_count > 0:
            # 2026-10-17 修复：个别号被网易云风控(code=250 安全验证)或登录失效，属账号级
            # 临时问题，不该让整个 relay run 标红、误发告警邮件。真正的系统故障(程序异常)
            # 由下方 except 分支统一告警并退出；此处仅记 warning，正常退出。
            logger.warning(
                f"今日应发账号全部为账号级失败(风控/登录失效等)，不计为系统故障，"
                f"不发送告警邮件。成功 {success_count} / 失败 {fail_count} / 应发 {len(todo)}"
            )
        print(f"发布完成: {success_count}/{len(todo)} 成功")

    except Exception as e:
        logger.error(f"程序异常: {e}")
        if cfg:
            notify_fail(cfg, f"程序异常: {e}", traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()




