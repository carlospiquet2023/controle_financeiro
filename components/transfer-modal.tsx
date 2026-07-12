"use client";

import { useActionState, useEffect } from "react";
import { X } from "lucide-react";
import { createAccountTransfer, type ActionState } from "@/app/actions";
import { isoDate } from "@/lib/format";

export function TransferModal({ accounts, onClose }: { accounts: { id: string; name: string }[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(createAccountTransfer, {} as ActionState);
  useEffect(() => { if (state.success) window.location.reload(); }, [state.success]);
  return <div className="modal-backdrop"><section className="modal management-modal" role="dialog" aria-modal="true"><header><div><span className="kicker">MOVIMENTAÇÃO INTERNA</span><h2>Transferir entre contas</h2></div><button className="icon-button" onClick={onClose}><X /></button></header><form action={action} className="transaction-form"><div className="form-grid"><label>Conta de origem<select name="fromAccountId" required defaultValue=""><option value="">Selecione…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Conta de destino<select name="toAccountId" required defaultValue=""><option value="">Selecione…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Data<input name="transferredAt" type="date" defaultValue={isoDate(new Date())} required /></label><label className="full">Descrição<input name="description" placeholder="Ex.: Reserva mensal" /></label></div>{state.error && <p className="form-error">{state.error}</p>}<footer><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={pending}>{pending ? "Transferindo…" : "Registrar transferência"}</button></footer></form></section></div>;
}
