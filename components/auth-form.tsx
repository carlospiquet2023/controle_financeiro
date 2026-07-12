"use client";
import { useActionState, useState } from "react";
import { authenticate } from "@/app/actions";

export function AuthForm() {
  const [state, action, pending] = useActionState(authenticate, { error: undefined });
  const [creating, setCreating] = useState(false);
  return <section className="auth-card"><div className="mark">F</div><h2>{creating ? "Crie seu espaço" : "Bem-vindo de volta"}</h2><p>{creating ? "Seu grupo financeiro ficará separado e protegido." : "Entre para consultar seu panorama financeiro."}</p>
    <form action={action}>{creating && <label>Seu nome<input name="name" placeholder="Como podemos chamar você?" required /></label>}<label>E-mail<input name="email" type="email" autoComplete="email" placeholder="voce@email.com" required /></label><label>Senha<input name="password" type="password" autoComplete={creating ? "new-password" : "current-password"} minLength={10} placeholder="Mínimo de 10 caracteres" required /></label>{state.error && <p className="form-error">{state.error}</p>}<button className="button primary" disabled={pending}>{pending ? "Aguarde…" : creating ? "Criar conta segura" : "Entrar"}</button></form>
    <button className="link-button" onClick={() => setCreating(!creating)}>{creating ? "Já tenho uma conta" : "Primeiro acesso? Criar conta"}</button><footer className="auth-credit">Criado e desenvolvido por <b>Carlao Antonio de Oliveira Piquet</b><span>© 2026 · Todos os direitos reservados</span></footer></section>;
}
