"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowDownLeft, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, CircleDollarSign, CreditCard, FileSpreadsheet, LayoutDashboard, LogOut, Plus, ReceiptText, Search, Settings, TrendingDown, UploadCloud, UserPlus, Users, WalletCards, X } from "lucide-react";
import { assignTransactionCard, cancelTransaction, logout, markPaid } from "@/app/actions";
import { money, monthLabel, shortDate } from "@/lib/format";
import { ImportPanel } from "@/components/import-panel";
import { ManagementModal } from "@/components/management-modal";
import { TransactionForm } from "@/components/transaction-form";

type View = "overview" | "transactions" | "invoices" | "accounts" | "people" | "planning" | "import" | "settings";
type ManagementKind = "card" | "account" | "person" | "category";
type Account = { id: string; name: string; openingBalance: number; color: string; institution?: string | null; type?: string };
type Card = { id: string; name: string; color: string; creditLimit: number; institution?: string | null; holder?: string | null; lastFour?: string | null; closingDay?: number | null; dueDay?: number | null };
type Category = { id: string; name: string; color: string };
type Person = { id: string; name: string; email: string | null; phone: string | null };
type Transaction = { id: string; description: string; amount: number; status: string; type: string; category: string; card: { id: string; name: string; color: string } | null; responsiblePerson: string | null; dueDate: string | null; competenceDate: string; installmentNumber: number; installmentCount: number; recurring: boolean; notes: string | null };
type ForecastItem = { amount: number; competenceDate: string };
type Receivable = { person: string; amount: number };
type ImportHistory = { id: string; fileName: string; status: string; rowCount: number; importedCount: number; total: number; createdAt: string };

type DashboardProps = { userName: string; householdName: string; selectedMonth: string; accounts: Account[]; cards: Card[]; categories: Category[]; people: Person[]; transactions: Transaction[]; forecast: ForecastItem[]; receivables: Receivable[]; imports: ImportHistory[] };

const menuItems: { id: View; label: string; short: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Central financeira", short: "Início", icon: <LayoutDashboard /> },
  { id: "invoices", label: "Faturas por cartão", short: "Faturas", icon: <CreditCard /> },
  { id: "transactions", label: "Lançamentos", short: "Lançamentos", icon: <ReceiptText /> },
  { id: "planning", label: "Próximos meses", short: "Planejar", icon: <CalendarDays /> },
  { id: "people", label: "Pessoas e acertos", short: "Pessoas", icon: <Users /> },
  { id: "accounts", label: "Contas", short: "Contas", icon: <WalletCards /> },
  { id: "import", label: "Importar e conciliar", short: "Importar", icon: <UploadCloud /> },
];

