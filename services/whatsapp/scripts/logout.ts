import { prisma } from "../../../lib/prisma";

/**
 * Clear the persisted Baileys auth state (forces re-pair on next worker
 * start). Run with `npm run whatsapp:logout`.
 *
 * The worker MUST be stopped first — clearing rows out from under a live
 * connection will cause Baileys to fail in confusing ways.
 */

const NAMESPACE = process.env.WA_AUTH_NAMESPACE || "default";

async function main(): Promise<void> {
  const result = await prisma.whatsAppAuth.deleteMany({
    where: { key: { startsWith: `${NAMESPACE}/` } },
  });
  console.log(
    `Cleared ${result.count} auth row(s) for namespace "${NAMESPACE}".`
  );
  console.log("Next `npm run whatsapp` will show a fresh QR.");
}

main()
  .catch((e) => {
    console.error("Logout failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
