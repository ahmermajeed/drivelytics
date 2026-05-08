import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma client.
 *
 * Next.js dev mode hot-reloads modules on every request, which would create
 * one new PrismaClient per HMR cycle and exhaust Postgres connections within
 * minutes. Caching on `globalThis` keeps a single client across reloads in
 * development; in production a fresh module graph means a fresh client.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
