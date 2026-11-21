import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readJson, route } from "@/lib/api";
import { insertRow, NO_ID } from "@/lib/db";
import { requireAuth } from "@/lib/guard";
import type { Service } from "@/lib/schema";
import { apiService } from "@/lib/serialize";
import { serviceCreateSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { db, business } = await requireAuth(req);
  const rows = await db.services.find({ businessId: business.id }, NO_ID).sort({ createdAt: 1 }).toArray();
  return NextResponse.json({ services: rows.map(apiService) });
});

export const POST = route(async (req) => {
  const { db, business } = await requireAuth(req, ["owner"]);
  const input = await readJson(req, serviceCreateSchema);
  const row: Service = { id: randomUUID(), businessId: business.id, ...input, active: true, createdAt: Date.now() };
  await insertRow(db.services, row);
  return NextResponse.json({ service: apiService(row) }, { status: 201 });
});
