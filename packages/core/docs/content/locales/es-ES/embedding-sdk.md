---
title: "Incrustar SDK"
description: "Integre un sidecar Agent-Native en una aplicación SaaS existente con contexto de página y comandos de host."
---

# Incrustar SDK

Integre Agent-Native en un producto existente: mantenga su aplicación SaaS, agregue una duradera
sidecar del agente y permitir que ese agente vea y opere en la página en la que se encuentra el usuario
ya lo estoy usando. Si todavía estás decidiendo entre agentes sin cabeza, chat enriquecido y
sidecar integrado o una aplicación completa, comience con
[Agent Surfaces](/docs/agent-surfaces).

```an-diagram title="La membrana de inclusión" summary="La aplicación host proporciona autenticación del lado del servidor y contexto de página en vivo; Agent-Native ejecuta el sidecar duradero y llega a la pestaña abierta mediante acciones del cliente y comandos del host."
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-box\" data-rough><strong>App SaaS anfitriona</strong><small class=\"diagram-muted\">tu interfaz, tu autenticación</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">getContext &rarr;</div><div class=\"diagram-pill\">&larr; acciones de cliente</div><div class=\"diagram-pill\">&larr; comandos del host</div></div><div class=\"diagram-panel center\" data-rough><strong>Agent-Native sidecar</strong><small class=\"diagram-muted\">chat durable · estado de app · extensiones</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL<br><small class=\"diagram-muted\">tablas del framework</small></div></div>",
  "css": ".diagram-embed{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-embed .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Empiece aquí: el complemento con pilas incluidas {#batteries-included}

Para la mayoría de los hosts SaaS, **use el tiempo de ejecución integrado completo**: el complemento del servidor
`createAgentNativeEmbeddedPlugin` más el cliente `<AgentNativeEmbedded>`
componente. Este es el valor predeterminado recomendado: reutiliza todo el marco
(actions, estado de la aplicación respaldada por SQL, extensiones, herramientas de sesión del navegador) y proporciona el
agente la capacidad de ver y operar en la página que el usuario ya está usando.

El host monta las rutas del servidor Agent-Native en su aplicación existente, pasa su
usuario que inició sesión en Agent-Native y muestra la barra lateral de React en el producto UI.
Agent-Native utiliza la implementación del host, la sesión del host y la configuración
`DATABASE_URL` para administrar sus propias tablas de marco: hilos de chat, configuraciones,
estado de la aplicación, extensiones, datos de extensión, secretos, sesiones del navegador y
rutas de acción.

```bash
pnpm add @agent-native/core
```

En el servidor:

```ts
// server/plugins/agent-native.ts
import { createAgentNativeEmbeddedPlugin } from "@agent-native/core/server";
import { builderActions } from "../agent-native/actions";
import { getBuilderSession } from "../auth";

export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.DATABASE_URL,
  auth: async (event) => {
    const session = await getBuilderSession(event);
    if (!session) return null;
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      orgId: session.organization.id,
      orgRole: session.organization.role,
    };
  },
  actions: builderActions,
  agentChat: {
    appId: "builder",
    systemPrompt:
      "You are Builder's embedded agent. Use Builder actions for durable work.",
  },
});
```

Sobre el cliente:

```tsx
import {
  AgentNativeEmbedded,
  defineClientAction,
} from "@agent-native/core/client";

