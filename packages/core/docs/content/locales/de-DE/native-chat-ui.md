---
title: "Nativer Chat-Oberfläche"
description: "Aktionsdeklarierte native Chat-Renderer, wiederverwendbare DataTable-/DataChart-Ausgaben und wie BYO-Agentenlaufzeiten eine Verbindung zum Agent-Native-Chat herstellen sollten."
---

# Nativer Chat-Oberfläche

Nativer Chat-Oberfläche ist der In-App-Rendering-Pfad für die Ausgabe von Erstanbieter-Agenten. Ein
Aktion gibt strukturiertes JSON zurück, die Chat-Laufzeit erkennt ein explizites Widget
diskriminant, und `<AssistantChat>` rendert eine echte React-Komponente im
Gespräch. Sie erstellen keinen Iframe oder ein einmaliges HTML-Artefakt für
normaler App-Chat.

Verwenden Sie den nativen Chat-Oberfläche, wenn der Benutzer die Ausgabe dort überprüfen soll, wo sich der Agent befindet
redet bereits: Abfrageergebnisse, Antworteinblicke, Setup-Zusammenfassungen,
Genehmigungs-/Ablehnungskontrollen oder Links zu App-Ansichten. Verwenden Sie [MCP Apps](/docs/mcp-apps)
wenn ein externer Host wie Claude, ChatGPT, Copilot oder Cursor rendern soll
eine Inline-Route aus Ihrer App.

```an-diagram title="Der native Renderpfad" summary="Eine Aktion gibt JSON zurück; die Laufzeit entspricht einer expliziten Widget-Diskriminante oder chatUI.renderer; AssistantChat mountet eine echte React-Komponente. Kein Iframe, keine HTML-Ausführung."
{
  "html": "<div class=\"diagram-render\"><div class=\"diagram-node\">Action läuft<br><small class=\"diagram-muted\">gibt strukturiertes JSON zurück</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Match</span><small class=\"diagram-muted\">explicit widget &middot; chatUI.renderer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">&lt;AssistantChat&gt;<br><small class=\"diagram-muted\">mountet ein React-Widget</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill ok\">DataTable</div><div class=\"diagram-pill ok\">DataChart</div><div class=\"diagram-pill ok\">DataInsights</div></div></div>",
  "css": ".diagram-render{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-render .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-render .col{display:flex;flex-direction:column;gap:6px;padding:12px}.diagram-render .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Aktionsdeklarierte Widgets {#action-declared-widgets}

Der native Pfad besteht aus zwei expliziten Teilen:

- `outputSchema` validiert die Antwortform der Aktion.
- `chatUI.renderer` wählt den nativen React-Renderer für das validierte Ergebnis aus.

Die integrierten Datenrenderer verwenden ein einfaches JSON-Ergebnis mit `widget` plus
passende Nutzlast:

| Widget            | Erforderliche Nutzlast         | Wird gerendert als                                           |
| ----------------- | ------------------------------ | ------------------------------------------------------------ |
| `"data-table"`    | `table`                        | Eine native, wiederverwendbare Datentabelle                  |
| `"data-chart"`    | `chartSeries`                  | Ein natives Balken-, Linien- oder Flächendiagramm            |
| `"data-insights"` | `table` und/oder `chartSeries` | Eine kombinierte Insight-Karte mit Diagramm-/Tabellenausgabe |

Server actions sollte die serversicheren Helfer und Schemata importieren von
`@agent-native/core/data-widgets`; Client-Code kann dieselben Typen importieren aus
`@agent-native/core/client/chat` oder `@agent-native/core/client`.

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
  "body": "Der Renderer übernimmt nur, wenn die Aktion `chatUI` deklariert **oder** das Ergebnis eine explizit bekannte `widget`-Diskriminante enthält. Es leitet niemals die Form beliebiger Objekte ab und führt niemals HTML oder JavaScript aus Werkzeugergebnissen aus – ein natives Widget kann also nicht zu einem Injektionsvektor werden."
}
```

Wenn ein Benutzer nach einem Diagramm, einer Grafik, einer Tabelle, einem Trend oder einem kompakten Bericht fragt, app-Agents
sollte eine Aktion bevorzugen, die einen dieser nativen Renderer deklariert. Das Finale
Assistententext sollte kurz bleiben und das Widget die Daten übertragen lassen; nicht kopieren
dieselben Zeilen in eine Markdown-Tabelle einfügen, es sei denn, der Benutzer fragt ausdrücklich nach einem Text
exportieren.

