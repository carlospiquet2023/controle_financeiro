import { AuthForm } from "@/components/auth-form";

export default function SignInPage() {
  return <main className="auth-shell"><section className="auth-copy"><p className="eyebrow">FINORA · CONTROLE QUE ACOMPANHA VOCÊ</p><h1>Dinheiro claro.<br />Decisões tranquilas.</h1><p>Uma única base para cartões, contas, parcelas e valores que cada pessoa precisa devolver.</p><div className="auth-points"><span>✓ Projeção dos próximos 12 meses</span><span>✓ Cartões e contas em um só lugar</span><span>✓ Privacidade por grupo familiar</span></div></section><AuthForm /></main>;
}
