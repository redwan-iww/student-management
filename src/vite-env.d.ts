/// <reference types="vite/client" />

/**
 * Supplied by the zohoProxy plugin (vite-zoho-proxy.ts). LIVE is true when the
 * OAuth credentials for the dev proxy are present, so the entries install the
 * live adapter; when it is false they install nothing and the tab says why.
 * A boolean only -- no credential ever reaches the bundle.
 */
declare module 'virtual:zoho-mode' {
  export const LIVE: boolean;
}
