---
title: "Bate-papo nativo UI"
description: "Renderizadores de bate-papo nativos declarados por ação, saídas DataTable/DataChart reutilizáveis e como os tempos de execução do agente BYO devem se conectar ao bate-papo Agent-Native."
---

# Bate-papo nativo UI

O bate-papo nativo UI é o caminho de renderização no aplicativo para a saída do agente primário. Um
a ação retorna JSON estruturado, o tempo de execução do chat reconhece um widget explícito
discriminante e `<AssistantChat>` renderiza um componente React real no
conversa. Você não cria um iframe ou um artefato HTML único para o
bate-papo normal do aplicativo.

Use o chat nativo UI quando o usuário precisar inspecionar a saída onde o agente está
já falando: resultados de consultas, insights de respostas, resumos de configuração,
controles de aprovação/negação ou links para visualizações de aplicativos. Usar [MCP Apps](/docs/mcp-apps)
quando um host externo como Claude, ChatGPT, Copilot ou Cursor deve ser renderizado
uma rota in-line do seu aplicativo.

```an-diagram title="O caminho de renderização nativo" summary="Uma ação retorna JSON; o tempo de execução corresponde a um discriminante de widget explícito ou chatUI.renderer; AssistantChat monta um componente React real. Sem iframe, sem execução de HTML."
{
  "html": "<div class=\"diagram-render\"><div class=\"diagram-node\">Ação executa<br><small class=\"diagram-muted\">retorna JSON estruturado</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Match</span><small class=\"diagram-muted\">explicit widget &middot; chatUI.renderer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">&lt;AssistantChat&gt;<br><small class=\"diagram-muted\">monta um widget React</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill ok\">DataTable</div><div class=\"diagram-pill ok\">DataChart</div><div class=\"diagram-pill ok\">DataInsights</div></div></div>",
  "css": ".diagram-render{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-render .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-render .col{display:flex;flex-direction:column;gap:6px;padding:12px}.diagram-render .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Widgets declarados por ação {#action-declared-widgets}

O caminho nativo tem duas partes explícitas:

- `outputSchema` valida o formato de resposta da ação.
- `chatUI.renderer` seleciona o renderizador nativo React para o resultado validado.

Os renderizadores de dados integrados usam um resultado JSON simples com `widget` mais o
carga útil correspondente:

| Widget            | Carga necessária           | Renderiza como                                              |
| ----------------- | -------------------------- | ----------------------------------------------------------- |
| `"data-table"`    | `table`                    | Uma tabela de dados nativa e reutilizável                   |
| `"data-chart"`    | `chartSeries`              | Um gráfico nativo de barras, linhas ou áreas                |
| `"data-insights"` | `table` e/ou `chartSeries` | Um cartão de insights combinado com saída de gráfico/tabela |

O servidor actions deve importar os auxiliares e esquemas seguros para o servidor de
`@agent-native/core/data-widgets`; o código do cliente pode importar os mesmos tipos de
`@agent-native/core/client/chat` ou `@agent-native/core/client`.

```ts
import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER } from "@agent-native/core/action-ui";
import {
  createDataInsightsWidgetResult,
  dataInsightsWidgetResultSchema,
} from "@agent-native/core/data-widgets";

