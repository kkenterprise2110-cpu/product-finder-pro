"""Telegram message -> product fields. Pure functions (easy to test)."""
import re
from typing import Optional, Tuple

_NUM = r"(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{2,6}(?:\.\d{1,2})?)"

# "₹1,299", "Rs. 999", "price: 1299", "@ 450"
_LABELED = re.compile(
    r"(?:₹|\brs\.?|\binr|\bprice|\brate|@)\s*[:\-=]?\s*(?:₹|rs\.?|inr)?\s*" + _NUM,
    re.IGNORECASE,
)
# "1299/-", "999 rs", "450 only"
_SUFFIXED = re.compile(_NUM + r"\s*(?:/-|\brs\b\.?|\binr\b|₹|\bonly\b)", re.IGNORECASE)
# "MRP 1999", "was 1500" -> these are NOT the selling price
_MRP = re.compile(
    r"(?:\bmrp\b|\bm\.r\.p\.?|\bmop\b|\boriginal\b|\bwas\b|\bregular\b)\s*[:\-=]?\s*"
    r"(?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d+)?(?:\s*/-)?",
    re.IGNORECASE,
)

_OUT = re.compile(
    r"\b(sold\s*out|stock\s*out|stockout|out\s*of\s*stock|oos|not\s+available|"
    r"unavailable|booked|finished|stock\s*finish(?:ed)?|no\s+stock|khatam|"
    r"stock\s+(?:nathi|nahi))\b",
    re.IGNORECASE,
)
_BACK = re.compile(r"\b(back\s+in\s+stock|restock(?:ed)?|available\s+now|in\s+stock)\b", re.IGNORECASE)

MIN_PRICE, MAX_PRICE = 10.0, 500000.0


def extract_price(text: str) -> Optional[float]:
    """Lowest sane selling price in the text (MRP/was prices are ignored)."""
    if not text:
        return None
    cleaned = _MRP.sub(" ", text)
    values = []
    for pat in (_LABELED, _SUFFIXED):
        for m in pat.finditer(cleaned):
            try:
                v = float(m.group(1).replace(",", ""))
            except ValueError:
                continue
            if MIN_PRICE <= v <= MAX_PRICE:
                values.append(v)
    return min(values) if values else None


def extract_title(text: str) -> str:
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.lower().startswith(("http://", "https://", "t.me/")):
            continue
        # drop leading emoji / bullets / decoration
        line = re.sub(r"^[^\w₹]+", "", line).strip()
        if len(re.findall(r"\w", line)) >= 3:
            return line[:120]
    return ""


def extract_status(text: str) -> str:
    if _OUT.search(text) and not _BACK.search(text):
        return "STOCK_OUT"
    return "IN_STOCK"


def parse_message(text: str) -> Tuple[str, Optional[float], str]:
    text = (text or "").strip()
    if not text:
        return "(No caption)", None, "IN_STOCK"
    return extract_title(text) or "(No title)", extract_price(text), extract_status(text)
