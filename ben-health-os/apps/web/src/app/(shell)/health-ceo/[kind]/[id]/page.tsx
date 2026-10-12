import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Report } from '@bho/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { ReportView } from '@/components/ReportView';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== 'weekly' && kind !== 'monthly') notFound();
  let report: Report;
  try {
    report = await apiFetch<Report>(`/v1/reports/${kind}/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader title={kind === 'weekly' ? 'Weekly Health CEO report' : 'Monthly Health Board report'} subtitle={`${report.periodFrom} → ${report.periodTo}`}>
        <Link href="/health-ceo" className="rounded-lg border border-line px-3 py-1 text-sm text-muted">All reports</Link>
      </PageHeader>
      <ReportView report={report} />
    </>
  );
}
