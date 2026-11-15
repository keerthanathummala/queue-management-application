import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, session, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(session.get()));

  // True after the user clicks "Log out", so the next login starts fresh instead of
  // returning to the previous user's page. Session expiry leaves it false.
  const [signedOut, setSignedOut] = useState(false);

  const logout = useCallback(({ explicit = false } = {}) => {
    session.set(null);
    setUser(null);
    setSignedOut(explicit);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    if (!session.get()) return;
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => logout())
      .finally(() => setChecking(false));
  }, [logout]);

  const finish = (d) => {
    setSignedOut(false);
    session.set(d.token);
    setUser(d.user);
    return d.user;
  };

  const value = useMemo(
    () => ({
      user,
      checking,
      signedOut,
      logout,
      login: (email, password) =>
        api('/auth/login', { method: 'POST', body: { email, password }, auth: false }).then(finish),
      register: (name, email, password) =>
        api('/auth/register', { method: 'POST', body: { name, email, password }, auth: false }).then(finish),
    }),
    [user, checking, signedOut, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
