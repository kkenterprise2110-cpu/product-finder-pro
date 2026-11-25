import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import TelegramConnect from '../components/TelegramConnect';
import { Search, Image as ImageIcon, Send, LogOut, ExternalLink, RefreshCw } from 'lucide-react';

export default function Dashboard() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [hideStockOut, setHideStockOut] = useState(false);
  const [sortBy, setSortBy] = useState('price_asc');
  const [showTgModal, setShowTgModal] = useState(false);
  const [tgConnected, setTgConnected] = useState(false);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUserId(data.user.id);
        checkTgStatus(data.user.id);
        fetchProducts(data.user.id);
      }
    });
  }, []);

  const checkTgStatus = async (uid) => {
    const { data } = await supabase
      .from('user_telegram_sessions')
      .select('status')
      .eq('user_id', uid)
      .maybeSingle();
    if (data?.status === 'CONNECTED') {
      setTgConnected(true);
    } else {
      setTgConnected(false);
    }
  };

  const fetchProducts = async (uid = userId) => {
    if (!uid) return;
    setLoading(true);
    let query = supabase
      .from('products')
      .select('*')
      .eq('user_id', uid)
      .order('posted_at', { ascending: false })
      .limit(300);

    const { data } = await query;
    setProducts(data || []);
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handlePhotoSearch = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    setSearchText(baseName);
  };

  const filtered = products
    .filter((p) => {
      if (hideStockOut && p.status === 'STOCK_OUT') return false;
      if (searchText.trim()) {
        const q = searchText.toLowerCase();
        const nameMatch = (p.product_name || '').toLowerCase().includes(q);
        const rawMatch = (p.raw_text || '').toLowerCase().includes(q);
        const chMatch = (p.channel_name || '').toLowerCase().includes(q);
        return nameMatch || rawMatch || chMatch;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'price_asc') return (a.price || 999999) - (b.price || 999999);
      if (sortBy === 'price_desc') return (b.price || 0) - (a.price || 0);
      return new Date(b.posted_at) - new Date(a.posted_at);
    });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-slate-900 text-white px-4 md:px-8 py-4 flex items-center justify-between shadow-md sticky top-0 z-30">
        <h1 className="text-lg md:text-xl font-bold tracking-tight">Product Finder Pro</h1>

        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={() => setShowTgModal(true)}
            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition ${
              tgConnected
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>{tgConnected ? 'Telegram Connected' : 'Connect Telegram'}</span>
          </button>

          <button
            onClick={() => fetchProducts()}
            title="Refresh Products"
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={handleLogout}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Search & Filters */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 mb-6">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search product name, SKU, or keyword (Last 90 days)..."
                className="w-full pl-11 pr-4 py-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <label className="cursor-pointer bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 shrink-0">
              <ImageIcon className="w-4 h-4" />
              <span>Search by Photo</span>
              <input type="file" accept="image/*" onChange={handlePhotoSearch} className="hidden" />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-3 border-t border-slate-100 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700">
              <input
                type="checkbox"
                checked={hideStockOut}
                onChange={(e) => setHideStockOut(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Hide Stock-Out Items</span>
            </label>

            <div className="flex items-center gap-2">
              <span className="text-slate-500">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none"
              >
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="newest">Newest First</option>
              </select>
            </div>
          </div>
        </div>

        {/* Product Grid */}
        {loading ? (
          <div className="text-center py-16 text-slate-500">Loading products...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            No products found yet. Click <b>Connect Telegram</b> above to sync your channels!
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col"
              >
                <div className="relative h-52 bg-slate-100 flex items-center justify-center overflow-hidden">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.product_name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-slate-400 text-xs">No Image</span>
                  )}
                  <span
                    className={`absolute top-2.5 right-2.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      item.status === 'STOCK_OUT'
                        ? 'bg-red-600 text-white'
                        : 'bg-emerald-600 text-white'
                    }`}
                  >
                    {item.status === 'STOCK_OUT' ? 'STOCK OUT' : 'IN STOCK'}
                  </span>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-xs font-semibold text-blue-600 mb-1 truncate">{item.channel_name}</p>
                    <h3 className="text-sm font-medium text-slate-800 line-clamp-2 mb-3">{item.product_name}</h3>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <span className="text-lg font-bold text-slate-900">
                      {item.price ? `₹${Number(item.price).toLocaleString('en-IN')}` : 'N/A'}
                    </span>
                    {item.telegram_link && (
                      <a
                        href={item.telegram_link}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
                      >
                        <span>Telegram</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showTgModal && (
        <TelegramConnect
          onClose={() => {
            setShowTgModal(false);
            if (userId) {
              checkTgStatus(userId);
              fetchProducts(userId);
            }
          }}
        />
      )}
    </div>
  );
}
