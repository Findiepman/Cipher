import 'dotenv/config';

// Must be set before anything imports src/env.ts.
process.env.NODE_ENV = 'test';

// These tests TRUNCATE every table between cases, so they must never run
// against the development database. Point at a dedicated one and refuse to
// start if it looks like the dev DB.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://messenger:messenger@localhost:5432/messenger_test?schema=public';

if (!/messenger_test|_test\b|\btest\b/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `Refusing to run tests against ${process.env.DATABASE_URL} - the database ` +
      'name must identify it as a test database. Set TEST_DATABASE_URL.',
  );
}

// A weak secret is fine here and nowhere else; env.ts only requires length.
process.env.JWT_SECRET ??= 'test-secret-value-that-is-long-enough-to-pass';

// Keep lockout thresholds predictable regardless of what .env says.
process.env.MAX_FAILED_LOGINS = '3';
process.env.LOCKOUT_MINUTES = '15';