export function BuilderAppShell({ children, content, editor }) {
  return (
    <AgentNativeEmbedded
      defaultOpen
      session={{
        id: browserTabId(),
        label: "Builder editor",
      }}
      getContext={() => ({
        route: {
          name: "builder-editor",
          pathname: window.location.pathname,
          params: { contentId: content.id },
        },
        resource: {
          type: "content",
          id: content.id,
          name: content.name,
        },
        user: currentUser(),
        organization: currentOrganization(),
      })}
      actions={[
        defineClientAction({
          name: "select-element",
          description: "Select an element in the visual editor",
          schema: {
            type: "object",
            properties: { elementId: { type: "string" } },
            required: ["elementId"],
          },
          run: ({ elementId }) => editor.select(elementId),
        }),
      ]}
      onRefresh={() => queryClient.invalidateQueries()}
      onNavigate={(payload) =>
        router.navigate((payload as { path: string }).path)
      }
      onRemount={() => setAppKey((key) => key + 1)}
    >
      {children}
    </AgentNativeEmbedded>
  );
}
```

Este modo es el predeterminado recomendado porque reutiliza el marco completo: los actions de backend se montan en `/_agent-native/actions`, el agente puede llamar al mismo actions que UI, las extensiones creadas por el usuario se almacenan en SQL, `extensionData` es duradero y tiene alcance de usuario/organización, y las herramientas de sesión del navegador permiten que el agente de backend inspeccione u opere la pestaña actualmente abierta.

La autenticación del host es del lado del servidor. No pase la identidad del navegador como fuente de verdad; utilice el objeto de solicitud/sesión del host o un token de corta duración verificado por el servidor. Si el host no expone los correos electrónicos, devuelva un `userId` estable y Agent-Native lo usará como clave de propietario.

### Aislamiento de bases de datos

El modo integrado gestiona las tablas Agent-Native en SQL. Para un producto SaaS maduro, el valor predeterminado más seguro es **mismo alojamiento y autenticación, base de datos/esquema dedicado Agent-Native**:

```ts
export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.AGENT_NATIVE_DATABASE_URL,
  auth: getHostSession,
  actions: hostActions,
});
```

Se admite el uso del `DATABASE_URL` principal del producto host, pero haga que sea una elección explícita. Agent-Native crea tablas de marco como `settings`, `application_state`, `tools`, `tool_data`, tablas de sesiones del navegador, secretos, hilos de chat e índices relacionados. Una base de datos/esquema dedicado evita colisiones de nombres de tablas, mantiene clara la propiedad de las tablas administradas y hace que sea más fácil razonar sobre la política de copia de seguridad/retención. Si comparte intencionalmente la base de datos del host, revise primero los nombres de las tablas existentes y trate las tablas Agent-Native como propiedad del marco.

## Otros modos {#other-modes}

El complemento anterior que incluye baterías es el camino feliz. Consigue uno de estos
solo cuando se ajuste mejor a tu situación:

| Modo                                    | Úsalo cuando                                                                                                                                       | Paquete                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Selector de aplicaciones integradas** | Lanzamiento de una aplicación Agent-Native completa como un iframe enfocado (selector de activos, creador de formularios, panel de aprobación).    | `@agent-native/embedding`                       |
| **Puente de host `<AgentNative>`**      | Aplicaciones complementarias independientes o iframes de orígenes cruzados que conectan el contexto de la página y el cliente actions manualmente. | `@agent-native/core/client`                     |
| **Extensiones portátiles**              | Permitir a los usuarios de alojamiento crear miniaplicaciones en espacio aislado cuando el SaaS ya posee almacenamiento/aprobación de extensión.   | Ranura de extensión `@agent-native/core/client` |

El paquete `@agent-native/embedding` de nivel inferior expone:

| Ruta de importación                | Qué proporciona                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@agent-native/embedding`          | Componente selector `EmbeddedApp`, `getA2AUrl`, `getMcpUrl`, `sendMessage` (transmisión de A2A)    |
| `@agent-native/embedding/react`    | Ganchos y componentes específicos de React                                                         |
| `@agent-native/embedding/bridge`   | `announceEmbeddedAppReady`, `sendEmbeddedAppMessage`: utilizados dentro de la aplicación integrada |
| `@agent-native/embedding/agent`    | Asistentes de punto final del agente                                                               |
| `@agent-native/embedding/protocol` | Tipos de protocolo                                                                                 |

```bash
pnpm add @agent-native/embedding
```

### Modo de selección y aplicación integrada

Utilice `@agent-native/embedding` cuando el producto host quiera lanzar una versión completa
Aplicación Agent-Native como superficie iframe enfocada: selector de recursos, generador de activos,
creador de formularios, selector de espacios de calendario, panel de aprobación o cualquier otra tarea específica
flujo de trabajo. Este es intencionalmente más pequeño que el puente anfitrión del sidecar que se muestra a continuación: el
iframe anuncia que está listo, el host puede enviar mensajes con nombre y el incrustado
La aplicación puede emitir eventos de dominio como `chooseAsset` o `close`.

