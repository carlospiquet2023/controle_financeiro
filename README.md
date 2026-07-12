# Finora

Central financeira familiar para organizar compromissos mensais, cartões, contas, orçamento, dívidas, acertos entre pessoas, documentos e contexto econômico. O produto também possui módulos opcionais de Open Finance, OCR e Central IVA.

> Criado, titularizado e desenvolvido por Carlao Antonio de Oliveira Piquet — carlos.piquet2016@gmail.com

Copyright © 2026 Carlao Antonio de Oliveira Piquet. Software proprietário; consulte [LICENSE](./LICENSE), [NOTICE.md](./NOTICE.md) e [AUTHORS.md](./AUTHORS.md).

## O que está implementado

- cadastro e login com sessão persistida, e-mail normalizado, bloqueio após tentativas, consulta de senha vazada por k-anonymity e troca de senha com encerramento das sessões;
- dashboard mensal, faturas, lançamentos paginados, parcelas, recorrências, receitas, pagamentos, cancelamentos e auditoria;
- orçamento por categoria, planejado × realizado e snapshot de fechamento mensal;
- cartões, contas com saldo corrente calculado, transferências internas, categorias e pessoas;
- divisão de despesas, pagamentos parciais e baixa/dispensa de valores a receber;
- Central de Dívidas com saldo, pagamentos, projeção de quitação e comparação com séries do Banco Central;
- feriados nacionais pela BrasilAPI para alertar vencimentos em dias não úteis;
- importação de Excel/CSV com conciliação, hash, histórico e rollback;
- comprovantes privados no Cloudflare R2, download autenticado, exclusão e OCR opcional pelo Google Document AI;
- compartilhamento mensal protegido por token/senha, somente leitura, com comentários;
- rascunho de lançamento e Conselho Econômico via Groq, com cálculos locais, cotas e fallback;
- Open Finance opcional via Pluggy: consentimento, contas, saldos, movimentações, webhooks, sincronização, revogação, conciliação e importação confirmada;
- Central IVA: modos família/empresa, simulação versionada, transição 2026–2033, comparação com tributos anteriores, visão de split payment, cashback hipotético, XML de NF-e/NFC-e/NFS-e, mapa por categoria e livro gerencial de débitos/créditos;
- Docker, PostgreSQL/Prisma, health check, CI e deploy Railway com migrations automáticas.

A descrição cirúrgica dos fluxos, tabelas, permissões e limites está em [arquitetura.md](./arquitetura.md).

## Limites importantes

- Pluggy, Google Document AI, Groq e R2 só funcionam quando as respectivas credenciais estiverem configuradas; Pluggy e OCR são serviços comerciais.
- O Finora não participa diretamente do Open Finance regulado: a conexão ocorre pelo agregador e depende do consentimento do usuário.
- Open Finance nunca cria lançamentos silenciosamente. Correspondências e movimentações externas exigem confirmação.
- OCR apenas sugere descrição, valor e datas; o usuário precisa revisar e salvar.
- A Central IVA é informativa. Não emite documento, não escritura, não declara, não movimenta split payment e ainda não chama automaticamente a calculadora/validador oficial da Receita.
- Em 2026 o simulador aplica somente as alíquotas oficiais de teste de CBS 0,9% e IBS 0,1%. Para anos posteriores, não existe “27%” fixo: as alíquotas precisam ser informadas a partir de fonte vigente.
- O fechamento mensal preserva um snapshot auditável, mas não congela os lançamentos.
- Não há recuperação de senha, verificação de e-mail, 2FA, convite de membro autenticado, troca de família, operação offline ou testes de navegador.

## Stack

- Node.js 22, Next.js 15, React 19 e TypeScript;
- PostgreSQL e Prisma;
- Zod, bcryptjs e jose;
- Groq, Pluggy Connect SDK, Google Auth/Document AI e Cloudflare R2/S3;
- SheetJS e fast-xml-parser;
- Docker multi-stage e Railway.

## Executar localmente

