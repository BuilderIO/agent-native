---
title: "Componente API"
description: "Blocos de construção React públicos para agente personalizado UI, campos de bate-papo, renderização de conversa, presença em tempo real, compartilhamento, progresso e editores avançados."
---

# Componente API

Agent-Native envia uma barra lateral completa, mas a barra lateral não é o contrato. O
contrato é o tempo de execução: streaming de bate-papo, estado do thread, actions, contexto,
anexos, seleção de modelo, execuções e sincronização apoiada por SQL. Use o estoque
componentes quando possível e uma camada suspensa quando precisar do produto personalizado UI.

Importar navegador UI de subcaminhos de cliente em foco:

```tsx
import { AgentSidebar } from "@agent-native/core/client";
import { PromptComposer } from "@agent-native/core/client/composer";
import { AgentConversation } from "@agent-native/core/client/conversation";
import { usePresence } from "@agent-native/core/client/collab";
import { SharedRichEditor } from "@agent-native/core/client/editor";
import { ResourcesPanel } from "@agent-native/core/client/resources";
```

Evite importar componentes UI do pacote `@agent-native/core` simples. Usar
`@agent-native/core/client` ou um subcaminho `@agent-native/core/client/*` em foco
para que os empacotadores escolham a entrada segura para o navegador.

```an-diagram title="Desça uma camada, não fora da estrutura" summary="Cada camada mantém o mesmo tempo de execução – ações, estado do thread e sincronização SQL-backed – enquanto oferece mais controle sobre o cromo."
{
  "html": "<div class=\"diagram-layers\"><div class=\"diagram-card layer\"><span class=\"diagram-pill accent\">&lt;AgentSidebar&gt;</span><small class=\"diagram-muted\">Sidebar inteira em volta do app. O caso de 80%.</small></div><div class=\"diagram-card layer l2\"><span class=\"diagram-pill\">&lt;AgentPanel&gt; &middot; &lt;AgentChatSurface&gt;</span><small class=\"diagram-muted\">O painel ou uma página de chat no seu próprio layout.</small></div><div class=\"diagram-card layer l3\"><span class=\"diagram-pill\">&lt;AssistantChat&gt; + runtime</span><small class=\"diagram-muted\">Own the chrome; optionally pass a BYO AgentChatRuntime.</small></div><div class=\"diagram-card layer l4\"><span class=\"diagram-pill\">&lt;PromptComposer&gt; &middot; &lt;AgentConversation&gt;</span><small class=\"diagram-muted\">Escreverr and transcript primitives only.</small></div><div class=\"diagram-rail\" data-rough>Mesmo runtime: actions &middot; thread state &middot; SQL-backed sync</div></div>",
  "css": ".diagram-layers{display:flex;flex-direction:column;gap:10px}.diagram-layers .layer{display:flex;flex-direction:column;gap:4px;padding:12px 14px}.diagram-layers .l2{margin-inline-start:24px}.diagram-layers .l3{margin-inline-start:48px}.diagram-layers .l4{margin-inline-start:72px}.diagram-layers .diagram-rail{margin-top:6px;padding:10px 14px;text-align:center}"
}
```

## Agente e bate-papo UI {#agent-chat-ui}

