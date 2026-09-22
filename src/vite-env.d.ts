/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the data API. Defaults to /api (proxied to the local server). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
