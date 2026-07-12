"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { money } from "@/lib/format";

type DueItem = { id: string; description: string; amount: number; dueDate: string };

export function DueDateAlerts({ items }: { items: DueItem[] }) {
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const years = useMemo(() => [...new Set(items.map((item) => new Date(item.dueDate).getUTCFullYear()))], [items]);
  useEffect(() => { Promise.all(years.map((year) => fetch(`/api/reference/holidays?year=${year}`).then((response) => response.json()).catch(() => ({ holidays: [] })))).then((results) => setHolidays(Object.fromEntries(results.flatMap((result) => (result.holidays || []).map((holiday: { date: string; name: string }) => [holiday.date, holiday.name]))))); }, [years.join(",")]);
  const alerts = items.map((item) => { const date = new Date(item.dueDate); const key = date.toISOString().slice(0, 10); const day = date.getUTCDay(); const reason = holidays[key] || (day === 0 ? "domingo" : day === 6 ? "sábado" : null); return reason ? { ...item, reason } : null; }).filter((item): item is DueItem & { reason: string } => Boolean(item)).slice(0, 5);
  if (!alerts.length) return null;
  return <section className="due-alerts"><header><CalendarClock /><span><b>Vencimentos em data não útil</b><small>Confira a regra da instituição e considere programar no dia útil anterior.</small></span></header>{alerts.map((item) => <div key={item.id}><span><b>{item.description}</b><small>{new Date(item.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })} · {item.reason}</small></span><strong>{money(item.amount)}</strong></div>)}</section>;
}
