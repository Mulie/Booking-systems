if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.SESSION_SECRET ??= "test-session-secret-0123456789";
process.env.TOKEN_ENCRYPTION_KEY ??= "ab".repeat(32);
