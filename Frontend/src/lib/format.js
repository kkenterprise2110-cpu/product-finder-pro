const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

export function formatPrice(p) {
  if (p === null || p === undefined) return null;
  const n = Number(p);
  return Number.isInteger(n) ? inr0.format(n) : inr2.format(n);
}

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function tokenize(q) {
  return (q || '')
    .toLowerCase()
    .replace(/[%_\\,()*"'`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}
