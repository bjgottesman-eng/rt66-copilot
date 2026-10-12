import { redirect } from 'next/navigation';
import type { MeResponse } from '@bho/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { AppShell } from '@/components/AppShell';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  let me: MeResponse;
  try {
    me = await apiFetch<MeResponse>('/v1/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    throw e;
  }
  return <AppShell me={me}>{children}</AppShell>;
}