Com Docker:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Sem Docker, com PostgreSQL disponível:

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Acesse `http://localhost:3000`. O primeiro cadastro cria o usuário, a família e a membership `OWNER`.

## Variáveis de ambiente

| Variável                          |             Necessidade | Uso                                                               |
| --------------------------------- | ----------------------: | ----------------------------------------------------------------- |
| `DATABASE_URL`                    |             obrigatória | PostgreSQL e migrations                                           |
| `AUTH_SECRET`                     | obrigatória em produção | assinatura de sessão e acesso compartilhado; mínimo 32 caracteres |
| `APP_URL`                         |          produção/smoke | URL pública do serviço                                            |
| `GROQ_API_KEY`                    |                 para IA | rascunho e Conselho Econômico                                     |
| `GROQ_MODEL`                      |                opcional | padrão `openai/gpt-oss-120b`                                      |
| `R2_ACCOUNT_ID`                   |           para arquivos | endpoint Cloudflare R2                                            |
| `R2_ACCESS_KEY_ID`                |           para arquivos | credencial R2                                                     |
| `R2_SECRET_ACCESS_KEY`            |           para arquivos | segredo R2                                                        |
| `R2_BUCKET`                       |           para arquivos | bucket privado                                                    |
| `PLUGGY_CLIENT_ID`                |       para Open Finance | autenticação do agregador                                         |
| `PLUGGY_CLIENT_SECRET`            |       para Open Finance | autenticação do agregador                                         |
| `PLUGGY_WEBHOOK_SECRET`           |           para webhooks | valor do header `x-finora-webhook-secret`                         |
| `GOOGLE_CLOUD_PROJECT`            |                para OCR | projeto Google Cloud                                              |
| `GOOGLE_DOCUMENT_AI_LOCATION`     |                para OCR | região do processor                                               |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` |                para OCR | processor Document AI                                             |
| `GOOGLE_APPLICATION_CREDENTIALS`  |               OCR local | arquivo de credencial; em cloud prefira identidade de workload    |
| `DATABASE_PUBLIC_URL`             |                 scripts | conexão externa para importação/smoke                             |
| `IMPORT_OWNER_EMAIL`              |          importação CLI | família de destino                                                |
| `SEED_OWNER_EMAIL`                |                    seed | proprietário que receberá categorias                              |

Nunca versione `.env`, credenciais ou planilhas. Veja [dados_ia.md](./dados_ia.md) e [r2.md](./r2.md).

## Comandos

| Comando                                | Finalidade                        |
| -------------------------------------- | --------------------------------- |
| `npm run dev`                          | desenvolvimento                   |
| `npm run build`                        | Prisma Client + build standalone  |
| `npm run start`                        | inicia o build pelo Next CLI      |
| `npm run lint`                         | verificação TypeScript            |
| `npm test`                             | testes Node                       |
| `npm run db:generate`                  | gera Prisma Client                |
| `npm run db:migrate`                   | aplica migrations pendentes       |
| `npm run db:seed`                      | categorias padrão                 |
| `npm run import:workbook -- <arquivo>` | importação legada administrativa  |
| `npm run smoke:production`             | smoke contra ambiente configurado |

## Deploy Railway

O Railway constrói o `Dockerfile`, verifica `GET /api/health/ready` e reinicia em falha. O processo final roda como usuário não-root e executa:

```text
npx prisma migrate deploy && node server.js
```

Antes do deploy, configure `DATABASE_URL` e `AUTH_SECRET`. Adicione as variáveis opcionais apenas para os módulos habilitados. Para Open Finance, cadastre no painel Pluggy o endpoint público `POST /api/open-finance/webhook` e envie o mesmo segredo em `x-finora-webhook-secret`.

## Verificação desta versão

Verificado em 12 de julho de 2026:

```text
npx tsc --noEmit  sem erros
npm test           16 testes aprovados
```

O CI repete geração do Prisma Client, TypeScript, testes e build. Integrações externas continuam exigindo smoke com credenciais e serviços reais.
