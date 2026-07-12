import type { Metadata } from "next";
import Link from "next/link";
import { LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";
import { addSharedLedgerComment, unlockSharedLedger } from "@/app/share-actions";
import { db } from "@/lib/db";
import { addUtcMonths } from "@/lib/format";
import { sharedAccess, shareTokenHash } from "@/lib/share-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compromissos compartilhados — Finora", robots: { index: false, follow: false } };
const PAGE_SIZE = 20;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const ledgerDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });

export default async function SharedLedgerPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ erro?: string; pagina?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  const link = await db.sharedLedgerLink.findUnique({ where: { tokenHash: shareTokenHash(token) }, include: { household: { select: { name: true } } } });
  if (!link?.active) return <main className="share-shell"><section className="share-invalid"><LockKeyhole /><h1>Este compartilhamento não está disponível</h1><p>O administrador revogou o link ou o endereço não é válido.</p></section></main>;
  const access = await sharedAccess(link.id);
  if (!access) {
    const errors: Record<string, string> = { dados: "Informe seu nome e a senha de 6 números.", senha: "Senha incorreta.", bloqueado: "Muitas tentativas. Aguarde 15 minutos.", indisponivel: "Este link foi revogado." };
    return <main className="share-shell"><section className="share-unlock"><div className="share-brand"><span>F</span><b>finora</b></div><LockKeyhole /><span className="kicker">ACESSO PROTEGIDO</span><h1>Compromissos de {link.household.name}</h1><p>Identifique-se e use a senha informada pelo administrador. Você poderá visualizar e comentar, sem alterar nenhum valor.</p><form action={unlockSharedLedger.bind(null, token)}><label>Seu nome<input name="name" minLength={2} maxLength={40} placeholder="Ex.: Maria" required autoFocus /></label><label>Senha de 6 números<input name="password" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="••••••" required /></label>{query.erro && <div className="share-error">{errors[query.erro] || "Não foi possível liberar o acesso."}</div>}<button className="button primary" type="submit">Acessar compromissos</button></form><small><ShieldCheck />Acesso somente para leitura. Dados financeiros não podem ser alterados.</small></section></main>;
  }

  const nextMonth = addUtcMonths(link.month, 1);
  const where = { householdId: link.householdId, type: "EXPENSE" as const, competenceDate: { gte: link.month, lt: nextMonth }, status: { notIn: ["CANCELED", "REFUNDED"] as ("CANCELED" | "REFUNDED")[] } };
  const total = await db.transaction.count({ where });
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const requestedPage = Math.max(Number.parseInt(query.pagina || "1", 10) || 1, 1);
  const page = Math.min(requestedPage, pages);
  const transactions = await db.transaction.findMany({ where, include: { card: true, category: true, sharedComments: { where: { linkId: link.id }, orderBy: { createdAt: "asc" } } }, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });
  const totalAmount = await db.transaction.aggregate({ where, _sum: { amount: true } });
  const monthLabel = link.month.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

  return <main className="share-ledger"><header><div className="share-brand"><span>F</span><b>finora</b></div><div><span className="kicker">COMPROMISSOS COMPARTILHADOS</span><h1>Lançamentos de {monthLabel}</h1><p>{link.household.name} · acesso de {access.authorName}</p></div><aside><small>Total do mês</small><strong>{money.format(Number(totalAmount._sum.amount || 0))}</strong></aside></header><div className="share-readonly"><ShieldCheck />Você pode visualizar e comentar. Somente o administrador altera os lançamentos.</div><section className="share-table"><div className="share-table-head"><span>Lançamento</span><span>Parcelas</span><span>Data</span><span>Valor</span><span>Status</span></div>{transactions.map((item) => <article key={item.id}><div className="share-row"><span className="share-transaction"><b>{item.description}</b><small>{item.card?.name || "Sem cartão"} · {item.category?.name || "Sem categoria"}</small></span><span>{item.recurring ? "Fixo" : item.installmentCount > 1 ? `${String(item.installmentNumber).padStart(2, "0")} de ${String(item.installmentCount).padStart(2, "0")}` : "À vista"}</span><span>{ledgerDate.format(item.dueDate || item.competenceDate)}</span><strong>{money.format(Number(item.amount))}</strong><em>{statusLabel(item.status)}</em></div><div className="share-comments">{item.sharedComments.map((comment) => <p key={comment.id}><MessageCircle /><span><b>{comment.authorName}</b>{comment.message}</span><small>{comment.createdAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small></p>)}<form action={addSharedLedgerComment.bind(null, token, item.id)}><input name="message" minLength={2} maxLength={500} placeholder="Deixe uma mensagem sobre este valor…" required /><button type="submit">Comentar</button></form></div></article>)}</section>{!transactions.length && <div className="share-empty">Nenhum compromisso neste mês.</div>}<nav className="pagination" aria-label="Paginação"><Link aria-disabled={page <= 1} href={page <= 1 ? `?pagina=1` : `?pagina=${page - 1}`}>Anterior</Link><span>{page} de {pages}</span><Link aria-disabled={page >= pages} href={page >= pages ? `?pagina=${pages}` : `?pagina=${page + 1}`}>Próxima</Link></nav><footer>Compartilhamento privado Finora · o administrador pode encerrar este acesso a qualquer momento.</footer></main>;
}

function statusLabel(status: string) { return ({ PENDING: "Pendente", PLANNED: "Previsto", PAID: "Pago", OVERDUE: "Vencido", PARTIALLY_PAID: "Parcial" } as Record<string, string>)[status] || status; }
