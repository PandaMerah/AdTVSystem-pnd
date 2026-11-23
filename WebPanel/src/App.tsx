import { useState } from 'react';
import { getToken } from './api';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { PlayerPage } from './pages/PlayerPage';

export function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const pathname = window.location.pathname;

  if (pathname.startsWith('/player') || pathname.startsWith('/tv')) {
    const parts = pathname.split('/').filter(Boolean);
    const deviceIdParam = parts.length > 1 ? decodeURIComponent(parts[1]) : undefined;
    return <PlayerPage deviceIdParam={deviceIdParam} />;
  }

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
  }

  return <AdminPage onLogout={() => setAuthed(false)} />;
}
