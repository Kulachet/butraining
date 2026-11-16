/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAS_TH_URL?: string;
  readonly VITE_GAS_EN_URL?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
