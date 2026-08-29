import type { FreshnessDto } from '@benhealth/shared';
import { freshnessExplanation, freshnessTone } from '@/lib/freshness-ui';

/**
 * Freshness pill: the exact FreshnessStatus string in a subtly toned chip,
 * with the plain-language explanation on hover (title) and for screen
 * readers. Never says "live".
 */
export function FreshnessPill({ freshness }: { freshness: FreshnessDto }) {
  const tone = freshnessTone(freshness.status);
  const explanation = freshnessExplanation(freshness);
  return (
    <span className={`pill pill-${tone}`} title={explanation}>
      {freshness.status}
      <span className="visually-hidden">. {explanation}</span>
    </span>
  );
}
