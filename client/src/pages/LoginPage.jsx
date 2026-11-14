import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { TicketMark } from '../components/Ticket.jsx';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const switchMode = (m) => {
    setMode(m);
    setError('');
  };

  return (
    <div className="login">
      <section className="login-board" aria-hidden="true">
        <div className="brand brand-lg">
          <TicketMark size={36} />
          <span>Queuedesk</span>
        </div>
        <div className="board">
          <div className="board-label">Now serving</div>
          <div className="board-code">G-042</div>
          <div className="board-meta">Counter 2</div>
        </div>
        <ul className="board-line">
          <li>
            <span>G-043</span>Priya Patel
          </li>
          <li>
            <span>G-044</span>Liam Chen
          </li>
          <li>
            <span>G-045</span>Walk-in
          </li>
        </ul>
        <p className="login-pitch">
          Issue tokens, call the next person with one click, and see how long people really wait.
        </p>
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={submit} noValidate>
          <h1>{mode === 'login' ? 'Log in to your desk' : 'Create a manager account'}</h1>
          <div className="segmented" role="tablist" aria-label="Account">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => switchMode('register')}
            >
              Sign up
            </button>
          </div>

          {mode === 'register' && (
            <label className="field">
              <span>Your name</span>
              <input value={form.name} onChange={set('name')} autoComplete="name" required minLength={2} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
            {mode === 'register' && <small>At least 6 characters</small>}
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>

          {mode === 'login' && (
            <p className="hint">
              Trying it out? Run <code>npm run seed</code> and log in as <strong>demo@queue.app</strong> with
              password <strong>demo1234</strong>.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
