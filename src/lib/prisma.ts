import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// The schema uses the `queryCompiler` preview feature, so the client talks to
// Postgres through a driver adapter instead of the Rust query engine. That
// keeps cold starts small on Lambda/Fargate and removes the native binary from
// the Docker image.
//
// To go back to the classic engine: drop `previewFeatures` from schema.prisma
// and replace the body below with `new PrismaClient()`.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// RDS (and most managed Postgres) requires SSL; local dev Postgres usually
// doesn't have it configured at all, so only turn it on for non-local hosts.
// AWS RDS server certs chain to a root already in Node's trust store, so
// this verifies normally -- no need to relax certificate checking.
const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalDb ? false : true,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
