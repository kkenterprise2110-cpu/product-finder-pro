"""Product Finder Pro - backend (FastAPI + Telethon).

Security model
  * Every endpoint (except /health) needs a valid Supabase login token. The
    user id comes from the verified token, never from the request body.
  * Telegram session strings are encrypted (Fernet) before they touch the DB.
  * Telegram is used READ-ONLY: we never send/forward/delete anything.
  * CORS is limited to ALLOWED_ORIGINS; OTP / login endpoints are rate limited.
"""
import asyncio
import io
import logging
import os
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import httpx
import uvicorn
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from supabase import Client, create_client
from telethon import TelegramClient, errors, events
from telethon.sessions import StringSession

from parsing import parse_message

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("pfp")
logging.getLogger("telethon").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)


# --------------------------------------------------------------------------- config
def _env(*names: str, default: str = "") -> str:
    for n in names:
        v = os.getenv(n)
        if v and v.strip():
            return v.strip()
    return default


API_ID = int(_env("TELEGRAM_API_ID", default="0") or 0)
API_HASH = _env("TELEGRAM_API_HASH")
SUPABASE_URL = _env("SUPABASE_URL").rstrip("/")
# service_role (legacy JWT "eyJ...") key. The anon key can NOT be used here.
SUPABASE_KEY = _env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY")
ENC_KEY = _env("SESSION_ENC_KEY")
ALLOWED_ORIGINS = [
    o.strip().rstrip("/")
    for o in _env("ALLOWED_ORIGINS", default="https://product-finder-pro.vercel.app").split(",")
    if o.strip()
]
SYNC_DAYS = int(_env("SYNC_DAYS", default="90"))
MAX_MSGS = int(_env("MAX_MSGS_PER_CHANNEL", default="400"))
BUCKET = "product-thumbs"
OTP_TTL = 600  # seconds a pending login stays alive


def check_config() -> None:
    missing = [
        n
        for n, v in (
            ("TELEGRAM_API_ID", API_ID),
            ("TELEGRAM_API_HASH", API_HASH),
            ("SUPABASE_URL", SUPABASE_URL),
            ("SUPABASE_SECRET_KEY", SUPABASE_KEY),
            ("SESSION_ENC_KEY", ENC_KEY),
        )
        if not v
    ]
    if missing:
        raise RuntimeError("Missing environment variables: " + ", ".join(missing))
    Fernet(ENC_KEY.encode())  # raises if the key is malformed


# --------------------------------------------------------------------------- helpers
def enc(s: str) -> str:
    return Fernet(ENC_KEY.encode()).encrypt(s.encode()).decode()


def dec(s: str) -> Optional[str]:
    try:
        return Fernet(ENC_KEY.encode()).decrypt(s.encode()).decode()
    except (InvalidToken, ValueError):
        return None


sb: Optional[Client] = None
http: Optional[httpx.AsyncClient] = None


async def run(fn, *a, **kw):
    """Run blocking supabase-py calls off the event loop."""
    return await asyncio.to_thread(fn, *a, **kw)


def tg_link(chat_id: int, username: Optional[str], msg_id: int) -> Optional[str]:
    if username:
        return f"https://t.me/{username}/{msg_id}"
    s = str(chat_id)
    if s.startswith("-100"):
        return f"https://t.me/c/{s[4:]}/{msg_id}"
    return None


def dhash64(img: Image.Image) -> int:
    """64-bit difference hash. The browser (imageHash.js) uses the same recipe."""
    g = img.convert("L").resize((9, 8), Image.BOX)
    px = g.tobytes()
    bits = 0
    for r in range(8):
        for c in range(8):
            bits = (bits << 1) | (1 if px[r * 9 + c] > px[r * 9 + c + 1] else 0)
    return bits - (1 << 64) if bits >= (1 << 63) else bits  # signed -> Postgres bigint


def make_thumb(data: bytes):
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    h = dhash64(img)
    img.thumbnail((480, 480))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=72, optimize=True)
    return out.getvalue(), h


