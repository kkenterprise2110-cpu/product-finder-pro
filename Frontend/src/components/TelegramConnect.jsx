import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Send, CheckCircle2, Smartphone, KeyRound, X } from 'lucide-react';

export default function TelegramConnect({ onClose }) {
  const [userId, setUserId] = useState(null);
  const [tgState, setTgState] = useState(null);
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUserId(data.user.id);
        loadStatus(data.user.id);
      }
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => loadStatus(userId), 2000);
    return () => clearInterval(interval);
  }, [userId]);

  const loadStatus = async (uid) => {
    const { data } = await supabase
      .from('user_telegram_sessions')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();
    if (data) {
      setTgState(data);
      if (['CONNECTED', 'ERROR', 'OTP_SENT', 'NEED_2FA'].includes(data.status)) {
        setBusy(false);
      }
    }
  };

  const sendOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    await supabase.from('user_telegram_sessions').upsert({
      user_id: userId,
      phone_number: phone.trim(),
      status: 'SEND_OTP',
      error_msg: null,
      updated_at: new Date().toISOString()
    });
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    await supabase.from('user_telegram_sessions').update({
      otp_code: otp.trim(),
      status: 'VERIFY_OTP',
      error_msg: null,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId);
  };

  const verify2Fa = async (e) => {
    e.preventDefault();
    setBusy(true);
    await supabase.from('user_telegram_sessions').update({
      two_fa_password: twoFa,
      status: 'VERIFY_2FA',
      error_msg: null,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId);
  };

  const disconnectTg = async () => {
    await supabase.from('user_telegram_sessions').update({
      status: 'DISCONNECTED',
      session_string: null,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId);
    setTgState(null);
  };

  const status = tgState?.status;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative text-slate-900">
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-slate-700">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <Send className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-bold text-slate-900">Connect Your Telegram</h2>
        </div>

        {tgState?.error_msg && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 border border-red-200">
            {tgState.error_msg}
          </div>
        )}

        {status === 'CONNECTED' ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle2 className="w-7 h-7 text-green-600 shrink-0" />
              <div>
                <p className="font-semibold text-green-900">Telegram Connected!</p>
                <p className="text-xs text-green-700">Phone: {tgState.phone_number} • Auto-syncing all your channels 24x7</p>
              </div>
            </div>
            <button
              onClick={disconnectTg}
              className="w-full py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50"
            >
              Disconnect Telegram
            </button>
          </div>
        ) : status === 'OTP_SENT' || status === 'VERIFY_OTP' ? (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-sm text-slate-600">
              Telegram app par aavelo 5-digit OTP code nakho (<b>{tgState.phone_number}</b>):
            </p>
            <div className="relative">
              <KeyRound className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 5-digit OTP"
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Verifying OTP...' : 'Verify & Connect'}
            </button>
          </form>
        ) : status === 'NEED_2FA' || status === 'VERIFY_2FA' ? (
          <form onSubmit={verify2Fa} className="space-y-4">
            <p className="text-sm text-slate-600">Tamaro Telegram 2-Step Verification password nakho:</p>
            <input
              type="password"
              required
              value={twoFa}
              onChange={(e) => setTwoFa(e.target.value)}
              placeholder="2FA Password"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Verifying Password...' : 'Unlock & Connect'}
            </button>
          </form>
        ) : (
          <form onSubmit={sendOtp} className="space-y-4">
            <p className="text-sm text-slate-600">
              Tamaro personal Telegram mobile number nakho. Tamari badhi joined channels auto-sync thai jase.
            </p>
            <div className="relative">
              <Smartphone className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+919876543210"
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Sending OTP...' : 'Send Telegram OTP'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
