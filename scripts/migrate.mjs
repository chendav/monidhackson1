import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("database_migration_failed: DATABASE_URL is not configured");
  process.exit(1);
}

try {
  const db = drizzle(neon(databaseUrl));
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("database_migration_succeeded");
} catch {
  // Database errors can include connection credentials or statement contents.
  // Keep CI/deployment logs intentionally terse and inspect failures locally.
  console.error("database_migration_failed");
  process.exit(1);
}
