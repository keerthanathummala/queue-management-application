import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import QueuesPage from './pages/QueuesPage.jsx';
import QueuePage from './pages/QueuePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

function RequireAuth({ children }) {
  const { user, checking, signedOut } = useAuth();
  const location = useLocation();
  if (checking) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={signedOut ? undefined : { from: location.pathname }} />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<QueuesPage />} />
        <Route path="queues/:id" element={<QueuePage />} />
        <Route path="dashboard" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
