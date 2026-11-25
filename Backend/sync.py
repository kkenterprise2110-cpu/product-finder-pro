import os
import re
import io
import asyncio
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timedelta, timezone
from PIL import Image
from dotenv import load_dotenv
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.types import Channel
from supabase import create_client

load_dotenv()

API_ID = int(os.getenv("TELEGRAM_API_ID"))
API_HASH = os.getenv("TELEGRAM_API_HASH")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

active_workers = {}
pending_auth = {}

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK - Multi-User Telegram Sync Running 24x7")
    def log_message(self, format, *args):
        pass

def start_health_server():
    port = int(os.environ.get("PORT", 10000))
    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    server.serve_forever()

def get_last_message_id(user_id, channel_id):
    try:
        res = (
            supabase.table("products")
            .select("message_id")
            .eq("user_id", user_id)
            .eq("channel_id", str(channel_id))
            .order("message_id", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            return int(res.data[0]["message_id"])
    except Exception:
        pass
    return 0

def compute_dhash_bytes(img_bytes):
    img = Image.open(io.BytesIO(img_bytes)).convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    pixels = list(img.getdata())
    avg = sum(pixels) / 64.0
    bits = "".join("1" if p >= avg else "0" for p in pixels)
    return "".join(f"{int(bits[i:i+4], 2):x}" for i in range(0, 64, 4))

def parse_message(text):
    if not text:
        return None, None, "IN_STOCK"
    clean_lines = [line.strip() for line in text.splitlines() if line.strip()]
    product_name = clean_lines[0][:180] if clean_lines else "Product"

    price = None
    price_match = re.search(r'(?:₹|rs\.?|inr|price|rate|@)\s*[:\-]?\s*(\d+(?:\.\d{1,2})?)', text, re.IGNORECASE)
    if not price_match:
        price_match = re.search(r'\b(\d{2,5})\s*(?:/-|rs|inr)\b', text, re.IGNORECASE)
    if price_match:
        try:
            price = float(price_match.group(1))
        except Exception:
            price = None

    lower = text.lower()
    is_out = any(k in lower for k in ["stock out", "out of stock", "sold out", "not available", "no stock", "booked"])
    status = "STOCK_OUT" if is_out else "IN_STOCK"
    return product_name, price, status

async def process_message(user_id, client, msg, entity, channel_title):
    if not msg or (not msg.text and not msg.photo):
        return
    text = msg.text or ""
    product_name, price, status = parse_message(text)

    if getattr(entity, "username", None):
        tg_link = f"https://t.me/{entity.username}/{msg.id}"
    else:
        tg_link = f"https://t.me/c/{entity.id}/{msg.id}"

    image_url = None
    image_hash = None

    if msg.photo:
        try:
            img_bytes = await client.download_media(msg.photo, file=bytes)
            if img_bytes:
                image_hash = compute_dhash_bytes(img_bytes)
                file_path = f"{user_id}/{entity.id}/{msg.id}.jpg"
                supabase.storage.from_("product-images").upload(
                    file_path,
                    img_bytes,
                    {"content-type": "image/jpeg", "upsert": "true"},
                )
                image_url = supabase.storage.from_("product-images").get_public_url(file_path)
        except Exception:
            pass

    posted_at = msg.date.astimezone(timezone.utc).isoformat() if msg.date else datetime.now(timezone.utc).isoformat()

    data = {
        "user_id": user_id,
        "channel_id": str(entity.id),
        "channel_name": channel_title,
        "message_id": msg.id,
        "product_name": product_name or "Product",
        "raw_text": text[:2000],
        "price": price,
        "status": status,
        "image_url": image_url,
        "image_hash": image_hash,
        "telegram_link": tg_link,
        "posted_at": posted_at,
    }

    try:
        supabase.table("products").upsert(data, on_conflict="user_id,channel_id,message_id").execute()
        print(f"[{user_id[:6]}][{status}] {channel_title} | {product_name[:30]} | ₹{price}")
    except Exception as e:
        print(f"[DB ERR] {e}")

async def sync_channel_smart(user_id, client, entity, title):
    cid = str(entity.id)
    last_id = get_last_message_id(user_id, cid)

    if last_id > 0:
        async for msg in client.iter_messages(entity, min_id=last_id, reverse=True):
            await process_message(user_id, client, msg, entity, title)
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(days=90)
        print(f"[{user_id[:6]}][90-DAY SYNC] {title}...")
        async for msg in client.iter_messages(entity, offset_date=datetime.now(timezone.utc), reverse=False):
            if msg.date and msg.date < cutoff:
                break
            await process_message(user_id, client, msg, entity, title)

async def run_user_worker(user_id, session_string):
    client = TelegramClient(StringSession(session_string), API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        supabase.table("user_telegram_sessions").update({"status": "DISCONNECTED"}).eq("user_id", user_id).execute()
        return

    print(f"[WORKER ACTIVE] User {user_id[:8]}")
    checked = set()

    @client.on(events.NewMessage)
    async def on_new(event):
        chat = await event.get_chat()
        if isinstance(chat, Channel) and chat.broadcast:
            await process_message(user_id, client, event.message, chat, chat.title or str(chat.id))

    @client.on(events.MessageEdited)
    async def on_edit(event):
        chat = await event.get_chat()
        if isinstance(chat, Channel) and chat.broadcast:
            await process_message(user_id, client, event.message, chat, chat.title or str(chat.id))

    while user_id in active_workers:
        try:
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                if isinstance(entity, Channel) and entity.broadcast:
                    cid = str(entity.id)
                    if cid not in checked:
                        checked.add(cid)
                        uname = f"@{entity.username}" if getattr(entity, "username", None) else cid
                        title = dialog.name or uname
                        supabase.table("channels").upsert(
                            {
                                "user_id": user_id,
                                "channel_username": uname,
                                "channel_title": title,
                                "is_active": True,
                            },
                            on_conflict="user_id,channel_username",
                        ).execute()
                        await sync_channel_smart(user_id, client, entity, title)
        except Exception as e:
            print(f"[WATCH ERR {user_id[:6]}] {e}")
        await asyncio.sleep(20)

async def handle_auth_requests():
    while True:
        try:
            res = supabase.table("user_telegram_sessions").select("*").execute()
            for row in res.data or []:
                uid = row["user_id"]
                status = row.get("status")
                phone = (row.get("phone_number") or "").strip()
                otp = (row.get("otp_code") or "").strip()
                pw = (row.get("two_fa_password") or "").strip()

                if status == "SEND_OTP" and phone:
                    try:
                        c = TelegramClient(StringSession(), API_ID, API_HASH)
                        await c.connect()
                        sent = await c.send_code_request(phone)
                        pending_auth[uid] = {"client": c, "phone": phone, "hash": sent.phone_code_hash}
                        supabase.table("user_telegram_sessions").update({
                            "status": "OTP_SENT",
                            "error_msg": None
                        }).eq("user_id", uid).execute()
                        print(f"[OTP SENT] {phone}")
                    except Exception as e:
                        supabase.table("user_telegram_sessions").update({
                            "status": "ERROR",
                            "error_msg": str(e)
                        }).eq("user_id", uid).execute()

                elif status == "VERIFY_OTP" and otp and uid in pending_auth:
                    info = pending_auth[uid]
                    c = info["client"]
                    try:
                        await c.sign_in(phone=info["phone"], code=otp, phone_code_hash=info["hash"])
                        s_str = c.session.save()
                        await c.disconnect()
                        del pending_auth[uid]
                        supabase.table("user_telegram_sessions").update({
                            "session_string": s_str,
                            "status": "CONNECTED",
                            "otp_code": None,
                            "error_msg": None
                        }).eq("user_id", uid).execute()
                        print(f"[CONNECTED] User {uid[:8]}")
                    except Exception as e:
                        err = str(e)
                        if "Two-steps verification" in err or "SessionPasswordNeededError" in type(e).__name__:
                            supabase.table("user_telegram_sessions").update({
                                "status": "NEED_2FA",
                                "error_msg": "Enter 2-Step Password"
                            }).eq("user_id", uid).execute()
                        else:
                            supabase.table("user_telegram_sessions").update({
                                "status": "OTP_SENT",
                                "error_msg": err
                            }).eq("user_id", uid).execute()

                elif status == "VERIFY_2FA" and pw and uid in pending_auth:
                    c = pending_auth[uid]["client"]
                    try:
                        await c.sign_in(password=pw)
                        s_str = c.session.save()
                        await c.disconnect()
                        del pending_auth[uid]
                        supabase.table("user_telegram_sessions").update({
                            "session_string": s_str,
                            "status": "CONNECTED",
                            "otp_code": None,
                            "two_fa_password": None,
                            "error_msg": None
                        }).eq("user_id", uid).execute()
                        print(f"[CONNECTED 2FA] User {uid[:8]}")
                    except Exception as e:
                        supabase.table("user_telegram_sessions").update({
                            "status": "NEED_2FA",
                            "error_msg": str(e)
                        }).eq("user_id", uid).execute()

                elif status == "CONNECTED" and row.get("session_string") and uid not in active_workers:
                    active_workers[uid] = asyncio.create_task(run_user_worker(uid, row["session_string"]))

                elif status == "DISCONNECTED" and uid in active_workers:
                    active_workers[uid].cancel()
                    del active_workers[uid]

        except Exception as e:
            print(f"[LOOP ERR] {e}")
        await asyncio.sleep(2)

async def main():
    threading.Thread(target=start_health_server, daemon=True).start()
    print("=== MULTI-USER 24x7 TELEGRAM SYNC ENGINE STARTED ===")
    await handle_auth_requests()

if __name__ == "__main__":
    asyncio.run(main())
