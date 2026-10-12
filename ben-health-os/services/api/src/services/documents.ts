/**
 * Document storage (lab PDFs/CSVs, generated briefs). Bytes live on disk under DOCUMENT_STORAGE_DIR,
 * never in the database; the row keeps the sha256, size and extraction status. PDF reading uses the
 * text layer only (pdf.js); scanned PDFs yield no lines and must be transcribed manually.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tx } from '../db/pool.js';

export interface DocumentInput {
  kind: string;
  title: string;
  mimeType: string;
  bytes: Buffer;
  provider: string | null;
  documentDate: string | null;
  metadata?: Record<string, unknown>;
}

export async function storeDocument(tx: Tx, userId: string, storageDir: string, input: DocumentInput): Promise<{ id: string; sha256: string; created: boolean }> {
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const existing = await tx.query<{ id: string }>('select id from public.documents where user_id = $1 and sha256 = $2', [userId, sha256]);
  if (existing.rows[0]) return { id: existing.rows[0].id, sha256, created: false };
  const dir = join(storageDir, userId);
  await mkdir(dir, { recursive: true });
  const ext = input.mimeType === 'application/pdf' ? 'pdf' : input.mimeType === 'text/csv' ? 'csv' : 'bin';
  const fileName = `${sha256}.${ext}`;
  await writeFile(join(dir, fileName), input.bytes);
  const r = await tx.query<{ id: string }>(
    `insert into public.documents (user_id, kind, title, storage_path, mime_type, sha256, size_bytes, provider, document_date, extraction_status, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10) returning id`,
    [userId, input.kind, input.title, `${userId}/${fileName}`, input.mimeType, sha256, input.bytes.length, input.provider, input.documentDate, JSON.stringify(input.metadata ?? {})],
  );
  return { id: r.rows[0]!.id, sha256, created: true };
}

export async function readDocumentBytes(storageDir: string, storagePath: string): Promise<Buffer> {
  return readFile(join(storageDir, storagePath));
}

/** Text lines from a PDF's text layer, top to bottom, left to right (items bucketed by baseline). */
export async function extractPdfTextLines(bytes: Buffer): Promise<{ lines: string[]; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const pageCount = doc.numPages;
  const lines: string[] = [];
  try {
    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map<number, Array<{ x: number; str: string }>>();
      for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
        if (!item.str || !item.transform) continue;
        const y = Math.round(item.transform[5]! / 3) * 3;
        const row = rows.get(y) ?? [];
        row.push({ x: item.transform[4]!, str: item.str });
        rows.set(y, row);
      }
      for (const [, items] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
        const line = items.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (line) lines.push(line);
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return { lines, pageCount };
}