export default defineAction({
  description: "Analyze form responses.",
  readOnly: true,
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
    title: "Response insights",
  },
  run: async () =>
    createDataInsightsWidgetResult({
      title: "Response insights",
      display: {
        title: "42 responses",
        description: "Completion rate rose this week.",
        primaryAction: {
          label: "Open response insights",
          href: "/response-insights",
        },
      },
      chartSeries: {
        type: "bar",
        title: "Responses by day",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [
          { day: "Mon", responses: 8 },
          { day: "Tue", responses: 13 },
        ],
      },
      table: {
        title: "Top answers",
        columns: [
          { key: "answer", label: "Answer" },
          { key: "count", label: "Count", align: "right" },
        ],
        rows: [
          { answer: "Yes", count: 31 },
          { answer: "No", count: 11 },
        ],
        totalRows: 2,
      },
    }),
});
```

```an-callout
{
  "tone": "success",
  "body": "O renderizador só assume o controle quando a ação declara `chatUI` **ou** o resultado carrega um discriminante `widget` conhecido explícito. Ele nunca infere objetos arbitrários e nunca executa HTML ou JavaScript a partir dos resultados da ferramenta - portanto, um widget nativo não pode se tornar um vetor de injeção."
}
```

Quando um usuário solicita um gráfico, gráfico, tabela, tendência ou relatório compacto, os agentes de aplicativos
deve preferir uma ação que declare um desses renderizadores nativos. A final
o texto do assistente deve ser breve e permitir que o widget carregue os dados; não copie
as mesmas linhas em uma tabela de descontos, a menos que o usuário solicite explicitamente um texto
exportar.

Quando não existe nenhuma ação de domínio, mas o agente já recuperou o compacto,
dados verdadeiros, ele pode chamar a ação da estrutura `render-data-widget` com o
mesma forma `data-table`, `data-chart` ou `data-insights` JSON. Somente esta ação
valida e renderiza o widget; não é uma fonte de dados e não deve ser usado
para inventar métricas de espaço reservado.

## Saída DataTable {#data-table}

`table` é intencionalmente simples, então listar, SQL, análises e configurar actions podem
reutilize:

```ts
{
  title?: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, unknown>>;
  totalRows?: number;
  sampledRows?: number;
  truncated?: boolean;
}
```

Prefira chaves de coluna estáveis ​​e valores de linha seguros para JSON. Use `totalRows`,
`sampledRows` e `truncated` quando a ação mostra uma fatia maior
conjunto de resultados.

## Saída do DataChart {#data-chart}

`chartSeries` oferece suporte aos formatos de gráfico comuns usados nas respostas dos agentes sem
exigindo que cada modelo envie seu próprio renderizador de chat:

```ts
{
  type: "bar" | "line" | "area";
  title?: string;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  data: Array<Record<string, unknown>>;
  sampled?: boolean;
}
```

Mantenha os dados do gráfico compactos. Para grandes conjuntos de dados, agregue na ação e vincule
para a visualização completa do aplicativo com metadados `display.primaryAction` ou ação `link`.

## Widgets nativos versus aplicativos MCP {#native-vs-mcp-apps}

Widgets de bate-papo nativos e aplicativos MCP são complementares:

- **Widgets nativos** são para o tempo de execução de bate-papo do próprio aplicativo. O resultado da ação é
  JSON, e a estrutura renderiza o widget React integrado.
- **Aplicativos MCP** são para hosts externos. A ação declara `mcpApp` e normalmente
  `link`, e o host renderiza uma rota de aplicativo real in-line quando compatível.
- **Deep links** continuam sendo o substituto universal. Use a ação `link` ou
  `display.primaryAction` para clientes CLI, hosts MCP mais antigos e transcrição simples
  os leitores podem abrir a visualização completa do aplicativo.

Quando uma carga útil de widget nativo e metadados de aplicativos MCP estão presentes, o arquivo no aplicativo
o chat prefere o widget nativo. Hosts externos usam o recurso MCP Apps ou o
substituto de link direto.

## Renderizadores nativos personalizados {#custom-native-renderers}

Registre componentes específicos do produto pelo ID exato do renderizador e, em seguida, declare esse ID
na ação:

```tsx
import { registerActionChatRenderer } from "@agent-native/core/client/chat";

registerActionChatRenderer({
  id: "crm.deal-card",
  renderer: "crm.deal-card",
  Component: ({ context }) => <DealCard result={context.resultJson} />,
});
```

```ts
export default defineAction({
  description: "Show a deal card.",
  outputSchema: dealCardSchema,
  chatUI: { renderer: "crm.deal-card" },
  run: async () => ({ dealId: "deal_123", amount: 42000 }),
});
```

Use isso para o aplicativo original UI. Mantenha o iframe entre hosts UI em `mcpApp` e mantenha
execução de consulta arbitrária por trás da leitura digitada actions em vez de SQL bruto no bate-papo.

## Tempos de execução do agente BYO {#byo-agent-runtimes}

`AgentChatRuntime` é o contrato traga seu próprio agente para o shell de bate-papo e
esta seção é sua referência canônica. Ele permite que um agente que você criou em outro lugar
transmitir eventos normalizados para a conversa Agent-Native de UI enquanto mantém o
compositor compartilhado, renderização de transcrição, cartões de ferramentas, aprovações, widgets nativos,
e layout do aplicativo ao redor. O [Drop-in Agent](/docs/drop-in-agent#custom-chat-ui)
pontos do tutorial aqui para a história do tempo de execução e [Component API](/docs/components#agent-chat-ui)
lista cada conector e adaptador com seu caminho de importação; o contrato em si é
descrito abaixo.

```an-diagram title="O tempo de execução BYO mantém o shell de bate-papo Agent-Native" summary="Seu agente externo transmite eventos normalizados por meio de um conector; Agent-Native mantém o compositor, a transcrição, os cartões de ferramentas, as aprovações e os widgets nativos."
{
  "html": "<div class=\"diagram-byo\"><div class=\"diagram-box\" data-rough>Seu agente<br><small class=\"diagram-muted\">OpenAI &middot; Claude &middot; Vercel AI &middot; AG-UI &middot; HTTP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">connector</span><small class=\"diagram-muted\">eventos message-* / tool-* normalizados</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill\">&lt;AssistantChat runtime=&hellip; /&gt;</div><small class=\"diagram-muted\">composer &middot; transcript &middot; tool cards</small><small class=\"diagram-muted\">approvals &middot; native widgets</small></div></div>",
  "css": ".diagram-byo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-byo .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-byo .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-byo .diagram-arrow{font-size:22px;line-height:1}"
}
```

Todos os conectores são exportados de `@agent-native/core/client/chat` (e da raiz
entrada `@agent-native/core/client`). Use o tempo de execução genérico HTTP quando seu agente
pode expor um endpoint POST que retorna eventos de tempo de execução SSE ou NDJSON:

```tsx
import {
  AssistantChat,
  createHttpAgentChatRuntime,
} from "@agent-native/core/client/chat";