export function Dashboard(props: DashboardProps) {
  const { userName, householdName, selectedMonth, accounts, cards, categories, people, transactions, forecast, receivables, imports } = props;
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<ManagementKind | null>(null);
  const [view, setView] = useState<View>("overview");
  const month = new Date(`${selectedMonth}T12:00:00`);
  useEffect(() => { const hash = window.location.hash.replace("#", "") as View; if ([...menuItems.map(item => item.id), "settings"].includes(hash)) setView(hash); }, []);
  function navigate(next: View) { setView(next); window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${next}`); }
  function changeMonth(offset: number) { const next = new Date(month.getFullYear(), month.getMonth() + offset, 1); router.push(`/?month=${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}#${view}`); }

  const active = transactions.filter((t) => !["CANCELED", "REFUNDED"].includes(t.status));
  const expenses = active.filter((t) => t.type === "EXPENSE");
  const invoiceTotal = expenses.reduce((sum, t) => sum + t.amount, 0);
  const paid = expenses.filter((t) => t.status === "PAID").reduce((sum, t) => sum + t.amount, 0);
  const pending = invoiceTotal - paid;
  const receive = receivables.reduce((sum, item) => sum + item.amount, 0);
  const projections = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth() + index, 1);
    const total = forecast.filter((item) => { const competence = new Date(item.competenceDate); return competence.getFullYear() === date.getFullYear() && competence.getMonth() === date.getMonth(); }).reduce((sum, item) => sum + item.amount, 0);
    return { date, total };
  }), [forecast, selectedMonth]);
  const invoiceGroups = useMemo(() => {
    const groups = cards.map((card) => {
      const rows = expenses.filter((item) => item.card?.id === card.id);
      return { ...card, total: rows.reduce((sum, item) => sum + item.amount, 0), paid: rows.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.amount, 0), count: rows.length, review: false };
    });
    const unknown = expenses.filter((item) => !item.card);
    if (unknown.length) groups.push({ id: "unassigned", name: "Não identificado", color: "#64748B", creditLimit: 0, total: unknown.reduce((sum, item) => sum + item.amount, 0), paid: unknown.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.amount, 0), count: unknown.length, review: true });
    return groups.sort((a, b) => b.total - a.total);
  }, [cards, expenses]);
  const viewName = view === "overview" ? "Central financeira" : menuItems.find((item) => item.id === view)?.label || "Configurações";

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="mark">F</span><div><b>finora</b><small>{householdName}</small></div></div>
      <nav>{menuItems.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} type="button" onClick={() => navigate(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><button className={view === "settings" ? "active" : ""} type="button" onClick={() => navigate("settings")}><Settings /><span>Configurações</span></button><form action={logout}><button type="submit"><LogOut /><span>Sair</span></button></form></div>
    </aside>

    <section className="content">
      <header className="topbar">
        <div><span className="kicker">{viewName.toUpperCase()}</span><h1>{view === "overview" ? `Olá, ${userName.split(" ")[0]}` : viewName}</h1><MonthControl month={month} previous={() => changeMonth(-1)} next={() => changeMonth(1)} /></div>
        <div className="top-actions"><div className="user-badge"><span>{userName.charAt(0).toUpperCase()}</span><div><b>{userName}</b><small>Administrador da família</small></div></div><button className="button primary add-button" onClick={() => setAdding(true)}><Plus size={17} />Novo lançamento</button></div>
      </header>

      <div className="mobile-nav">{menuItems.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => navigate(item.id)}>{item.icon}<span>{item.short}</span></button>)}</div>

      {view === "overview" && <Overview month={month} total={invoiceTotal} paid={paid} pending={pending} receive={receive} transactions={expenses} groups={invoiceGroups} projections={projections.slice(0, 6)} onInvoices={() => navigate("invoices")} onTransactions={() => navigate("transactions")} onPlanning={() => navigate("planning")} onImport={() => navigate("import")} />}
      {view === "invoices" && <InvoicesView month={month} groups={invoiceGroups} total={invoiceTotal} transactions={expenses} cards={cards} />}
      {view === "transactions" && <TransactionsView transactions={active} />}
      {view === "accounts" && <AccountsView accounts={accounts} onAdd={() => setManaging("account")} />}
      {view === "people" && <PeopleView people={people} receivables={receivables} onAdd={() => setManaging("person")} />}
      {view === "planning" && <PlanningView projections={projections} />}
      {view === "import" && <ImportPanel history={imports} onImported={() => navigate("transactions")} />}
      {view === "settings" && <SettingsView categories={categories} onCategory={() => setManaging("category")} onCard={() => setManaging("card")} onAccount={() => setManaging("account")} onPerson={() => setManaging("person")} />}
    </section>

    {adding && <TransactionForm accounts={accounts} cards={cards} categories={categories} people={people} onClose={() => setAdding(false)} />}
    {managing && <ManagementModal kind={managing} onClose={() => setManaging(null)} />}
  </main>;
}

