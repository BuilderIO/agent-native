---
title: "Agente sin cita previa"
description: "Monte el espacio de trabajo y chat del agente en cualquier aplicación React con <AgentPanel>, <AgentSidebar> y sendToAgentChat()."
---

# Agente sin cita previa

> **Página del desarrollador.** Esta página es para desarrolladores que integran el agente en una aplicación React. Para conocer la experiencia del usuario final al trabajar con el agente, consulte [Using Your Agent](/docs/using-your-agent).

No es necesario crear un agente nativo desde cero. El chat del agente, la pestaña del espacio de trabajo, el terminal CLI, la entrada de voz y toda la infraestructura relacionada se envían como un puñado de componentes React que se pueden colocar en cualquier aplicación.

> **Requisito previo:** el servidor debe ejecutar `agent-chat-plugin` (se monta automáticamente en cada plantilla). Si estás empezando desde cero, consulta [Server](/docs/server).
>
> ¿Necesita el mapa público API en lugar de un tutorial? Ver [Component API](/docs/components).

## Los componentes de un vistazo {#components}

| Componente            | Qué es                                                                                                      | Úselo cuando                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `<AgentSidebar>`      | Ajusta el diseño de tu aplicación raíz y agrega un panel lateral alternable que contiene el agente completo | Quieres que el agente esté disponible junto con tu aplicación en todas las pantallas |
| `<AgentToggleButton>` | Abre/cierra `<AgentSidebar>` (ponlo en tu encabezado)                                                       | Emparejar con `<AgentSidebar>`                                                       |
| `<AgentPanel>`        | El panel sin formato en sí: chat + CLI + pestañas del espacio de trabajo                                    | Quieres control total sobre el diseño o una página de agente dedicada                |
| `<AgentChatSurface>`  | Un panel/superficie de chat de página precableado                                                           | Quieres chatear sin el envoltorio de la barra lateral                                |
| `<AssistantChat>`     | Representador de chat de nivel inferior con enlaces de compositor/historial                                 | Necesitas Chrome personalizado en torno a la conversación estándar UI                |
| `sendToAgentChat()`   | Enviar un mensaje al chat mediante programación                                                             | Un botón que entrega el trabajo al agente en lugar de ejecutarlo en línea            |
| `useActionMutation()` | Envoltura de interfaz Typesafe alrededor de una acción                                                      | El UI necesita ejecutar la misma operación que ejecutaría una herramienta de agente  |

Todos estos se exportan desde `@agent-native/core/client`.

```an-diagram title="El modelo de montaje" summary="<AgentSidebar> ajusta su diseño existente. Tus rutas se muestran en el área principal; el panel del agente se monta junto a ellos. <AgentPanel> es el mismo panel sin el contenedor."
{
  "html": "<div class=\"diagram-mount\"><div class=\"diagram-box sidebar\" data-rough><span class=\"diagram-pill accent\">&lt;AgentSidebar&gt;</span><div class=\"inner\"><div class=\"diagram-node main\">Tu aplicación<br><small class=\"diagram-muted\">children: header + &lt;Outlet/&gt;</small></div><div class=\"diagram-node panel\">Panel del agente<br><small class=\"diagram-muted\">chat &middot; CLI &middot; workspace</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-card alt\"><span class=\"diagram-pill\">&lt;AgentPanel&gt;</span><small class=\"diagram-muted\">same panel, no wrapper &mdash; you own the layout</small></div></div>",
  "css": ".diagram-mount{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mount .sidebar{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-mount .inner{display:flex;gap:10px}.diagram-mount .main{flex:2}.diagram-mount .panel{flex:1}.diagram-mount .alt{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-mount .diagram-arrow{font-size:22px;line-height:1}"
}
```

## El caso del 80%: `<AgentSidebar>` {#sidebar}

La configuración más común es una barra lateral que se abre desde la derecha en cualquier pantalla.
Ajuste su diseño raíz existente con `<AgentSidebar>`; lo que sea que pases por
los niños permanecen en el área principal de la aplicación. El chat del agente es el panel lateral.

