# Finora Design System

Fonte de verdade visual e comportamental do produto, revisada contra `app/globals.css` e os componentes em 12 de julho de 2026.

## Direção

- Produto: central financeira familiar com IA explicável.
- Personalidade: confiável, humana, precisa, acolhedora e adulta.
- Tema atual: exclusivamente claro.
- Densidade: intermediária em desktop e confortável no celular.
- Prioridade: entendimento dos valores, vencimentos e estados antes de decoração.
- Idioma e formato: pt-BR, BRL e datas legíveis em português.

Não introduzir modo escuro, nova marca, avatar caricato ou linguagem de investimento sem decisão explícita de produto.

## Implementação

O sistema não usa biblioteca de componentes nem CSS Modules. Toda a interface compartilha `app/globals.css`. Componentes estruturais estão em `components/` e ícones vêm de `lucide-react`.

As fontes são carregadas do Google Fonts por `@import`:

- Manrope 600, 700 e 800 para títulos e marca;
- DM Sans 400, 500, 600 e 700 para interface, corpo e números;
- Arial como fallback de corpo; sans-serif como fallback de título.

Como as fontes dependem de rede e não são auto-hospedadas, a renderização pode usar fallback quando o Google Fonts estiver indisponível.

## Tokens atuais

### Primitivos

| Token CSS       | Valor     | Uso principal                            |
| --------------- | --------- | ---------------------------------------- |
| `--blue-950`    | `#162849` | navegação e superfícies de máxima ênfase |
| `--blue-700`    | `#304c89` | ação primária                            |
| `--blue-600`    | `#3e63aa` | links e ações secundárias                |
| `--emerald-600` | `#168b78` | pago, confirmação e segurança            |
| `--coral-600`   | `#d86352` | pendência, risco e cancelamento          |
| `--gold-600`    | `#b67b22` | atenção e acertos                        |
| `--neutral-950` | `#172033` | texto principal                          |
| `--neutral-600` | `#69758c` | texto secundário                         |
| `--neutral-200` | `#e4e9f0` | bordas                                   |
| `--neutral-100` | `#f4f6f8` | canvas                                   |
| `--neutral-0`   | `#ffffff` | superfície                               |
| `--focus-ring`  | `#2563eb` | foco visível                             |

### Semânticos

| Token         | Referência      |
| ------------- | --------------- |
| `--ink`       | `--neutral-950` |
| `--muted`     | `--neutral-600` |
| `--line`      | `--neutral-200` |
| `--canvas`    | `--neutral-100` |
| `--surface`   | `--neutral-0`   |
| `--primary`   | `--blue-700`    |
| `--primary-2` | `--blue-600`    |
| `--navy`      | `--blue-950`    |
| `--mint`      | `--emerald-600` |
| `--coral`     | `--coral-600`   |
| `--gold`      | `--gold-600`    |

Valores complementares usados diretamente no CSS incluem fundos suaves `#e9f7f3`, `#fff0ed`, `#fff6e5` e `#edf2fa`.

### Forma e elevação

- raio global de painel: `18px`;
- painéis internos: em geral 9–18 px;
- hero: 22 px;
- sombra padrão: `0 12px 35px rgba(24,40,73,.06)`;
- botões principais: altura mínima de 40 px e raio de 9 px;
- alvos críticos no breakpoint móvel: mínimo de 44 × 44 px.

## Hierarquia

### Navegação

- desktop: sidebar fixa visualmente, 260 px, altura da viewport;
- conteúdo: largura máxima de 1510 px, descontando a sidebar;
- celular/tablet: sidebar é substituída por drawer e botão hambúrguer;
- o Conselho Econômico usa drawer lateral independente;
- a visão ativa é representada no fragmento da URL.

### Conteúdo financeiro

Ordem recomendada:

1. período e contexto familiar;
2. total principal;
3. pago, pendente, a receber e mês seguinte;
4. faturas e projeções;
5. lançamentos e ações.

A fatura usa o total de compras do mês como dado principal. Limite de crédito, instituição, final e datas são secundários.

### Estados

- pago: esmeralda;
- pendente: dourado/laranja;
- previsto: azul suave;
- vencido/cancelado/erro: coral ou neutro conforme gravidade;
- dado incompleto: atenção explícita com texto, nunca apenas cor;
- carregamento: texto verbal como “Salvando…”, “Analisando…” ou “Processando…”.

## Componentes existentes

| Componente/padrão                      | Uso                                                       |
| -------------------------------------- | --------------------------------------------------------- |
| `.panel`                               | superfície operacional padrão                             |
| `.hero-balance`                        | total mensal e atalhos principais                         |
| `.stat`                                | indicador financeiro compacto                             |
| `.invoice-card`                        | fatura por cartão                                         |
| `.transaction-row`                     | leitura e edição inline de lançamento                     |
| `.notice`                              | sucesso, informação ou divergência                        |
| `.modal`                               | criação de lançamento e cadastros                         |
| `.share-modal`                         | geração e revogação de link                               |
| `.advisor-drawer`                      | Conselho Econômico                                        |
| `.mobile-drawer`                       | navegação em telas menores                                |
| `.pagination`                          | lista autenticada e compartilhada                         |
| `.share-unlock`                        | autenticação do convidado                                 |
| `.budget-layout` / `.budget-rows`      | orçamento, realizado e fechamento                         |
| `.debt-layout` / `.debt-card`          | dívida, referência e quitação                             |
| `.banking-layout` / `.connection-card` | consentimento e contas externas                           |
| `.match-list` / `.external-list`       | conciliação bancária confirmável                          |
| `.due-alerts`                          | vencimentos em fim de semana/feriado                      |
| `.tax-center` / `.tax-hero`            | contexto da Central IVA                                   |
| `.tax-tabs` / `.tax-simulator-grid`    | simulação, documentos, transição, cashback e livro fiscal |
| `.tax-disclaimer`                      | limite legal/fiscal explícito                             |

