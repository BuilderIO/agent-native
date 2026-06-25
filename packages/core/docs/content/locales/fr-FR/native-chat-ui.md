---
title: "Chat natif UI"
description: "Renduurs de chat natifs déclarés par action, sorties DataTable/DataChart réutilisables et manière dont les environnements d'exécution de l'agent BYO doivent se connecter au chat Agent-Native."
---

# Chat natif UI

Le chat natif UI est le chemin de rendu dans l'application pour la sortie des agents propriétaires. Un
l'action renvoie un JSON structuré, le runtime de chat reconnaît un widget explicite
discriminant, et `<AssistantChat>` restitue un véritable composant React dans le
conversation. Vous ne créez pas d'iframe ou d'artefact HTML unique pour le
chat normal dans l'application.

Utiliser le chat natif UI lorsque l'utilisateur doit inspecter la sortie là où se trouve l'agent
déjà parlant : résultats de requêtes, informations sur les réponses, résumés de configuration,
contrôles d'approbation/refus ou liens vers des vues d'application. Utilisez [MCP Apps](/docs/mcp-apps)
quand un hôte externe tel que Claude, ChatGPT, Copilot ou Cursor doit effectuer le rendu
un itinéraire en ligne depuis votre application.

```an-diagram title="Le chemin de rendu natif" summary="Une action renvoie JSON ; le runtime correspond à un discriminant de widget explicite ou chatUI.renderer ; AssistantChat monte un véritable composant React. Pas d'iframe, pas d'exécution HTML."
{
  "html": "<div class=\"diagram-render\"><div class=\"diagram-node\">L’action s’exécute<br><small class=\"diagram-muted\">renvoie du JSON structuré</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Match</span><small class=\"diagram-muted\">explicit widget &middot; chatUI.renderer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">&lt;AssistantChat&gt;<br><small class=\"diagram-muted\">monte un widget React</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill ok\">DataTable</div><div class=\"diagram-pill ok\">DataChart</div><div class=\"diagram-pill ok\">DataInsights</div></div></div>",
  "css": ".diagram-render{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-render .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-render .col{display:flex;flex-direction:column;gap:6px;padding:12px}.diagram-render .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Widgets déclarés par action {#action-declared-widgets}

Le chemin natif comporte deux parties explicites :

- `outputSchema` valide la forme de réponse de l'action.
- `chatUI.renderer` sélectionne le moteur de rendu natif React pour le résultat validé.

Les moteurs de rendu de données intégrés utilisent un résultat JSON simple avec `widget` plus le
charge utile correspondante :

| Widget            | Charge utile requise        | Rendu comme                                                         |
| ----------------- | --------------------------- | ------------------------------------------------------------------- |
| `"data-table"`    | `table`                     | Une table de données native et réutilisable                         |
| `"data-chart"`    | `chartSeries`               | Un graphique natif à barres, à courbes ou à aires                   |
| `"data-insights"` | `table` et/ou `chartSeries` | Une carte d'informations combinée avec une sortie graphique/tableau |

Le serveur actions doit importer les assistants et les schémas sécurisés pour le serveur à partir de
`@agent-native/core/data-widgets` ; le code client peut importer les mêmes types depuis
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
  "body": "Le moteur de rendu ne prend le relais que lorsque l'action déclare `chatUI` **ou** le résultat comporte un discriminant `widget` explicite et connu. Il ne déduit jamais de forme d'objets arbitraires et n'exécute jamais HTML ou JavaScript à partir des résultats de l'outil — un widget natif ne peut donc pas devenir un vecteur d'injection."
}
```

Lorsqu'un utilisateur demande un graphique, un tableau, une tendance ou un rapport compact, les agents de l'application
devrait préférer une action qui déclare l'un de ces moteurs de rendu natifs. La finale
le texte de l'assistant doit rester bref et laisser le widget transporter les données ; ne copiez pas
les mêmes lignes dans un tableau de démarques sauf si l'utilisateur demande explicitement un texte
exporter.

