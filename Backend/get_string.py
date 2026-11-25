import os
from dotenv import load_dotenv
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

load_dotenv()
api_id = int(os.getenv("TELEGRAM_API_ID"))
api_hash = os.getenv("TELEGRAM_API_HASH")

with TelegramClient("session_name", api_id, api_hash) as client:
    print("\n=== COPY THIS SESSION STRING (KEEP IT SECRET) ===")
    print(StringSession.save(client.session))
    print("=================================================\n")
