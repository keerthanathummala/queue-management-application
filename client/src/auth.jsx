import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, session, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(session.get()));

  const logout = useCallback(() => {
    session.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!session.get()) return;
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => logout())
      .finally(() => setChecking(false));
  }, [logout]);

  const finish = (d) => {
    session.set(d.token);
    setUser(d.user);
    return d.user;
  };

  const value = useMemo(
    () => ({
      user,
      checking,
      logout,
      login: (email, password) =>
        api('/auth/login', { method: 'POST', body: { email, password }, auth: false }).then(finish),
      register: (name, email, password) =>
        api('/auth/register', { method: 'POST', body: { name, email, password }, auth: false }).then(finish),
    }),
    [user, checking, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