Lorsqu'aucune action de domaine n'existe mais que l'agent a déjà récupéré le compact,
données véridiques, il peut appeler l'action du framework `render-data-widget` avec le
même forme `data-table`, `data-chart` ou `data-insights` JSON. Cette action uniquement
valide et restitue le widget ; ce n'est pas une source de données et ne doit pas être utilisé
pour inventer des métriques d'espace réservé.

## Sortie DataTable {#data-table}

`table` est intentionnellement simple, donc la liste, SQL, les analyses et la configuration de actions peuvent
réutilisez-le :

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

Préférez les clés de colonne stables et les valeurs de ligne sécurisées JSON. Utilisez `totalRows`,
`sampledRows` et `truncated` lorsque l'action affiche une tranche d'un plus grand
ensemble de résultats.

## Sortie DataChart {#data-chart}

`chartSeries` prend en charge les formes de graphique courantes utilisées dans les réponses des agents sans
exiger que chaque modèle soit livré avec son propre moteur de rendu de chat :

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

Gardez les données du graphique compactes. Pour les ensembles de données volumineux, regroupez-les dans l'action et liez
vers la vue complète de l'application avec les métadonnées `display.primaryAction` ou l'action `link`.

## Widgets natifs vs applications MCP {#native-vs-mcp-apps}

Les widgets de chat natifs et les applications MCP sont complémentaires :

- **Les widgets natifs** sont destinés au propre environnement de discussion de l'application. Le résultat de l'action est
  JSON, et le framework restitue le widget React intégré.
- **Les applications MCP** sont destinées aux hôtes externes. L'action déclare `mcpApp` et généralement
  `link`, et l'hôte restitue un véritable itinéraire d'application en ligne lorsqu'il est pris en charge.
- **Les liens profonds** restent la solution de repli universelle. Utilisez l'action `link` ou
  `display.primaryAction` donc clients CLI, anciens hôtes MCP et transcription simple
  les lecteurs peuvent ouvrir la vue complète de l'application.

Lorsqu'une charge utile de widget natif et des métadonnées d'applications MCP sont présentes, l'application intégrée
le chat préfère le widget natif. Les hôtes externes utilisent la ressource MCP Apps ou le
Repli des liens profonds.

## Rendu natifs personnalisés {#custom-native-renderers}

Enregistrez les composants spécifiques au produit par identifiant exact du moteur de rendu, puis déclarez cet identifiant
sur l'action :

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

Utilisez-le pour l'application propriétaire UI. Conservez l'iframe multi-hôtes UI dans `mcpApp` et conservez
exécution de requêtes arbitraires derrière une lecture tapée actions plutôt que SQL brute dans le chat.

## Environnements d'exécution de l'agent BYO {#byo-agent-runtimes}

