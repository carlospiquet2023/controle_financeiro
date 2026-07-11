"use client";

import { useMemo, useState } from "react";
import { Bell, CalendarDays, ChevronRight, CircleDollarSign, CreditCard, FileSpreadsheet, LayoutDashboard, LogOut, MoreHorizontal, Plus, ReceiptText, Settings, UploadCloud, Users, WalletCards } from "lucide-react";
import { logout, markPaid } from "@/app/actions";
import { money, monthLabel, shortDate } from "@/lib/format";
import { ImportPanel } from "@/components/import-panel";
import { TransactionForm } from "@/components/transaction-form";

type View = "overview" | "transactions" | "accounts" | "people" | "planning" | "import" | "settings";

type Account = { id: string; name: string; openingBalance: number; color: string; institution?: string | null; type?: string };
type Card = { id: string; name: string; color: string; creditLimit: number; institution?: string | null; holder?: string | null; lastFour?: string | null };
type Category = { id: string; name: string };
type Person = { id: string; name: string; email: string | null; phone: string | null };
type Transaction = { id: string; description: string; amount: number; status: string; category: string; card: { name: string; color: string } | null; responsiblePerson: string | null; dueDate: string | null; competenceDate: string };
type ForecastItem = { amount: number; competenceDate: string };
type Receivable = { person: string; amount: number };

type DashboardProps = {
  userName: string;
  accounts: Account[];
  cards: Card[];
  categories: Category[];
  people: Person[];
  transactions: Transaction[];
  forecast: ForecastItem[];
  receivables: Receivable[];
};

const menuItems: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Visão geral", icon: <LayoutDashboard /> },
  { id: "transactions", label: "Lançamentos", icon: <ReceiptText /> },
  { id: "accounts", label: "Contas e cartões", icon: <WalletCards /> },
  { id: "people", label: "Pessoas", icon: <Users /> },
  { id: "planning", label: "Planejamento", icon: <CalendarDays /> },
  { id: "import", label: "Importar planilha", icon: <UploadCloud /> },
];

const viewTitle: Record<View, string> = {
  overview: "Visão geral",
  transactions: "Lançamentos",
  accounts: "Contas e cartões",
  people: "Pessoas",
  planning: "Planejamento",
  import: "Importar planilha",
  settings: "Configurações",
};

