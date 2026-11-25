import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Login from './pages/Login';
import Search from './pages/Search';
import Channels from './pages/Channels';
import TelegramConnect from './components/TelegramConnect';
import { Send, Settings, LogOut, CheckCircle2 } from 'lucide-react';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('search');
  const [showTgModal, setShowTgModal] = useState(false);
  const [tgConnected, setTgConnected] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session?.user) checkTelegramStatus(session.user.id, true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) checkTelegramStatus(session.user.id, true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkTelegramStatus = async (userId, autoOpenIfNew = false) => {
    const { data } = await supabase
      .from('user_telegram_sessions')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle();

    const isConn = data?.status === 'CONNECTED';
    setTgConnected(isConn);
    // જો નવો યુઝર પહેલીવાર લોગીન કરે અને Telegram કનેક્ટ ન હોય તો તરત Connect Telegram બોક્સ ખુલશે
    if (!isConn && autoOpenIfNew) {
      setShowTgModal(true);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Loading...</div>;
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div
          onClick={() => setPage('search')}
          className="text-xl font-bold tracking-tight cursor-pointer"
        >
          Product Finder Pro
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTgModal(true)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition ${
              tgConnected
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30'
                : 'bg-blue-600 text-white hover:bg-blue-700 animate-pulse'
            }`}
          >
            {tgConnected ? <CheckCircle2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            {tgConnected ? 'Telegram Connected' : 'Connect Telegram'}
          </button>

          <button
            onClick={() => setPage(page === 'channels' ? 'search' : 'channels')}
            className="bg-slate-800 hover:bg-slate-700 px-3.5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border border-slate-700"
          >
            <Settings className="w-4 h-4" />
            {page === 'channels' ? 'Back to Search' : 'Channels'}
          </button>

          <button
            onClick={() => supabase.auth.signOut()}
            className="bg-red-600 hover:bg-red-700 px-3.5 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </header>

      <main>
        {page === 'channels' ? <Channels /> : <Search />}
      </main>

      {showTgModal && (
        <TelegramConnect
          onClose={() => {
            setShowTgModal(false);
            if (session?.user) checkTelegramStatus(session.user.id, false);
          }}
        />
      )}
    </div>
  );
}