`AgentChatRuntime` est le contrat « apportez votre propre agent » pour le shell de chat, et
cette section est sa référence canonique. Il permet à un agent que vous avez créé ailleurs
diffusez des événements normalisés dans la conversation UI de Agent-Native tout en conservant
compositeur partagé, rendu des transcriptions, fiches outils, approbations, widgets natifs,
et la disposition de l'application environnante. Le [Drop-in Agent](/docs/drop-in-agent#custom-chat-ui)
points du didacticiel ici pour l'histoire d'exécution et [Component API](/docs/components#agent-chat-ui)
répertorie chaque connecteur et adaptateur avec son chemin d'importation ; le contrat lui-même est
décrit ci-dessous.

```an-diagram title="Le runtime BYO conserve le shell de discussion Agent-Native" summary="Votre agent externe diffuse des événements normalisés via un connecteur ; Agent-Native conserve le compositeur, la transcription, les fiches outils, les approbations et les widgets natifs."
{
  "html": "<div class=\"diagram-byo\"><div class=\"diagram-box\" data-rough>Votre agent<br><small class=\"diagram-muted\">OpenAI &middot; Claude &middot; Vercel AI &middot; AG-UI &middot; HTTP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">connector</span><small class=\"diagram-muted\">événements message-* / tool-* normalisés</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill\">&lt;AssistantChat runtime=&hellip; /&gt;</div><small class=\"diagram-muted\">composer &middot; transcript &middot; tool cards</small><small class=\"diagram-muted\">approvals &middot; native widgets</small></div></div>",
  "css": ".diagram-byo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-byo .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-byo .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-byo .diagram-arrow{font-size:22px;line-height:1}"
}
```

Tous les connecteurs sont exportés depuis `@agent-native/core/client/chat` (et la racine
Entrée `@agent-native/core/client`). Utilisez le runtime générique HTTP lorsque votre agent
peut exposer un point de terminaison POST qui renvoie des événements d'exécution SSE ou NDJSON :

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

Si votre point de terminaison diffuse déjà un protocole d'agent commun, utilisez le protocole correspondant
connecteur et ignorez l'écriture d'un mappeur personnalisé :

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

Le point de terminaison peut diffuser directement la forme d'événement normalisée :

```text
data: {"type":"message-start","message":{"id":"m1","role":"assistant","content":[]}}
data: {"type":"message-delta","messageId":"m1","delta":{"type":"text","text":"Hello"}}
data: {"type":"tool-start","toolCall":{"id":"t1","name":"query","input":{"q":"forms"}}}
data: {"type":"tool-done","toolCallId":"t1","toolName":"query","status":"completed","resultText":"34 rows"}
data: {"type":"done","reason":"complete"}
```

Pour les agents très simples, une réponse JSON `{ "text": "..." }` est acceptée et
converti en un seul message d'assistant. Pour les agents plus riches, diffusez
`message-*`, `tool-*`, `approval-request`, `status`, `artifact`, `file`,
Événements `usage`, `error` et `done`. Les résultats de l'outil peuvent porter `mcpApp` ou
Métadonnées `chatUI`, donc les widgets natifs déclarés par action s'affichent toujours sans
iframe.

Lorsque vous souhaitez que le transport Agent-Native intégré soit un objet d'exécution, utilisez :

```ts
import { createAgentNativeChatRuntime } from "@agent-native/core/client/chat";

const runtime = createAgentNativeChatRuntime({
  threadId: "forms-chat",
  mode: "act",
});
```

Utilisez `<AssistantChat createAdapter={...} />` uniquement lorsque vous en avez besoin
Contrôle de l'adaptateur assistant-ui. Utilisez `PromptComposer` seul lorsque votre produit
possède l'intégralité de la transcription externe et ne souhaite que le compositeur de Agent-Native
champ.

Les flux OpenAI, AG-UI, Claude Agent SDK et Vercel AI SDK peuvent utiliser la norme
assistants de connecteur. ACP reste l'interopérabilité agent de codage/éditeur, pas le
environnement d'exécution général du chat d'application pour les utilisateurs finaux. A2UI n'est pas déclaré comme pris en charge ici ;
S'il arrive à maturité, il devrait s'adapter à ce même contrat explicite d'exécution/widget.

## Documents associés {#related-docs}

- [Actions](/docs/actions) : définissez les opérations qui renvoient les données natives du widget.
- [Agent Surfaces](/docs/agent-surfaces) : décidez si vous avez besoin d'une application sans interface, de chat, side-car ou complète.
- [Drop-in Agent](/docs/drop-in-agent) — le didacticiel pour monter le runtime de chat standard.
- [Component API](/docs/components) : la carte API par exportation pour les couches de discussion, les environnements d'exécution et les moteurs de rendu d'outils.
- [MCP Apps](/docs/mcp-apps) — UI en ligne pour les hôtes MCP externes.
- [Key Concepts](/docs/key-concepts#protocols) — état et positionnement du protocole.
