export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  // vars (wrangler.jsonc)
  APP_NAME: string;
  FISCAL_YEAR_START_MONTH: string;
  REPORT_LANG: string;
  TIMEZONE: string;

  // secrets
  ALLOWED_EMAIL: string;
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_LOGIN: string;
}

export function fiscalYearStartMonth(env: Env): number {
  const n = Number.parseInt(env.FISCAL_YEAR_START_MONTH ?? "10", 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : 10;
}