```tsx
import { EmbeddedApp } from "@agent-native/embedding";

export function AssetPickerDialog({ close }) {
  return (
    <EmbeddedApp
      url="https://assets.agent-native.com/picker"
      className="h-full w-full"
      onLoad={(ref) => {
        ref.postMessage("configure", {
          prompt: "Editorial blog hero",
          aspectRatio: "16:9",
        });
      }}
      onMessage={(name, payload) => {
        if (name === "chooseAsset") {
          const asset = payload as { url: string; altText?: string };
          insertAsset(asset.url, asset.altText);
          close();
        }
        if (name === "close") close();
      }}
    />
  );
}
```

Dentro de la aplicación integrada, utilice el puente del navegador para anunciar que está listo y enviar
eventos de vuelta al anfitrión:

```ts
import {
  announceEmbeddedAppReady,
  sendEmbeddedAppMessage,
} from "@agent-native/embedding/bridge";

announceEmbeddedAppReady({ app: "assets", mode: "picker" });
sendEmbeddedAppMessage("chooseAsset", {
  url: asset.previewUrl,
  assetId: asset.id,
  altText: asset.altText,
});
```

Assets también emite `chooseImage` como alias de compatibilidad para el selector de imágenes anterior
anfitriones; las nuevas integraciones deberían escuchar a `chooseAsset`.

Para aplicaciones propias alojadas, habilite SSO entre aplicaciones con Dispatch como identidad
centro para que `content.agent-native.com` y `assets.agent-native.com` vinculen a los usuarios por
correo electrónico verificado. Los lanzamientos de iframe aún deberían utilizar un alcance de ruta de corta duración
incorporar sesiones cuando necesiten resistencia a cookies de terceros; cookies de aplicaciones normales
no son una historia completa de autenticación de inserción por sí solas.

El mismo paquete incluye agentes auxiliares de punto final para el descubrimiento de protocolos y
transmisión de texto sobre A2A:

```ts
import { getA2AUrl, getMcpUrl, sendMessage } from "@agent-native/embedding";

getMcpUrl("https://assets.agent-native.com");
getA2AUrl("https://assets.agent-native.com");

for await (const chunk of sendMessage(
  "https://assets.agent-native.com",
  "Generate a blog hero",
)) {
  append(chunk);
}
```

### Aplicación host (puente host `<AgentNative>`)

> Se prefiere el complemento anterior que incluye baterías. Utilice este puente de nivel inferior
> solo para aplicaciones paralelas independientes o iframes de orígenes cruzados donde conectas la página
> contexto y cliente actions usted mismo.

Para aplicaciones sidecar independientes o iframes de origen cruzado, utilice el `<AgentNative />` de nivel inferior. Representa el contexto de la página iframe sidecar y wires, el cliente en vivo actions y los comandos de actualización/navegación del host en un solo lugar:

```tsx
import { AgentNative, defineClientAction } from "@agent-native/core/client";

export function AssistantDock({ customer, sessionToken }) {
  return (
    <AgentNative
      agentUrl="https://agent.example.com/workspaces/acme/sidecar"
      className="h-full w-full"
      session={{ id: browserTabId(), label: "Customer detail" }}
      auth={() => ({ token: sessionToken })}
      screen={{ includeVisibleText: true }}
      getContext={() => ({
        route: {
          name: "customer-detail",
          pathname: window.location.pathname,
          params: { customerId: customer.id },
        },
        resource: {
          type: "customer",
          id: customer.id,
          name: customer.name,
        },
        selection: {
          ids: getSelectedRowIds(),
          text: window.getSelection()?.toString() || undefined,
        },
        user: currentUser(),
        organization: currentOrganization(),
      })}
      actions={[
        defineClientAction<{ contentId: string }, { published: true }>({
          name: "publish-content",
          description: "Publish a Builder content entry",
          schema: {
            type: "object",
            properties: { contentId: { type: "string" } },
            required: ["contentId"],
          },
          destructive: true,
          approval: { title: "Publish this entry?", risk: "medium" },
          run: async ({ contentId }, { refresh }) => {
            await builderApi.publish(contentId);
            await refresh({ queryKey: ["content", contentId] });
            return { published: true };
          },
        }),
        defineClientAction<{ elementId: string }, void>({
          name: "select-element",
          description: "Select an element in the live visual editor",
          schema: {
            type: "object",
            properties: { elementId: { type: "string" } },
            required: ["elementId"],
          },
          run: ({ elementId }) => editor.select(elementId),
        }),
      ]}
      onNavigate={(payload) => {
        const { path } = payload as { path: string };
        router.navigate(path);
      }}
      onRefresh={(payload) => {
        const { queryKey } = payload as { queryKey?: readonly unknown[] };
        queryClient.invalidateQueries({ queryKey });
      }}
      onRemount={() => setAppKey((key) => key + 1)}
      onOpenResource={(payload) => openResource(payload)}
      onRequestApproval={(payload) => approvalDialog.confirm(payload)}
    />
  );
}
```

