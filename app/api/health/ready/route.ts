import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try { await db.$queryRaw`SELECT 1`; return NextResponse.json({ status: "ok", service: "finora" }); }
  catch { return NextResponse.json({ status: "unavailable" }, { status: 503 }); }
}
