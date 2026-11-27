import { Component, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { configMissing, supabase } from './lib/supabase';
import AuthScreen from './components/AuthScreen.jsx';
import Dashboard from './components/Dashboard.jsx';

class Boundary extends Component {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="splash">
        <div className="center">
          <h2>Kai gadbad thai</h2>
          <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    if (configMissing) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="splash"><Loader2 className="spin" size={28} /></div>;
  }
  return <Boundary>{session ? <Dashboard session={session} /> : <AuthScreen />}</Boundary>;
}