function MonthControl({ month, previous, next }: { month: Date; previous: () => void; next: () => void }) {
  return <div className="month-control"><button aria-label="Mês anterior" onClick={previous}><ArrowLeft size={14} /></button><span>{monthLabel.format(month).replace(/^./, (value) => value.toUpperCase())}</span><button aria-label="Próximo mês" onClick={next}><ArrowRight size={14} /></button></div>;
}

type InvoiceGroup = Card & { total: number; paid: number; count: number; review: boolean };
function Overview({ month, total, paid, pending, receive, transactions, groups, projections, onInvoices, onTransactions, onPlanning, onImport }: { month: Date; total: number; paid: number; pending: number; receive: number; transactions: Transaction[]; groups: InvoiceGroup[]; projections: { date: Date; total: number }[]; onInvoices: () => void; onTransactions: () => void; onPlanning: () => void; onImport: () => void }) {
  const unknown = groups.find((group) => group.review);
  const progress = total ? Math.min((paid / total) * 100, 100) : 0;
  return <>
    {unknown && <button className="attention-banner" onClick={onInvoices}><AlertCircle size={19} /><span><b>{money(unknown.total)} ainda sem cartão identificado</b><small>Revise {unknown.count} lançamento{unknown.count === 1 ? "" : "s"} para saber exatamente onde a fatura será cobrada.</small></span><ChevronRight size={18} /></button>}
    <section className="hero-balance">
      <div><span className="kicker light">TOTAL A PAGAR EM {month.toLocaleDateString("pt-BR", { month: "long" }).toUpperCase()}</span><h2>{money(total)}</h2><p>{transactions.length} compromissos distribuídos em {groups.length} grupos de pagamento.</p><div className="hero-progress"><i style={{ width: `${progress}%` }} /></div><small>{money(paid)} pagos · {money(pending)} pendentes</small></div>
      <div className="hero-actions"><button onClick={onInvoices}><CreditCard size={18} /><span><b>Ver faturas</b><small>Totais por cartão</small></span><ChevronRight /></button><button onClick={onImport}><FileSpreadsheet size={18} /><span><b>Conciliar planilha</b><small>Importação segura</small></span><ChevronRight /></button></div>
    </section>
    <section className="summary-grid compact-stats"><Stat label="Ainda falta pagar" value={money(pending)} detail={total ? `${Math.round(100 - progress)}% do mês` : "Mês sem despesas"} icon={<TrendingDown />} tone="coral" /><Stat label="Já foi pago" value={money(paid)} detail={total ? `${Math.round(progress)}% concluído` : "Nenhum pagamento"} icon={<Check />} tone="mint" /><Stat label="A receber de pessoas" value={money(receive)} detail="Acertos familiares em aberto" icon={<ArrowDownLeft />} tone="gold" /><Stat label="Próximo mês" value={money(projections[1]?.total || 0)} detail="Parcelas e fixos previstos" icon={<CalendarDays />} tone="blue" /></section>
    <section className="overview-grid"><div className="panel"><PanelHeading eyebrow="FATURAS" title="Quanto pagar em cada cartão" action="Ver detalhes" onAction={onInvoices} /><div className="invoice-quick-list">{groups.slice(0, 6).map((group) => <div key={group.id}><i style={{ background: group.color }} /><span><b>{group.name}</b><small>{group.count ? `${group.count} lançamento${group.count === 1 ? "" : "s"}` : "Sem compras neste mês"}</small></span><strong>{money(group.total)}</strong></div>)}</div></div><div className="panel"><PanelHeading eyebrow="PREVISÃO" title="Pressão dos próximos meses" action="Ver 12 meses" onAction={onPlanning} /><ForecastChart projections={projections} /><p className="chart-note">Soma prevista em 6 meses: <b>{money(projections.reduce((sum, item) => sum + item.total, 0))}</b></p></div></section>
    <section className="panel"><PanelHeading eyebrow="COMPROMISSOS" title="Lançamentos deste mês" action="Ver todos" onAction={onTransactions} /><TransactionList transactions={transactions.slice(0, 8)} empty="Nenhum compromisso neste mês." /></section>
  </>;
}

