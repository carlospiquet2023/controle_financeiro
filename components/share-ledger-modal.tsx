"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Link2, ShieldCheck, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSharedLedgerLink, revokeSharedLedgerLink } from "@/app/share-actions";

type ShareLink = { id: string; createdAt: string };

export function ShareLedgerModal({ month, links, onClose }: { month: string; links: ShareLink[]; onClose: () => void }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  function createLink() {
    startTransition(async () => {
      setMessage("");
      const result = await createSharedLedgerLink(month, password);
      if (result.error || !result.path) return setMessage(result.error || "Não foi possível gerar o link.");
      setUrl(`${window.location.origin}${result.path}`); setPassword(""); router.refresh();
    });
  }
  function revoke(id: string) {
    startTransition(async () => {
      const result = await revokeSharedLedgerLink(id);
      setMessage(result.error || "Link revogado. O acesso foi encerrado imediatamente.");
      if (!result.error) { setUrl(""); router.refresh(); }
    });
  }
  async function copy() { if (!url) return; await navigator.clipboard.writeText(url); setCopied(true); }
  return <div className="modal-backdrop"><section className="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title"><header><div><span className="kicker">ACESSO PARA A FAMÍLIA</span><h2 id="share-title">Compartilhar compromissos</h2><p>{monthName} · somente visualização e comentários</p></div><button aria-label="Fechar" onClick={onClose}><X size={18} /></button></header><div className="share-modal-safety"><ShieldCheck /><span><b>A dívida continua sob controle do administrador.</b><small>Quem receber o link não pode editar, pagar, cancelar ou excluir lançamentos.</small></span></div><div className="share-create"><label>Crie uma senha de 6 números<input value={password} onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" placeholder="Ex.: 415263" /></label><button className="button primary" disabled={pending || password.length !== 6} onClick={createLink}><Link2 />Gerar URL protegida</button></div>{url && <div className="generated-share"><span><Check />Link criado — copie e envie para sua esposa</span><div><input readOnly value={url} /><button onClick={copy}><Copy />{copied ? "Copiado" : "Copiar"}</button></div><small>Por segurança, esta URL completa é exibida somente agora. Se perder, revogue e gere outra.</small></div>}<div className="active-shares"><b>Links ativos para este mês</b>{links.length ? links.map((link) => <div key={link.id}><span><Link2 /><small>Criado em {new Date(link.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small></span><button disabled={pending} onClick={() => revoke(link.id)}><Trash2 />Revogar</button></div>) : <p>Nenhum link ativo.</p>}</div>{message && <div className={message.startsWith("Link revogado") ? "notice" : "notice danger"}>{message}</div>}</section></div>;
}
