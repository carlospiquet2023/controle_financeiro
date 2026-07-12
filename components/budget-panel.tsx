"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, CircleAlert, LockKeyhole, Save, UnlockKeyhole } from "lucide-react";
import { closeFinancialMonth, reopenFinancialMonth, saveMonthlyBudgets } from "@/app/actions";
import { money } from "@/lib/format";

type Category = { id: string; name: string; color: string };
type Summary = { type: string; status: string; amount: number; count: number };

export function BudgetPanel({ month, categories, budgets, actuals, summary, monthClose, unassignedCards }: { month: string; categories: Category[]; budgets: { categoryId: string; amount: number }[]; actuals: { categoryId: string | null; amount: number }[]; summary: Summary[]; monthClose: { closedAt: string; snapshot: unknown } | null; unassignedCards: number }) {
  const initial = Object.fromEntries(categories.map((category) => [category.id, String(budgets.find((item) => item.categoryId === category.id)?.amount || "")])) as Record<string, string>;
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const expense = summary.filter((item) => item.type === "EXPENSE").reduce((sum, item) => sum + item.amount, 0);
  const income = summary.filter((item) => item.type === "INCOME").reduce((sum, item) => sum + item.amount, 0);
  const paid = summary.filter((item) => item.type === "EXPENSE" && item.status === "PAID").reduce((sum, item) => sum + item.amount, 0);
  const pendingAmount = expense - paid;
  const planned = useMemo(() => Object.values(values).reduce((sum, value) => sum + (Number(value) || 0), 0), [values]);
  const uncategorized = actuals.find((item) => item.categoryId === null)?.amount || 0;
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  function save() {
    startTransition(async () => {
      const result = await saveMonthlyBudgets(month, categories.map((category) => ({ categoryId: category.id, amount: Number(values[category.id]) || 0 })));
      setMessage(result.error || "Orçamento mensal salvo.");
    });
  }
  function toggleClose() {
    startTransition(async () => {
      const result = monthClose ? await reopenFinancialMonth(month) : await closeFinancialMonth(month);
      setMessage(result.error || (monthClose ? "Mês reaberto para revisão." : "Mês fechado com um snapshot dos valores atuais."));
      if (!result.error) window.location.reload();
    });
  }

  return <div className="budget-layout">
    <section className="planning-head budget-head"><div><span className="kicker light">ORÇAMENTO DE {monthName.toUpperCase()}</span><h2>{money(planned)}</h2><p>planejados · {money(expense)} realizados</p></div><div><small>Resultado do mês</small><strong>{money(income - expense)}</strong></div></section>
    <section className="summary-grid compact-stats"><article className="stat mint"><div><p>Receita cadastrada</p><h3>{money(income)}</h3><small>Base para capacidade do mês</small></div></article><article className="stat coral"><div><p>Despesas</p><h3>{money(expense)}</h3><small>{money(pendingAmount)} ainda pendentes</small></div></article><article className="stat gold"><div><p>Orçamento disponível</p><h3>{money(planned - expense)}</h3><small>{planned ? `${Math.round((expense / planned) * 100)}% utilizado` : "Defina limites por categoria"}</small></div></article><article className="stat blue"><div><p>Situação</p><h3>{monthClose ? "Fechado" : "Em aberto"}</h3><small>{monthClose ? new Date(monthClose.closedAt).toLocaleString("pt-BR") : "Pode ser revisado"}</small></div></article></section>
    <section className="panel budget-panel"><div className="panel-heading"><div><span className="kicker">PLANEJADO × REALIZADO</span><h2>Limites por categoria</h2></div><button onClick={save} disabled={pending}><Save size={15} />Salvar orçamento</button></div><div className="budget-rows">{categories.map((category) => { const actual = actuals.find((item) => item.categoryId === category.id)?.amount || 0; const budget = Number(values[category.id]) || 0; const pct = budget ? Math.min((actual / budget) * 100, 140) : 0; return <div key={category.id}><i style={{ background: category.color }} /><span><b>{category.name}</b><small>{money(actual)} realizados</small></span><label><span>Limite mensal</span><input type="number" min="0" step="0.01" value={values[category.id] || ""} onChange={(event) => setValues((current) => ({ ...current, [category.id]: event.target.value }))} placeholder="0,00" /></label><div className={budget > 0 && actual > budget ? "over" : ""}><i><b style={{ width: `${Math.min(pct, 100)}%` }} /></i><small>{budget ? `${Math.round((actual / budget) * 100)}%` : "sem limite"}</small></div></div>; })}</div></section>
    <section className="panel close-panel"><div className="panel-heading"><div><span className="kicker">FECHAMENTO GUIADO</span><h2>Conferência de {monthName}</h2></div></div><div className="close-checks"><span className={unassignedCards ? "warning" : "done"}>{unassignedCards ? <CircleAlert /> : <Check />}<b>{unassignedCards ? `${unassignedCards} despesas sem cartão` : "Cartões conciliados"}</b></span><span className={uncategorized ? "warning" : "done"}>{uncategorized ? <CircleAlert /> : <Check />}<b>{uncategorized ? `${money(uncategorized)} sem categoria` : "Categorias revisadas"}</b></span><span className={pendingAmount ? "warning" : "done"}>{pendingAmount ? <CircleAlert /> : <Check />}<b>{pendingAmount ? `${money(pendingAmount)} ainda pendentes` : "Pagamentos do mês concluídos"}</b></span><span className={planned ? "done" : "warning"}>{planned ? <Check /> : <CircleAlert />}<b>{planned ? "Orçamento definido" : "Orçamento ainda não definido"}</b></span></div><p>O fechamento registra uma fotografia auditável. Alertas não impedem fechar, pois podem representar escolhas conscientes da família.</p><button className={`button ${monthClose ? "secondary" : "primary"}`} disabled={pending} onClick={toggleClose}>{monthClose ? <UnlockKeyhole /> : <LockKeyhole />}{pending ? "Processando…" : monthClose ? "Reabrir mês" : "Fechar mês agora"}</button>{message && <div className={message.includes("inválid") || message.includes("permissão") ? "notice danger" : "notice"}>{message}</div>}</section>
  </div>;
}
