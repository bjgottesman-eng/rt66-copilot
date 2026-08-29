import type {
  BpReadingDto,
  BpSessionDto,
  BpSummaryDto,
  FreshnessDto,
  SourceStatusDto,
} from '@benhealth/shared';
import { redirect } from 'next/navigation';
import { ErrorPanel } from '@/components/error-panel';
import { LatestReadingCard } from '@/components/latest-reading-card';
import { ManualEntryForm } from '@/components/manual-entry-form';
import { ReadingHistory } from '@/components/reading-history';
import { SessionList } from '@/components/session-list';
import { TrendSection } from '@/components/trend-section';
import { WithingsCard } from '@/components/withings-card';
import { sessionPoints } from '@/lib/bp-data';
import { platformGet } from '@/lib/platform-server';

export const metadata = { title: 'Blood pressure' };

export default async function DashboardPage() {
  const now = new Date();
  const from30 = encodeURIComponent(new Date(now.getTime() - 30 * 86_400_000).toISOString());

  const [latest, summary7, summary30, sessionsRes, readingsRes, sourcesRes] = await Promise.all([
    platformGet<{ reading: BpReadingDto | null; freshness: FreshnessDto }>('/bp/latest'),
    platformGet<BpSummaryDto>('/bp/summary?window=7d'),
    platformGet<BpSummaryDto>('/bp/summary?window=30d'),
    platformGet<{ sessions: BpSessionDto[] }>(`/bp/sessions?from=${from30}`),
    platformGet<{ readings: BpReadingDto[] }>(`/bp/readings?from=${from30}&includeDuplicates=true`),
    platformGet<{ sources: SourceStatusDto[] }>('/sources'),
  ]);

  if (
    !latest.ok ||
    !summary7.ok ||
    !summary30.ok ||
    !sessionsRes.ok ||
    !readingsRes.ok ||
    !sourcesRes.ok
  ) {
    const failures = [latest, summary7, summary30, sessionsRes, readingsRes, sourcesRes].filter(
      (r) => !r.ok,
    );
    if (failures.some((f) => !f.ok && f.kind === 'unauthorized')) {
      redirect('/login?expired=1');
    }
    const first = failures[0];
    return (
      <ErrorPanel
        title="Couldn't load blood pressure data"
        message={first !== undefined && !first.ok ? first.message : 'unknown error'}
      />
    );
  }

  const sessions = sessionsRes.data.sessions;
  const points = sessionPoints(sessions);
  const chartTz =
    latest.data.reading?.measuredTz ?? sessions[0]?.readings[0]?.measuredTz ?? null;
  const withings = sourcesRes.data.sources.find((s) => s.provider === 'withings') ?? null;

  return (
    <>
      <div>
        <h1 className="page-title">Blood pressure</h1>
        <p className="page-subtitle">
          Measurement times are shown in each reading&apos;s own timezone; ingestion times are
          secondary.
        </p>
      </div>
      <div className="grid-main">
        <LatestReadingCard reading={latest.data.reading} freshness={latest.data.freshness} now={now} />
        <WithingsCard source={withings} now={now.toISOString()} />
      </div>
      <TrendSection
        points={points}
        summary7={summary7.data}
        summary30={summary30.data}
        nowMs={now.getTime()}
        tz={chartTz}
      />
      <div className="grid-main">
        <SessionList sessions={sessions} now={now} />
        <ManualEntryForm />
      </div>
      <ReadingHistory readings={readingsRes.data.readings} now={now} />
    </>
  );
}
