import { AUTH_MODE } from '@/lib/config';
import { LoginForm } from '@/components/LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-xs uppercase tracking-widest text-muted">Ben Health OS</p>
        <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          {AUTH_MODE === 'local'
            ? 'Local development mode: enter an email to create or open a local account. Nothing leaves this machine.'
            : 'Sign in with your Supabase Auth account.'}
        </p>
        <LoginForm mode={AUTH_MODE} next={next ?? '/today'} />
      </div>
    </main>
  );
}