function InvoicesView({ month, groups, total, transactions, cards }: { month: Date; groups: InvoiceGroup[]; total: number; transactions: Transaction[]; cards: Card[] }) {
  const unassigned = transactions.filter((item) => !item.card);
  return <><section className="page-intro"><div><span className="kicker">CONCILIAÇÃO MENSAL</span><h2>{money(total)} para pagar em {month.toLocaleDateString("pt-BR", { month: "long" })}</h2><p>A fatura é o valor das compras do mês. Limite de crédito aparece apenas como informação secundária quando cadastrado.</p></div></section><section className="invoice-grid">{groups.map((group) => { const pending = group.total - group.paid; const limitPct = group.creditLimit ? Math.min((group.total / group.creditLimit) * 100, 100) : 0; return <article className={`invoice-card ${group.review ? "needs-review" : ""}`} key={group.id} style={{ "--card-color": group.color } as React.CSSProperties}><div className="invoice-card-top"><span className="card-mark"><CreditCard size={19} /></span>{group.review && <em><AlertCircle size={13} />Revisar</em>}<small>{group.lastFour ? `final ${group.lastFour}` : group.institution || "Fatura mensal"}</small></div><span className="invoice-label">TOTAL DA FATURA</span><h3>{money(group.total)}</h3><div className="invoice-meta"><span><small>Pago</small><b>{money(group.paid)}</b></span><span><small>Pendente</small><b>{money(pending)}</b></span><span><small>Compras</small><b>{group.count}</b></span></div>{group.creditLimit > 0 && <div className="limit-info"><div><span>Uso do limite</span><b>{money(group.creditLimit)}</b></div><i><span style={{ width: `${limitPct}%` }} /></i></div>}{group.dueDay && <p className="due-copy">Vence todo dia {group.dueDay}</p>}</article>; })}</section>{unassigned.length > 0 && <UnassignedReview transactions={unassigned} cards={cards} />}</>;
}