Utilice `screen={false}` si solo desea un contexto semántico explícito. Utilice `screen={{ includeDomHtml: true }}` como alternativa para aplicaciones que aún no han asignado su UI a ID semánticos y estado de selección. El puente de host solo acepta mensajes del origen de `agentUrl` de forma predeterminada. Pase `agentOrigin` si el iframe URL es un URL enrutado/proxy cuyo origen confiable difiere.

Para hosts que no sean React, llame a `createAgentNativeHostBridge()` directamente y pase las mismas opciones `getContext`, `actions` y `commands`.

### Lado del marco flotante

Dentro del sidecar Agent-Native, utilice los ayudantes de marco para solicitar el contexto del host, descubrir sesiones de navegador en vivo actions, ejecutarlas o pedirle al host que haga el trabajo de UI. Pase siempre el `hostOrigin` esperado en producción:

```ts
import {
  announceAgentNativeFrameReady,
  createAgentNativeHostTools,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  runAgentNativeHostAction,
  sendAgentNativeHostCommand,
} from "@agent-native/core/client";

announceAgentNativeFrameReady({ hostOrigin: "https://app.example.com" });

const context = await requestAgentNativeHostContext({
  hostOrigin: "https://app.example.com",
});

const liveActions = await requestAgentNativeHostActions({
  hostOrigin: "https://app.example.com",
});

await runAgentNativeHostAction(
  "select-element",
  { elementId: context.selection?.ids?.[0] },
  { hostOrigin: "https://app.example.com" },
);

await sendAgentNativeHostCommand(
  "refreshData",
  { queryKey: ["customer", context.resource?.id] },
  { hostOrigin: "https://app.example.com" },
);

const hostTools = createAgentNativeHostTools({
  hostOrigin: "https://app.example.com",
});
```

### Puente de herramientas mediado por servidor

Para un compañero de trabajo de estilo CLAW, el iframe también puede registrar su pestaña de navegador en vivo con el backend del sidecar. Luego, el agente obtiene herramientas de backend normales que ponen en cola una solicitud, el iframe la reclama, la página host la ejecuta y el backend devuelve el resultado al agente.

```an-diagram title="Puente de sesión de navegador mediado por servidor" summary="Una herramienta de backend pone en cola el trabajo; la pestaña registrada lo reclama, lo ejecuta en la página activa y el resultado regresa al agente, por lo que un agente backend/Slack/A2A aún puede tocar la pestaña abierta."
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-node\" data-rough>Agente backend<br><small class=\"diagram-muted\">charla · Slack · A2A</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>enqueue request<br><small class=\"diagram-muted\">/_agent-native/browser-sessions</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>La pestaña activa lo reclama<br><small class=\"diagram-muted\">registered bridge</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">result &rarr; agent</div></div>",
  "css": ".diagram-bridge{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}"
}
```

En la aplicación sidecar, inicie el puente de sesión del navegador una vez cuando se monte el iframe:

```tsx
import { useEffect } from "react";
import { startAgentNativeBrowserSessionBridge } from "@agent-native/core/client";

export function SidecarRuntime() {
  useEffect(() => {
    const bridge = startAgentNativeBrowserSessionBridge({
      hostOrigin: "https://app.example.com",
      label: "Builder editor",
    });
    return () => bridge.stop();
  }, []);

  return null;
}
```

El marco monta `/_agent-native/browser-sessions` automáticamente. Una vez que el puente esté en funcionamiento, el agente sidecar puede utilizar:

| Herramienta                    | Propósito                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `list-browser-sessions`        | Ver las pestañas del host conectado para el usuario actual.                                       |
| `view-browser-session`         | Solicite a una pestaña activa el contexto de la página actual y una instantánea de la pantalla.   |
| `list-browser-session-actions` | Solicite una pestaña activa para conocer los manifiestos de acción actuales del lado del cliente. |
| `run-browser-session-action`   | Ejecutar una acción del cliente actual a través de la pestaña en vivo.                            |
| `send-browser-session-command` | Pídale al host que actualice, navegue, vuelva a montar, vuelva a cargar o apruebe.                |

Este es el puente que se debe usar cuando el agente se ejecuta en el backend, en Slack/Telegram/correo electrónico, o como destinatario de la llamada A2A pero aún necesita tocar la pestaña actual del navegador del usuario cuando está abierta. Si el navegador está cerrado, el backend actions aún debería manejar el trabajo duradero y las herramientas de sesión del navegador informarán que no hay ninguna pestaña activa conectada.

### Actions

Hay dos clases de acciones:

| Tipo de acción     | Dónde se ejecuta                                                         | ¿Funciona cuando el navegador está cerrado? | Mejor para                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Acción de backend  | Aplicación Sidecar, backend API, MCP o adaptador de integración          | Sí                                          | Trabajo duradero como crear, actualizar, publicar, sincronizar, enviar e importar.                                                          |
| Acción del cliente | Pestaña actual del navegador a través de `<AgentNative actions={...} />` | No                                          | El UI efímero funciona como seleccionar un elemento, leer el estado del editor, desplazarse a una fila, copiar el estado actual del lienzo. |

El backend actions debe ser el predeterminado para cualquier cosa que deba sobrevivir a actualizaciones, navegadores cerrados, reintentos o ejecuciones activadas por integración. Pertenecen a la capa de acción/herramienta Agent-Native normal de la aplicación sidecar, donde el agente puede llamarlos desde chat, automatizaciones, integraciones de Slack/Telegram/correo electrónico y trabajos en segundo plano.

El cliente actions es un puente activo hacia una pestaña del navegador. El anfitrión los anuncia con `source: "client"` y `availability: "browser-session"`, y el sidecar debe tratar ese manifiesto como temporal. Vuelva a incluir actions cuando cambie la ruta o la selección y regrese al backend actions cuando la pestaña desaparezca.

### Extensiones portátiles

> Prefiere el complemento con baterías incluidas cuando quieras administrar Agent-Native
> definiciones de extensión, aprobación, almacenamiento y extensiones creadas por el agente. Usar
> la ranura portátil a continuación solo cuando el SaaS ya posee esas preocupaciones.

El SDK también admite extensiones definidas por el usuario: miniaplicaciones Alpine.js en espacio aislado que un SaaS host puede representar en ranuras con nombre. Utilícelo cuando el cliente desee crear sus propios paneles pequeños, calculadoras, paneles o ayudas de flujo de trabajo en la misma superficie de acción/contexto que utiliza el agente.

```tsx
import {
  AgentNativeExtensionSlot,
  createHttpAgentNativeExtensionStorage,
  defineClientAction,
} from "@agent-native/core/client";

const storage = createHttpAgentNativeExtensionStorage({
  endpoint: "/api/agent-native/extensions/storage",
  headers: () => ({ Authorization: `Bearer ${sessionToken()}` }),
});

const actions = [
  defineClientAction({
    name: "list-at-risk-customers",
    description: "List customers currently at risk",
    schema: { type: "object", properties: {} },
    run: () => crmApi.customers.list({ status: "at-risk" }),
  }),
];

const customerHealthExtension = {
  id: "customer-health",
  name: "Customer health",
  description: "Shows at-risk customers and quick notes.",
  manifest: {
    slots: ["crm.customer.sidebar"],
    requestedActions: ["list-at-risk-customers"],
    requestedCommands: ["openResource", "refreshData"],
    storageScopes: ["user", "org"],
  },
  content: `
    <div x-data="{
      customers: [],
      note: '',
      async init() {
        this.customers = await appAction('list-at-risk-customers', {})
        const row = await extensionData.get('notes', slotContext.customerId, { scope: 'user' })
        this.note = row?.data?.text || ''
      },
      async save() {
        await extensionData.set('notes', slotContext.customerId, { text: this.note }, { scope: 'user' })
        await agentNative.refresh({ customerId: slotContext.customerId })
      }
    }" x-init="init()" class="space-y-3">
      <textarea class="w-full rounded-md border bg-background p-2" x-model="note"></textarea>
      <button class="rounded-md bg-primary px-3 py-2 text-primary-foreground" @click="save()">Save</button>
    </div>
  `,
};

export function CustomerSidebar({ customer, userExtensions }) {
  return (
    <AgentNativeExtensionSlot
      id="crm.customer.sidebar"
      extensions={[customerHealthExtension, ...userExtensions]}
      context={{ customerId: customer.id, plan: customer.plan }}
      actions={actions}
      storage={storage}
      storageContext={{
        userId: currentUser().id,
        organizationId: currentOrganization().id,
      }}
      getContext={() => ({
        resource: { type: "customer", id: customer.id, name: customer.name },
      })}
      commands={{
        refreshData: async () => queryClient.invalidateQueries(),
      }}
    />
  );
}
```

