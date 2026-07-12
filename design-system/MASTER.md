# Finora Design System

Fonte de verdade visual e comportamental do produto. Alterações futuras devem preservar estes princípios.

## Direção

- Produto: central financeira familiar com IA explicável.
- Personalidade: confiável, humana, precisa, acolhedora e adulta.
- Tema: claro. Não adicionar modo escuro sem decisão explícita de produto.
- Densidade: intermediária em desktop e confortável no celular.
- Prioridade: entendimento financeiro antes de decoração.

## Tokens

### Primitivos

| Família | Valores principais |
|---|---|
| Azul | `#162849`, `#304C89`, `#3E63AA`, `#EAF0F8` |
| Esmeralda | `#168B78`, `#E9F7F3` |
| Coral | `#D86352`, `#FFF0ED` |
| Dourado | `#B67B22`, `#FFF6E5` |
| Neutros | `#172033`, `#69758C`, `#E4E9F0`, `#F4F6F8`, `#FFFFFF` |

### Semânticos

- `primary`: decisões e ações principais.
- `success`: valor pago, conciliação e confirmação.
- `warning`: dados incompletos e atenção.
- `danger`: risco, divergência ou cancelamento.
- `surface`: cartões operacionais.
- `canvas`: fundo da aplicação.

### Componentes

- Botão primário: 40–44 px de altura, texto branco, foco visível.
- Alvo móvel: mínimo 44 × 44 px.
- Painel: raio 14–18 px, borda neutra, sombra discreta.
- Fatura: total do mês é o dado principal; limite é secundário.
- Conselho Econômico: drawer lateral, nunca um modal genérico.

## Tipografia

- Títulos: Manrope 600–800.
- Interface e números: DM Sans 400–700.
- Corpo operacional: mínimo recomendado de 13–14 px.
- Textos auxiliares: mínimo de 11 px quando não forem essenciais.
- Valores financeiros usam peso e contraste; nunca apenas cor.

## Movimento

- Microinterações: 150–300 ms.
- Movimento não pode alterar o espaço ocupado pelo elemento.
- Respeitar `prefers-reduced-motion`.
- Nada de parallax ou animação contínua sobre dados financeiros.

## Acessibilidade

- Contraste mínimo WCAG AA.
- Foco de teclado sempre visível.
- Ordem de tabulação igual à ordem visual.
- Ícones estruturais exclusivamente vetoriais e com rótulo acessível.
- Navegação principal alcançável por link “Pular para o conteúdo”.
- Formulários com rótulos, mensagens de erro e teclado móvel adequado.
- Menu e Conselho fecham com `Esc` e respeitam safe areas.

## Responsividade

- Validar em 375, 768, 1024, 1366, 1440 e 1920 px.
- Celular usa menu hambúrguer; não usar faixa horizontal de navegação.
- Nenhum conteúdo pode ficar encoberto por barra fixa ou teclado virtual.

## Antipadrões proibidos

- Dark mode adicionado apenas por tendência.
- Robô infantil ou avatar caricato para a IA.
- Números calculados pelo modelo de linguagem.
- Texto cinza de baixo contraste.
- Botão sem ação, foco ou feedback de carregamento.
- Emojis usados como ícones de navegação.
- Efeitos visuais que disputem atenção com valores e vencimentos.
