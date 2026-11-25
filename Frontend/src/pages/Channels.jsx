import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';

export default function Channels({ onBack }) {
  const [channels, setChannels] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchChannels = async () => {
    const { data } = await supabase.from('channels').select('*').order('created_at', { ascending: false });
    setChannels(data || []);
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  const addChannel = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);

    let clean = input.trim().replace('https://t.me/', '').replace('t.me/', '').replace('/', '');
    if (!clean.startsWith('@')) clean = `@${clean}`;

    await supabase.from('channels').upsert({ channel_username: clean, is_active: true }, { onConflict: 'channel_username' });
    setInput('');
    await fetchChannels();
    setLoading(false);
  };

  const removeChannel = async (id) => {
    await supabase.from('channels').delete().eq('id', id);
    fetchChannels();
  };

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#2563eb', fontWeight: '600', cursor: 'pointer', marginBottom: '16px', fontSize: '15px' }}>
        <ArrowLeft size={18} /> Back to Search
      </button>

      <h2 style={{ margin: '0 0 8px', color: '#0f172a' }}>Manage Telegram Channels</h2>
      <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: '14px' }}>Add public channel @username or t.me link. Restart backend once after adding new channels to pull the last 90 days.</p>

      <form onSubmit={addChannel} style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="e.g. @wholesaledeals or https://t.me/wholesaledeals"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }}
        />
        <button type="submit" disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '12px 20px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}>
          <Plus size={18} /> Add
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {channels.map((ch) => (
          <div key={ch.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
            <div>
              <div style={{ fontWeight: '600', color: '#0f172a' }}>{ch.channel_title || ch.channel_username}</div>
              <div style={{ fontSize: '13px', color: '#64748b' }}>{ch.channel_username}</div>
            </div>
            <button onClick={() => removeChannel(ch.id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px', borderRadius: '8px', cursor: 'pointer' }}>
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        {channels.length === 0 && <p style={{ color: '#64748b', textAlign: 'center' }}>No channels added yet.</p>}
      </div>
    </div>
  );
}
