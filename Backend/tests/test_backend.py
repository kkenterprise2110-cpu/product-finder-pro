import os, sys, asyncio
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from cryptography.fernet import Fernet
os.environ.update(TELEGRAM_API_ID="123", TELEGRAM_API_HASH="abc", SUPABASE_URL="https://x.supabase.co",
                  SUPABASE_SECRET_KEY="svc", SESSION_ENC_KEY=Fernet.generate_key().decode(),
                  ALLOWED_ORIGINS="https://app.example.com")
import pytest
from parsing import parse_message, extract_price
import sync
from fastapi.testclient import TestClient


@pytest.mark.parametrize("text,price", [
    ("Nike Shoes\nPrice: ₹1,299", 1299), ("Watch Rs. 999/-", 999), ("Bag 450 only", 450),
    ("Phone MRP 19999 offer price 15999", 15999), ("Headphones @ 799", 799), ("no price here", None),
    ("Combo ₹1,500 and ₹1,200", 1200), ("Call 9876543210", None),
])
def test_price(text, price):
    assert extract_price(text) == price

def test_status_and_title():
    assert parse_message("🔥 Red Jacket\nSOLD OUT")[2] == "STOCK_OUT"
    assert parse_message("Red Jacket\nback in stock now")[2] == "IN_STOCK"
    assert parse_message("🔥🔥 Red Jacket ₹500")[0] == "Red Jacket ₹500"
    assert parse_message("")[0] == "(No caption)"

def test_crypto_roundtrip():
    s = "1BVtsOK..session"
    assert sync.dec(sync.enc(s)) == s and sync.dec("garbage") is None and sync.enc(s) != s

def test_dhash_stable_signed():
    from PIL import Image
    im = Image.effect_noise((200, 150), 60).convert("RGB")
    h = sync.dhash64(im)
    assert -(1 << 63) <= h < (1 << 63)
    assert sync.dhash64(im.resize((100, 75))) != None

def test_tg_link():
    assert sync.tg_link(-1001234, "shop", 5) == "https://t.me/shop/5"
    assert sync.tg_link(-1001234, None, 5) == "https://t.me/c/1234/5"

class FakeResp:
    def __init__(self, code, js): self.status_code, self._j = code, js
    def json(self): return self._j

class FakeClient:
    def __init__(self): self.session = type("S", (), {"save": lambda s: "SESSION"})()
    async def connect(self): pass
    async def disconnect(self): pass
    async def send_code_request(self, phone):
        return type("R", (), {"phone_code_hash": "h"})()
    async def sign_in(self, **kw):
        if kw.get("code") == "00000": raise sync.errors.PhoneCodeInvalidError(None)

@pytest.fixture
def client(monkeypatch):
    class Table:
        def __init__(self, n): self.n = n
        def __getattr__(self, k): return lambda *a, **kw: self
        def execute(self): return type("R", (), {"data": []})()
    class FakeSB:
        def table(self, n): return Table(n)
    monkeypatch.setattr(sync, "create_client", lambda *a: FakeSB())
    async def fake_get(url, headers=None):
        return FakeResp(200, {"id": "user-1"}) if headers["Authorization"] == "Bearer good" else FakeResp(401, {})
    monkeypatch.setattr(sync.httpx.AsyncClient, "get", lambda self, url, headers=None: fake_get(url, headers))
    monkeypatch.setattr(sync, "TelegramClient", lambda *a, **k: FakeClient())
    started = []
    async def fake_start(uid, s): started.append((uid, s))
    monkeypatch.setattr(sync, "start_worker", fake_start)
    sync.limiter.hits.clear(); sync._auth_cache.clear(); sync.pending.clear()
    with TestClient(sync.app) as c:
        c.started = started
        yield c

H = {"Authorization": "Bearer good"}

def test_health_open(client):
    assert client.get("/health").json()["ok"] is True

def test_auth_required(client):
    for path in ("/status", "/channels"):
        assert client.get(path).status_code == 401
        assert client.get(path, headers={"Authorization": "Bearer evil"}).status_code == 401
    r = client.post("/send-otp", json={"phone": "+919876543210", "user_id": "victim"})
    assert r.status_code == 401 and r.json()["ok"] is False

def test_user_id_in_body_is_ignored(client):
    client.post("/send-otp", json={"phone": "+919876543210", "user_id": "victim"}, headers=H)
    assert list(sync.pending) == ["user-1"]

def test_otp_flow_and_validation(client):
    assert client.post("/send-otp", json={"phone": "12345678"}, headers=H).status_code == 400
    assert client.post("/send-otp", json={"phone": "+91 98765-43210"}, headers=H).json()["status"] == "OTP_SENT"
    assert client.post("/verify-otp", json={"otp": "00000"}, headers=H).status_code == 400
    r = client.post("/verify-otp", json={"otp": "12345"}, headers=H)
    assert r.json()["status"] == "CONNECTED" and client.started == [("user-1", "SESSION")]

def test_rate_limit(client):
    codes = [client.post("/send-otp", json={"phone": "+919876543210"}, headers=H).status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and codes[5:] == [429, 429]

def test_cors(client):
    ok = client.options("/status", headers={"Origin": "https://app.example.com", "Access-Control-Request-Method": "GET"})
    bad = client.options("/status", headers={"Origin": "https://evil.com", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "https://app.example.com"
    assert "access-control-allow-origin" not in bad.headers