Wenn keine Domänenaktion vorhanden ist, der Agent jedoch bereits die Kompaktheit abgerufen hat,
wahrheitsgemäße Daten, es kann die Framework-Aktion `render-data-widget` mit dem aufrufen
gleiche `data-table`-, `data-chart`- oder `data-insights` JSON-Form. Nur diese Aktion
überprüft und rendert das Widget; Es ist keine Datenquelle und darf nicht verwendet werden
um Platzhaltermetriken zu erfinden.

## DataTable-Ausgabe {#data-table}

`table` ist bewusst einfach gehalten, sodass Liste, SQL, Analyse und Einrichtung von actions möglich sind
wiederverwenden:

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

Stabile Spaltenschlüssel und JSON-sichere Zeilenwerte bevorzugen. Verwenden Sie `totalRows`,
`sampledRows` und `truncated`, wenn die Aktion einen Ausschnitt eines größeren zeigt
Ergebnissatz.

## DataChart-Ausgabe {#data-chart}

`chartSeries` unterstützt die gängigen Diagrammformen, die in Agentenantworten verwendet werden, ohne
Jede Vorlage muss ihren eigenen Chat-Renderer liefern:

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

Kartendaten kompakt halten. Bei großen Datensätzen die Aktion aggregieren und verknüpfen
zur vollständigen App-Ansicht mit `display.primaryAction`- oder Aktions-`link`-Metadaten.

## Native Widgets vs. MCP Apps {#native-vs-mcp-apps}

Native Chat-Widgets und MCP Apps ergänzen sich:

- **Native Widgets** sind für die eigene Chat-Laufzeitumgebung der App vorgesehen. Das Aktionsergebnis ist
  JSON, und das Framework rendert das integrierte React-Widget.
- **MCP Apps** sind für externe Hosts. Die Aktion deklariert `mcpApp` und normalerweise
  `link`, und der Host rendert eine echte App-Route inline, sofern unterstützt.
- **Deep Links** bleiben der universelle Fallback. Verwenden Sie die Aktion `link` oder
  `display.primaryAction` also CLI-Clients, ältere MCP-Hosts und einfaches Transkript
  Leser können die vollständige App-Ansicht öffnen.

Wenn sowohl eine native Widget-Nutzlast als auch MCP Apps-Metadaten vorhanden sind, die In-App
chat bevorzugt das native Widget. Externe Hosts verwenden die MCP Apps-Ressource oder die
Deep-Link-Fallback.

## Benutzerdefinierte native Renderer {#custom-native-renderers}

Produktspezifische Komponenten anhand der genauen Renderer-ID registrieren und dann diese ID deklarieren
zur Aktion:

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

Verwenden Sie dies für die Erstanbieter-App UI. Behalten Sie den hostübergreifenden Iframe UI in `mcpApp` und behalten Sie
willkürliche Abfrageausführung hinter eingegebenem Lese-actions anstelle von rohem SQL im Chat.

## BYO Agentenlaufzeiten {#byo-agent-runtimes}

