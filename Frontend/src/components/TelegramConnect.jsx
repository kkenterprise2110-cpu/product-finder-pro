import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Send, Smartphone, KeyRound, ShieldCheck, CheckCircle2, Loader2, LogOut } from 'lucide-react';

const BACKEND_URL = 'https://telegram-product-sync.onrender.com';

export default function TelegramConnect({ onClose }) {
  const [userId, setUserId] = useState(null);
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [step, setStep] = useState('PHONE'); // PHONE | OTP | 2FA | CONNECTED
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data?.user) return;
      const uid = data.user.id;
      setUserId(uid);

      const { data: row } = await supabase
        .from('user_telegram_sessions')
        .select('phone_number, status')
        .eq('user_id', uid)
        .maybeSingle();

      if (row?.status === 'CONNECTED') {
        if (row.phone_number) setPhone(row.phone_number);
        setStep('CONNECTED');
      }
    });
  }, []);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!userId) return setErrorMsg('Please login again.');
    if (phone.trim().length < 10) return setErrorMsg('Sacho mobile number nakho (+91 sathe).');

    setBusy(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${BACKEND_URL}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, phone: phone.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'OTP failed');
      setStep('OTP');
    } catch (err) {
      setErrorMsg(err.message === 'Failed to fetch' ? 'Render server wake up thay che, 15 second pachi fari click karo.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!userId || !otp.trim()) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${BACKEND_URL}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, otp: otp.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Invalid OTP');
      if (data.status === 'NEED_2FA') {
        setStep('2FA');
      } else {
        setStep('CONNECTED');
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify2FA = async (e) => {
    e.preventDefault();
    if (!userId || !twoFa.trim()) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${BACKEND_URL}/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, password: twoFa.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Wrong 2FA password');
      setStep('CONNECTED');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!userId) return;
    setBusy(true);
    await supabase
      .from('user_telegram_sessions')
      .update({ status: 'DISCONNECTED', session_string: null })
      .eq('user_id', userId);
    setStep('PHONE');
    setOtp('');
    setTwoFa('');
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-600/20">
            <Send className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Telegram Connection</h2>
            <p className="text-xs text-slate-500">Direct 24x7 Cloud Sync</p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium break-words">
            {errorMsg}
          </div>
        )}

        {step === 'CONNECTED' ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Telegram Connected!</h3>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              Connected with <b>{phone}</b>. Tamari badhi channels sync thai rahi che.
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-xl text-sm font-semibold"
              >
                Done
              </button>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>Disconnect</span>
              </button>
            </div>
          </div>
        ) : step === 'OTP' ? (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <p className="text-xs text-slate-600">
              Telegram app ma <b>{phone}</b> par aavelo 5-digit OTP nakho:
            </p>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter OTP (e.g. 12345)"
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-600 outline-none"
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>{busy ? 'Verifying OTP...' : 'Verify & Connect'}</span>
            </button>
          </form>
        ) : step === '2FA' ? (
          <form onSubmit={handleVerify2FA} className="space-y-4">
            <p className="text-xs text-slate-600">
              Tamara Telegram account no 2-Step Verification password nakho:
            </p>
            <div className="relative">
              <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                value={twoFa}
                onChange={(e) => setTwoFa(e.target.value)}
                placeholder="2FA Password"
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-600 outline-none"
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>{busy ? 'Checking Password...' : 'Unlock & Connect'}</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <p className="text-xs text-slate-600">
              Tamaro personal Telegram mobile number nakho. Ek j var connect karvanu rehse:
            </p>
            <div className="relative">
              <Smartphone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+919876543210"
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-600 outline-none"
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow-md shadow-blue-600/20"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>{busy ? 'Sending OTP...' : 'Send Telegram OTP'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}