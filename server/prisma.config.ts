import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/// Prisma 7 no longer reads the connection URL from schema.prisma - migration
/// and introspection commands get it from here, and the running server gets it
/// from the driver adapter in src/db.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
