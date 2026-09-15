import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { dbSslConfig } from "./db-ssl";

// The schema uses the `queryCompiler` preview feature, so the client talks to
// Postgres through a driver adapter instead of the Rust query engine. That
// keeps cold starts small on Lambda/Fargate and removes the native binary from
// the Docker image.
//
// To go back to the classic engine: drop `previewFeatures` from schema.prisma
// and replace the body below with `new PrismaClient()`.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ssl: dbSslConfig(process.env.DATABASE_URL),
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
