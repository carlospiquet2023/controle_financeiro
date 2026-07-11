# Finora

Controle financeiro familiar, responsivo e pronto para produção. Troca a planilha mensal por uma base histórica: despesas, receitas, cartões, parcelas, valores a receber e projeções ficam ligados entre si.

## O que está entregue

- Login com senha protegida por bcrypt, sessão HTTP-only e isolamento por grupo familiar.
- Papéis de acesso e trilha de auditoria para lançamentos.
- Cartões, contas, categorias, pessoas e divisões de despesas modelados no PostgreSQL.
- Motor de parcelas que gera as competências futuras e preserva a soma exata em centavos.
- Painel com compromissos do mês, projeção de seis meses, cartões, pendências e valores a receber.
- Endpoint de upload temporário para comprovantes no Cloudflare R2; as chaves nunca são expostas ao navegador.
- Assistente Groq para transformar texto livre em lançamento estruturado; ele sugere e o usuário confirma antes de gravar.
- Importador da planilha de julho/2026, incluindo leitura das cores como apoio somente na migração inicial.
- Docker, migration versionada, health check e configuração Railway.

## Executar localmente

1. Copie `.env.example` para `.env` e gere `AUTH_SECRET` com `openssl rand -base64 32`.
2. Execute `docker compose up --build`.
3. Acesse `http://localhost:3000` e crie a conta proprietária.

O container aplica `prisma migrate deploy` antes de iniciar. O health check é `GET /api/health/ready`.

## Importar a planilha existente

Depois de criar a conta, execute localmente apontando para o mesmo PostgreSQL:

```powershell
$env:IMPORT_OWNER_EMAIL="seu-email@exemplo.com"
npm run import:workbook -- "C:\Users\pique\Desktop\controle_finaceiro\Planilha-dividas julho.xlsx"
```

O importador cria os cartões identificáveis pela cor, gera parcelas futuras a partir de julho/2026 e é idempotente. Registros sem cor devem ser revisados no painel antes de serem considerados definitivos.

## Railway

No serviço de aplicação, configure:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | referência do serviço PostgreSQL Railway |
| `AUTH_SECRET` | segredo aleatório com 32+ caracteres |
| `APP_URL` | domínio público do Railway, por exemplo `https://finora-production.up.railway.app` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | credenciais do bucket R2 para comprovantes |
| `R2_PUBLIC_URL` | opcional, URL pública do bucket/CDN |
| `GROQ_API_KEY`, `GROQ_MODEL` | chave e modelo Groq para o preenchimento inteligente |

O Railway usa `Dockerfile`, aplica a migration no start e monitora `/api/health/ready`. Nunca suba `.env`, planilhas ou chaves para o GitHub.

## Próximos incrementos de produto

A estrutura já suporta as próximas telas: wizard de importação no navegador, pagamentos parciais, recorrências com geração mensal, notificações, 2FA TOTP e leitura OCR de comprovantes. Essas evoluções podem ser inseridas sem alterar o modelo financeiro central.