| API                                  | Caminho de importação                         | Usar quando                                                                                                                |
| ------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `<AgentSidebar>`                     | `@agent-native/core/client` ou `/client/chat` | Você deseja a barra lateral completa do seu aplicativo.                                                                    |
| `<AgentToggleButton>`                | `@agent-native/core/client` ou `/client/chat` | Você renderiza seu próprio botão de cabeçalho para a barra lateral.                                                        |
| `<AgentPanel>`                       | `@agent-native/core/client` ou `/client/chat` | Você deseja o painel completo em seu próprio layout, rota, caixa de diálogo ou coluna lateral.                             |
| `<AgentChatSurface>`                 | `@agent-native/core/client` ou `/client/chat` | Você deseja conversar no modo painel ou página sem o wrapper da barra lateral.                                             |
| `<AssistantChat>`                    | `@agent-native/core/client` ou `/client/chat` | Você deseja possuir o Chrome circundante, mantendo a conversação padrão e o tempo de execução do compositor.               |
| `<MultiTabAssistantChat>`            | `@agent-native/core/client` ou `/client/chat` | Você deseja as guias de thread da estrutura sem o cromo `AgentPanel`.                                                      |
| `createHttpAgentChatRuntime()`       | `@agent-native/core/client` ou `/client/chat` | Você tem um endpoint de agente BYO que transmite eventos de chat normalizados.                                             |
| `createOpenAIAgentsChatRuntime()`    | `@agent-native/core/client` ou `/client/chat` | Você tem um stream OpenAI Agents SDK e deseja usar o chat padrão UI em torno dele.                                         |
| `createOpenAIResponsesChatRuntime()` | `@agent-native/core/client` ou `/client/chat` | Você tem um fluxo de eventos de respostas OpenAI e deseja que ele seja normalizado no chat UI.                             |
| `createAgUiChatRuntime()`            | `@agent-native/core/client` ou `/client/chat` | Você tem um stream de eventos AG-UI e deseja que ele seja normalizado no chat UI.                                          |
| `createClaudeAgentChatRuntime()`     | `@agent-native/core/client` ou `/client/chat` | Você tem um stream do Agente Claude SDK e deseja que ele seja normalizado no chat UI.                                      |
| `createVercelAiChatRuntime()`        | `@agent-native/core/client` ou `/client/chat` | Você tem um stream Vercel AI SDK e deseja que ele seja normalizado no chat UI.                                             |
| `createAgentChatRuntimeAdapter()`    | `@agent-native/core/client` ou `/client/chat` | Você mesmo precisa adaptar um `AgentChatRuntime` para a interface do assistente.                                           |
| `createAgentChatAdapter()`           | `@agent-native/core/client` ou `/client/chat` | Você precisa do transporte Agent-Native SSE integrado como um adaptador de interface do usuário assistente de baixo nível. |
| `useChatThreads()`                   | `@agent-native/core/client` ou `/client/chat` | Você precisa de uma lista de conversas personalizada, um seletor de histórico ou um bate-papo com escopo UI.               |
| `sendToAgentChat()`                  | `@agent-native/core/client` ou `/client/chat` | Uma ação de produto deve entregar o trabalho ao chat do agente.                                                            |

`AgentChatRuntime` é o contrato do agente BYO para o shell de chat padrão. Passe
`runtime` para `<AssistantChat>` quando um agente externo deve alimentar o
conversa enquanto Agent-Native mantém o compositor, a transcrição, os cartões de ferramentas e
renderização de widget nativo. Os conectores acima são a superfície API; o tempo de execução
formas de contratos e eventos são ensinadas em
[Native Interface de chat — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes).
Se você estiver escolhendo entre agentes sem comando, chat avançado, sidecar incorporado e
formas completas do aplicativo, consulte [Agent Surfaces](/docs/agent-surfaces).

A rota personalizada mais curta ainda é uma superfície pré-conectada:

```tsx
import { AgentChatSurface } from "@agent-native/core/client/chat";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-screen" />;
}
```

Para cromo personalizado em torno do tempo de execução padrão:

```tsx
import { AssistantChat, useChatThreads } from "@agent-native/core/client/chat";

function CustomChat({ projectSlug }: { projectSlug: string }) {
  const threads = useChatThreads(undefined, projectSlug);
  const threadId = threads.activeThreadId ?? undefined;

  return (
    <section className="grid h-full grid-cols-[260px_1fr]">
      <ThreadList
        threads={threads.threads}
        activeThreadId={threadId}
        onSelect={threads.switchThread}
      />
      <AssistantChat threadId={threadId} />
    </section>
  );
}
```

Para um endpoint do tipo "traga seu próprio agente", crie um `AgentChatRuntime` com um dos
conectores acima e passe-os para `<AssistantChat runtime={...} />`. Veja
[Native Interface de chat — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes)
para o uso do conector, o fluxo de eventos normalizado e quando alcançá-lo
`createHttpAgentChatRuntime()` versus um conector específico de protocolo.

## Campo de bate-papo e compositor {#composer}

Use `@agent-native/core/client/composer` quando precisar colocar o mesmo chat
campo usado pela barra lateral dentro do UI personalizado.