Ao criar um padrão recorrente, reutilize classes/tokens existentes ou extraia componente antes de duplicar variações.

## Tipografia

- título de página desktop: aproximadamente 29 px;
- valor principal do hero: 39 px;
- títulos de painel: aproximadamente 15 px;
- corpo operacional: em geral 9–13 px no CSS atual;
- kicker: 10 px, peso 800, caixa alta e espaçamento amplo;
- valores monetários usam peso, alinhamento e contraste, nunca somente cor.

O CSS atual contém textos essenciais abaixo da recomendação de 13–14 px. Melhorias futuras de acessibilidade devem aumentar esses tamanhos com teste de layout, sobretudo em tabelas, status e textos auxiliares.

## Movimento

- transições usuais: cerca de 180 ms;
- microinterações devem permanecer entre 150 e 300 ms;
- movimento não pode mudar o espaço reservado aos dados;
- drawers e modais devem fechar com `Esc`;
- não usar parallax, animações contínuas sobre números ou efeitos que simulem urgência;
- a regra global `prefers-reduced-motion: reduce` reduz animações e transições a 0,01 ms.

## Acessibilidade

Obrigatório para alterações novas:

- contraste mínimo WCAG AA;
- foco de teclado visível;
- ordem de tabulação igual à ordem visual;
- botão com `aria-label` quando houver somente ícone;
- campos com rótulo textual e erro próximo;
- nenhum estado comunicado apenas por cor;
- ícones decorativos sem substituir o nome da ação;
- drawer/menu fechável por `Esc` e backdrop;
- conteúdo alcançável pelo link “Pular para o conteúdo”;
- dialogs com semântica e nome acessível;
- tabelas horizontais utilizáveis sem esconder dados.

Estado atual verificado:

- existe skip link global;
- botões de ícone principais têm rótulos;
- menu e Conselho fecham com `Esc`;
- há foco global no CSS;
- alguns modais ainda não implementam focus trap/restauração explícita;
- tamanhos tipográficos pequenos e tabela compartilhada com rolagem horizontal merecem validação manual.

## Responsividade

Breakpoints implementados concentram-se em 1180, 980, 820 e 600 px.

Validar manualmente pelo menos em:

- 375 px;
- 600 px;
- 768 px;
- 1024 px;
- 1366 px;
- 1440 px;
- 1920 px.

Regras:

- nenhum conteúdo pode ficar sob barra, drawer, safe area ou teclado virtual;
- celular usa menu hambúrguer, não faixa horizontal de navegação;
- controles críticos atingem 44 px no móvel;
- gráficos precisam manter rótulo e valor legíveis;
- tabela compartilhada pode rolar horizontalmente, mas comentários devem continuar acessíveis;
- formulários devem escolher teclado móvel coerente com e-mail, número, dinheiro e senha.

## Conteúdo e tom

- falar em “compromissos”, “despesas”, “receita cadastrada” e “valores a devolver” com precisão;
- não chamar despesa futura de recebimento;
- quando não houver renda, dizer que a capacidade de pagamento não pode ser calculada;
- usar mensagens diretas, sem culpa ou moralização;
- ações destrutivas devem declarar escopo e irreversibilidade;
- IA deve ser apresentada como explicação e organização, não como autoridade financeira;
- não afirmar que uma integração está ativa apenas porque a configuração existe.
- Open Finance deve destacar consentimento, separação dos dados externos e confirmação antes de importar;
- OCR deve exibir confiança e nunca apresentar extração como lançamento concluído;
- IVA deve usar “simulação”, “estimativa”, versão e fonte; nunca declarar direito a cashback, obrigação fiscal ou alíquota futura definitiva;
- comparações do Banco Central devem dizer “referência”, não “melhor taxa” ou “oferta”.

## Antipadrões proibidos

- dark mode adicionado por tendência;
- robô infantil ou avatar caricato;
- números calculados livremente pelo modelo de linguagem;
- texto cinza de baixo contraste;
- botão sem ação, foco ou feedback;
- emoji como ícone de navegação;
- limite de cartão tratado como saldo disponível;
- ocultar divergência de planilha;
- modal genérico para o Conselho Econômico;
- ação destrutiva sem confirmação proporcional;
- marcar recurso parcial como entregue.
- esconder o aviso “sem efeito fiscal” da Central IVA;
- transformar movimentação bancária em lançamento sem confirmação;
- usar verde/vermelho isoladamente para indicar correspondência ou elegibilidade.

## Checklist de alteração visual

- usa tokens semânticos existentes?
- preserva hierarquia do valor principal?
- funciona com teclado e leitor de tela?
- tem foco, hover, disabled, loading, vazio, erro e sucesso?
- funciona em 375, 768, 1024 e 1440 px?
- fecha corretamente por `Esc` quando sobreposto?
- respeita `prefers-reduced-motion` se houver animação?
- não altera o significado financeiro?
- mantém Conselho, importação e compartilhamento visualmente distintos?
- mantém Central Bancária e Central IVA distintas do núcleo financeiro e com seus avisos visíveis?

Mudanças estruturais também devem ser refletidas em [arquitetura.md](../arquitetura.md).