```an-annotated-code title="Ajustando el diseño raíz con <AgentSidebar>"
{
  "filename": "app/root.tsx",
  "language": "tsx",
  "code": "import { Outlet } from \"react-router\";\nimport { AgentSidebar, AgentToggleButton } from \"@agent-native/core/client\";\n\nexport default function Root() {\n  return (\n    <AgentSidebar\n      emptyStateText=\"¿Cómo puedo ayudar?\"\n      suggestions={[\n        \"Summarize my inbox\",\n        \"Draft a reply to the latest email\",\n        \"Show me yesterday's signup numbers\",\n      ]}\n      dynamicSuggestions\n      defaultSidebarWidth={420}\n      position=\"right\"\n    >\n      <header>\n        <AgentToggleButton />\n      </header>\n\n      <main>\n        <Outlet />\n      </main>\n    </AgentSidebar>\n  );\n}",
  "annotations": [
    { "lines": "6", "label": "Envoltorio", "note": "`<AgentSidebar>` wraps your whole layout. It adds the toggleable side panel; everything you pass as children stays in the main app area." },
    { "lines": "8-12", "label": "Indicaciones de inicio", "note": "`suggestions` se renderiza como chips en los que se puede hacer clic en el chat vacío." },
    { "lines": "13", "label": "Chips sensibles al contexto", "note": "`dynamicSuggestions` merges screen-aware prompts (e.g. \"Summarize this selection\") with your static ones. On by default." },
    { "lines": "18-20", "label": "Botón de alternar", "note": "Put `<AgentToggleButton />` anywhere in your header to open and close the panel." },
    { "lines": "22-24", "label": "Tu aplicación", "note": "`<Outlet/>` (your routes) renders in the main area, untouched." }
  ]
}
```

Eso es todo. El usuario ahora tiene un agente alternable en cada página, con historial de chat, pestaña de espacio de trabajo, terminal CLI, entrada de voz y modo de pantalla completa. El estado persiste entre recargas a través de `localStorage`.

### Accesorios

- **`children`**: el diseño y las rutas normales de tu aplicación. Representado en el área principal; el panel del agente se monta junto a él en el escritorio y encima en el móvil/pantalla completa.
- **`emptyStateText`**: saludo que se muestra cuando el chat no tiene mensajes. Valor predeterminado: `"How can I help you?"`.
- **`suggestions`**: los mensajes de inicio se muestran como chips en los que se puede hacer clic cuando están vacíos.
- **`dynamicSuggestions`**: chips de aviso contextuales fusionados con `suggestions`. Habilitado de forma predeterminada; pase `false` para mostrar solo sugerencias estáticas o `{ max, includeStatic, getSuggestions }` para personalizar.
- **`defaultSidebarWidth`**: ancho de píxel inicial (solo montaje; cambio de tamaño por parte del usuario y anulación del valor guardado). Valor predeterminado: `380`.
- **`position`** — `"left"` o `"right"`. Valor predeterminado: `"right"`.
- **`defaultOpen`**: si la barra lateral comienza a abrirse (solo en escritorio). Valor predeterminado: `false`.

## El otro 20%: `<AgentPanel>` {#panel}

Cuando necesite control total sobre el diseño (una ruta `/chat` dedicada, un panel integrado en una columna lateral que administre o una ventana emergente), renderice `<AgentPanel>` directamente:

```tsx
// app/routes/agent.tsx
import { AgentPanel } from "@agent-native/core/client";

export default function AgentRoute() {
  return (
    <div className="h-screen">
      <AgentPanel defaultMode="chat" className="h-full" />
    </div>
  );
}
```

`<AgentPanel>` le ofrece pestañas sin formato (Chat/CLI/Espacio de trabajo) sin el envoltorio de la barra lateral, el botón contraer ni ninguna persistencia de estado. Ponlo donde quieras; tú manejas el diseño.