export function Dashboard({ userName, accounts, cards, categories, people, transactions, forecast, receivables }: DashboardProps) {
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<View>("overview");
  const month = new Date();
  const expenses = transactions.filter((t) => t.status !== "CANCELED" && t.status !== "REFUNDED").reduce((sum, t) => sum + t.amount, 0);
  const paid = transactions.filter((t) => t.status === "PAID").reduce((sum, t) => sum + t.amount, 0);
  const receive = receivables.reduce((sum, item) => sum + item.amount, 0);
  const projections = useMemo(() => Array.from({ length: view === "planning" ? 12 : 6 }, (_, i) => {
    const date = new Date(month.getFullYear(), month.getMonth() + i, 1);
    const total = forecast.filter((t) => {
      const competence = new Date(t.competenceDate);
      return competence.getFullYear() === date.getFullYear() && competence.getMonth() === date.getMonth();
    }).reduce((sum, t) => sum + t.amount, 0);
    return { date, total };
  }), [forecast, view]);
  const maxProjection = Math.max(...projections.map((p) => p.total), 1);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="mark">F</span><span>finora</span></div>
        <nav>
          {menuItems.map((item) => (
            <button className={view === item.id ? "active" : ""} key={item.id} type="button" onClick={() => setView(item.id)}>
              {item.icon}{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className={view === "settings" ? "active" : ""} type="button" onClick={() => setView("settings")}><Settings />Configurações</button>
          <form action={logout}><button type="submit"><LogOut />Sair</button></form>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{viewTitle[view].toUpperCase()}</p>
            <h1>{view === "overview" ? <>Olá, {userName.split(" ")[0]} <span>👋</span></> : viewTitle[view]}</h1>
            <p className="muted">{monthLabel.format(month).replace(/^./, (v) => v.toUpperCase())} · Seu panorama financeiro</p>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notificações"><Bell size={19} /><i /></button>
            <button className="avatar">{userName.slice(0, 1).toUpperCase()}</button>
            <button className="button primary add-button" onClick={() => setAdding(true)}><Plus size={18} />Novo lançamento</button>
          </div>
        </header>

        {view === "overview" && <Overview expenses={expenses} paid={paid} receive={receive} cards={cards} receivables={receivables} transactions={transactions} projections={projections} maxProjection={maxProjection} onPlanning={() => setView("planning")} onTransactions={() => setView("transactions")} />}
        {view === "transactions" && <TransactionsView transactions={transactions} />}
        {view === "accounts" && <AccountsView accounts={accounts} cards={cards} transactions={transactions} />}
        {view === "people" && <PeopleView people={people} receivables={receivables} />}
        {view === "planning" && <PlanningView projections={projections} maxProjection={maxProjection} />}
        {view === "import" && <ImportPanel onImported={() => setView("transactions")} />}
        {view === "settings" && <SettingsView categories={categories} />}
      </section>

      {adding && <TransactionForm accounts={accounts} cards={cards} categories={categories} onClose={() => setAdding(false)} />}
    </main>
  );
}

function Overview({ expenses, paid, receive, cards, receivables, transactions, projections, maxProjection, onPlanning, onTransactions }: { expenses: number; paid: number; receive: number; cards: Card[]; receivables: Receivable[]; transactions: Transaction[]; projections: { date: Date; total: number }[]; maxProjection: number; onPlanning: () => void; onTransactions: () => void }) {
  return (
    <>
      <section className="summary-grid">
        <Stat label="Comprometido este mês" value={money(expenses)} detail={`${transactions.length} lançamentos`} trend="base" icon={<ReceiptText />} />
        <Stat label="Já foi pago" value={money(paid)} detail={expenses ? `${Math.round((paid / expenses) * 100)}% do mês` : "Sem pagamentos"} trend="positive" icon={<CircleDollarSign />} />
        <Stat label="A receber" value={money(receive)} detail={`${receivables.length} pessoa${receivables.length === 1 ? "" : "s"} pendente${receivables.length === 1 ? "" : "s"}`} trend="accent" icon={<Users />} />
        <Stat label="Cartões ativos" value={String(cards.length)} detail="Acompanhe limites e faturas" trend="neutral" icon={<CreditCard />} />
      </section>
      <section className="main-grid">
        <ForecastPanel projections={projections} maxProjection={maxProjection} onPlanning={onPlanning} />
        <CardsPanel cards={cards} transactions={transactions} />
      </section>
      <section className="panel transactions">
        <div className="panel-header">
          <div><h2>Próximos lançamentos</h2><p>O que vence ou está previsto neste mês</p></div>
          <button className="text-button" onClick={onTransactions}>Ver todos <ChevronRight size={16} /></button>
        </div>
        <TransactionList transactions={transactions} empty="Nada previsto neste mês. Crie seu primeiro lançamento." />
      </section>
    </>
  );
}

function TransactionsView({ transactions }: { transactions: Transaction[] }) {
  return (
    <section className="panel transactions full-panel">
      <div className="panel-header"><div><h2>Todos os lançamentos do mês</h2><p>Valores previstos, pendentes e pagos.</p></div></div>
      <TransactionList transactions={transactions} empty="Nenhum lançamento encontrado neste mês." />
    </section>
  );
}

function AccountsView({ accounts, cards, transactions }: { accounts: Account[]; cards: Card[]; transactions: Transaction[] }) {
  return (
    <section className="management-grid">
      <div className="panel">
        <div className="panel-header"><div><h2>Contas</h2><p>Base de pagamento e saldo inicial.</p></div></div>
        <div className="simple-list">{accounts.length ? accounts.map((account) => <SimpleRow key={account.id} title={account.name} detail={account.institution || account.type || "Conta"} value={money(account.openingBalance)} color={account.color} />) : <Empty text="Nenhuma conta cadastrada." />}</div>
      </div>
      <div className="panel">
        <div className="panel-header"><div><h2>Cartões</h2><p>Limite, titular e faturas planejadas.</p></div><button className="icon-button"><MoreHorizontal size={18} /></button></div>
        <CardsPanel cards={cards} transactions={transactions} compact />
      </div>
    </section>
  );
}

function PeopleView({ people, receivables }: { people: Person[]; receivables: Receivable[] }) {
  return (
    <section className="panel full-panel">
      <div className="panel-header"><div><h2>Pessoas</h2><p>Responsáveis e valores que ainda precisam devolver.</p></div></div>
      <div className="simple-list">{people.length ? people.map((person) => {
        const receivable = receivables.find((item) => item.person === person.name)?.amount || 0;
        return <SimpleRow key={person.id} title={person.name} detail={person.email || person.phone || "Sem contato"} value={money(receivable)} color="#F59E0B" />;
      }) : <Empty text="Nenhuma pessoa cadastrada." />}</div>
    </section>
  );
}

function PlanningView({ projections, maxProjection }: { projections: { date: Date; total: number }[]; maxProjection: number }) {
  return (
    <section className="panel forecast full-panel">
      <div className="panel-header"><div><h2>Próximos 12 meses</h2><p>Parcelas e despesas já planejadas.</p></div></div>
      <Chart projections={projections} maxProjection={maxProjection} />
      <div className="forecast-note"><span>✦</span><p>Nos próximos 12 meses, você já tem <b>{money(projections.reduce((a, p) => a + p.total, 0))}</b> comprometidos.</p></div>
    </section>
  );
}

function SettingsView({ categories }: { categories: Category[] }) {
  return (
    <section className="management-grid">
      <div className="panel">
        <div className="panel-header"><div><h2>Categorias</h2><p>Usadas em lançamentos e importações.</p></div></div>
        <div className="chip-list">{categories.length ? categories.map((category) => <span key={category.id}>{category.name}</span>) : <Empty text="Categorias serão criadas automaticamente na primeira importação." />}</div>
      </div>
      <div className="panel">
        <div className="panel-header"><div><h2>Produção</h2><p>Aplicação conectada ao banco PostgreSQL e R2 para arquivos.</p></div></div>
        <div className="simple-list">
          <SimpleRow title="Banco principal" detail="Railway PostgreSQL" value="Ativo" color="#10B981" />
          <SimpleRow title="Arquivos" detail="Cloudflare R2" value="Ativo" color="#F97316" />
          <SimpleRow title="IA" detail="Groq" value="Ativo" color="#6366F1" />
        </div>
      </div>
    </section>
  );
}

function ForecastPanel({ projections, maxProjection, onPlanning }: { projections: { date: Date; total: number }[]; maxProjection: number; onPlanning: () => void }) {
  return (
    <div className="panel forecast">
      <div className="panel-header">
        <div><h2>Compromissos futuros</h2><p>Parcelas e despesas previstas</p></div>
        <button className="text-button" onClick={onPlanning}>Ver 12 meses <ChevronRight size={16} /></button>
      </div>
      <Chart projections={projections} maxProjection={maxProjection} />
      <div className="forecast-note"><span>✦</span><p>Nos próximos 6 meses, você já tem <b>{money(projections.reduce((a, p) => a + p.total, 0))}</b> comprometidos.</p></div>
    </div>
  );
}

function Chart({ projections, maxProjection }: { projections: { date: Date; total: number }[]; maxProjection: number }) {
  return (
    <div className="chart">
      {projections.map((p, i) => (
        <div className="bar-wrap" key={i}>
          <strong>{money(p.total)}</strong>
          <div className="bar-track"><div className="bar" style={{ height: `${Math.max((p.total / maxProjection) * 100, p.total ? 8 : 2)}%` }} /></div>
          <span>{p.date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span>
        </div>
      ))}
    </div>
  );
}

function CardsPanel({ cards, transactions, compact = false }: { cards: Card[]; transactions: Transaction[]; compact?: boolean }) {
  if (!cards.length) return <Empty text="Cadastre seus cartões para acompanhar faturas." />;
  return (
    <div className={compact ? "cards-list compact" : ""}>
      {cards.slice(0, compact ? 10 : 4).map((card) => {
        const used = transactions.filter((t) => t.card?.name === card.name && t.status !== "PAID").reduce((sum, t) => sum + t.amount, 0);
        const pct = card.creditLimit ? Math.min((used / card.creditLimit) * 100, 100) : 0;
        return (
          <div className="card-row" key={card.id}>
            <span className="card-symbol" style={{ background: card.color }}><CreditCard size={16} /></span>
            <div><b>{card.name}</b><small>{card.creditLimit ? `${money(used)} de ${money(card.creditLimit)}` : "Limite não informado"}</small></div>
            <div className="mini-progress"><i style={{ width: `${pct}%`, background: card.color }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function TransactionList({ transactions, empty }: { transactions: Transaction[]; empty: string }) {
  return transactions.length ? (
    <div className="transaction-list">
      {transactions.map((t) => (
        <div className="transaction-row" key={t.id}>
          <span className="transaction-icon" style={{ background: t.card?.color || "#E8EEFF" }}>{t.card ? <CreditCard size={18} /> : <WalletCards size={18} />}</span>
          <div className="transaction-title"><b>{t.description}</b><small>{t.category}{t.responsiblePerson ? ` · ${t.responsiblePerson}` : ""}</small></div>
          <span className="due">{t.dueDate ? `Vence ${shortDate.format(new Date(t.dueDate))}` : shortDate.format(new Date(t.competenceDate))}</span>
          <strong>{money(t.amount)}</strong>
          <span className={`status ${t.status.toLowerCase()}`}>{statusLabel(t.status)}</span>
          {t.status !== "PAID" && <button className="pay-button" onClick={() => markPaid(t.id)}>Marcar pago</button>}
        </div>
      ))}
    </div>
  ) : <Empty text={empty} />;
}

function Stat({ label, value, detail, trend, icon }: { label: string; value: string; detail: string; trend: string; icon: React.ReactNode }) {
  return <article className={`stat ${trend}`}><div className="stat-icon">{icon}</div><p>{label}</p><h2>{value}</h2><small>{detail}</small></article>;
}

function SimpleRow({ title, detail, value, color }: { title: string; detail: string; value: string; color: string }) {
  return <div className="simple-row"><span style={{ background: color }} /><div><b>{title}</b><small>{detail}</small></div><strong>{value}</strong></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function statusLabel(status: string) {
  return ({ PENDING: "Pendente", PLANNED: "Previsto", PAID: "Pago", OVERDUE: "Vencido", PARTIALLY_PAID: "Parcial" } as Record<string, string>)[status] || status;
}
