export interface Env {
  CONTROL_DB: D1Database;
  DATA_DB: D1Database;
  ENVIRONMENT: "development" | "staging" | "beta" | "production";
  AUTH_MODE: "development" | "oauth";
  PUBLIC_ORIGIN: string;
  DATA_RETENTION_MODE: "until_user_deletes";
  AUTH0_DOMAIN?: string;
  AUTH0_AUDIENCE?: string;
  AUTH0_CLIENT_ID?: string;
  AUTH0_CLIENT_SECRET?: string;
  DATA_ENCRYPTION_KEY?: string;
  OPENAI_APPS_CHALLENGE?: string;
  EXPORTS: R2Bucket;
  DERIVED_QUEUE: Queue;
  ACCOUNT_LIFECYCLE: Workflow<import("../operations/cloudflare-lifecycle").AccountWorkflowParams>;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}