| API                               | Usar quando                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<PromptComposer>`                | Você precisa de um campo de bate-papo pronto para envio com anexos, comandos de barra, referências, manipulação de texto colado, persistência de rascunho, entrada de voz e semântica de envio. |
| `<AgentComposerFrame>`            | Você deseja o shell visual padrão em torno de um corpo de compositor personalizado.                                                                                                             |
| `<TiptapComposer>`                | Você precisa do campo de bate-papo avançado de nível mais baixo. Ele deve ser renderizado dentro de um runtime assistant-ui `ThreadPrimitive.Root`/composer.                                    |
| `buildPromptComposerSubmission()` | Você precisa do mesmo anexo e da mesma normalização do texto colado antes de chamar seu próprio manipulador de envio.                                                                           |
| `formatPromptWithAttachments()`   | Você precisa renderizar metadados de anexos ocultos em uma string de prompt.                                                                                                                    |

A maioria dos UIs personalizados devem começar com `PromptComposer`:

```tsx
import { PromptComposer } from "@agent-native/core/client/composer";

<PromptComposer
  placeholder="Ask the agent..."
  onSubmit={async (text, files, references, options) => {
    await sendMessageToYourRuntime({ text, files, references, options });
  }}
/>;
```

Use `TiptapComposer` somente se você já estiver conectando primitivos assistant-ui
você mesmo. É o campo, não todo o tempo de execução do chat.

## Renderização de conversa {#conversation}

Use `@agent-native/core/client/conversation` para renderização em estilo de transcrição
fora do tempo de execução completo do agente.

| API                                             | Usar quando                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `<AgentConversation>`                           | Renderize uma lista de mensagens normalizadas do agente.                               |
| `<AgentConversationMessageView>`                | Renderize uma mensagem normalizada.                                                    |
| `normalizeCodeAgentTranscriptForConversation()` | Converta eventos de transcrição do agente de código em mensagens de conversa.          |
| `useNearBottomAutoscroll()`                     | Mantenha uma transcrição personalizada fixada na parte inferior durante a transmissão. |

Essa camada prioriza os dados intencionalmente: você sabe de onde vêm as mensagens e
o renderizador possui descontos, anexos, avisos, artefatos e
exibição de chamada de ferramenta.

## Widgets de ferramentas nativas {#native-tool-widgets}

Use widgets de ferramentas nativas quando o resultado de uma ação for renderizado como UI com qualidade de aplicativo
chat interno em vez de JSON simples. As saídas reutilizáveis integradas incluem
`DataTableWidget`, `DataChartWidget` e `DataWidgetResult`; eles são exportados
de `@agent-native/core/client/chat` e a entrada do cliente raiz. Veja
[Native Interface de chat](/docs/native-chat-ui) para o contrato de resultado de ação.

| API                              | Usar quando                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DataTableWidget`                | Você deseja que o resultado de uma ação renderize linhas e colunas no chat nativo.                          |
| `DataChartWidget`                | Você deseja uma saída compacta de gráfico de barras, linhas ou áreas no chat nativo.                        |
| `DataWidgetResult`               | Você deseja um formato de resultado digitado para `"data-table"`, `"data-chart"` ou `"data-insights"`.      |
| `registerActionChatRenderer()`   | Você precisa de um renderizador com ação declarada selecionado por `chatUI.renderer` exato.                 |
| `registerToolRenderer()`         | Você precisa de um renderizador nativo específico do produto para um resultado de ferramenta não essencial. |
| `registerReservedToolRenderer()` | O código da estrutura precisa de um renderizador reservado que vença os renderizadores de modelo.           |

## Colaboração e presença em tempo real {#collab-presence}

Use `@agent-native/core/client/collab` para presença no estilo Liveblocks e
ganchos de documentos colaborativos.

| API                                                 | Usar quando                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `useCollaborativeDoc()`                             | Vincule um editor de rich text ou uma superfície Yjs personalizada ao `/_agent-native/collab`.               |
| `usePresence()`                                     | Publique e renderize campos de reconhecimento arbitrários: cursores, seleções, janela de visualização, modo. |
| `<PresenceBar>`                                     | Mostre colaboradores humanos e agentes ativos.                                                               |
| `<LiveCursorOverlay>`                               | Renderize rótulos de cursor remoto sobre um contêiner posicionado.                                           |
| `<RemoteSelectionRings>`                            | Renderizar contornos de seleção remota sobre elementos DOM.                                                  |
| `useFollowUser()`                                   | Seguir a janela de visualização ou seleção de outro participante.                                            |
| `useCollaborativeMap()` / `useCollaborativeArray()` | Experimente o estado Y.Map/Y.Array estruturado quando a colaboração do corpo em rich text não for adequada.  |
| `dedupeCollabUsersByEmail()`                        | Crie uma pilha de avatares personalizada sem guias duplicadas para o mesmo usuário.                          |

