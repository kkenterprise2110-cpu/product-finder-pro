import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Megaphone, RefreshCw, Search, Users } from 'lucide-react';
import Modal from './Modal.jsx';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

export default function ChannelsModal({ connected, onClose, onConnect, onChanged, toast }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [busyIds, setBusyIds] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('user_channels').select('channel_id,title,username,is_group,enabled,last_synced_at').order('title');
    if (error) toast('Channels load na thaya.', true); else setRows(data);
  }, [toast]);

  useEffect(() => { if (connected) load(); }, [connected, load]);

  const refresh = async () => {
    setRefreshing(true);
    try { await api.refreshChannels(); await load(); toast('Channels list update thai.'); }
    catch (e) { toast(e.message, true); }
    finally { setRefreshing(false); }
  };

  const toggle = async (ids, enabled) => {
    setBusyIds((s) => new Set([...s, ...ids]));
    setRows((r) => r.map((x) => (ids.includes(x.channel_id) ? { ...x, enabled } : x)));
    try {
      await api.toggleChannels(ids, enabled);
      if (enabled) toast('Sync chalu — products thodi vaar ma aavse.');
      onChanged();
    } catch (e) {
      toast(e.message, true);
      load();
    } finally {
      setBusyIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
    }
  };

  const shown = useMemo(() => (rows || []).filter((r) => (r.title || '').toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const onCount = (rows || []).filter((r) => r.enabled).length;

  return (
    <Modal wide title="Channels" subtitle={rows ? `${onCount} of ${rows.length} channels ON` : 'Telegram channels'} icon={<Megaphone size={20} />} onClose={onClose}>
      {!connected ? (
        <div className="center">
          <p className="muted">Pehla Telegram connect karo.</p>
          <button className="btn primary" onClick={onConnect}>Connect Telegram</button>
        </div>
      ) : !rows ? (
        <div className="center" style={{ padding: 30 }}><Loader2 className="spin" /></div>
      ) : (
        <>
          <div className="ch-tools">
            <div className="search-box" style={{ flex: 1, minWidth: 160 }}>
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Channel search…" aria-label="Search channels" style={{ height: 38, paddingLeft: 40 }} />
            </div>
            <button className="btn sm" onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />Refresh</button>
          </div>
          <div className="ch-tools">
            <button className="btn sm" onClick={() => toggle(shown.filter((r) => !r.enabled).map((r) => r.channel_id), true)} disabled={!shown.some((r) => !r.enabled)}>Badha ON</button>
            <button className="btn sm" onClick={() => toggle(shown.filter((r) => r.enabled).map((r) => r.channel_id), false)} disabled={!shown.some((r) => r.enabled)}>Badha OFF</button>
          </div>
          {rows.length === 0 ? (
            <p className="muted center">Koi channel malyu nahi. <b>Refresh</b> dabavo.</p>
          ) : (
            <div className="ch-list">
              {shown.map((r) => (
                <div className="ch-item" key={r.channel_id}>
                  {r.is_group ? <Users size={18} color="var(--muted)" /> : <Megaphone size={18} color="var(--muted)" />}
                  <div className="name">
                    {r.title || 'Channel'}
                    <small>{r.username ? `@${r.username}` : 'private'}{r.last_synced_at ? ' • synced' : ''}</small>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={r.enabled} disabled={busyIds.has(r.channel_id)} onChange={(e) => toggle([r.channel_id], e.target.checked)} aria-label={`Track ${r.title}`} />
                    <i />
                  </label>
                </div>
              ))}
            </div>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>OFF karta te channel na products pan delete thai jase.</p>
        </>
      )}
    </Modal>
  );
}