El manifiesto es el contrato de instalación. Cuando `requestedActions`, `requestedCommands` o `storageScopes` están presentes, SDK los aplica en el host antes de que una solicitud de iframe llegue al puente de acción o al adaptador de almacenamiento. Cuando `slots` está presente, `AgentNativeExtensionSlot` solo representa la extensión en las ranuras correspondientes. Los hosts aún pueden anular la política por ranura con `allowedActions`, `allowedCommands` y `allowedStorageScopes`.

Una extensión es simple HTML. El tiempo de ejecución de iframe proporciona las mismas primitivas de puente seguro para la miniaplicación:

```html
<div
  x-data="{ customers: [], async init() { this.customers = await appAction('list-at-risk-customers', {}) } }"
  x-init="init()"
>
  <template x-for="customer in customers" :key="customer.id">
    <button
      class="block w-full rounded-md px-3 py-2 text-left hover:bg-muted"
      x-text="customer.name"
      @click="agentNative.command('openResource', { type: 'customer', id: customer.id })"
    ></button>
  </template>
</div>
```

Globalmente disponibles dentro del iframe:

| Ayudante                       | Propósito                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `appAction(name, args)`        | Ejecutar una acción declarada por el host.                                       |
| `agentNative.context()`        | Leer la página de host actual, los recursos, el espacio y los datos del usuario. |
| `agentNative.command(name, p)` | Pídale al host que navegue, actualice, vuelva a montar o abra.                   |
| `agentNative.refresh(payload)` | Atajo para `refreshData`.                                                        |
| `extensionData.*`              | Conservar los datos locales de extensión a través del adaptador de host.         |

De forma predeterminada, `extensionData` utiliza el navegador `localStorage`, que es útil para prototipos y widgets locales. Los hosts SaaS de producción deben pasar un adaptador `storage` respaldado por backend para que los datos de extensión con alcance de usuario y organización sean duraderos, auditables y se rijan por los permisos de la aplicación. El adaptador genérico HTTP envía cuerpos POST como `{ operation, extensionId, slotId, collection, id, data, options, context }` y espera `{ result }` o el resultado JSON directamente.

Esta capa SDK portátil está separada del almacén de extensiones integrado respaldado por SQL del marco. En una aplicación Agent-Native, utilice los componentes `ExtensionSlot`/`EmbeddedExtension` existentes y la acción `create-extension`. En un escenario de integración de SaaS alojado, prefiera `createAgentNativeEmbeddedPlugin()` más `AgentNativeEmbedded` cuando desee que Agent-Native administre las definiciones de extensión, la aprobación, el almacenamiento y las extensiones creadas por el agente de forma inmediata. Utilice `AgentNativeExtensionSlot` solo cuando SaaS ya posea definiciones de extensión, aprobación, mercado, almacenamiento y facturación.

Modelo de seguridad:

- Los iframes de extensión están protegidos sin `allow-same-origin`; la miniaplicación no puede leer directamente el DOM principal, las cookies ni el tiempo de ejecución de la aplicación.
- Las extensiones solo pueden llamar al actions y a los comandos permitidos por el host y el manifiesto de extensión.
- Risky actions debe configurar `destructive` o `requiresApproval` para que el host pueda mostrar un flujo de aprobación.
- Trate la extensión creada por el usuario HTML como no confiable. Revise las instalaciones del mercado, registre el uso de acciones y alcance el almacenamiento backend por usuario/organización.

