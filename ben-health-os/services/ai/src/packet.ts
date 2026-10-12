import { createHash } from 'node:crypto';
import type { AnalysisPacket, PacketItem } from '@bho/contracts';
import { AI_INSTRUCTIONS } from './instructions.js';

export interface PacketInputs {
  kind: AnalysisPacket['kind'];
  generatedAt: string;
  period: AnalysisPacket['period'];
  timeZone: string;
  subject: AnalysisPacket['subject'];
  sharing: { enabled: boolean; excludedConnectors: string[] };
  items: PacketItem[];
  domainStatuses: AnalysisPacket['domainStatuses'];
  dataQuality: AnalysisPacket['dataQuality'];
}

/** Drops every item that carries data from an excluded connector (ADR 0006: Oura API data by default). */
export function applySharingControls(items: PacketItem[], excludedConnectors: string[]): { items: PacketItem[]; dropped: number } {
  const excluded = new Set(excludedConnectors);
  const kept = items.filter((i) => !i.sources.some((s) => excluded.has(s)));
  return { items: kept, dropped: items.length - kept.length };
}

export function packetHash(items: PacketItem[], period: AnalysisPacket['period'], kind: string): string {
  return createHash('sha256').update(JSON.stringify({ kind, period, items: items.map((i) => [i.id, i.text, i.data]) })).digest('hex').slice(0, 32);
}

/**
 * Assembles a packet. With `forProvider` the sharing controls are applied (the packet must not leave
 * the server unless `sharing.enabled`); without it the full packet feeds the local rules engine and
 * reports. Items keep their ids in both cases so citations stay valid.
 */
export function assemblePacket(input: PacketInputs, opts: { forProvider: boolean }): AnalysisPacket {
  const { items, dropped } = opts.forProvider ? applySharingControls(input.items, input.sharing.excludedConnectors) : { items: input.items, dropped: 0 };
  return {
    packetVersion: 1,
    generatedAt: input.generatedAt,
    kind: input.kind,
    period: input.period,
    timeZone: input.timeZone,
    subject: input.subject,
    sharing: { enabled: input.sharing.enabled, excludedConnectors: input.sharing.excludedConnectors, droppedItems: dropped },
    items,
    domainStatuses: input.domainStatuses,
    dataQuality: input.dataQuality,
    instructions: AI_INSTRUCTIONS,
    hash: packetHash(items, input.period, input.kind),
  };
}

export function itemsOfKind(packet: AnalysisPacket, kind: string): PacketItem[] {
  return packet.items.filter((i) => i.kind === kind);
}

export function findItem(packet: AnalysisPacket, id: string): PacketItem | undefined {
  return packet.items.find((i) => i.id === id);
}
