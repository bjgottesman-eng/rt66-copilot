import { AiResponseSchema, type AiFinding, type AnalysisPacket } from '@bho/contracts';

export const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(you (have|are suffering from|suffer from)|diagnos(is|e|ed|tic)\b.*\b(of|with|as)|consistent with a diagnosis|indicates? (that you have|a diagnosis))\b/i, reason: 'diagnostic claim' },
  { re: /\b(stop|discontinue|skip|double|halve|increase|decrease|reduce|taper|adjust)\b[^.]{0,60}\b(dose|dosage|medication|medications|prescription|statin|tablet|pill)s?\b/i, reason: 'medication change' },
  { re: /\b(call 911|emergency room|go to the er|heart attack|stroke|life[- ]threatening|medical emergency)\b/i, reason: 'unsupported emergency claim' },
  { re: /\b(is caused by|was caused by|causes your|causing your|proves? that)\b/i, reason: 'causal claim' },
];

export interface ValidationResult {
  summary: string | null;
  accepted: AiFinding[];
  rejected: Array<{ title: string; reason: string }>;
  physicianQuestions: string[];
  providerMeta: Record<string, unknown>;
}

export function forbiddenReason(text: string): string | null {
  for (const p of FORBIDDEN_PATTERNS) if (p.re.test(text)) return p.reason;
  return null;
}

/** Validator v1: structure, citations against the packet, forbidden phrasing. Uncited or unsafe findings never reach the user. */
export function validateAiResponse(raw: unknown, packet: AnalysisPacket): ValidationResult {
  const parsed = AiResponseSchema.safeParse(raw);
  if (!parsed.success) return { summary: null, accepted: [], rejected: [{ title: 'response', reason: `malformed response: ${parsed.error.issues[0]?.message ?? 'schema'}` }], physicianQuestions: [], providerMeta: {} };
  const ids = new Set(packet.items.map((i) => i.id));
  const accepted: AiFinding[] = [];
  const rejected: Array<{ title: string; reason: string }> = [];
  for (const f of parsed.data.findings) {
    const valid = f.citations.filter((c) => ids.has(c));
    if (valid.length === 0) {
      rejected.push({ title: f.title, reason: 'no valid packet citation' });
      continue;
    }
    const bad = forbiddenReason(`${f.title}. ${f.text}. ${f.proposedAction ?? ''}`);
    if (bad) {
      rejected.push({ title: f.title, reason: bad });
      continue;
    }
    accepted.push({ ...f, citations: valid });
  }
  const summaryReason = forbiddenReason(parsed.data.summary);
  const summary = summaryReason ? `[summary withheld by the validator: ${summaryReason}]` : parsed.data.summary;
  const physicianQuestions = parsed.data.physicianQuestions.filter((q) => !forbiddenReason(q));
  return { summary, accepted, rejected, physicianQuestions, providerMeta: parsed.data.providerMeta };
}