def pick_size(photo):
    """Smallest photo size that is at least ~300px wide (good for cards + hashing)."""
    sizes = [s for s in getattr(photo, "sizes", []) if hasattr(s, "w")]
    sizes.sort(key=lambda s: s.w)
    for s in sizes:
        if s.w >= 300:
            return s
    return sizes[-1] if sizes else None


class RateLimiter:
    def __init__(self):
        self.hits: Dict[str, deque] = defaultdict(deque)

    def check(self, key: str, limit: int, window: int) -> None:
        now = time.time()
        q = self.hits[key]
        while q and q[0] < now - window:
            q.popleft()
        if len(q) >= limit:
            wait = int(q[0] + window - now) + 1
            raise HTTPException(429, f"Ghana prayas thaya. {max(1, wait // 60 + 1)} minute pachi fari try karo.")
        q.append(now)


limiter = RateLimiter()
_auth_cache: Dict[str, tuple] = {}


async def current_user(authorization: Optional[str] = Header(default=None)) -> str:
    """Verify the Supabase access token and return the user id (uuid)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Login jaruri che.")
    token = authorization[7:].strip()
    hit = _auth_cache.get(token)
    if hit and hit[1] > time.time():
        return hit[0]
    try:
        r = await http.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_KEY},
        )
    except httpx.HTTPError:
        raise HTTPException(503, "Login check na thai. Thodi vaar pachi try karo.")
    if r.status_code != 200 or not r.json().get("id"):
        raise HTTPException(401, "Login expire thai gayu. Fari login karo.")
    uid = r.json()["id"]
    if len(_auth_cache) > 2000:
        _auth_cache.clear()
    _auth_cache[token] = (uid, time.time() + 300)
    return uid


# --------------------------------------------------------------------------- sync worker
DEAD_SESSION_ERRORS = tuple(
    getattr(errors, n)
    for n in (
        "AuthKeyUnregisteredError",
        "AuthKeyInvalidError",
        "SessionRevokedError",
        "SessionExpiredError",
        "UserDeactivatedError",
        "UserDeactivatedBanError",
    )
    if hasattr(errors, n)
)


class SessionDead(Exception):
    pass


@dataclass
class ChannelMeta:
    title: str
    username: Optional[str]


MEDIA_SEM = asyncio.Semaphore(3)  # at most 3 photo downloads at once (Telegram friendly)


class Worker:
    """One Telegram connection per user: backfills 90 days + listens live."""

    def __init__(self, uid: str, session_str: str):
        self.uid = uid
        self.session_str = session_str
        self.client: Optional[TelegramClient] = None
        self.enabled: set = set()
        self.meta: Dict[int, ChannelMeta] = {}
        self.queue: "asyncio.Queue[int]" = asyncio.Queue()
        self.queued: set = set()
        self.task: Optional[asyncio.Task] = None
        self.stopped = False

    # ---- lifecycle
    def start(self):
        self.task = asyncio.create_task(self._supervisor())

    @property
    def alive(self) -> bool:
        return bool(self.client and self.client.is_connected())

    async def stop(self, log_out: bool = False):
        self.stopped = True
        if self.client:
            try:
                if log_out:
                    await self.client.log_out()  # removes the session from Telegram > Devices
                else:
                    await self.client.disconnect()
            except Exception:
                pass
        if self.task:
            self.task.cancel()

    async def _supervisor(self):
        backoff = 5
        while not self.stopped:
            try:
                await self._session()
                backoff = 5
            except asyncio.CancelledError:
                raise
            except (SessionDead, *DEAD_SESSION_ERRORS):
                log.warning("[%s] Telegram session is no longer valid", self.uid[:8])
                await run(lambda: sb.table("user_telegram_sessions")
                          .update({"status": "EXPIRED", "session_string": None})
                          .eq("user_id", self.uid).execute())
                return
            except Exception as e:
                log.error("[%s] worker error: %s", self.uid[:8], type(e).__name__)
            if self.stopped:
                return
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)

    async def _session(self):
        self.client = TelegramClient(
            StringSession(self.session_str), API_ID, API_HASH,
            device_model="Product Finder Pro", app_version="2.0",
            flood_sleep_threshold=30, connection_retries=5, auto_reconnect=True,
        )
        await self.client.connect()
        if not await self.client.is_user_authorized():
            raise SessionDead()
        self._register_handlers()
        await self.discover()
        await self._load_enabled()
        consumer = asyncio.create_task(self._consume())
        log.info("[%s] listening (%d channels enabled)", self.uid[:8], len(self.enabled))
        try:
            await self.client.run_until_disconnected()
        finally:
            consumer.cancel()

    # ---- channels
    async def discover(self) -> int:
        rows = []
        async for d in self.client.iter_dialogs():
            if not d.is_channel:
                continue
            ent = d.entity
            title = (d.name or "Channel")[:200]
            username = getattr(ent, "username", None)
            self.meta[d.id] = ChannelMeta(title, username)
            rows.append({
                "user_id": self.uid, "channel_id": d.id, "title": title,
                "username": username, "is_group": bool(getattr(ent, "megagroup", False)),
            })
        for i in range(0, len(rows), 200):  # 'enabled' is not in payload -> user choice is kept
            chunk = rows[i:i + 200]
            await run(lambda c=chunk: sb.table("user_channels").upsert(c, on_conflict="user_id,channel_id").execute())
        return len(rows)

    async def _load_enabled(self):
        res = await run(lambda: sb.table("user_channels").select("channel_id")
                        .eq("user_id", self.uid).eq("enabled", True).execute())
        self.enabled = {int(r["channel_id"]) for r in (res.data or [])}
        for cid in self.enabled:
            self.enqueue(cid)

    def enqueue(self, cid: int):
        if cid not in self.queued:
            self.queued.add(cid)
            self.queue.put_nowait(cid)

    async def set_enabled(self, cids: List[int], on: bool):
        for cid in cids:
            if on:
                self.enabled.add(cid)
                self.enqueue(cid)
            else:
                self.enabled.discard(cid)

    async def _consume(self):
        """Backfill one channel at a time (gentle on Telegram's rate limits)."""
        while True:
            cid = await self.queue.get()
            try:
                if cid in self.enabled:
                    await self.backfill(cid)
            except errors.FloodWaitError as e:
                log.warning("[%s] FloodWait %ss", self.uid[:8], e.seconds)
                await asyncio.sleep(min(e.seconds + 1, 600))
                self.queued.discard(cid)
                self.enqueue(cid)
                continue
            except Exception as e:
                log.error("[%s] backfill %s failed: %s", self.uid[:8], cid, type(e).__name__)
            self.queued.discard(cid)
            await asyncio.sleep(1)

    # ---- building rows
    def _row(self, chat_id: int, msg_id: int, date: datetime, text: str) -> dict:
        meta = self.meta.get(chat_id) or ChannelMeta("Channel", None)
        title, price, status = parse_message(text)
        return {
            "id": f"{self.uid}:{chat_id}:{msg_id}",
            "user_id": self.uid, "channel_id": chat_id, "message_id": msg_id,
            "channel_name": meta.title, "product_name": title,
            "raw_text": (text or "")[:1500], "price": price, "status": status,
            "telegram_link": tg_link(chat_id, meta.username, msg_id),
            "posted_at": date.astimezone(timezone.utc).isoformat(),
        }

    async def upsert(self, rows: List[dict]):
        for i in range(0, len(rows), 100):
            chunk = rows[i:i + 100]
            try:
                await run(lambda c=chunk: sb.table("products").upsert(c, on_conflict="id").execute())
            except Exception as e:
                log.error("[%s] upsert failed: %s", self.uid[:8], str(e)[:200])

    async def backfill(self, chat_id: int):
        cutoff = datetime.now(timezone.utc) - timedelta(days=SYNC_DAYS)
        msgs = []
        try:
            async for m in self.client.iter_messages(chat_id, limit=MAX_MSGS, wait_time=0.5):
                if m.date < cutoff:
                    break
                if getattr(m, "action", None):
                    continue
                msgs.append(m)
        except (errors.ChannelPrivateError, errors.ChannelInvalidError, ValueError):
            log.warning("[%s] channel %s not readable -> disabled", self.uid[:8], chat_id)
            self.enabled.discard(chat_id)
            await run(lambda: sb.table("user_channels").update({"enabled": False})
                      .eq("user_id", self.uid).eq("channel_id", chat_id).execute())
            return

        # albums -> one product (caption from whichever message has text)
        singles, groups = [], defaultdict(list)
        for m in msgs:
            if m.grouped_id:
                groups[m.grouped_id].append(m)
            else:
                singles.append(m)
        items = []  # (msg_id, date, text, photo_msg)
        for m in singles:
            items.append((m.id, m.date, m.message or "", m if m.photo else None))
        for g in groups.values():
            first = min(g, key=lambda x: x.id)
            text = next((x.message for x in g if x.message), "")
            photo_msg = next((x for x in sorted(g, key=lambda x: x.id) if x.photo), None)
            items.append((first.id, first.date, text, photo_msg))
        items = [i for i in items if i[2].strip() or i[3]]

        rows = [self._row(chat_id, mid, dt, txt) for mid, dt, txt, _ in items]
        await self.upsert(rows)  # text first => results are searchable immediately

        # photos next (skip the ones we already processed on an earlier run)
        have = await run(lambda: sb.table("products").select("message_id")
                         .eq("user_id", self.uid).eq("channel_id", chat_id)
                         .not_.is_("image_path", "null").limit(2000).execute())
        done = {int(r["message_id"]) for r in (have.data or [])}
        todo = [(mid, row, pm) for (mid, _, _, pm), row in zip(items, rows) if pm is not None and mid not in done]
        enriched = await asyncio.gather(*[self.enrich(chat_id, mid, row, pm) for mid, row, pm in todo])
        await self.upsert([r for r in enriched if r])

        await run(lambda: sb.table("user_channels")
                  .update({"last_synced_at": datetime.now(timezone.utc).isoformat()})
                  .eq("user_id", self.uid).eq("channel_id", chat_id).execute())
        log.info("[%s] synced %s: %d products, %d photos", self.uid[:8], chat_id, len(rows), len([r for r in enriched if r]))

    async def enrich(self, chat_id: int, msg_id: int, row: dict, photo_msg) -> Optional[dict]:
        """Download a small preview, store it privately and compute the image hash."""
        async with MEDIA_SEM:
            try:
                size = pick_size(photo_msg.photo)
                try:
                    data = await self.client.download_media(photo_msg, file=bytes, thumb=size)
                except Exception:
                    data = await self.client.download_media(photo_msg, file=bytes)
                if not data:
                    return None
                jpeg, h = await asyncio.to_thread(make_thumb, data)
                path = f"{self.uid}/{chat_id}_{msg_id}.jpg"
                await run(lambda: sb.storage.from_(BUCKET).upload(
                    path, jpeg, {"content-type": "image/jpeg", "upsert": "true"}))
                return {**row, "image_path": path, "image_hash": h}
            except errors.FloodWaitError as e:
                await asyncio.sleep(min(e.seconds + 1, 120))
            except Exception as e:
                log.warning("[%s] photo %s/%s skipped: %s", self.uid[:8], chat_id, msg_id, type(e).__name__)
            return None

    # ---- live updates
    def _register_handlers(self):
        c = self.client

        async def handle_one(chat_id, msg, text=None, photo_msg=None, first_id=None):
            if chat_id not in self.enabled:
                return
            text = msg.message if text is None else text
            pm = photo_msg if photo_msg is not None else (msg if msg.photo else None)
            if not (text or "").strip() and not pm:
                return
            mid = first_id or msg.id
            row = self._row(chat_id, mid, msg.date, text or "")
            await self.upsert([row])
            if pm is not None:
                rich = await self.enrich(chat_id, mid, row, pm)
                if rich:
                    await self.upsert([rich])

        @c.on(events.NewMessage())
        async def _new(ev):
            if ev.is_channel and not ev.message.grouped_id:
                await handle_one(ev.chat_id, ev.message)

        @c.on(events.Album)
        async def _album(ev):
            if not ev.is_channel:
                return
            msgs = sorted(ev.messages, key=lambda x: x.id)
            pm = next((x for x in msgs if x.photo), None)
            await handle_one(ev.chat_id, msgs[0], text=ev.text or "", photo_msg=pm, first_id=msgs[0].id)

        @c.on(events.MessageEdited())
        async def _edit(ev):  # e.g. caption changed to "SOLD OUT"
            if ev.is_channel and not ev.message.grouped_id:
                await handle_one(ev.chat_id, ev.message)


workers: Dict[str, Worker] = {}
pending: Dict[str, dict] = {}  # uid -> login in progress


async def start_worker(uid: str, session_str: str):
    old = workers.get(uid)
    if old and not old.stopped:
        return old
    w = Worker(uid, session_str)
    workers[uid] = w
    w.start()
    return w


async def get_worker(uid: str) -> Optional[Worker]:
    w = workers.get(uid)
    if w and not w.stopped:
        return w
    res = await run(lambda: sb.table("user_telegram_sessions").select("session_string,status")
                    .eq("user_id", uid).maybe_single().execute())
    row = getattr(res, "data", None)
    if row and row.get("status") == "CONNECTED" and row.get("session_string"):
        s = dec(row["session_string"])
        if s:
            return await start_worker(uid, s)
    return None


async def drop_pending(uid: str):
    info = pending.pop(uid, None)
    if info:
        try:
            await info["client"].disconnect()
        except Exception:
            pass


async def cleanup_loop():
    while True:
        await asyncio.sleep(60)
        now = time.time()
        for uid in [u for u, i in pending.items() if now - i["t"] > OTP_TTL]:
            await drop_pending(uid)


async def keepalive_loop():
    """Render free tier sleeps after 15 min without traffic: ping ourselves."""
    url = _env("RENDER_EXTERNAL_URL")
    if not url:
        return
    while True:
        await asyncio.sleep(600)
        try:
            await http.get(url.rstrip("/") + "/health")
        except Exception:
            pass


# --------------------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(app: FastAPI):
    global sb, http
    check_config()
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    http = httpx.AsyncClient(timeout=10)
    bg = [asyncio.create_task(cleanup_loop()), asyncio.create_task(keepalive_loop())]

    async def resume():
        try:
            res = await run(lambda: sb.table("user_telegram_sessions").select("user_id,session_string")
                            .eq("status", "CONNECTED").execute())
            for row in res.data or []:
                s = dec(row.get("session_string") or "")
                if not s:
                    log.warning("[%s] cannot decrypt session (wrong SESSION_ENC_KEY?)", row["user_id"][:8])
                    continue
                await start_worker(row["user_id"], s)
                await asyncio.sleep(2)  # stagger logins
        except Exception as e:
            log.error("resume failed: %s", e)

    bg.append(asyncio.create_task(resume()))
    log.info("Product Finder Pro backend ready")
    yield
    for t in bg:
        t.cancel()
    for w in list(workers.values()):
        await w.stop()
    await http.aclose()


app = FastAPI(title="Product Finder Pro", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
    max_age=600,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@app.exception_handler(HTTPException)
async def http_exc(_: Request, exc: HTTPException):
    return JSONResponse({"ok": False, "error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def any_exc(_: Request, exc: Exception):
    log.error("unhandled: %s", type(exc).__name__)
    return JSONResponse({"ok": False, "error": "Server ma kai gadbad thai. Fari try karo."}, status_code=500)


class PhoneIn(BaseModel):
    phone: str = Field(min_length=8, max_length=20)


class OtpIn(BaseModel):
    otp: str = Field(min_length=3, max_length=10)


class PwIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class ToggleIn(BaseModel):
    channel_ids: List[int] = Field(min_length=1, max_length=500)
    enabled: bool


class DisconnectIn(BaseModel):
    purge: bool = True


@app.get("/health")
@app.get("/")
async def health():
    return {"ok": True, "status": "OK"}


@app.post("/send-otp")
async def send_otp(body: PhoneIn, uid: str = Depends(current_user)):
    limiter.check(f"otp:{uid}", 5, 600)
    phone = re.sub(r"[\s\-()]", "", body.phone)
    if not re.fullmatch(r"\+\d{8,15}", phone):
        raise HTTPException(400, "Mobile number country code sathe nakho (jem ke +919876543210).")
    await drop_pending(uid)
    client = TelegramClient(StringSession(), API_ID, API_HASH, device_model="Product Finder Pro")
    try:
        await client.connect()
        sent = await client.send_code_request(phone)
    except errors.FloodWaitError as e:
        await client.disconnect()
        raise HTTPException(429, f"Telegram e {e.seconds // 60 + 1} minute rokvanu kahyu che. Pachi try karo.")
    except errors.PhoneNumberInvalidError:
        await client.disconnect()
        raise HTTPException(400, "Aa mobile number Telegram ne valid nathi lagto.")
    except Exception as e:
        await client.disconnect()
        log.error("send_code failed: %s", type(e).__name__)
        raise HTTPException(502, "Telegram sathe connect na thai shakyu. Thodi vaar pachi try karo.")
    pending[uid] = {"client": client, "phone": phone, "hash": sent.phone_code_hash, "t": time.time()}
    return {"ok": True, "status": "OTP_SENT"}


async def finish_login(uid: str, info: dict):
    client = info["client"]
    session_str = client.session.save()
    await client.disconnect()
    pending.pop(uid, None)
    await run(lambda: sb.table("user_telegram_sessions").upsert({
        "user_id": uid, "phone_number": info["phone"], "session_string": enc(session_str),
        "status": "CONNECTED", "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id").execute())
    old = workers.pop(uid, None)
    if old:
        await old.stop()
    await start_worker(uid, session_str)
    return {"ok": True, "status": "CONNECTED"}


@app.post("/verify-otp")
async def verify_otp(body: OtpIn, uid: str = Depends(current_user)):
    limiter.check(f"verify:{uid}", 10, 600)
    info = pending.get(uid)
    if not info:
        raise HTTPException(400, "Session expire thayu. Fari OTP mangavo.")
    try:
        await info["client"].sign_in(phone=info["phone"], code=body.otp.strip(), phone_code_hash=info["hash"])
    except errors.SessionPasswordNeededError:
        info["t"] = time.time()
        return {"ok": True, "status": "NEED_2FA"}
    except errors.PhoneCodeInvalidError:
        raise HTTPException(400, "OTP khotu che. Fari check karo.")
    except errors.PhoneCodeExpiredError:
        await drop_pending(uid)
        raise HTTPException(400, "OTP expire thai gayo. Fari OTP mangavo.")
    except errors.FloodWaitError as e:
        raise HTTPException(429, f"Telegram e {e.seconds // 60 + 1} minute rokvanu kahyu che.")
    except Exception as e:
        log.error("sign_in failed: %s", type(e).__name__)
        raise HTTPException(400, "Login na thai shakyu. Fari OTP mangavo.")
    return await finish_login(uid, info)


@app.post("/verify-2fa")
async def verify_2fa(body: PwIn, uid: str = Depends(current_user)):
    limiter.check(f"2fa:{uid}", 6, 600)
    info = pending.get(uid)
    if not info:
        raise HTTPException(400, "Session expire thayu. Fari OTP mangavo.")
    try:
        await info["client"].sign_in(password=body.password)
    except errors.PasswordHashInvalidError:
        raise HTTPException(400, "2-Step password khotu che.")
    except errors.FloodWaitError as e:
        raise HTTPException(429, f"Telegram e {e.seconds // 60 + 1} minute rokvanu kahyu che.")
    except Exception as e:
        log.error("2fa failed: %s", type(e).__name__)
        raise HTTPException(400, "Password verify na thayo.")
    return await finish_login(uid, info)


@app.get("/status")
async def status(uid: str = Depends(current_user)):
    res = await run(lambda: sb.table("user_telegram_sessions").select("phone_number,status")
                    .eq("user_id", uid).maybe_single().execute())
    row = getattr(res, "data", None) or {}
    st = row.get("status") or "NONE"
    phone = row.get("phone_number") or ""
    masked = (phone[:3] + "•" * max(0, len(phone) - 7) + phone[-4:]) if len(phone) > 7 else ""
    w = workers.get(uid)
    if st == "CONNECTED" and not (w and not w.stopped):
        await get_worker(uid)  # wake the worker if the server just restarted
        w = workers.get(uid)
    ch = await run(lambda: sb.table("user_channels").select("channel_id,enabled,last_synced_at")
                   .eq("user_id", uid).execute())
    rows = ch.data or []
    synced = [r["last_synced_at"] for r in rows if r.get("last_synced_at")]
    return {
        "ok": True, "status": st, "phone": masked, "worker": bool(w and w.alive),
        "channels_total": len(rows), "channels_enabled": sum(1 for r in rows if r["enabled"]),
        "last_sync": max(synced) if synced else None,
    }


@app.get("/channels")
async def channels(uid: str = Depends(current_user)):
    res = await run(lambda: sb.table("user_channels").select("*").eq("user_id", uid).order("title").execute())
    return {"ok": True, "channels": res.data or []}


@app.post("/channels/refresh")
async def channels_refresh(uid: str = Depends(current_user)):
    limiter.check(f"refresh:{uid}", 10, 600)
    w = await get_worker(uid)
    if not w:
        raise HTTPException(400, "Pehla Telegram connect karo.")
    for _ in range(40):  # worker may still be logging in
        if w.alive:
            break
        await asyncio.sleep(0.5)
    if not w.alive:
        raise HTTPException(503, "Telegram connect thai rahyu che. 10 second pachi try karo.")
    n = await w.discover()
    return {"ok": True, "count": n}


@app.post("/channels/toggle")
async def channels_toggle(body: ToggleIn, uid: str = Depends(current_user)):
    w = await get_worker(uid)
    if not w:
        raise HTTPException(400, "Pehla Telegram connect karo.")
    ids = list(set(body.channel_ids))
    await run(lambda: sb.table("user_channels").update({"enabled": body.enabled})
              .eq("user_id", uid).in_("channel_id", ids).execute())
    if not body.enabled:  # also remove that channel's products + thumbnails
        for cid in ids:
            res = await run(lambda c=cid: sb.table("products").select("image_path")
                            .eq("user_id", uid).eq("channel_id", c).not_.is_("image_path", "null").execute())
            paths = [r["image_path"] for r in (res.data or []) if r.get("image_path")]
            if paths:
                await run(lambda p=paths: sb.storage.from_(BUCKET).remove(p))
            await run(lambda c=cid: sb.table("products").delete()
                      .eq("user_id", uid).eq("channel_id", c).execute())
    await w.set_enabled(ids, body.enabled)
    return {"ok": True}


@app.post("/disconnect")
async def disconnect(body: DisconnectIn, uid: str = Depends(current_user)):
    await drop_pending(uid)
    w = workers.pop(uid, None)
    if w is None:  # server restarted: rebuild the client only to log it out
        row = await run(lambda: sb.table("user_telegram_sessions").select("session_string")
                        .eq("user_id", uid).maybe_single().execute())
        s = dec((getattr(row, "data", None) or {}).get("session_string") or "")
        if s:
            w = Worker(uid, s)
            w.client = TelegramClient(StringSession(s), API_ID, API_HASH)
            try:
                await w.client.connect()
            except Exception:
                pass
    if w:
        await w.stop(log_out=True)
    await run(lambda: sb.table("user_telegram_sessions").delete().eq("user_id", uid).execute())
    await run(lambda: sb.table("user_channels").delete().eq("user_id", uid).execute())
    if body.purge:
        res = await run(lambda: sb.table("products").select("image_path").eq("user_id", uid)
                        .not_.is_("image_path", "null").limit(5000).execute())
        paths = [r["image_path"] for r in (res.data or []) if r.get("image_path")]
        for i in range(0, len(paths), 100):
            await run(lambda p=paths[i:i + 100]: sb.storage.from_(BUCKET).remove(p))
        await run(lambda: sb.table("products").delete().eq("user_id", uid).execute())
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "10000")), log_level="info")
