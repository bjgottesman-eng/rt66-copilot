import type { DomainStatus, MetricCard } from '@bho/contracts';
import { metricById } from '@bho/shared-config';

/**
 * Domain status from its metric cards. Transparent rules, no composite score:
 *  NOT_CONNECTED      every metric is NOT_CONNECTED
 *  INSUFFICIENT_DATA  no metric has a baseline comparison with evidence
 *  ATTENTION          any MEANINGFUL change in the unfavourable direction
 *  WATCH              any DIRECTIONAL change in the unfavourable direction (and nothing worse)
 *  IMPROVING          at least one MEANINGFUL favourable change and nothing unfavourable
 *  STEADY             otherwise
 */
export function domainStatus(cards: MetricCard[]): { status: DomainStatus; evidence: string[] } {
  if (cards.length === 0) return { status: 'INSUFFICIENT_DATA', evidence: ['No metrics configured for this domain yet.'] };
  if (cards.every((c) => c.freshness.status === 'NOT_CONNECTED')) return { status: 'NOT_CONNECTED', evidence: ['No connected source for this domain.'] };
  const evidence: string[] = [];
  let worseMeaningful = false;
  let worseDirectional = false;
  let betterMeaningful = false;
  let anyEvidence = false;
  for (const c of cards) {
    const cmp = c.comparison;
    if (!cmp || cmp.changeClass === 'INSUFFICIENT_EVIDENCE' || cmp.delta === null) continue;
    anyEvidence = true;
    const def = metricById(c.metricId);
    if (!def || def.direction === 'neutral' || def.direction === 'target_range') {
      if (cmp.changeClass === 'MEANINGFUL') evidence.push(`${c.label}: ${cmp.explanation}`);
      continue;
    }
    const favourable = def.direction === 'higher_better' ? cmp.delta > 0 : cmp.delta < 0;
    if (cmp.changeClass === 'MEANINGFUL') {
      evidence.push(`${c.label}: ${cmp.explanation}`);
      if (favourable) betterMeaningful = true;
      else worseMeaningful = true;
    } else if (cmp.changeClass === 'DIRECTIONAL' && !favourable) {
      worseDirectional = true;
      evidence.push(`${c.label}: ${cmp.explanation}`);
    }
  }
  if (!anyEvidence) return { status: 'INSUFFICIENT_DATA', evidence: ['Not enough days of data yet for a baseline comparison.'] };
  if (worseMeaningful) return { status: 'ATTENTION', evidence };
  if (worseDirectional) return { status: 'WATCH', evidence };
  if (betterMeaningful) return { status: 'IMPROVING', evidence };
  return { status: 'STEADY', evidence: evidence.length ? evidence : ['All compared metrics are within normal variation.'] };
}
