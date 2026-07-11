"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createAccount, createCard, createCategory, createPerson, type ActionState } from "@/app/actions";

type Kind = "card" | "account" | "person" | "category";
const initial: ActionState = {};

export function ManagementModal({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const action = kind === "card" ? createCard : kind === "account" ? createAccount : kind === "person" ? createPerson : createCategory;
  const [state, formAction, pending] = useActionState(action, initial);
  const router = useRouter();
  useEffect(() => { if (state.success) { router.refresh(); onClose(); } }, [state.success, onClose, router]);
  const title = ({ card: "Novo cartão", account: "Nova conta", person: "Nova pessoa", category: "Nova categoria" } as const)[kind];
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal management-modal">
    <header><div><span className="kicker">CADASTRO</span><h2>{title}</h2></div><button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}><X size={18} /></button></header>
    <form action={formAction} className="transaction-form"><div className="form-grid">
      {kind === "card" && <>
        <label>Nome do cartão<input name="name" required autoFocus placeholder="Ex.: Casa Bahia" /></label>
        <label>Instituição<input name="institution" placeholder="Ex.: Bradescard" /></label>
        <label>Titular<input name="holder" placeholder="Nome do titular" /></label>
        <label>Final do cartão<input name="lastFour" inputMode="numeric" maxLength={4} placeholder="0000" /></label>
        <label>Limite de crédito<input name="creditLimit" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <label>Cor de identificação<input name="color" type="color" defaultValue="#5269E8" /></label>
        <label>Dia de fechamento<input name="closingDay" type="number" min="1" max="31" placeholder="Opcional" /></label>
        <label>Dia de vencimento<input name="dueDay" type="number" min="1" max="31" placeholder="Opcional" /></label>
      </>}
      {kind === "account" && <>
        <label>Nome da conta<input name="name" required autoFocus placeholder="Ex.: Conta principal" /></label>
        <label>Instituição<input name="institution" placeholder="Banco ou carteira" /></label>
        <label>Tipo<select name="type" defaultValue="CHECKING"><option value="CHECKING">Conta corrente</option><option value="SAVINGS">Poupança</option><option value="DIGITAL_WALLET">Carteira digital</option><option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="OTHER">Outra</option></select></label>
        <label>Saldo inicial<input name="openingBalance" type="number" step="0.01" defaultValue="0" /></label>
        <label>Cor<input name="color" type="color" defaultValue="#0F766E" /></label>
      </>}
      {kind === "person" && <>
        <label>Nome<input name="name" required autoFocus placeholder="Quem participa da despesa?" /></label>
        <label>E-mail<input name="email" type="email" placeholder="Opcional" /></label>
        <label>Telefone<input name="phone" placeholder="Opcional" /></label>
      </>}
      {kind === "category" && <>
        <label>Nome<input name="name" required autoFocus placeholder="Ex.: Moradia" /></label>
        <label>Cor<input name="color" type="color" defaultValue="#5269E8" /></label>
      </>}
    </div>{state.error && <p className="form-error">{state.error}</p>}<footer><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button></footer></form>
  </section></div>;
}
