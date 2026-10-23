// Project-specific VITE_* variables; `vite/client` (tsconfig "types") supplies ImportMeta itself.
interface ImportMetaEnv {
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_RUN_ID?: string;
  readonly VITE_BUILD_TIME?: string;
  readonly VITE_GOATCOUNTER_CODE?: string;
  readonly VITE_REPO_URL?: string;
}
