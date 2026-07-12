import { NextResponse } from "next/server";
import { getEconomicIndicators } from "@/lib/economic-indicators";

export async function GET() {
  try {
    const indicators = await getEconomicIndicators();
    if (!indicators.length) return NextResponse.json({ error: "As referências do Banco Central estão temporariamente indisponíveis." }, { status: 503 });
    return NextResponse.json({ indicators }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return NextResponse.json({ error: "As referências do Banco Central estão temporariamente indisponíveis." }, { status: 503 });
  }
}
