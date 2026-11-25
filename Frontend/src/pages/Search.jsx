import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { computeImageHash, hammingDistance } from '../lib/imageHash';
import { Search as SearchIcon, Image as ImageIcon, Settings, LogOut, ExternalLink, X } from 'lucide-react';

export default function Search({ onOpenChannels }) {
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [hideStockOut, setHideStockOut] = useState(false);
  const [sortOrder, setSortOrder] = useState('price_asc');
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadedHash, setUploadedHash] = useState(null);

  const fetchProducts = async () => {
    setLoading(true);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    let req = supabase
      .from('products')
      .select('*')
      .gte('posted_at', ninetyDaysAgo)
      .limit(150);

    if (query.trim()) {
      req = req.ilike('product_name', `%${query.trim()}%`);
    }

    if (hideStockOut) {
      req = req.eq('status', 'IN_STOCK');
    }

    if (sortOrder === 'price_asc') {
      req = req.order('price', { ascending: true, nullsFirst: false });
    } else if (sortOrder === 'price_desc') {
      req = req.order('price', { ascending: false, nullsFirst: false });
    } else {
      req = req.order('posted_at', { ascending: false });
    }

    const { data } = await req;
    let results = data || [];

    if (uploadedHash) {
      results = results
        .map((item) => ({
          ...item,
          similarity: hammingDistance(uploadedHash, item.image_hash),
        }))
        .filter((item) => item.similarity <= 18)
        .sort((a, b) => (a.price ?? 999999) - (b.price ?? 999999));
    }

    setProducts(results);
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [query, hideStockOut, sortOrder, uploadedHash]);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    const hash = await computeImageHash(file);
    setUploadedHash(hash);
  };

  const clearImageSearch = () => {
    setImagePreview(null);
    setUploadedHash(null);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: '#0f172a', color: '#fff', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ fontWeight: '700', fontSize: '18px' }}>Product Finder Pro</div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onOpenChannels} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
            <Settings size={16} /> Channels
          </button>
          <button onClick={() => supabase.auth.signOut()} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#dc2626', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </header>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
        <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ flex: 1, minWidth: '240px', display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 12px' }}>
              <SearchIcon size={18} color="#64748b" />
              <input
                type="text"
                placeholder="Search product name, SKU, or keyword (Last 90 days)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ width: '100%', padding: '11px', border: 'none', outline: 'none', fontSize: '15px' }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
              <ImageIcon size={18} /> Search by Photo
              <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
            </label>
          </div>

          {imagePreview && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#f1f5f9', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', width: 'fit-content' }}>
              <img src={imagePreview} alt="Search query" style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px' }} />
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>Matching similar images (Low to High Price)</span>
              <button onClick={clearImageSearch} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>
                <X size={18} />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#334155', cursor: 'pointer', fontWeight: '500' }}>
              <input type="checkbox" checked={hideStockOut} onChange={(e) => setHideStockOut(e.target.checked)} />
              Hide Stock-Out Items
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#64748b' }}>Sort by:</span>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#fff' }}
              >
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="newest">Newest First</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Searching products...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
            {products.map((item) => {
              const isOut = item.status === 'STOCK_OUT';
              return (
                <div
                  key={item.id}
                  style={{
                    background: '#fff',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: isOut ? '2px solid #ef4444' : '1px solid #e2e8f0',
                    opacity: isOut ? 0.85 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ position: 'relative', height: '210px', background: '#f1f5f9' }}>
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.product_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '13px' }}>No Image</div>
                      )}
                      <span
                        style={{
                          position: 'absolute',
                          top: '10px',
                          right: '10px',
                          background: isOut ? '#dc2626' : '#16a34a',
                          color: '#fff',
                          fontSize: '11px',
                          fontWeight: '700',
                          padding: '4px 8px',
                          borderRadius: '6px',
                        }}
                      >
                        {isOut ? 'STOCK OUT' : 'IN STOCK'}
                      </span>
                    </div>

                    <div style={{ padding: '14px' }}>
                      <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: '600', marginBottom: '4px' }}>{item.channel_name}</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a', marginBottom: '8px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {item.product_name}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '0 14px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                      {item.price ? `₹${item.price}` : 'Price N/A'}
                    </div>
                    <a
                      href={item.telegram_link}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0f172a', color: '#fff', textDecoration: 'none', padding: '7px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}
                    >
                      Telegram <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && products.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
            No matching products found. Add Telegram channels from the "Channels" button above!
          </div>
        )}
      </div>
    </div>
  );
}