```an-diagram title="Presença: os humanos e o agente compartilham uma camada de consciência" summary="useCollaborativeDoc possui a instância de reconhecimento; ganchos de cliente publicam cursores e seleções; os ajudantes do servidor permitem que uma ação do agente apareça como um participante ao vivo."
{
  "html": "<div class=\"diagram-presence\"><div class=\"diagram-col\"><div class=\"diagram-node\">Humans<br><small class=\"diagram-muted\">usePresence &middot; cursors, selection</small></div><div class=\"diagram-node diagram-accent\">Ação do agente<br><small class=\"diagram-muted\">agentUpdateSelection()</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">useCollaborativeDoc</span><small class=\"diagram-muted\">awareness layer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">&lt;PresenceBar&gt; &middot; &lt;LiveCursorOverlay&gt;<br><small class=\"diagram-muted\">renderiza todos, agente incluído</small></div></div>",
  "css": ".diagram-presence{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-presence .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-presence .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-presence .diagram-arrow{font-size:22px;line-height:1}"
}
```

O agente do lado do servidor actions que deseja aparecer como um participante ao vivo usa o
ajudantes de presença do agente `@agent-native/core/collab` de nível inferior:

```ts
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
```

## Editor avançado {#rich-editor}

Use `@agent-native/core/client/editor` quando precisar do editor de markdown compartilhado
superfície usada por planos, conteúdo, recursos e documentos colaborativos
experiências.

| API                              | Usar quando                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `<SharedRichEditor>`             | Você precisa do editor atual e configurável com serialização de redução, Yjs opcionais e extras de aplicativo.                 |
| `<RichMarkdownEditor>`           | Você precisa do alias compatível com versões anteriores para o editor avançado compartilhado.                                  |
| `createSharedEditorExtensions()` | Você está construindo seu próprio editor Tiptap, mas deseja o esquema da estrutura e os dialetos de markdown.                  |
| `<SlashCommandMenu>`             | Você precisa do comando de barra compartilhado UI para uma superfície Tiptap personalizada.                                    |
| `<BubbleToolbar>`                | Você precisa da barra de ferramentas de seleção compartilhada para marcas, links e actions embutido personalizado.             |
| `createRegistryBlockNode()`      | Você precisa de nós de bloco apoiados por registro dentro de um editor avançado.                                               |
| `uploadEditorImage()`            | Você deseja que a ação upload-image da estrutura esteja por trás do bloco de imagem compartilhada do editor.                   |
| `useCollabReconcile()`           | Você está vinculando uma superfície de editor personalizada a um documento Yjs enquanto preserva a marcação como estado salvo. |

O editor controlado básico é apenas markdown in e markdown out:

```tsx
import { SharedRichEditor } from "@agent-native/core/client/editor";

<SharedRichEditor
  value={markdown}
  onChange={setMarkdown}
  placeholder="Write notes..."
  features={{ tables: true, tasks: true, link: true }}
/>;
```

Para edição em tempo real, combine-o com o subcaminho collab:

```tsx
import {
  emailToColor,
  useCollaborativeDoc,
} from "@agent-native/core/client/collab";
import { SharedRichEditor } from "@agent-native/core/client/editor";

const editorUser = {
  name: user.name,
  email: user.email,
  color: emailToColor(user.email),
};
const collab = useCollaborativeDoc({
  docId,
  user: editorUser,
});

<SharedRichEditor
  value={markdown}
  onChange={setMarkdown}
  ydoc={collab.ydoc}
  awareness={collab.awareness}
  user={editorUser}
/>;
```

## Recursos do espaço de trabalho {#resources}

Use `@agent-native/core/client/resources` quando quiser expor o mesmo
modelo de recurso de espaço de trabalho que alimenta a guia Espaço de trabalho do painel do agente.

