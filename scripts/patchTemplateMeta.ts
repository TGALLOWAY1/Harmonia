/**
 * One-time patch: canonicalize CardTemplate meta keys for reliable filtering.
 * - Adds keyRoot when meta has root but not keyRoot
 * - Adds keyType when meta has type but not keyType (for scale/key cards)
 * Safe: only updates CardTemplate.meta; never touches CardState or CardAttempt.
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const templates = await prisma.cardTemplate.findMany();
  let patched = 0;

  for (const t of templates) {
    if (!t.meta || typeof t.meta !== "object") continue;

    const meta = t.meta as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    // Add keyRoot if root exists but keyRoot missing
    if (typeof meta.root === "string" && typeof meta.keyRoot !== "string") {
      updates.keyRoot = meta.root;
    }
    // Add keyType if type exists but keyType missing (for scale/key cards)
    if (typeof meta.type === "string" && typeof meta.keyType !== "string") {
      updates.keyType = meta.type;
    }

    if (Object.keys(updates).length === 0) continue;

    const newMeta = { ...meta, ...updates };
    await prisma.cardTemplate.update({
      where: { id: t.id },
      data: { meta: newMeta as any },
    });
    patched++;
  }

  console.log(`Patched ${patched} templates.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
