"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, ChevronDown, Lightbulb, Send, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { money } from "@/lib/format";

type Advice = { headline: string; summary: string; riskLevel: "GREEN" | "YELLOW" | "ORANGE" | "RED" | "INCOMPLETE"; insights: { title: string; explanation: string; amount: number | null }[]; nextActions: string[]; basis: string[]; caveat: string };
type Answer = { question: string; adviceId: string; advice: Advice; snapshot: { health: string; commitmentRate: number | null; income: number; expenses: number } };

const suggestions = ["Faça um diagnóstico do meu mês", "Onde posso aliviar os próximos meses?", "Quais valores precisam de atenção primeiro?"];

export function EconomicAdvisor({ open, month, onClose }: { open: boolean; month: string; onClose: () => void }) {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const initialized = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && !initialized.current) { initialized.current = true; void ask("Faça um diagnóstico objetivo do meu mês e diga qual é a prioridade número um."); } }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [answers, loading]);
  useEffect(() => { initialized.current = false; setAnswers([]); }, [month]);

  async function ask(question = text) {
    const clean = question.trim(); if (clean.length < 4 || loading) return;
    setLoading(true); setError(""); setText("");
    try {
      const response = await fetch("/api/ai/advisor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: clean, month: month.slice(0, 7) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Não foi possível gerar a análise.");
      setAnswers((current) => [...current, { question: clean, adviceId: data.adviceId, advice: data.advice, snapshot: data.snapshot }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar a análise."); } finally { setLoading(false); }
  }

  async function review(adviceId: string, value: "HELPFUL" | "DISAGREE") {
    setFeedback((current) => ({ ...current, [adviceId]: value }));
    await fetch("/api/ai/advisor/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adviceId, feedback: value }) });
  }

  return <><button className={`advisor-backdrop ${open ? "open" : ""}`} aria-label="Fechar Conselho Econômico" tabIndex={open ? 0 : -1} onClick={onClose} /><aside className={`advisor-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
    <header className="advisor-header"><div className="advisor-orb"><span /><Sparkles /></div><div><span>FINORA INTELIGENTE</span><h2>Conselho Econômico</h2><p>Clareza para decidir, sem julgamento.</p></div><button aria-label="Fechar" onClick={onClose}><X size={18} /></button></header>
    <div className="advisor-safety"><ShieldCheck size={15} /><span>Seus cálculos vêm do banco. A IA apenas explica e organiza prioridades.</span></div>
    <div className="advisor-conversation">
      {!answers.length && !loading && <div className="advisor-welcome"><div className="advisor-orb large"><span /><Bot /></div><h3>Vamos olhar sua realidade como ela é.</h3><p>Eu uso somente os dados registrados no Finora. Se faltar renda ou alguma dívida, vou dizer claramente que a análise está incompleta.</p><div>{suggestions.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div></div>}
      {answers.map((answer) => <article className="advice-block" key={answer.adviceId}>
        <div className="user-question">{answer.question}</div>
        <div className={`health-strip ${answer.advice.riskLevel.toLowerCase()}`}><span>{riskLabel(answer.advice.riskLevel)}</span>{answer.snapshot.commitmentRate !== null && <b>{answer.snapshot.commitmentRate}% da renda comprometida</b>}{answer.advice.riskLevel === "INCOMPLETE" && <b>renda não registrada</b>}</div>
        <div className="advice-answer"><span className="ai-mark"><Sparkles size={15} /></span><div><h3>{answer.advice.headline}</h3><p>{answer.advice.summary}</p></div></div>
        <div className="insight-list">{answer.advice.insights.map((insight) => <div key={insight.title}><Lightbulb size={15} /><span><b>{insight.title}</b><p>{insight.explanation}</p></span>{insight.amount !== null && <strong>{money(insight.amount)}</strong>}</div>)}</div>
        <div className="next-actions"><span>PRÓXIMOS PASSOS</span>{answer.advice.nextActions.map((action, index) => <div key={action}><i>{index + 1}</i><p>{action}</p></div>)}</div>
        <details className="advice-basis"><summary>Como cheguei nessa análise?<ChevronDown size={15} /></summary><ul>{answer.advice.basis.map((item) => <li key={item}>{item}</li>)}</ul><p><AlertTriangle size={13} />{answer.advice.caveat}</p></details>
        <div className="advice-feedback"><span>{feedback[answer.adviceId] ? "Revisão registrada" : "Esta leitura ajudou?"}</span><button className={feedback[answer.adviceId] === "HELPFUL" ? "selected" : ""} onClick={() => review(answer.adviceId, "HELPFUL")}><ThumbsUp size={14} />Sim</button><button className={feedback[answer.adviceId] === "DISAGREE" ? "selected" : ""} onClick={() => review(answer.adviceId, "DISAGREE")}><ThumbsDown size={14} />Discordo</button></div>
      </article>)}
      {loading && <div className="advisor-thinking"><div className="advisor-orb"><span /><Sparkles /></div><span><b>Analisando seu mês…</b><small>Conferindo faturas, parcelas e próximos meses</small></span><i /><i /><i /></div>}
      {error && <div className="advisor-error"><AlertTriangle size={16} />{error}</div>}
      <div ref={endRef} />
    </div>
    <footer className="advisor-composer"><div className="advisor-shortcuts">{suggestions.slice(1).map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div><div><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} rows={2} placeholder="Pergunte sobre seu mês ou simule uma decisão…" /><button aria-label="Enviar" disabled={loading || text.trim().length < 4} onClick={() => ask()}><Send size={17} /></button></div><p><Check size={11} />Não indica investimentos nem movimenta dinheiro sem sua confirmação.</p></footer>
  </aside></>;
}

function riskLabel(level: Advice["riskLevel"]) { return ({ GREEN: "Organizado", YELLOW: "Atenção", ORANGE: "Orçamento apertado", RED: "Risco de déficit", INCOMPLETE: "Diagnóstico parcial" } as const)[level]; }
