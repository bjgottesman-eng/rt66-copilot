import { requestJson, type HttpOptions } from '../http.js';

export interface FhirResource {
  resourceType: string;
  id?: string;
  [k: string]: unknown;
}
interface Bundle {
  resourceType: 'Bundle';
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: Array<{ resource?: FhirResource }>;
}

/** Minimal FHIR R4 REST client: read + search with `link[rel=next]` paging; every call carries the patient token. */
export class FhirClient {
  private readonly base: string;
  constructor(fhirBase: string, private readonly accessToken: string, private readonly http: HttpOptions = {}) {
    this.base = fhirBase.replace(/\/$/, '');
  }
  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.accessToken}`, accept: 'application/fhir+json' };
  }
  read<T extends FhirResource>(type: string, id: string): Promise<T> {
    return requestJson<T>(`${this.base}/${type}/${encodeURIComponent(id)}`, { headers: this.headers() }, this.http);
  }
  async searchAll(type: string, params: Record<string, string>, opts: { maxPages?: number } = {}): Promise<FhirResource[]> {
    const maxPages = opts.maxPages ?? 50;
    const u = new URL(`${this.base}/${type}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    let next: string | null = u.toString();
    const out: FhirResource[] = [];
    let pages = 0;
    while (next && pages < maxPages) {
      const bundle: Bundle = await requestJson<Bundle>(next, { headers: this.headers() }, this.http);
      for (const e of bundle.entry ?? []) if (e.resource && e.resource.resourceType === type) out.push(e.resource);
      next = bundle.link?.find((l) => l.relation === 'next')?.url ?? null;
      pages++;
    }
    return out;
  }
}
