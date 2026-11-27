import { useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, Mail, Search, TriangleAlert } from 'lucide-react';
import { configMissing, supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState('login'); // login | signup | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setInfo('');
    if (mode !== 'reset' && password.length < 8) return setErr('Password ochha ma ochho 8 character no rakho.');
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) setInfo('Account ban gayu! Tamara email ma confirm link moklyo che — e click karo, pachi login karo.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin });
        if (error) throw error;
        setInfo('Password reset link email par moklyo che.');
      }
    } catch (e2) {
      const m = (e2.message || '').toLowerCase();
      setErr(
        m.includes('invalid login') ? 'Email athva password khotu che.'
        : m.includes('already') ? 'Aa email thi account pehla thi che. Login karo.'
        : m.includes('rate') ? 'Ghana prayas thaya. Thodi vaar pachi try karo.'
        : m.includes('not confirmed') ? 'Pehla email confirm karo (inbox / spam check karo).'
        : e2.message || 'Kai gadbad thai.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><span className="brand-mark"><Search size={18} color="#fff" /></span>Product Finder Pro</div>
        <p className="sub">Telegram channels na products, price ane stock — ek j jagya e.</p>

        {configMissing && (
          <div className="alert err"><TriangleAlert size={14} style={{ verticalAlign: -2 }} /> VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY Vercel ma set nathi.</div>
        )}

        {mode !== 'reset' && (
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setErr(''); setInfo(''); }}>Login</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => { setMode('signup'); setErr(''); setInfo(''); }}>Sign up</button>
          </div>
        )}

        {err && <div className="alert err" role="alert">{err}</div>}
        {info && <div className="alert ok" role="status">{info}</div>}

        <label className="sr-only" htmlFor="email">Email</label>
        <div className="field">
          <Mail size={16} />
          <input id="email" className="input" type="email" autoComplete="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        {mode !== 'reset' && (
          <>
            <label className="sr-only" htmlFor="pw">Password</label>
            <div className="field">
              <Lock size={16} />
              <input id="pw" className="input" type={show ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="Password (8+ character)" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: 46 }} />
              <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}
                style={{ position: 'absolute', right: 5, top: 5 }}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </>
        )}

        <button className="btn primary block" disabled={busy || configMissing}>
          {busy && <Loader2 size={16} className="spin" />}
          {mode === 'login' ? 'Login' : mode === 'signup' ? 'Account banavo' : 'Reset link moklo'}
        </button>

        <p className="center" style={{ margin: '14px 0 0' }}>
          {mode === 'reset'
            ? <button type="button" className="link" onClick={() => setMode('login')}>← Login par pacha</button>
            : mode === 'login' && <button type="button" className="link" onClick={() => { setMode('reset'); setErr(''); setInfo(''); }}>Password bhuli gaya?</button>}
        </p>
      </form>
    </main>
  );
}
