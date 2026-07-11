import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Finora — Controle financeiro", description: "Seu dinheiro, organizado com clareza.", manifest: "/manifest.webmanifest" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
