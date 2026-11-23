import { useState } from 'react';
import { Tv, Lock } from 'lucide-react';
import { setToken } from '../api';

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      setToken(data.token);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-7 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-600/20 p-2.5 text-indigo-400">
            <Tv className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">AdTV Admin Panel</h1>
            <p className="text-xs text-zinc-400">Digital Signage & Kiosk OTA Control</p>
          </div>
        </div>

        {error && <div className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300">{error}</div>}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Default: admin123"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Lock className="h-4 w-4" />
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
