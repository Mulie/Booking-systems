export const env = {
  get databaseUrl() {
    const v = process.env.DATABASE_URL;
    if (!v) throw new Error("DATABASE_URL is not set");
    return v;
  },
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get sessionSecret() {
    const v = process.env.SESSION_SECRET;
    if (!v || v.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
    return v;
  },
  get encryptionKey() {
    const v = process.env.TOKEN_ENCRYPTION_KEY ?? "";
    if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex chars");
    return Buffer.from(v, "hex");
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get googleConfigured() {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  },
};
