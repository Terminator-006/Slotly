import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readJson, route } from "@/lib/api";
import { requireAuth } from "@/lib/guard";
import { services } from "@/lib/schema";
import { apiService } from "@/lib/serialize";
import { serviceCreateSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { db, business } = await requireAuth(req);
  const rows = await db.select().from(services).where(eq(services.businessId, business.id)).orderBy(asc(services.createdAt));
  return NextResponse.json({ services: rows.map(apiService) });
});

export const POST = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const input = await readJson(req, serviceCreateSchema);
  const row = { id: randomUUID(), businessId: business.id, ...input, active: true, createdAt: Date.now() };
  await db.insert(services).values(row);
  return NextResponse.json({ service: apiService(row) }, { status: 201 });
});
