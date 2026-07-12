import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Ano inválido." }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`, { signal: controller.signal, next: { revalidate: 604_800 } });
    if (!response.ok) throw new Error("Calendário indisponível.");
    const holidays = await response.json() as { date: string; name: string; type?: string }[];
    return NextResponse.json({ holidays: holidays.map(({ date, name }) => ({ date, name })), source: "BrasilAPI" }, { headers: { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" } });
  } catch {
    return NextResponse.json({ holidays: [], source: null, warning: "Feriados nacionais temporariamente indisponíveis." }, { status: 200 });
  } finally {
    clearTimeout(timeout);
  }
}