`AgentChatRuntime` ist der Bring-Your-Own-Agent-Vertrag für die Chat-Shell und
Dieser Abschnitt ist seine kanonische Referenz. Es ermöglicht einen Agenten, den Sie woanders erstellt haben
normalisierte Ereignisse in die Konversation UI von Agent-Native streamen und dabei die beibehalten
Gemeinsamer Verfassenr, Transkript-Rendering, Toolkarten, Genehmigungen, native Widgets,
und das umgebende App-Layout. Der [Drop-in Agent](/docs/drop-in-agent#custom-chat-ui)
Tutorial-Punkte hier für die Laufzeitgeschichte und [Component API](/docs/components#agent-chat-ui)
listet jeden Connector und Adapter mit seinem Importpfad auf; Der Vertrag selbst ist
unten beschrieben.

```an-diagram title="Die BYO-Laufzeit behält die Agent-Native-Chat-Shell bei" summary="Ihr externer Agent streamt normalisierte Ereignisse über einen Connector; Agent-Native behält den Komponisten, das Transkript, die Werkzeugkarten, Genehmigungen und native Widgets."
{
  "html": "<div class=\"diagram-byo\"><div class=\"diagram-box\" data-rough>Dein Agent<br><small class=\"diagram-muted\">OpenAI &middot; Claude &middot; Vercel AI &middot; AG-UI &middot; HTTP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">connector</span><small class=\"diagram-muted\">normalisierte message-* / tool-*-Events</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill\">&lt;AssistantChat runtime=&hellip; /&gt;</div><small class=\"diagram-muted\">composer &middot; transcript &middot; tool cards</small><small class=\"diagram-muted\">approvals &middot; native widgets</small></div></div>",
  "css": ".diagram-byo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-byo .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-byo .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-byo .diagram-arrow{font-size:22px;line-height:1}"
}
```

Alle Connectors werden aus `@agent-native/core/client/chat` (und dem Root) exportiert
`@agent-native/core/client`-Eintrag). Verwenden Sie die generische HTTP-Laufzeit, wenn Ihr Agent
kann einen POST-Endpunkt verfügbar machen, der SSE- oder NDJSON-Laufzeitereignisse zurückgibt:

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

Wenn Ihr Endpunkt bereits ein gemeinsames Agentenprotokoll streamt, verwenden Sie das entsprechende
Connector und überspringen Sie das Schreiben eines benutzerdefinierten Mappers:

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

Der Endpunkt kann die normalisierte Ereignisform direkt streamen:

```text
data: {"type":"message-start","message":{"id":"m1","role":"assistant","content":[]}}
data: {"type":"message-delta","messageId":"m1","delta":{"type":"text","text":"Hello"}}
data: {"type":"tool-start","toolCall":{"id":"t1","name":"query","input":{"q":"forms"}}}
data: {"type":"tool-done","toolCallId":"t1","toolName":"query","status":"completed","resultText":"34 rows"}
data: {"type":"done","reason":"complete"}
```

Für sehr einfache Agenten wird eine JSON-Antwort `{ "text": "..." }` akzeptiert und
in eine einzelne Assistentennachricht umgewandelt. Für umfangreichere Agenten streamen Sie
`message-*`, `tool-*`, `approval-request`, `status`, `artifact`, `file`,
`usage`-, `error`- und `done`-Ereignisse. Werkzeugergebnisse können `mcpApp` oder
`chatUI`-Metadaten, sodass aktionsdeklarierte native Widgets immer noch ohne gerendert werden
iframes.

Wenn Sie den integrierten Agent-Native-Transport als Laufzeitobjekt verwenden möchten, verwenden Sie:

```ts
import { createAgentNativeChatRuntime } from "@agent-native/core/client/chat";

const runtime = createAgentNativeChatRuntime({
  threadId: "forms-chat",
  mode: "act",
});
```

Verwenden Sie `<AssistantChat createAdapter={...} />` nur, wenn Sie die volle Kapazität benötigen
Assistent-UI-Adaptersteuerung. Verwenden Sie `PromptComposer` allein für Ihr Produkt
besitzt das gesamte externe Transkript und möchte nur den Komponisten von Agent-Native
Feld.

OpenAI-, AG-UI-, Claude Agent SDK- und Vercel AI SDK-Streams können den Standard verwenden
Connector-Helfer. ACP bleibt die Interoperabilität zwischen Codierungsagent und Editor, nicht die
allgemeine App-Chat-Laufzeit für Endbenutzer. A2UI wird hier nicht als unterstützt beansprucht;
Wenn es ausgereift ist, sollte es sich an denselben expliziten Laufzeit-/Widget-Vertrag anpassen.

## Verwandte Dokumente {#related-docs}

- [Actions](/docs/actions) – Definieren Sie die Vorgänge, die native Widget-Daten zurückgeben.
- [Agent Surfaces](/docs/agent-surfaces) – entscheiden Sie, ob Sie eine Headless-, Chat-, Sidecar- oder vollständige App benötigen.
- [Drop-in Agent](/docs/drop-in-agent) – das Tutorial zum Mounten der Standard-Chat-Laufzeitumgebung.
- [Component API](/docs/components) – die API-Karte pro Export für Chat-Ebenen, Laufzeiten und Tool-Renderer.
- [MCP Apps](/docs/mcp-apps) – Inline-UI für externe MCP-Hosts.
- [Key Concepts](/docs/key-concepts#protocols) – Protokollstatus und Positionierung.
