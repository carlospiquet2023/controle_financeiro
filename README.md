# Finora

Central financeira familiar criada para responder quatro perguntas sem ambiguidade: quanto a família paga no mês, em qual cartão, quem precisa devolver e quanto já está comprometido no futuro.

## O que está entregue

- Login com senha protegida por bcrypt, sessão HTTP-only e isolamento por grupo familiar.
- Papéis de acesso e trilha de auditoria para lançamentos.
- Cartões, contas, categorias, pessoas e divisões de despesas modelados no PostgreSQL.
- Motor de parcelas que gera as competências futuras e preserva a soma exata em centavos.
- Central mensal com total a pagar, pago, pendente, acertos familiares e projeção dos próximos 12 meses.
- Faturas por cartão calculadas pelas compras do mês. Limite de crédito é apenas informação secundária.
- Navegação real entre meses, filtros de lançamentos e experiência responsiva para notebook, desktop e celular.
- Cadastros funcionais de cartões, contas, pessoas e categorias.
- Endpoint de upload temporário para comprovantes no Cloudflare R2; as chaves nunca são expostas ao navegador.
- Assistente Groq para transformar texto livre em lançamento estruturado; ele sugere e o usuário confirma antes de gravar.
- Importador conciliado de Excel/CSV: reconhece fórmulas, cores, parcelas e totais por cartão da planilha original.
- O arquivo original de cada importação é preservado no R2, o lote fica auditável e pode ser desfeito sem afetar lançamentos manuais.
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

O importador exige que o total das linhas seja idêntico ao resumo por cartão. Ele cria inclusive cartões zerados, gera as parcelas restantes, projeta despesas marcadas como `FIXO` por 12 meses e mantém o grupo “Não identificado” separado para revisão. Para substituir uma importação antiga com erro:

```powershell
npm run import:workbook -- "C:\caminho\Planilha-dividas julho.xlsx" --replace-legacy
```

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

O Railway usa `Dockerfile`, aplica as migrations antes de iniciar e monitora `/api/health/ready`. Nunca suba `.env`, planilhas ou chaves para o GitHub.

## Garantias da importação

- valores monetários persistidos como `Decimal(14,2)` no PostgreSQL;
- comparação em centavos, sem aceitar diferenças de ponto flutuante;
- hash SHA-256 para bloquear o mesmo arquivo duas vezes;
- vínculo de cada lançamento ao lote que o criou;
- trilha de auditoria para importar, desfazer, pagar, cancelar e revisar cartão;
- isolamento por grupo familiar em todas as ações do servidor.
