export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://sectortraders:sectortraders@localhost:5432/sectortraders",
  // Daily reset schedule (cron) and the timezone it runs in.
  resetCron: process.env.RESET_CRON ?? "0 0 * * *",
  resetTz: process.env.TZ ?? "America/New_York",
  // Set to true behind HTTPS so session cookies are marked Secure.
  secureCookies: process.env.SECURE_COOKIES === "true",
  webDir: process.env.WEB_DIR ?? "",
};
