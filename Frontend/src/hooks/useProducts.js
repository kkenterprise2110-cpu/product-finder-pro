import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { tokenize } from '../lib/format';

const PAGE = 36;
const DAYS = 90;
const COLS = 'id,channel_id,channel_name,product_name,raw_text,price,status,telegram_link,image_path,posted_at';

function build({ q, hideOut, sort, channelId }) {
  let qb = supabase.from('products').select(COLS);
  qb = qb.gte('posted_at', new Date(Date.now() - DAYS * 864e5).toISOString());
  for (const t of tokenize(q)) qb = qb.ilike('search_text', `%${t}%`);
  if (hideOut) qb = qb.eq('status', 'IN_STOCK');
  if (channelId) qb = qb.eq('channel_id', channelId);
  if (sort === 'price_asc') qb = qb.order('price', { ascending: true, nullsFirst: false });
  else if (sort === 'price_desc') qb = qb.order('price', { ascending: false, nullsFirst: false });
  else qb = qb.order('posted_at', { ascending: false });
  return qb.order('posted_at', { ascending: false }).order('id');
}

export default function useProducts(filters, version) {
  const [state, setState] = useState({ items: [], loading: true, more: false, hasMore: false, error: '' });
  const req = useRef(0);
  const key = JSON.stringify(filters);

  const load = useCallback(async (offset) => {
    const id = ++req.current;
    setState((s) => (offset === 0 ? { ...s, loading: true, error: '' } : { ...s, more: true }));
    const { data, error } = await build(filters).range(offset, offset + PAGE - 1);
    if (id !== req.current) return; // a newer search started
    if (error) return setState((s) => ({ ...s, loading: false, more: false, error: 'Products load na thaya. Fari try karo.' }));
    setState((s) => ({
      items: offset === 0 ? data : [...s.items, ...data],
      loading: false, more: false, hasMore: data.length === PAGE, error: '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(0); }, [load, version]);

  const loadMore = useCallback(() => {
    setState((s) => {
      if (!s.loading && !s.more && s.hasMore) load(s.items.length);
      return s;
    });
  }, [load]);

  return { ...state, loadMore, reload: () => load(0) };
}