| API                                                                   | Usar quando                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `<ResourcesPanel>`                                                    | Você deseja a guia Espaço de trabalho completa como uma página, gaveta ou painel personalizado.        |
| `<ResourceTree>`                                                      | Você deseja renderizar seu próprio navegador de recursos em torno dos dados da estrutura.              |
| `<ResourceEditor>`                                                    | Você deseja o editor de estrutura para um recurso selecionado.                                         |
| `useResourceTree()`                                                   | Você precisa de uma árvore com escopo para recursos pessoais, compartilhados ou de espaço de trabalho. |
| `useResource()`                                                       | Você precisa do conteúdo e dos metadados de um recurso selecionado.                                    |
| `useCreateResource()` / `useUpdateResource()` / `useDeleteResource()` | Você precisa de controles personalizados em torno do ciclo de vida dos recursos.                       |
| `useUploadResource()`                                                 | Você precisa fazer o upload do arquivo para o armazenamento de recursos da estrutura.                  |

O painel completo não precisa de acessórios:

```tsx
import { ResourcesPanel } from "@agent-native/core/client/resources";

<ResourcesPanel />;
```

Para cromo de recurso personalizado, mantenha os ganchos e os primitivos juntos:

```tsx
import { useState } from "react";
import {
  ResourceEditor,
  ResourceTree,
  useResource,
  useResourceTree,
  useUpdateResource,
} from "@agent-native/core/client/resources";

function WorkspaceResources() {
  const tree = useResourceTree("workspace");
  const updateResource = useUpdateResource();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const resource = useResource(selectedId);

  return (
    <div className="grid h-full grid-cols-[260px_1fr]">
      <ResourceTree
        tree={tree.data ?? []}
        selectedId={selectedId}
        onSelect={(item) => setSelectedId(item.id)}
        onCreateFile={() => {}}
        onCreateFolder={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
        onDrop={() => {}}
      />
      {resource.data ? (
        <ResourceEditor
          resource={resource.data}
          onSave={(content) =>
            updateResource.mutate({ id: resource.data.id, content })
          }
        />
      ) : null}
    </div>
  );
}
```

## Outro UI público {#other-ui}

| Área             | APIs                                                            | Caminho de importação                     |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------- |
| Compartilhamento | `<ShareButton>`, `<ShareDialog>`, `<VisibilityBadge>`           | `@agent-native/core/client/sharing`       |
| Notificações     | `<NotificationsBell>`                                           | `@agent-native/core/client/notifications` |
| Progresso        | `<RunsTray>`, ganchos e tipos de progresso                      | `@agent-native/core/client/progress`      |
| Integração       | `useOnboarding()`, ganchos de painel integrados                 | `@agent-native/core/client/onboarding`    |
| Observabilidade  | `<ObservabilityDashboard>`, `<ThumbsFeedback>`                  | `@agent-native/core/client/observability` |
| Recursos         | `<ResourcesPanel>`, `<ResourceTree>`, ganchos de recursos       | `@agent-native/core/client/resources`     |
| Editor avançado  | `<SharedRichEditor>`, comandos de barra, ganchos de nó de bloco | `@agent-native/core/client/editor`        |

## Completamento de texto único {#one-off-text-completion}

Se você realmente precisa de entrada/saída de texto bruto, mantenha-o no lado do servidor e use
`completeText()` de `@agent-native/core/server`. Envolva o uso voltado ao usuário em um
ação para que UI e o agente compartilhem a mesma capacidade.

```an-callout
{
  "tone": "warning",
  "body": "`completeText()` is the escape hatch, not the default. Reach for it only for true text-in/text-out (a label, a one-line rewrite). Anything needing tools, state, auditability, or steering belongs in an action plus `sendToAgentChat({ background: true })`."
}
```

```ts
import { defineAction } from "@agent-native/core/action";
import { completeText } from "@agent-native/core/server";

export default defineAction({
  description: "Classify a short message",
  run: async ({ body }: { body: string }) => {
    const result = await completeText({
      systemPrompt: "Return exactly one label.",
      input: body,
      maxOutputTokens: 12,
      temperature: 0,
    });
    return { label: result.text.trim() };
  },
});
```

Use `sendToAgentChat({ background: true, openSidebar: false })` quando
o trabalho precisa de ferramentas, estado, auditabilidade, orientação do usuário ou várias etapas
raciocínio.