### Sesiones y pestañas

El puente de host tiene como alcance un par de iframe/ventana de host. Si el mismo usuario abre varias pestañas, cada pestaña tiene su propio `session`, contexto, selección, cliente actions y respuestas de comando pendientes. No asuma que una acción del cliente descubierta en una pestaña se puede ejecutar en otra pestaña o que seguirá existiendo después de la navegación.

Para productos de múltiples pestañas, mantenga el estado duradero en SQL/backend actions y use el cliente actions solo para las partes locales de pestañas: enfocar una fila, copiar el estado visible del editor, seleccionar un elemento de lienzo o actualizar la caché de consultas React actual. Incluya suficiente contexto `route`, `resource` y `selection` para que el sidecar decida si la pestaña actual es el lugar correcto para ejecutar una acción de sesión del navegador.

### Modelo de comando

Los nombres de los comandos integrados tienen deliberadamente forma de aplicación, no de base de datos:

| Comando                                | Propósito                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `navigate`                             | Mueva el host UI a una ruta/vista/recurso.                                                   |
| `refreshData` / `refresh-data`         | Solicite al host que invalide los datos del lado del cliente.                                |
| `remountView` / `remount-view`         | Pídale al host que vuelva a montar un subárbol, p.e. `<App key={key} />`.                    |
| `hardReload` / `hard-reload`           | Recarga completa del navegador.                                                              |
| `openResource` / `open-resource`       | Abra un objeto de dominio específico en el host UI.                                          |
| `requestApproval` / `request-approval` | Pídale al anfitrión que muestre un flujo de confirmación. Registre un controlador para esto. |

Si no se proporciona ningún controlador, los valores predeterminados seguros envían eventos del navegador como `agentNative:refresh-data` y `agentNative:remount-view`. `requestApproval` no tiene un controlador predeterminado; registre uno antes de confiar en él.

### Guía de aprobación

Marque el cliente riesgoso actions con `destructive: true` en su manifiesto y solicite la aprobación del host antes de ejecutar operaciones que eliminen, publiquen, envíen, cobren, inviten, compartan o afecten de otro modo a usuarios fuera de la vista actual. El backend actions también debería aplicar sus propias comprobaciones de autorización y aprobación; La aprobación del host es una experiencia de usuario útil, no el límite de seguridad.

Prefiere esta forma:

- La mutación duradera se ejecuta en una acción de backend con validación, autenticación, registro de auditoría y reintentos.
- El comando de host abre una aprobación UI o enfoca el recurso afectado.
- La acción del cliente maneja solo el paso UI en vivo que no puede ocurrir en el backend.

### Integración en tiempo de ejecución

Utilice `createAgentNativeHostTools()` dentro del iframe sidecar cuando el tiempo de ejecución de su agente acepte descriptores de herramientas simples. Devuelve cuatro herramientas independientes del marco:

| Herramienta         | Propósito                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| `view-host-screen`  | Leer el contexto semántico del host y la instantánea de la pantalla.           |
| `list-host-actions` | Enumera la sesión de navegador en vivo actions expuesta por la pestaña actual. |
| `run-host-action`   | Ejecutar una acción de cliente en vivo por nombre.                             |
| `send-host-command` | Enviar comandos del host como actualizar, navegar, volver a montar o aprobar.  |

El asistente devuelve intencionalmente objetos `{ name, description, parameters, execute }` simples para que los sidecars puedan adaptarlos a la llamada de función AI SDK, Anthropic, OpenAI o Agent-Native `ActionEntry` sin acoplar este SDK a un tiempo de ejecución.

## Forma recomendada del producto

Iniciar primero el iframe. Funciona para Builder.io, aplicaciones SaaS de clientes y herramientas de administración interna sin acoplar ciclos de lanzamiento ni suposiciones de CSS/tiempo de ejecución.

El sidecar en sí debe seguir siendo una aplicación/plantilla Agent-Native: actions es la superficie backend API, el estado de la aplicación respaldada por SQL es la memoria del agente y las integraciones como Slack o Telegram pueden enrutarse al mismo chat duradero. El SDK integrado proporciona la membrana activa entre ese sidecar y la página de host actual.
