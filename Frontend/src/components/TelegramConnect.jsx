import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, LogOut, Send, ShieldCheck, Smartphone } from 'lucide-react';
import Modal from './Modal.jsx';
import { api } from '../lib/api';

export default function TelegramConnect({ status, onClose, onChanged }) {
  const connected = status?.status === 'CONNECTED';
  const [step, setStep] = useState(connected ? 'CONNECTED' : 'PHONE'); // PHONE | OTP | 2FA | CONNECTED | DISCONNECT
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [pw, setPw] = useState('');
  const [purge, setPurge] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.wake(); }, []);

  const run = (fn) => async (e) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  const sendOtp = run(async () => {
    if (!/^\+\d{8,15}$/.test(phone.replace(/[\s-]/g, ''))) throw new Error('Number +91 jevi country code sathe nakho.');
    await api.sendOtp(phone.replace(/[\s-]/g, ''));
    setStep('OTP');
  });
  const verifyOtp = run(async () => {
    const r = await api.verifyOtp(otp.trim());
    if (r.status === 'NEED_2FA') return setStep('2FA');
    setStep('CONNECTED'); setPw(''); onChanged();
  });
  const verify2fa = run(async () => {
    await api.verify2fa(pw);
    setPw(''); setStep('CONNECTED'); onChanged();
  });
  const disconnect = run(async () => {
    await api.disconnect(purge);
    onChanged(); onClose();
  });

  return (
    <Modal title="Telegram Connection" subtitle="Secure • Read-only • 24x7 sync" icon={<Send size={20} />} onClose={onClose}>
      {err && <div className="alert err" role="alert">{err}</div>}

      {step === 'PHONE' && (
        <form onSubmit={sendOtp}>
          <p className="muted" style={{ marginTop: 0 }}>Tamaro Telegram mobile number nakho (country code sathe).</p>
          <div className="field">
            <Smartphone size={16} />
            <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" required autoFocus />
          </div>
          <button className="btn primary block" disabled={busy}>{busy && <Loader2 size={16} className="spin" />}Send Telegram OTP</button>
          <div className="note">
            <ShieldCheck size={16} />
            <span>Tamaro session encrypt thai ne save thay che. App fakt channel posts <b>vanche</b> che — kyarey message mokle / delete karto nathi. Tame kyarey pan Disconnect kari shako, Telegram na Devices mathi pan session nikli jase.</span>
          </div>
        </form>
      )}

      {step === 'OTP' && (
        <form onSubmit={verifyOtp}>
          <p className="muted" style={{ marginTop: 0 }}>Telegram app ma <b>{phone}</b> par aavelo code nakho.</p>
          <div className="field">
            <KeyRound size={16} />
            <input className="input" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="12345" maxLength={8} required autoFocus />
          </div>
          <button className="btn primary block" disabled={busy || otp.length < 4}>{busy && <Loader2 size={16} className="spin" />}Verify & Connect</button>
          <p className="center" style={{ margin: '12px 0 0' }}><button type="button" className="link" onClick={() => { setStep('PHONE'); setOtp(''); setErr(''); }}>Number badlo</button></p>
        </form>
      )}

      {step === '2FA' && (
        <form onSubmit={verify2fa}>
          <p className="muted" style={{ marginTop: 0 }}>Tamara Telegram account no 2-Step Verification password nakho. (Aa password save thato nathi.)</p>
          <div className="field">
            <ShieldCheck size={16} />
            <input className="input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="2FA password" required autoFocus />
          </div>
          <button className="btn primary block" disabled={busy || !pw}>{busy && <Loader2 size={16} className="spin" />}Unlock & Connect</button>
        </form>
      )}

      {step === 'CONNECTED' && (
        <div className="center">
          <div className="success-ico"><CheckCircle2 size={34} /></div>
          <h3 style={{ margin: '0 0 4px' }}>Telegram Connected!</h3>
          <p className="muted" style={{ margin: '0 0 16px' }}>
            {status?.phone ? <>Connected: <b>{status.phone}</b>. </> : null}
            Have <b>Channels</b> ma jaine je channels track karva hoy te ON karo.
          </p>
          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} onClick={onClose}>Done</button>
            <button className="btn" onClick={() => setStep('DISCONNECT')}><LogOut size={16} />Disconnect</button>
          </div>
        </div>
      )}

      {step === 'DISCONNECT' && (
        <div>
          <p style={{ marginTop: 0 }}>Telegram disconnect karvu che? Telegram na <b>Devices</b> mathi aa session nikli jase.</p>
          <label className="check" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            Synced products ane photos pan delete karo
          </label>
          <div className="row">
            <button className="btn" style={{ flex: 1 }} onClick={() => setStep('CONNECTED')} disabled={busy}>Cancel</button>
            <button className="btn danger" style={{ flex: 1 }} onClick={disconnect} disabled={busy}>{busy && <Loader2 size={16} className="spin" />}Disconnect</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
