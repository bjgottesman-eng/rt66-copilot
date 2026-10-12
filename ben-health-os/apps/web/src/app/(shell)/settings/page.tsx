import type { AiStatus, MeResponse, NotificationPrefs } from '@bho/contracts';
import { CONNECTORS } from '@bho/shared-config';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { SettingsForms } from '@/components/SettingsForms';
import { NotificationPrefsForm } from '@/components/NotificationPrefsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const me = await apiFetch<MeResponse>('/v1/me');
  const exported = await apiFetch<{ profile: { ai_sharing: { enabled: boolean; excludedConnectors: string[] } } }>('/v1/me/export');
  const prefs = await apiFetch<NotificationPrefs>('/v1/notifications/prefs');
  const ai = await apiFetch<AiStatus>('/v1/ai/status');
  return (
    <>
      <PageHeader title="Settings" subtitle={`Signed in as ${me.email ?? me.userId} · auth mode: ${me.authMode}`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <SettingsForms me={me} aiSharing={exported.profile.ai_sharing} />
        <div className="space-y-5">
        <NotificationPrefsForm prefs={prefs} />
        <Card>
          <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold">AI provider</h2><Chip tone={ai.status === 'CONFIGURED' ? 'good' : ai.status === 'MOCK' ? 'watch' : 'neutral'}>{ai.status.replace(/_/g, ' ').toLowerCase()}</Chip></div>
          <p className="mt-1 text-xs text-muted">{ai.note}</p>
          <p className="mt-1 text-xs text-muted">Provider: {ai.provider}{ai.model ? ` (${ai.model})` : ''}. Packets contain measured facts and derived trends with provenance; raw records, documents and excluded connectors never leave the server. The validator rejects any finding without citations or with diagnostic, medication-change, emergency or causal wording.</p>
        </Card>
        <Card>
          <h2 className="text-base font-semibold">Implementation status</h2>
          <p className="mt-1 text-xs text-muted">Honest per-connector status. Nothing is presented as working unless it has been tested.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {CONNECTORS.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span>{c.displayName} <span className="text-xs text-muted">· phase {c.phase}</span></span>
                <Chip tone={c.implementationStatus === 'NOT_IMPLEMENTED' ? 'neutral' : c.implementationStatus === 'BLOCKED_BY_CREDENTIALS' ? 'watch' : 'good'}>{c.implementationStatus.replace(/_/g, ' ').toLowerCase()}</Chip>
              </li>
            ))}
          </ul>
        </Card>
        </div>
      </div>
    </>
  );
}
