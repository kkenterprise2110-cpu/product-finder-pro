import os
import re
import asyncio
import threading
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

pending_clients = {}
active_workers = {}
main_loop = None

def extract_price(text: str):
    if not text:
        return None
    patterns = [
        r'(?:₹|rs\.?|inr|price|rate|@)\s*[:\-]?\s*([0-9]{1,3}(?:,[0-9]{2,3})+|[0-9]{2,6})(?:\.[0-9]{1,2})?',
        r'([0-9]{1,3}(?:,[0-9]{2,3})+|[0-9]{3,6})\s*(?:/-|rs|inr|₹|only)'
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            raw_num = m.group(1).replace(",", "")
            try:
                val = float(raw_num)
                if 10 <= val <= 500000:
                    return val
            except:
                pass
    return None

def parse_message(text: str):
    if not text:
        return "Untitled Product", None, "IN_STOCK"
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    title = lines[0][:120] if lines else "Product Item"
    price = extract_price(text)
    lower = text.lower()
    out_words = ["sold out", "stock out", "out of stock", "not available", "booked", "finished"]
    status = "STOCK_OUT" if any(w in lower for w in out_words) else "IN_STOCK"
    return title, price, status

async def sync_user_channels(user_id: str, session_str: str):
    client = TelegramClient(StringSession(session_str), API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print(f"[AUTH EXPIRED] User {user_id[:8]}")
        return

    print(f"[SYNC START] User {user_id[:8]}")
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)

    async for dialog in client.iter_dialogs():
        if not dialog.is_channel:
            continue
        ch_name = dialog.name or "Channel"
        ch_username = getattr(dialog.entity, "username", None)
        try:
            async for msg in client.iter_messages(dialog.id, offset_date=datetime.now(timezone.utc), reverse=False, limit=150):
                if msg.date < cutoff:
                    break
                text = msg.message or ""
                if not text and not msg.photo:
                    continue
                title, price, status = parse_message(text)
                tg_link = f"https://t.me/{ch_username}/{msg.id}" if ch_username else None
                unique_key = f"{user_id}_{dialog.id}_{msg.id}"

                supabase.table("products").upsert({
                    "id": unique_key,
                    "user_id": user_id,
                    "channel_name": ch_name,
                    "product_name": title,
                    "raw_text": text[:1000],
                    "price": price,
                    "status": status,
                    "telegram_link": tg_link,
                    "posted_at": msg.date.isoformat()
                }, on_conflict="id").execute()
        except Exception as e:
            print(f"[CHANNEL ERR] {ch_name}: {e}")

    @client.on(events.NewMessage)
    async def on_new_msg(event):
        if not event.is_channel:
            return
        chat = await event.get_chat()
        ch_name = getattr(chat, "title", "Channel")
        ch_username = getattr(chat, "username", None)
        text = event.message.message or ""
        if not text and not event.message.photo:
            return
        title, price, status = parse_message(text)
        tg_link = f"https://t.me/{ch_username}/{event.message.id}" if ch_username else None
        unique_key = f"{user_id}_{chat.id}_{event.message.id}"
        supabase.table("products").upsert({
            "id": unique_key,
            "user_id": user_id,
            "channel_name": ch_name,
            "product_name": title,
            "raw_text": text[:1000],
            "price": price,
            "status": status,
            "telegram_link": tg_link,
            "posted_at": event.message.date.isoformat()
        }, on_conflict="id").execute()

    print(f"[24x7 LISTENING] User {user_id[:8]}")
    await client.run_until_disconnected()

async def api_send_otp(user_id: str, phone: str):
    if user_id in pending_clients:
        try:
            await pending_clients[user_id]["client"].disconnect()
        except:
            pass
    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.connect()
    sent = await client.send_code_request(phone)
    pending_clients[user_id] = {
        "client": client,
        "phone": phone,
        "phone_code_hash": sent.phone_code_hash
    }
    return {"ok": True, "status": "OTP_SENT"}

async def api_verify_otp(user_id: str, otp: str):
    if user_id not in pending_clients:
        return {"ok": False, "error": "Session expired. Fari OTP moklo."}
    info = pending_clients[user_id]
    client = info["client"]
    try:
        await client.sign_in(phone=info["phone"], code=otp, phone_code_hash=info["phone_code_hash"])
    except Exception as e:
        if "SessionPasswordNeededError" in type(e).__name__ or "password" in str(e).lower():
            return {"ok": True, "status": "NEED_2FA"}
        return {"ok": False, "error": str(e)}

    s_str = client.session.save()
    await client.disconnect()
    del pending_clients[user_id]

    supabase.table("user_telegram_sessions").upsert({
        "user_id": user_id,
        "phone_number": info["phone"],
        "session_string": s_str,
        "status": "CONNECTED"
    }, on_conflict="user_id").execute()

    if user_id not in active_workers:
        active_workers[user_id] = asyncio.create_task(sync_user_channels(user_id, s_str))
    return {"ok": True, "status": "CONNECTED"}

async def api_verify_2fa(user_id: str, password: str):
    if user_id not in pending_clients:
        return {"ok": False, "error": "Session expired. Fari OTP moklo."}
    info = pending_clients[user_id]
    client = info["client"]
    try:
        await client.sign_in(password=password)
    except Exception as e:
        return {"ok": False, "error": str(e)}

    s_str = client.session.save()
    await client.disconnect()
    del pending_clients[user_id]

    supabase.table("user_telegram_sessions").upsert({
        "user_id": user_id,
        "phone_number": info["phone"],
        "session_string": s_str,
        "status": "CONNECTED"
    }, on_conflict="user_id").execute()

    if user_id not in active_workers:
        active_workers[user_id] = asyncio.create_task(sync_user_channels(user_id, s_str))
    return {"ok": True, "status": "CONNECTED"}

class APIHandler(BaseHTTPRequestHandler):
    def _send_json(self, code, payload):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        self._send_json(200, {"status": "OK - Multi-User Telegram Sync Running 24x7"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode() or "{}")
        user_id = body.get("user_id")

        try:
            if self.path == "/send-otp":
                fut = asyncio.run_coroutine_threadsafe(api_send_otp(user_id, body.get("phone")), main_loop)
                res = fut.result(timeout=25)
                self._send_json(200, res)
            elif self.path == "/verify-otp":
                fut = asyncio.run_coroutine_threadsafe(api_verify_otp(user_id, body.get("otp")), main_loop)
                res = fut.result(timeout=25)
                self._send_json(200, res)
            elif self.path == "/verify-2fa":
                fut = asyncio.run_coroutine_threadsafe(api_verify_2fa(user_id, body.get("password")), main_loop)
                res = fut.result(timeout=25)
                self._send_json(200, res)
            else:
                self._send_json(404, {"ok": False, "error": "Not found"})
        except Exception as e:
            self._send_json(500, {"ok": False, "error": str(e)})

def start_http():
    port = int(os.environ.get("PORT", 10000))
    server = HTTPServer(("0.0.0.0", port), APIHandler)
    server.serve_forever()

async def main():
    global main_loop
    main_loop = asyncio.get_running_loop()
    threading.Thread(target=start_http, daemon=True).start()
    print("HTTP API + 24x7 Sync Engine Started!")

    try:
        res = supabase.table("user_telegram_sessions").select("*").eq("status", "CONNECTED").execute()
        for row in (res.data or []):
            uid = row["user_id"]
            s_str = row.get("session_string")
            if s_str and uid not in active_workers:
                active_workers[uid] = asyncio.create_task(sync_user_channels(uid, s_str))
    except Exception as e:
        print("Boot resume warning:", e)

    while True:
        await asyncio.sleep(30)

if __name__ == "__main__":
    asyncio.run(main())