function UnassignedReview({ transactions, cards }: { transactions: Transaction[]; cards: Card[] }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [selected, setSelected] = useState<Record<string, string>>({}); const [message, setMessage] = useState("");
  function assign(id: string) { const cardId = selected[id]; if (!cardId) return setMessage("Escolha o cartão antes de associar."); startTransition(async () => { const result = await assignTransactionCard(id, cardId); setMessage(result.error || "Cartão associado. Os totais foram recalculados."); router.refresh(); }); }
  return <section className="panel review-panel"><PanelHeading eyebrow="PRECISA DE ATENÇÃO" title="Descobrir em qual cartão foi cobrado" /><p>Esses lançamentos vieram do grupo “não sei qual cartão usou”. Associe quando conferir a fatura.</p><div className="review-list">{transactions.map((item) => <div key={item.id}><span><b>{item.description}</b><small>{item.notes || "Sem observação"}</small></span><strong>{money(item.amount)}</strong><select value={selected[item.id] || ""} onChange={(event) => setSelected((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">Escolher cartão…</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select><button disabled={pending || !selected[item.id]} onClick={() => assign(item.id)}>Associar</button></div>)}</div>{message && <div className="notice"><Check size={15} />{message}</div>}</section>;
}

function TransactionsView({ transactions }: { transactions: Transaction[] }) {
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("ALL");
  const filtered = transactions.filter((item) => (status === "ALL" || item.status === status) && `${item.description} ${item.category} ${item.card?.name || ""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  return <section className="panel full-panel"><div className="list-toolbar"><div><span className="kicker">MOVIMENTOS</span><h2>{filtered.length} lançamentos encontrados</h2></div><div className="filters"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar descrição, cartão…" /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Todos os status</option><option value="PENDING">Pendentes</option><option value="PLANNED">Previstos</option><option value="PAID">Pagos</option></select></div></div><TransactionList transactions={filtered} empty="Nenhum lançamento corresponde aos filtros." detailed /></section>;
}

function AccountsView({ accounts, onAdd }: { accounts: Account[]; onAdd: () => void }) { return <section className="panel full-panel"><PanelHeading eyebrow="CONTAS" title="Onde o dinheiro está" action="Adicionar conta" onAction={onAdd} /><div className="entity-grid">{accounts.length ? accounts.map((account) => <article className="entity-card" key={account.id}><i style={{ background: account.color }}><WalletCards /></i><div><b>{account.name}</b><small>{account.institution || accountType(account.type)}</small></div><span><small>Saldo inicial</small><strong>{money(account.openingBalance)}</strong></span></article>) : <EmptyAction text="Nenhuma conta cadastrada" detail="Cadastre a conta usada para pagar suas faturas." action="Adicionar primeira conta" onAction={onAdd} />}</div></section>; }

function PeopleView({ people, receivables, onAdd }: { people: Person[]; receivables: Receivable[]; onAdd: () => void }) { return <section className="panel full-panel"><PanelHeading eyebrow="FAMÍLIA" title="Pessoas e acertos" action="Adicionar pessoa" onAction={onAdd} /><div className="entity-grid">{people.length ? people.map((person) => { const amount = receivables.filter((item) => item.person === person.name).reduce((sum, item) => sum + item.amount, 0); return <article className="entity-card person-card" key={person.id}><i><Users /></i><div><b>{person.name}</b><small>{person.email || person.phone || "Sem contato"}</small></div><span><small>A devolver</small><strong>{money(amount)}</strong></span></article>; }) : <EmptyAction text="Nenhuma pessoa cadastrada" detail="Associe compras a familiares e acompanhe quem precisa devolver." action="Adicionar primeira pessoa" onAction={onAdd} />}</div></section>; }

function PlanningView({ projections }: { projections: { date: Date; total: number }[] }) { const total = projections.reduce((sum, item) => sum + item.total, 0); const average = total / projections.length; return <><section className="planning-head"><div><span className="kicker light">VISÃO DE 12 MESES</span><h2>{money(total)}</h2><p>já comprometidos em parcelas e despesas recorrentes</p></div><div><small>Média mensal prevista</small><strong>{money(average)}</strong></div></section><section className="panel planning-panel"><PanelHeading eyebrow="CALENDÁRIO FINANCEIRO" title="Pressão mensal dos compromissos" /><ForecastChart projections={projections} large /><div className="month-ledger">{projections.map((item) => <div key={item.date.toISOString()}><span>{item.date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span><strong>{money(item.total)}</strong><i style={{ width: `${Math.max((item.total / Math.max(...projections.map((entry) => entry.total), 1)) * 100, item.total ? 2 : 0)}%` }} /></div>)}</div></section></>; }

function SettingsView({ categories, onCategory, onCard, onAccount, onPerson }: { categories: Category[]; onCategory: () => void; onCard: () => void; onAccount: () => void; onPerson: () => void }) { return <section className="settings-grid"><div className="panel"><PanelHeading eyebrow="ORGANIZAÇÃO" title="Categorias" action="Nova categoria" onAction={onCategory} /><div className="category-list">{categories.map((item) => <span key={item.id}><i style={{ background: item.color }} />{item.name}</span>)}</div></div><div className="panel"><PanelHeading eyebrow="CADASTROS" title="Estrutura da família" /><div className="settings-actions"><button onClick={onCard}><CreditCard /><span><b>Novo cartão</b><small>Nome, cor, vencimento e limite</small></span><ChevronRight /></button><button onClick={onAccount}><WalletCards /><span><b>Nova conta</b><small>Conta usada nos pagamentos</small></span><ChevronRight /></button><button onClick={onPerson}><UserPlus /><span><b>Nova pessoa</b><small>Responsáveis e valores a devolver</small></span><ChevronRight /></button></div></div><div className="panel system-panel"><PanelHeading eyebrow="INFRAESTRUTURA" title="Proteções ativas" /><div className="system-list"><span><Check />PostgreSQL Railway <b>Ativo</b></span><span><Check />Originais no Cloudflare R2 <b>Ativo</b></span><span><Check />Assistente Groq com confirmação <b>Ativo</b></span><span><Check />Trilha de auditoria e isolamento familiar <b>Ativo</b></span></div></div></section>; }

function TransactionList({ transactions, empty, detailed = false }: { transactions: Transaction[]; empty: string; detailed?: boolean }) { return transactions.length ? <div className="transaction-list">{transactions.map((item) => <div className={`transaction-row ${item.status === "CANCELED" ? "canceled" : ""}`} key={item.id}><span className="transaction-icon" style={{ background: item.card?.color || "#E2E8F0", color: item.card ? "#fff" : "#475569" }}>{item.card ? <CreditCard size={17} /> : <CircleDollarSign size={17} />}</span><div className="transaction-title"><b>{item.description}</b><small>{item.card?.name || "Sem cartão"} · {item.category}{item.responsiblePerson ? ` · ${item.responsiblePerson}` : ""}</small></div>{detailed && <span className="installment">{item.recurring ? "Fixo" : item.installmentCount > 1 ? `${item.installmentNumber}/${item.installmentCount}` : "À vista"}</span>}<span className="due">{item.dueDate ? `Vence ${shortDate.format(new Date(item.dueDate))}` : shortDate.format(new Date(item.competenceDate))}</span><strong>{money(item.amount)}</strong><span className={`status ${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span><div className="row-actions">{!["PAID", "CANCELED"].includes(item.status) && <button className="pay-button" onClick={() => markPaid(item.id)}><Check size={13} />Pago</button>}{item.status !== "CANCELED" && <button className="cancel-button" title="Cancelar lançamento" onClick={() => cancelTransaction(item.id)}><X size={14} /></button>}</div></div>)}</div> : <div className="empty">{empty}</div>; }

function ForecastChart({ projections, large = false }: { projections: { date: Date; total: number }[]; large?: boolean }) { const max = Math.max(...projections.map((item) => item.total), 1); return <div className={`forecast-bars ${large ? "large" : ""}`}>{projections.map((item) => <div key={item.date.toISOString()}><span>{money(item.total)}</span><i><b style={{ height: `${Math.max((item.total / max) * 100, item.total ? 3 : 0)}%` }} /></i><small>{item.date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></div>)}</div>; }
function PanelHeading({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) { return <div className="panel-heading"><div><span className="kicker">{eyebrow}</span><h2>{title}</h2></div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} /></button>}</div>; }
function Stat({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: string }) { return <article className={`stat ${tone}`}><span className="stat-icon">{icon}</span><div><p>{label}</p><h3>{value}</h3><small>{detail}</small></div></article>; }
function EmptyAction({ text, detail, action, onAction }: { text: string; detail: string; action: string; onAction: () => void }) { return <div className="empty-action"><span><Plus /></span><b>{text}</b><p>{detail}</p><button className="button secondary" onClick={onAction}>{action}</button></div>; }
function statusLabel(status: string) { return ({ PENDING: "Pendente", PLANNED: "Previsto", PAID: "Pago", OVERDUE: "Vencido", PARTIALLY_PAID: "Parcial", CANCELED: "Cancelado" } as Record<string, string>)[status] || status; }
function accountType(type?: string) { return ({ CASH: "Dinheiro", CHECKING: "Conta corrente", SAVINGS: "Poupança", DIGITAL_WALLET: "Carteira digital", PIX: "PIX", OTHER: "Outra conta" } as Record<string, string>)[type || ""] || "Conta"; }
