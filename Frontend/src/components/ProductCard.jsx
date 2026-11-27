import { memo, useState } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, ImageOff } from 'lucide-react';
import { formatPrice, timeAgo } from '../lib/format';

function ProductCard({ p, imageUrl, best, similarity, onCopied }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const out = p.status === 'STOCK_OUT';
  const price = formatPrice(p.price);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${p.product_name}${price ? ` — ${price}` : ''}${p.telegram_link ? `\n${p.telegram_link}` : ''}`);
      setCopied(true); onCopied?.();
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <article className={`card${out ? ' out' : ''}`}>
      <div className="thumb">
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" decoding="async" /> : <ImageOff size={28} />}
        <div className="badges">
          <span className={`badge ${out ? 'out' : 'in'}`}>{out ? 'Stock Out' : 'In Stock'}</span>
          {similarity != null ? <span className="badge sim">{similarity}% match</span> : best ? <span className="badge best">Best price</span> : null}
        </div>
      </div>
      <div className="card-body">
        {price ? <div className="price">{price}</div> : <div className="price none">Price nathi</div>}
        <div className="title" title={p.product_name}>{p.product_name}</div>
        <div className="meta"><span title={p.channel_name}>{p.channel_name}</span><span>{timeAgo(p.posted_at)}</span></div>
        {open && p.raw_text && <pre className="raw">{p.raw_text}</pre>}
        <div className="card-actions">
          {p.telegram_link && (
            <a className="btn sm" aria-label="Open in Telegram" href={p.telegram_link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /><span className="lbl">Telegram</span></a>
          )}
          <button className="btn sm" onClick={copy} aria-label="Copy">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
          {p.raw_text && (
            <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Details">
              <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default memo(ProductCard);

export function CardSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <div className="thumb skeleton" style={{ borderRadius: 0 }} />
      <div className="card-body">
        <div className="skeleton" style={{ height: 22, width: '45%' }} />
        <div className="skeleton" style={{ height: 14 }} />
        <div className="skeleton" style={{ height: 14, width: '70%' }} />
        <div className="skeleton" style={{ height: 34, marginTop: 8 }} />
      </div>
    </div>
  );
}
