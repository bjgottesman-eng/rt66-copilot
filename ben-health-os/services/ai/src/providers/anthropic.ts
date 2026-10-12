import type { AnalysisPacket } from '@bho/contracts';
import type { AiProvider } from './types.js';

/**
 * Anthropic Messages API adapter (server-side key, structured output via a forced tool call).
 * TESTED only against a local mock of the endpoint; live use is BLOCKED BY CREDENTIALS (ANTHROPIC_API_KEY).
 */
export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  apiBase?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

const SUBMIT_TOOL = {
  name: 'submit_analysis',
  description: 'Submit the analysis of the packet. Every finding must cite packet item ids.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'findings', 'physicianQuestions'],
    properties: {
      summary: { type: 'string', description: 'Plain-language summary, at most 4000 characters, no diagnoses.' },
      findings: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['claimType', 'title', 'text', 'citations', 'confidence', 'category'],
          properties: {
            claimType: { type: 'string', enum: ['DERIVED_TREND', 'HYPOTHESIS', 'RECOMMENDATION'] },
            title: { type: 'string' },
            text: { type: 'string' },
            citations: { type: 'array', items: { type: 'string' }, minItems: 1 },
            confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
            category: { type: 'string' },
            proposedAction: { type: 'string' },
            expectedBenefit: { type: 'string' },
            limitations: { type: 'string' },
            clinicianReview: { type: 'boolean' },
          },
        },
      },
      physicianQuestions: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    },
  },
};

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  constructor(private readonly cfg: AnthropicProviderConfig) {
    this.model = cfg.model;
  }

  async analyze(packet: AnalysisPacket): Promise<unknown> {
    const base = (this.cfg.apiBase ?? 'https://api.anthropic.com').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 90_000);
    try {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.cfg.maxTokens ?? 4000,
          system: packet.instructions.join('\n'),
          tools: [SUBMIT_TOOL],
          tool_choice: { type: 'tool', name: 'submit_analysis' },
          messages: [{ role: 'user', content: `Analysis packet (JSON):\n${JSON.stringify({ ...packet, instructions: undefined })}` }],
        }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { content?: Array<{ type: string; name?: string; input?: unknown }>; error?: { message?: string }; model?: string; usage?: unknown };
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${body.error?.message ?? 'request failed'}`);
      const tool = body.content?.find((c) => c.type === 'tool_use' && c.name === 'submit_analysis');
      if (!tool) throw new Error('anthropic response did not call submit_analysis');
      const input = (tool.input ?? {}) as Record<string, unknown>;
      return { ...input, providerMeta: { provider: 'anthropic', model: body.model ?? this.model, usage: body.usage ?? null } };
    } finally {
      clearTimeout(timer);
    }
  }
}