const runtime = createHttpAgentChatRuntime({
  id: "external:mastra",
  label: "Mastra",
  endpoint: "/api/mastra/chat",
  headers: async () => ({
    Authorization: `Bearer ${await getAgentToken()}`,
  }),
});

export function SupportChat() {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

Se o seu endpoint já transmite um protocolo de agente comum, use o protocolo correspondente
conector e pule a gravação de um mapeador personalizado:

```ts
import {
  createAgUiChatRuntime,
  createClaudeAgentChatRuntime,
  createOpenAIAgentsChatRuntime,
  createOpenAIResponsesChatRuntime,
  createVercelAiChatRuntime,
} from "@agent-native/core/client/chat";

const openAiAgentsRuntime = createOpenAIAgentsChatRuntime({
  endpoint: "/api/openai-agents/chat",
});

const openAiResponsesRuntime = createOpenAIResponsesChatRuntime({
  endpoint: "/api/openai-responses/chat",
});

const claudeAgentRuntime = createClaudeAgentChatRuntime({
  endpoint: "/api/claude-agent/chat",
});

const vercelAiRuntime = createVercelAiChatRuntime({
  endpoint: "/api/vercel-ai/chat",
});

const agUiRuntime = createAgUiChatRuntime({
  endpoint: "/api/ag-ui/chat",
});
```

O endpoint pode transmitir diretamente o formato do evento normalizado:

```text
data: {"type":"message-start","message":{"id":"m1","role":"assistant","content":[]}}
data: {"type":"message-delta","messageId":"m1","delta":{"type":"text","text":"Hello"}}
data: {"type":"tool-start","toolCall":{"id":"t1","name":"query","input":{"q":"forms"}}}
data: {"type":"tool-done","toolCallId":"t1","toolName":"query","status":"completed","resultText":"34 rows"}
data: {"type":"done","reason":"complete"}
```

Para agentes muito simples, uma resposta JSON `{ "text": "..." }` é aceita e
convertido em uma única mensagem do assistente. Para agentes mais ricos, transmita
`message-*`, `tool-*`, `approval-request`, `status`, `artifact`, `file`,
Eventos `usage`, `error` e `done`. Os resultados da ferramenta podem conter `mcpApp` ou
Metadados `chatUI`, portanto, widgets nativos declarados por ação ainda são renderizados sem
iframes.

Quando desejar o transporte Agent-Native integrado como um objeto de tempo de execução, use:

```ts
import { createAgentNativeChatRuntime } from "@agent-native/core/client/chat";

const runtime = createAgentNativeChatRuntime({
  threadId: "forms-chat",
  mode: "act",
});
```

Use `<AssistantChat createAdapter={...} />` somente quando precisar de full
controle do adaptador assistant-ui. Use `PromptComposer` sozinho quando seu produto
possui toda a transcrição externa e só quer o compositor de Agent-Native
campo.

Os fluxos OpenAI, AG-UI, Claude Agent SDK e Vercel AI SDK podem usar o padrão
ajudantes de conector. ACP permanece interoperabilidade agente de codificação/editor, não o
tempo de execução geral do app-chat para usuários finais. A2UI não é reivindicado como suportado aqui;
se amadurecer, deverá se adaptar ao mesmo contrato explícito de tempo de execução/widget.

## Documentos relacionados {#related-docs}

- [Actions](/docs/actions) — defina as operações que retornam dados nativos do widget.
- [Agent Surfaces](/docs/agent-surfaces): decida se você precisa de um aplicativo headless, chat, sidecar ou completo.
- [Drop-in Agent](/docs/drop-in-agent) — o tutorial para montar o tempo de execução de chat padrão.
- [Component API](/docs/components) — o mapa API por exportação para camadas de bate-papo, tempos de execução e renderizadores de ferramentas.
- [MCP Apps](/docs/mcp-apps) — UI embutido para hosts MCP externos.
- [Key Concepts](/docs/key-concepts#protocols) — status e posicionamento do protocolo.
