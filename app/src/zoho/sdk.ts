// Minimal typing for the Zoho embedded-app SDK loaded by each HTML entry.
//
// There is no official @types package, so we declare only what we use rather
// than pretending to model the whole surface.

/**
 * PageLoad payload.
 *
 * In a `crm.detailview` widget this carries the record the widget was opened
 * from. In a `crm.webtab` it does NOT -- a web tab is a standalone page in the
 * CRM nav with no record context -- so both fields are optional and each tab
 * picks its own subject.
 */
export interface PageLoadData {
  Entity?: string;
  EntityId?: string[] | string;
  ButtonPosition?: string;
}

export interface ZohoApiResponse<T = Record<string, unknown>> {
  data?: T[];
  info?: { more_records?: boolean; count?: number };
  code?: string;
  details?: { id?: string };
  message?: string;
  status?: string;
}

interface ZohoCrmApi {
  getRecord(o: { Entity: string; RecordID: string }): Promise<ZohoApiResponse>;
  getAllRecords(o: { Entity: string; sort_by?: string; sort_order?: string; per_page?: number; page?: number }): Promise<ZohoApiResponse>;
  searchRecord(o: { Entity: string; Type: 'criteria' | 'email' | 'phone' | 'word'; Query: string; per_page?: number; page?: number }): Promise<ZohoApiResponse>;
  insertRecord(o: { Entity: string; APIData: Record<string, unknown>; Trigger?: string[] }): Promise<ZohoApiResponse>;
  updateRecord(o: { Entity: string; RecordID: string; APIData: Record<string, unknown>; Trigger?: string[] }): Promise<ZohoApiResponse>;
  deleteRecord(o: { Entity: string; RecordID: string }): Promise<ZohoApiResponse>;
}

interface ZohoGlobal {
  embeddedApp: {
    on(event: 'PageLoad', handler: (data: PageLoadData) => void): void;
    init(): Promise<void>;
  };
  CRM: { API: ZohoCrmApi };
}

declare global {
  // eslint-disable-next-line no-var
  var ZOHO: ZohoGlobal | undefined;
}

export class NotInsideCrmError extends Error {
  constructor() {
    super(
      'The Zoho SDK did not initialise. A CRM web tab only runs inside the Zoho ' +
        'CRM frame -- opening this page directly will always fail here.',
    );
    this.name = 'NotInsideCrmError';
  }
}

/** Narrow the global, or fail with an explanation rather than a TypeError. */
export function zoho(): ZohoGlobal {
  if (typeof globalThis.ZOHO === 'undefined') throw new NotInsideCrmError();
  return globalThis.ZOHO;
}

/**
 * Resolves once CRM completes its handshake.
 *
 * `init()` alone never resolves outside a CRM frame -- the parent page never
 * answers the postMessage -- so we race it against a timeout and surface a
 * useful error instead of a spinner that hangs forever.
 */
export function initTab(timeoutMs = 8000): Promise<PageLoadData> {
  return new Promise((resolve, reject) => {
    let sdk: ZohoGlobal;
    try {
      sdk = zoho();
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => reject(new NotInsideCrmError()), timeoutMs);
    const done = (data: PageLoadData) => {
      clearTimeout(timer);
      resolve(data);
    };

    sdk.embeddedApp.on('PageLoad', done);
    sdk.embeddedApp.init().catch((err: unknown) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
