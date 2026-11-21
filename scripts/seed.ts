import { closeDb, getDb } from "../lib/db";
import { DEMO, seedDemo } from "../lib/seed";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL (e.g. in .env.local) to seed a real database.");
    process.exit(1);
  }
  const db = await getDb();
  const created = await seedDemo(db);

  if (created) {
    console.log("Seeded demo business.");
    console.log(`  Public page : /b/${DEMO.slug}`);
    console.log(`  Owner login : ${DEMO.email} / ${DEMO.password}`);
  } else {
    console.log(`Demo business "${DEMO.slug}" already exists, nothing to do.`);
  }
  await closeDb(db);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
