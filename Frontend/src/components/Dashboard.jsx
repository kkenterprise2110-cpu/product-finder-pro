import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as ImageIcon, Loader2, LogOut, Megaphone, PackageSearch, RefreshCw, Search, Send, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { dhashFromFile } from '../lib/imageHash';
import useDebounce from '../hooks/useDebounce';
import useProducts from '../hooks/useProducts';
import useSignedUrls from '../hooks/useSignedUrls';
import ProductCard, { CardSkeleton } from './ProductCard.jsx';
import TelegramConnect from './TelegramConnect.jsx';
import ChannelsModal from './ChannelsModal.jsx';

export default function Dashboard({ session }) {
  const uid = session.user.id;
  const [q, setQ] = useState('');
  const [hideOut, setHideOut] = useState(false);
  const [sort, setSort] = useState('price_asc');
  const [photoSort, setPhotoSort] = useState('match');
  const [channelId, setChannelId] = useState('');
  const [photo, setPhoto] = useState(null); // { preview, rows, loading }
  const [liveRows, setLiveRows] = useState([]);
  const [liveSearching, setLiveSearching] = useState(false);
  const [modal, setModal] = useState(null); // 'tg' | 'channels'
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState('');
  const [channels, setChannels] = useState([]);
  const [version, setVersion] = useState(0);
  const [fresh, setFresh] = useState(0);
  const [toasts, setToasts] = useState([]);
  const fileRef = useRef(null);
  const sentinel = useRef(null);

  const dq = useDebounce(q, 250);

  const toast = useCallback((msg, isErr) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, isErr }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // ---------------------------------------------------------------- status + channels
  const loadStatus = useCallback(async () => {
    try { setStatus(await api.status()); setStatusErr(''); }
    catch (e) { setStatusErr(e.message); }
  }, []);
  const loadChannels = useCallback(async () => {
    const { data } = await supabase.from('user_channels').select('channel_id,title').eq('enabled', true).order('title');
    setChannels(data || []);
  }, []);

  useEffect(() => { api.wake(); loadStatus(); }, [loadStatus]);
  useEffect(() => { loadChannels(); }, [loadChannels, version]);

  // ---------------------------------------------------------------- live "new products"
  useEffect(() => {
    const ch = supabase.channel('products-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'products', filter: `user_id=eq.${uid}` }, () => setFresh((n) => n + 1))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid]);

  // ---------------------------------------------------------------- products (DB + Live Telegram)
  const filters = useMemo(() => ({ q: dq, hideOut, sort, channelId: channelId ? Number(channelId) : null }), [dq, hideOut, sort, channelId]);
  const list = useProducts(filters, version);

  useEffect(() => {
    const term = dq.trim();
    if (!term || photo || status?.status !== 'CONNECTED') {
      setLiveRows([]);
      setLiveSearching(false);
      return;
    }
    const ac = new AbortController();
    setLiveSearching(true);
    api.liveSearch(term, channelId ? Number(channelId) : null, ac.signal)
      .then((res) => {
        if (!ac.signal.aborted) {
          setLiveRows(res.products || []);
          setLiveSearching(false);
        }
      })
      .catch((err) => {
        if (!ac.signal.aborted && err.name !== 'AbortError') {
          setLiveSearching(false);
        }
      });
    return () => ac.abort();
  }, [dq, channelId, photo, status?.status]);

  // Merge DB items + Live Telegram search results without duplicates
  const mergedSearchItems = useMemo(() => {
    if (!dq.trim()) return list.items;
    const map = new Map();
    for (const item of list.items) map.set(item.id, item);
    for (const item of liveRows) {
      const ex = map.get(item.id);
      if (!ex || (!ex.image_path && !ex.live_image && (item.live_image || item.image_path))) {
        map.set(item.id, item);
      }
    }
    let arr = Array.from(map.values());
    if (hideOut) arr = arr.filter((x) => x.status === 'IN_STOCK');
    if (channelId) arr = arr.filter((x) => x.channel_id === Number(channelId));
    const by = {
      price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
      price_desc: (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
      new: (a, b) => new Date(b.posted_at) - new Date(a.posted_at),
    }[sort];
    return by ? [...arr].sort(by) : arr;
  }, [dq, list.items, liveRows, hideOut, channelId, sort]);

  const photoItems = useMemo(() => {
    if (!photo?.rows) return [];
    let r = photo.rows.filter((x) => !hideOut || x.status === 'IN_STOCK').filter((x) => !channelId || x.channel_id === Number(channelId));
    const by = {
      price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
      price_desc: (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
      new: (a, b) => new Date(b.posted_at) - new Date(a.posted_at),
      match: (a, b) => a.distance - b.distance,
    }[photoSort];
    return [...r].sort(by);
  }, [photo, hideOut, photoSort, channelId]);

  const items = photo ? photoItems : mergedSearchItems;
  const loading = photo ? photo.loading : (list.loading && items.length === 0 && !liveSearching);
  const urlFor = useSignedUrls(items.filter((i) => !i.live_image && i.image_path).map((i) => i.image_path));

  const bestId = useMemo(() => {
    if (items.length < 2 || !(photo || dq.trim())) return null;
    const priced = items.filter((i) => i.price != null && i.status === 'IN_STOCK');
    if (priced.length < 2) return null;
    return priced.reduce((a, b) => (b.price < a.price ? b : a)).id;
  }, [items, photo, dq]);

  // infinite scroll
  useEffect(() => {
    if (photo || !sentinel.current) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && list.loadMore(), { rootMargin: '600px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [photo, list.loadMore, list.items.length]);

  // ---------------------------------------------------------------- photo search
  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setPhoto({ preview, rows: null, loading: true });
    try {
      const hash = await dhashFromFile(file);
      const { data, error } = await supabase.rpc('search_by_image', { q_hash: hash, max_distance: 14, lim: 60 });
      if (error) throw error;
      setPhoto({ preview, rows: data || [], loading: false });
      if (!data?.length) toast('Aa photo jevu koi product malyu nahi.');
    } catch (err) {
      setPhoto(null);
      toast(err.message || 'Photo search na thayu.', true);
    }
  };
  const clearPhoto = () => { if (photo?.preview) URL.revokeObjectURL(photo.preview); setPhoto(null); };

  const logout = async () => { await supabase.auth.signOut(); };
  const refreshAll = () => { setFresh(0); setVersion((v) => v + 1); };

  const connected = status?.status === 'CONNECTED';
  const chip = statusErr ? { cls: 'warn', text: 'Server offline' }
    : !status ? { cls: 'idle', text: 'Checking…' }
    : connected ? { cls: 'ok', text: 'Connected' }
    : status.status === 'EXPIRED' ? { cls: 'bad', text: 'Reconnect' }
    : { cls: 'idle', text: 'Not connected' };

  const noFilters = !dq.trim() && !hideOut && !channelId && !photo;

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand"><span className="brand-mark"><Search size={17} color="#fff" /></span><span>Product Finder Pro</span></div>
          <div className="grow" />
          <button className={`chip ${chip.cls}`} onClick={() => setModal('tg')} aria-label={`Telegram: ${chip.text}`}>
            <span className="dot" />{chip.text}
          </button>
          <button className="btn" onClick={() => setModal('channels')}><Megaphone size={16} /><span className="hide-sm">Channels</span></button>
          <button className="btn logout" onClick={logout} aria-label="Logout"><LogOut size={16} /><span className="hide-sm">Logout</span></button>
        </div>
      </header>

      <div className="page">
        <div className="toolbar">
          <div className="toolbar-card">
            <div className="search-row">
              <div className="search-box">
                <Search size={18} />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any product live across all channels…" aria-label="Search products" disabled={!!photo} />
                {liveSearching && <Loader2 size={16} className="spin" />}
                {q && !photo && <button className="icon-btn clear" onClick={() => setQ('')} aria-label="Clear"><X size={16} /></button>}
              </div>
              <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={photo?.loading}>
                {photo?.loading ? <Loader2 size={16} className="spin" /> : <ImageIcon size={16} />}<span className="hide-sm">Search by Photo</span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
            </div>

            {photo && (
              <div className="photo-chip">
                <img src={photo.preview} alt="" />
                <span style={{ flex: 1 }}>{photo.loading ? 'Photo match thai rahyu che…' : `${photoItems.length} similar product${photoItems.length === 1 ? '' : 's'}`}</span>
                <button className="btn sm" onClick={clearPhoto}><X size={14} />Clear</button>
              </div>
            )}

            <div className="filter-row">
              <label className="check"><input type="checkbox" checked={hideOut} onChange={(e) => setHideOut(e.target.checked)} />Hide Stock-Out</label>
              {channels.length > 1 && (
                <select className="select wide" value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Channel filter">
                  <option value="">All channels</option>
                  {channels.map((c) => <option key={c.channel_id} value={c.channel_id}>{c.title}</option>)}
                </select>
              )}
              <div className="push">
                <label htmlFor="sort" className="muted hide-sm">Sort by</label>
                <select id="sort" className="select" value={photo ? photoSort : sort} onChange={(e) => (photo ? setPhotoSort(e.target.value) : setSort(e.target.value))}>
                  {photo && <option value="match">Best match</option>}
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="new">Newest first</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {fresh > 0 && !photo && !dq.trim() && (
          <button className="btn primary sm new-pill" onClick={refreshAll}><RefreshCw size={14} />{fresh} new product{fresh > 1 ? 's' : ''} — show</button>
        )}

        {statusErr && (
          <div className="banner warn" role="status">
            <span>{statusErr}</span>
            <button className="btn sm" onClick={loadStatus}>Retry</button>
          </div>
        )}
        {status?.status === 'EXPIRED' && (
          <div className="banner warn"><span>Telegram session expire thayu che.</span><button className="btn sm" onClick={() => setModal('tg')}>Reconnect</button></div>
        )}

        {list.error && !photo && (
          <div className="banner warn"><span>{list.error}</span><button className="btn sm" onClick={list.reload}>Retry</button></div>
        )}

        {loading || (liveSearching && items.length === 0) ? (
          <div className="grid" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <div className="ico">{!connected && noFilters ? <Send size={30} /> : <PackageSearch size={30} />}</div>
            {noFilters && status && !connected ? (
              <>
                <h2>Pehla Telegram connect karo</h2>
                <p>Tamara Telegram channels na products, price ane stock ahiya search karva mate account connect karo.</p>
                <button className="btn primary" onClick={() => setModal('tg')}><Send size={16} />Connect Telegram</button>
              </>
            ) : noFilters && status && status.channels_enabled === 0 ? (
              <>
                <h2>Channels select karo</h2>
                <p>Je Telegram channels na products joiye te <b>Channels</b> ma ON karo.</p>
                <button className="btn primary" onClick={() => setModal('channels')}><Megaphone size={16} />Open Channels</button>
              </>
            ) : (
              <>
                <h2>{noFilters ? 'Products sync thai rahya che…' : 'Koi product malyu nahi'}</h2>
                <p>{noFilters ? 'Pehli vaar 1-2 minute lagi shake. Pachi refresh karo.' : 'Bijo keyword ke filter try karo.'}</p>
                {noFilters && <button className="btn" onClick={refreshAll}><RefreshCw size={16} />Refresh</button>}
              </>
            )}
          </div>
        ) : (
          <>
            <div className="results-meta">
              <span>{items.length}{!photo && !dq.trim() && list.hasMore ? '+' : ''} product{items.length === 1 ? '' : 's'}{liveSearching ? ' (live searching…)' : ''}</span>
              <button className="btn ghost sm" onClick={refreshAll}><RefreshCw size={14} />Refresh</button>
            </div>
            <div className="grid">
              {items.map((p) => (
                <ProductCard key={p.id} p={p} imageUrl={p.live_image || urlFor(p.image_path)} best={p.id === bestId}
                  similarity={photo && p.distance != null ? Math.round((1 - p.distance / 64) * 100) : null} />
              ))}
            </div>
            {!photo && <div ref={sentinel} className="sentinel" />}
            {!photo && list.more && <div className="more"><Loader2 className="spin" /></div>}
            {!photo && list.hasMore && !list.more && <div className="more"><button className="btn" onClick={list.loadMore}>Load more</button></div>}
          </>
        )}
      </div>

      {modal === 'tg' && (
        <TelegramConnect status={status} onClose={() => { setModal(null); loadStatus(); }}
          onChanged={() => { loadStatus(); setVersion((v) => v + 1); }} />
      )}
      {modal === 'channels' && (
        <ChannelsModal connected={connected} onClose={() => { setModal(null); loadStatus(); }} onConnect={() => setModal('tg')}
          onChanged={() => setVersion((v) => v + 1)} toast={toast} />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast${t.isErr ? ' err' : ''}`}>{t.msg}</div>)}
      </div>
    </>
  );
}