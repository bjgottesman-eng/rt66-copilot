import type { AnalysisPacket } from '@bho/contracts';

/** A provider turns a packet into a raw response object; the validator decides what is shown. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  analyze(packet: AnalysisPacket): Promise<unknown>;
}
