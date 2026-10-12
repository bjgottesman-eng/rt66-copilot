'use client';
import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch('/api/session', { method: 'DELETE' });
        router.push('/login');
        router.refresh();
      }}
      className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-ink"
    >
      Sign out
    </button>
  );
}