### Accesorios seleccionados

- **`defaultMode`** — `"chat"` o `"cli"`. Valor predeterminado: `"chat"`.
- **`className`** — Clase CSS para el contenedor exterior.
- **`onCollapse`**: si se proporciona, aparece un botón para contraer en el encabezado.
- **`isFullscreen`** / **`onToggleFullscreen`**: conecte el estado de pantalla completa externo si desea una columna centrada estilo Claude.
- **`storageKey`**: espacio de nombres para claves `localStorage`. Útil cuando renderizas varios paneles (diferentes instancias de aplicaciones o espacios de trabajo) en la misma página.

Accesorios completos: `AgentPanelProps` en `@agent-native/core/client`.

## Mensajes programáticos: `sendToAgentChat()` {#send}

Un botón que entrega el trabajo al agente (en lugar de ejecutar una llamada `llm()` en línea, el antipatrón del [ladder](/docs/what-is-agent-native#the-ladder)):

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

<Button
  onClick={() =>
    sendToAgentChat({
      message: "Generate a chart showing signups by source",
      context: `Dashboard ID: ${dashboardId}, date range: last 30 days`,
      submit: true,
    })
  }
>
  Generate chart
</Button>;
```

### Opciones

- **`message`**: el mensaje visible que se muestra en el chat.
- **`context`**: contexto oculto agregado al mensaje (texto seleccionado, posición del cursor, ID de entidad actual: cualquier cosa que el agente debería saber pero que el usuario no debería ver dos veces).
- **`submit`**: `true` se ejecutará automáticamente, `false` se precargará pero espere. Omita utilizar el valor predeterminado del proyecto.
- **`newTab`**: crea un hilo de chat independiente para este mensaje.
- **`background`** — con `newTab`, ejecute sin enfocar el nuevo hilo. La ejecución oculta se rastrea en `RunsTray`.
- **`openSidebar`**: configurado en `false` para envíos en segundo plano/silenciosos. Predeterminado abre la barra lateral para que el usuario vea la respuesta.
- **`type`**: `"content"` (predeterminado) mantiene el trabajo en el agente de aplicación integrado. `"code"` enruta al marco de edición de código (para cambios de código escritos por el agente, consulte [Frames](/docs/frames)).

`sendToAgentChat` devuelve un `tabId` estable que puedes utilizar para realizar un seguimiento de la ejecución del chat.

Para trabajo silencioso, empareje `newTab`, `background` y `openSidebar: false`:

```ts
sendToAgentChat({
  message: "Summarize the selected thread and save the summary",
  context: `Thread id: ${threadId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

Esto sigue siendo una ejecución completa del agente con herramientas, actions, estado del hilo y ejecución
seguimiento. Simplemente no roba el foco del estado actual de la barra lateral del usuario.

Cuando la misma ruta está integrada como una aplicación MCP, enviada
Las llamadas `sendToAgentChat()` se reenvían al chat del anfitrión cuando sea compatible; ver
[Client](/docs/client#sendtoagentchat) para el comportamiento del puente de la aplicación MCP.

Si desea un estado de carga, utilice el gancho `useSendToAgentChat()`; devuelve tanto `send` como `isGenerating`:

```ts
import { useSendToAgentChat } from "@agent-native/core/client";

const { send, isGenerating } = useSendToAgentChat();
```

## Cuando la barra lateral de acciones no es la adecuada {#custom-chat-ui}

`<AgentSidebar>` y `<AgentPanel>` cubren la mayoría de las aplicaciones. Cuando necesitas ser dueño del
diseño alrededor del agente, o desea impulsar la conversación con un agente
construiste en otro lugar, despliega una capa, pero sigue dejando que el marco sea dueño del
tiempo de ejecución, actions y estado respaldado por SQL:

- **Sea propietario de Chrome en el tiempo de ejecución estándar.** Utilice `<AgentChatSurface>` para
  una ruta de chat dedicada, o `<AssistantChat>` cuando quieras encabezados personalizados,
  pestañas y estados vacíos alrededor de la conversación estándar. El mapa de capas completo:
  cada componente, gancho, compositor y adaptador, con rutas de importación, vive en
  [Component API](/docs/components#agent-chat-ui).
- **Traiga su propio tiempo de ejecución de agente.** Si un agente que creó en otro lugar debería hacerlo
  impulsa la conversación mientras Agent-Native mantiene el compositor, la transcripción y la herramienta
  tarjetas, aprobaciones y widgets nativos, pase un `AgentChatRuntime` a
  `<AssistantChat runtime={...} />`. Los conectores
  (`createHttpAgentChatRuntime()` y OpenAI / Claude / Vercel AI / AG-UI
  helpers) y el contrato del evento están documentados en
  [Native Interfaz de chat — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes).

Cualquiera que sea la capa que elija, mantenga el estado de la aplicación respaldada por actions y SQL como contrato,
y evite publicar directamente en `/_agent-native/agent-chat` desde el producto UI. Si un
Falta el ayudante con nombre para una superficie personalizada real, agregue ese ayudante primero
El código del cliente no aprende un segundo transporte ad hoc.

## actions con seguridad tipográfica desde UI: `useActionMutation()` {#use-action-mutation}

Cuando UI necesita ejecutar la misma operación que ejecutaría una herramienta de agente (rango 3 de [ladder](/docs/what-is-agent-native#rung-three)), use `useActionMutation`:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

Los argumentos de tipo seguro provienen del esquema zod en su `defineAction()`. Consulte [Actions](/docs/actions) para conocer el sistema de acción completo.

```an-callout
{
  "tone": "decision",
  "body": "**`useActionMutation` vs `sendToAgentChat`.** Run the operation directly with `useActionMutation` when the user clicked a deterministic button (\"Send reply\"). Hand it to `sendToAgentChat` when the work needs the agent's reasoning, tools, or multi-step planning. Never call an inline `llm()` from UI — that is rung 1 of the [ladder](/docs/what-is-agent-native#the-ladder)."
}
```

## Selección + reconocimiento del cursor {#selection}

El agente puede ver lo que el usuario ha seleccionado (texto, celdas, diapositivas, contactos) a través de las teclas `navigation` y `selection` en el estado de aplicación. El chat vacío también utiliza esas teclas para ofrecer sugerencias dinámicas como "Resumir esta selección" o "Mejorar esta diapositiva" cuando la pantalla actual las hace relevantes. Si desea que Cmd-I (o similar) envíe un rango seleccionado al chat como contexto, consulte [Context Awareness](/docs/context-awareness).

## Poniéndolo todo junto {#putting-it-together}

Una configuración típica sin cita previa:

```tsx
// app/root.tsx
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";

export default function Root() {
  return (
    <AgentSidebar suggestions={["Draft a reply", "Summarize selection"]}>
      <Header>
        <AgentToggleButton />
      </Header>

      <Main>
        <YourRoutes />
      </Main>
    </AgentSidebar>
  );
}
```

```tsx
// Anywhere else in the app
<Button
  onClick={() =>
    sendToAgentChat({
      message: "Summarize this thread",
      context: `Thread id: ${threadId}`,
      submit: true,
    })
  }
>
  Summarize
</Button>
```

El usuario ve un botón de chat en el encabezado, puede abrirlo y hablar con el agente. Sus botones entregan el trabajo a ese mismo agente en lugar de ejecutar llamadas LLM únicas.

## ¿Qué sigue?

- [**Actions**](/docs/actions) — `defineAction()` y `useActionMutation()`
- [**Context Awareness**](/docs/context-awareness) — selección, navegación, visualización de pantalla
- [**Workspace**](/docs/workspace): qué contiene la pestaña Espacio de trabajo (skills, memoria, servidores MCP, trabajos programados)
- [**Voice Input**](/docs/voice-input) — el micrófono en el compositor de chat
