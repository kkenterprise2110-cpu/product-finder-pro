import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const cache = new Map(); // path -> { url, exp }
const TTL = 3600;

export default function useSignedUrls(paths) {
  const [, bump] = useState(0);
  const sig = paths.join('|');

  useEffect(() => {
    const now = Date.now();
    const need = [...new Set(paths)].filter((p) => p && !(cache.get(p)?.exp > now));
    if (!need.length) return;
    let live = true;
    (async () => {
      for (let i = 0; i < need.length; i += 100) {
        const chunk = need.slice(i, i + 100);
        const { data } = await supabase.storage.from('product-thumbs').createSignedUrls(chunk, TTL);
        (data || []).forEach((d) => { if (d.signedUrl) cache.set(d.path, { url: d.signedUrl, exp: Date.now() + (TTL - 120) * 1000 }); });
      }
      if (live) bump((n) => n + 1);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return (p) => (p && cache.get(p)?.exp > Date.now() ? cache.get(p).url : null);
}
