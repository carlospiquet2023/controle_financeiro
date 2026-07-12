import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finora — Controle financeiro",
  description: "Seu dinheiro, organizado com clareza.",
  applicationName: "Finora",
  authors: [{ name: "Carlao Antonio de Oliveira Piquet", url: "mailto:carlos.piquet2016@gmail.com" }],
  creator: "Carlao Antonio de Oliveira Piquet",
  publisher: "Carlao Antonio de Oliveira Piquet",
  manifest: "/manifest.webmanifest",
  other: { copyright: "Copyright © 2026 Carlao Antonio de Oliveira Piquet. Todos os direitos reservados.", owner: "Carlao Antonio de Oliveira Piquet" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body><a className="skip-link" href="#main-content">Pular para o conteúdo</a>{children}</body></html>; }
