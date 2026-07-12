"use client";

import { useActionState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { changePassword, type ActionState } from "@/app/actions";

export function SecurityPanel() {
  const [state, action, pending] = useActionState(changePassword, {} as ActionState);
  return <div className="panel security-panel"><div className="panel-heading"><div><span className="kicker">SEGURANÇA</span><h2>Senha e sessões</h2></div><ShieldCheck /></div><p>A nova senha é comparada anonimamente com bases de vazamentos. Ao alterar, todas as sessões são encerradas.</p><form action={action}><label>Senha atual<input name="currentPassword" type="password" minLength={10} autoComplete="current-password" required /></label><label>Nova senha<input name="newPassword" type="password" minLength={12} autoComplete="new-password" required /></label>{state.error && <p className="form-error">{state.error}</p>}<button className="button secondary" disabled={pending}><KeyRound />{pending ? "Atualizando…" : "Alterar senha"}</button></form></div>;
}
