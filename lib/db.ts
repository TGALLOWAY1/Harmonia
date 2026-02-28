import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };
const connectionString = process.env.DATABASE_URL || "file:./dev.db";
const providerFromEnv = process.env.DATABASE_PROVIDER?.toLowerCase();
const resolvedProvider =
  providerFromEnv ||
  (connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://")
    ? "postgresql"
    : "sqlite");

function createPrismaClient(): PrismaClient {
  if (resolvedProvider === "postgresql") {
    try {
      // Use runtime require so local SQLite setups don't require pg adapter installation.
      const { PrismaPg } = require("@prisma/adapter-pg") as {
        PrismaPg: new (args: { connectionString: string }) => any;
      };
      const adapter = new PrismaPg({ connectionString });
      return new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      });
    } catch {
      throw new Error(
        "DATABASE_PROVIDER=postgresql requires @prisma/adapter-pg. Install it with `npm i @prisma/adapter-pg`."
      );
    }
  }

  const adapter = new PrismaBetterSqlite3({ url: connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
