'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm({ mode, next }: { mode: 'local' | 'supabase'; next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('ben@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'local') {
        const res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
        if (!res.ok) throw new Error((await res.json()).detail ?? 'login failed');
      } else {
        const { createBrowserClient } = await import('@supabase/ssr');
        const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err || !data.session) throw new Error(err?.message ?? 'sign-in failed');
        const res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: data.session.access_token, expiresAt: new Date(data.session.expires_at! * 1000).toISOString() }) });
        if (!res.ok) throw new Error('session cookie failed');
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="text-muted">Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent" data-testid="login-email" />
      </label>
      {mode === 'supabase' && (
        <label className="block text-sm">
          <span className="text-muted">Password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent" />
        </label>
      )}
      {error && <p className="text-sm text-attention">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-60 dark:text-black" data-testid="login-submit">
        {busy ? 'Signing in…' : 'Continue'}
      </button>
    </form>
  );
}
