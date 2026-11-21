import { getDb } from "../lib/db";
import { DEMO, seedDemo } from "../lib/seed";

const created = seedDemo(getDb());

if (created) {
  console.log("Seeded demo business.");
  console.log(`  Public page : /b/${DEMO.slug}`);
  console.log(`  Owner login : ${DEMO.email} / ${DEMO.password}`);
} else {
  console.log(`Demo business "${DEMO.slug}" already exists, nothing to do.`);
}
