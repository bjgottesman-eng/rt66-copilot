import { LoginForm } from '@/components/login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <div className="login-wrap">
      <LoginForm expired={params.expired === '1'} />
    </div>
  );
}
