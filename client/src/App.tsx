import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { api } from './api';

export default function App() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const hasJwt = await api.hasJwt();
      const hasKey = await api.hasApiKey();
      if (!hasJwt && !hasKey) {
        nav('/login', { replace: true });
      }
      setReady(true);
    })();
  }, [nav]);

  if (!ready) {
    return <div className="splash">加载中…</div>;
  }
  return (
    <div className="layout">
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
