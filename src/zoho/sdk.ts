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

/**
 * Why the handshake did not complete. The two causes look identical on screen
 * but need opposite fixes, so they are kept apart:
 *
 * - 'no-sdk'      the ZOHO global is absent -- the SDK <script> never loaded
 *                 (blocked, offline, or the page opened outside any frame).
 * - 'no-response' the SDK loaded and we called init(), but the parent never
 *                 answered. That is what a plain Web Tab does: only a
 *                 registered widget gets the postMessage handshake.
 * - 'unframed'    the page is its own top window, so there is no parent at all.
 */
export type HandshakeFailure = 'no-sdk' | 'no-response' | 'unframed';

export class NotInsideCrmError extends Error {
  readonly reason: HandshakeFailure;
  readonly waitedMs: number;

  constructor(reason: HandshakeFailure, waitedMs = 0) {
    super(NotInsideCrmError.describe(reason));
    this.name = 'NotInsideCrmError';
    this.reason = reason;
    this.waitedMs = waitedMs;
  }

  static describe(reason: HandshakeFailure): string {
    switch (reason) {
      case 'no-sdk':
        return 'The Zoho SDK script did not load, so there is no ZOHO global to call.';
      case 'unframed':
        return 'This page is not inside a frame, so there is no CRM parent to hand it context.';
      case 'no-response':
        return 'The SDK loaded and init() was called, but the CRM parent never answered.';
    }
  }
}

/** Narrow the global, or fail with an explanation rather than a TypeError. */
export function zoho(): ZohoGlobal {
  if (typeof globalThis.ZOHO === 'undefined') throw new NotInsideCrmError('no-sdk');
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

    // Unframed is knowable immediately -- no need to burn the full timeout.
    if (window.self === window.top) {
      reject(new NotInsideCrmError('unframed'));
      return;
    }

    const startedAt = Date.now();
    const timer = setTimeout(
      () => reject(new NotInsideCrmError('no-response', Date.now() - startedAt)),
      timeoutMs,
    );
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
