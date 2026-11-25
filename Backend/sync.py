import os
import re
import io
import asyncio
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
SESSION_STRING = os.getenv("TELEGRAM_SESSION_STRING")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)

def get_last_message_id(channel_id):
    try:
        res = supabase.table("products").select("message_id").eq("channel_id", str(channel_id)).order("message_id", desc=True).limit(1).execute()
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
        except:
            price = None

    lower = text.lower()
    is_out = any(k in lower for k in ["stock out", "out of stock", "sold out", "not available", "no stock", "booked"])
    status = "STOCK_OUT" if is_out else "IN_STOCK"
    return product_name, price, status

async def process_message(msg, entity, channel_title):
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
                file_path = f"{entity.id}/{msg.id}.jpg"
                supabase.storage.from_("product-images").upload(
                    file_path,
                    img_bytes,
                    {"content-type": "image/jpeg", "upsert": "true"}
                )
                image_url = supabase.storage.from_("product-images").get_public_url(file_path)
        except Exception:
            pass

    posted_at = msg.date.astimezone(timezone.utc).isoformat() if msg.date else datetime.now(timezone.utc).isoformat()

    data = {
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
        "posted_at": posted_at
    }

    try:
        supabase.table("products").upsert(data, on_conflict="channel_id,message_id").execute()
        print(f"[{status}] {channel_title} | {product_name[:35]} | ₹{price}")
    except Exception as e:
        print(f"[DB ERR] {e}")

async def sync_channel_smart(entity, title):
    cid = str(entity.id)
    last_id = get_last_message_id(cid)

    if last_id > 0:
        async for msg in client.iter_messages(entity, min_id=last_id, reverse=True):
            await process_message(msg, entity, title)
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(days=90)
        print(f"[INITIAL 90-DAY SYNC] {title}...")
        async for msg in client.iter_messages(entity, offset_date=datetime.now(timezone.utc), reverse=False):
            if msg.date and msg.date < cutoff:
                break
            await process_message(msg, entity, title)

checked_in_session = set()

async def watch_channels():
    while True:
        try:
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                if isinstance(entity, Channel) and entity.broadcast:
                    cid = str(entity.id)
                    if cid not in checked_in_session:
                        checked_in_session.add(cid)
                        uname = f"@{entity.username}" if getattr(entity, "username", None) else cid
                        title = dialog.name or uname
                        supabase.table("channels").upsert({
                            "channel_username": uname,
                            "channel_title": title,
                            "is_active": True
                        }, on_conflict="channel_username").execute()
                        await sync_channel_smart(entity, title)
        except Exception as e:
            print(f"[CHANNEL WATCH ERR] {e}")
        await asyncio.sleep(20)

@client.on(events.NewMessage)
async def on_new_post(event):
    chat = await event.get_chat()
    if isinstance(chat, Channel) and chat.broadcast:
        await process_message(event.message, chat, chat.title or str(chat.id))

@client.on(events.MessageEdited)
async def on_edited_post(event):
    chat = await event.get_chat()
    if isinstance(chat, Channel) and chat.broadcast:
        await process_message(event.message, chat, chat.title or str(chat.id))

async def main():
    await client.start()
    print("=== 24x7 CLOUD REAL-TIME SYNC RUNNING ===")
    asyncio.create_task(watch_channels())
    await client.run_until_disconnected()

with client:
    client.loop.run_until_complete(main())
