import type { AnalysisPacket } from '@bho/contracts';
import type { AiProvider } from './types.js';

/** Deterministic provider for tests and demo mode: restates packet trends as hypotheses with citations. */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'mock-v1';
  constructor(private readonly opts: { includeInvalid?: boolean } = {}) {}

  async analyze(packet: AnalysisPacket): Promise<unknown> {
    const trends = packet.items.filter((i) => i.kind === 'trend' && (i.data.changeClass === 'MEANINGFUL' || i.data.changeClass === 'DIRECTIONAL'));
    const unfavourable = trends.filter((t) => t.data.favourable === false || (t.data.metricId === 'sleep_duration' && Number(t.data.delta) < 0)).slice(0, 3);
    const favourable = trends.filter((t) => t.data.favourable === true).slice(0, 1);
    const findings: unknown[] = unfavourable.map((t) => ({
      claimType: 'HYPOTHESIS',
      title: `${String(t.data.label)} moved unfavourably versus the 28-day baseline`,
      text: `${t.text} This is an observation about the period, not an explanation; routine changes, travel or illness are plausible contexts worth checking.`,
      citations: [t.id],
      confidence: t.data.changeClass === 'MEANINGFUL' ? 'MEDIUM' : 'LOW',
      category: String(t.domain),
      limitations: 'Derived from a 7-day window; correlation only.',
      clinicianReview: false,
    }));
    for (const t of favourable) findings.push({ claimType: 'RECOMMENDATION', title: `Keep what is working for ${String(t.data.label).toLowerCase()}`, text: `${t.text} Keeping the current routine for another week would show whether the improvement holds.`, citations: [t.id], confidence: 'LOW', category: String(t.domain), proposedAction: 'Hold the current routine for 7 more days and re-check the 7-day mean.', expectedBenefit: 'Confirms whether the favourable change is stable.', limitations: 'One favourable week is not a trend.', clinicianReview: false });
    const flaggedLabs = packet.items.filter((i) => i.kind === 'lab' && i.data.flagged === true);
    const physicianQuestions = flaggedLabs.slice(0, 3).map((l) => `The laboratory flagged ${String(l.data.label)} (${String(l.data.abnormalFlag ?? 'outside range')}) on ${String(l.data.collectedAt ?? 'the latest panel')}: how should it be followed up?`);
    if (this.opts.includeInvalid) {
      findings.push({ claimType: 'RECOMMENDATION', title: 'Uncited claim', text: 'Something without evidence.', citations: ['nope:1'], confidence: 'HIGH', category: 'test' });
      findings.push({ claimType: 'RECOMMENDATION', title: 'Unsafe claim', text: 'You should stop taking your statin medication.', citations: [packet.items[0]?.id ?? 'x'], confidence: 'HIGH', category: 'test' });
    }
    return {
      summary: `Mock provider: ${packet.items.length} packet items, ${trends.length} metric(s) changed versus baseline, ${flaggedLabs.length} lab-flagged value(s). Domain statuses: ${packet.domainStatuses.map((d) => `${d.domain} ${d.status}`).join(', ')}.`,
      findings,
      physicianQuestions,
      providerMeta: { mock: true, packetHash: packet.hash },
    };
  }
}
