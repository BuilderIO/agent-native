---
title: "Aplicaciones MCP"
description: "Cree e incruste aplicaciones MCP interactivas UI dentro de Claude, ChatGPT y otros hosts compatibles, utilizando rutas de aplicaciones reales, el puente de inserción y el puente de host API."
---

# Aplicaciones MCP

**Esta página: UI en línea en Claude/ChatGPT.** Creación de recursos de la aplicación MCP y el puente de inserción que representa una ruta de aplicación real dentro del chat de un host compatible. Esta página también es el hogar único de la **matriz de soporte al cliente** ([below](#client-support)).

| Si quieres…                                                                                        | Leer                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Conecta un agente/host externo a tu aplicación                                                     | [External Agents](/docs/external-agents) |
| Dale a tu agente más herramientas (consume otros servidores MCP)                                   | [MCP Clients](/docs/mcp-clients)         |
| Crea UI en línea que se rendericen en Claude/ChatGPT                                               | **Esta página** — Aplicaciones MCP       |
| Referencia del servidor MCP de nivel inferior (autenticación, herramientas, montaje personalizado) | [MCP Protocol](/docs/mcp-protocol)       |

Las aplicaciones MCP son la extensión oficial `io.modelcontextprotocol/ui` que permite a los hosts compatibles (Claude, Claude Desktop, ChatGPT, VS Code GitHub Copilot, Goose, Postman, MCPJam y Cursor) representar UI interactivos en línea en el chat. En las aplicaciones nativas del agente, cada aplicación MCP es una **ruta React real**, no un widget simple-HTML independiente.

Dentro del chat de una aplicación Agent-Native, prefiera [native chat renderers](/docs/native-chat-ui) para widgets propios como tablas, gráficos, resultados escritos y posibilidades de aprobación. Utilice aplicaciones MCP para UI en línea externo/entre hosts en Claude, ChatGPT, Copilot, Cursor y otros hosts compatibles, con la acción `link` como respaldo de enlace profundo universal.

## Autoría: aplicaciones MCP opcionales UI {#mcp-apps}

Para los hosts que admiten la extensión de aplicaciones MCP, una acción también puede anunciar un recurso UI en línea con `mcpApp`. Esta es una mejora progresiva para los flujos en los que el agente externo debe entregar al usuario una superficie interactiva en lugar de solo texto, por ejemplo, revisar un borrador de correo electrónico, editar una invitación de calendario o elegir entre variantes del panel generado.

Utilice la aplicación React real con `embedRoute()` o `embedApp()` siempre que el usuario necesite UI. El modelo mental es simple: el objetivo `link` de la acción es también el objetivo de inserción de la aplicación MCP. Exponga la operación como una acción/herramienta normal, devuelva un vínculo profundo enfocado con `link` y agregue `mcpApp.resource = embedApp(...)` para que los hosts capaces carguen esa misma ruta en línea en lugar de abrir una nueva pestaña. Cuando ambos deben crearse a partir de la misma ruta, prefiera `embedRoute({ title, openLabel, path })`: es el contenedor conveniente que devuelve los campos `link` y `mcpApp` coincidentes de una sola llamada, mientras que `embedApp(...)` es el recurso de nivel inferior que asigna directamente a `mcpApp.resource`.

Eso significa que las inserciones de aplicaciones completas pueden hacer cualquier cosa que la ruta pueda hacer una vez abierta: revisar o editar un borrador de correo electrónico, mostrar una bandeja de entrada/búsqueda filtrada, abrir un evento de calendario o un borrador de evento, cargar una página de extensión, inspeccionar un panel de análisis completo o un análisis guardado, continuar una presentación en el editor de Presentaciones o abrir un proyecto/editor de diseño. Prefiere URL/parámetros de enlace profundo y el puente de estado de aplicación/navegación `/_agent-native/open` existente en lugar de inventar un segundo protocolo de estado para aplicaciones MCP.

En raras ocasiones, el objetivo correcto es una ruta de aplicación enfocada que representa un componente React compartido en lugar de todo el shell de la aplicación. La ruta `/chart` de Analytics es el modelo: toma una carga útil compacta `SqlPanel` en el URL y representa el mismo componente de gráfico que utiliza el panel. Esta sigue siendo una aplicación integrada, no una simple aplicación HTML MCP. Expóngalo o llámelo mediante una acción normal / `open_app({ path, embed: true })`, mantenga el URL determinista y deje que `embedApp()` represente esa ruta en línea.

No escriba a mano aplicaciones únicas HTML MCP para el producto UI; si la acción necesita una superficie personalizada, agregue o reutilice primero una ruta/componente de aplicación real e incruste esa ruta.

```an-diagram title="MCP Aplicación integrada de ida y vuelta" summary="El destino del enlace de la acción también es el destino de inserción. Los hosts compatibles cargan la misma ruta de aplicación firmada en línea; todos los demás recurren al enlace profundo."
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-card\" data-rough><strong>Action</strong><small class=\"diagram-muted\">`link` target = MCP App embed target</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>embedApp()</strong><span class=\"diagram-pill accent\">create_embed_session</span><small class=\"diagram-muted\">mints short-lived embed session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>/_agent-native/embed/start</strong><small class=\"diagram-muted\">intercambia ticket SQL de un solo uso</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>Signed app route</strong><span class=\"diagram-pill ok\">ruta React real</span><small class=\"diagram-muted\">short-lived browser session</small></div><div class=\"diagram-fallback\"><span class=\"diagram-pill warn\">sin soporte para MCP Apps</span><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>&quot;Open in … &rarr;&quot; deep link</div></div></div>",
"css": ".diagram-embed{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-embed .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:140px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .diagram-fallback{display:flex;flex-direction:column;align-items:center;gap:6px;margin-inline-start:8px}"
}

```

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...description, schema, run, link...
  mcpApp: {
    resource: embedApp({
      title: "Review draft",
      description: "Open the generated draft in the real Mail compose UI.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
    }),
  },
});
```

```an-annotated-code title="La configuración del recurso mcpApp"
{
  "filename": "actions/review-draft.ts",
  "language": "ts",
  "code": "import { embedApp } from \"@agent-native/core\";\n\nexport default defineAction({\n  // ...description, schema, run, link...\n  mcpApp: {\n    resource: embedApp({\n      title: \"Review draft\",\n      description: \"Open the generated draft in the real Mail compose UI.\",\n      iframeTitle: \"Agent-Native Mail\",\n      openLabel: \"Open in Mail\",\n    }),\n  },\n});",
  "annotations": [
    { "lines": "6", "label": "Mejora progresiva", "note": "`mcpApp.resource` anuncia una interfaz de usuario en línea para hosts que admiten la extensión de aplicaciones MCP. Mantenga también el generador `link` de la acción: los hosts anteriores y exclusivos para CLI ignoran los metadatos de la interfaz de usuario y aún necesitan el enlace profundo." },
    { "lines": "7", "label": "Embed = the link target", "note": "`embedApp()` uses the action's `link` as its launch target: it calls `create_embed_session`, exchanges a one-time SQL ticket at `/_agent-native/embed/start`, and navigates the MCP App frame to the same signed app route." },
    { "lines": "11", "label": "Etiqueta de reserva universal", "note": "`openLabel` is the visible `\"Open in … →\"` text used as the deep-link escape hatch when a host does not render the inline iframe." }
  ]
}
```

El servidor MCP anuncia la extensión `io.modelcontextprotocol/ui`, agrega `_meta.ui.resourceUri` más `_meta["ui/resourceUri"]` a `tools/list` y también emite metadatos de compatibilidad de aplicaciones ChatGPT SDK (`openai/outputTemplate`, widget CSP/descripción/accesibilidad). Expone desde HTML hasta `resources/list`, `resources/templates/list` y `resources/read` usando MIME `text/html;profile=mcp-app`. El proxy stdio reenvía esos controladores de recursos desde la aplicación en vivo, por lo que los clientes de escritorio y CLI ven los mismos recursos que los clientes HTTP.

Mantenga el constructor `link` existente incluso cuando agregue `mcpApp`. Los clientes exclusivos de CLI, los hosts más antiguos y cualquier host que no represente aplicaciones MCP ignorarán los metadatos de UI y seguirán necesitando el enlace `"Open in … →"`. `embedApp()` utiliza ese enlace como objetivo de lanzamiento, llama al asistente `create_embed_session` exclusivo de la aplicación, intercambia un ticket único de SQL en `/_agent-native/embed/start` y navega por el marco de la aplicación MCP hasta la ruta de destino con una sesión de navegador de corta duración más un respaldo de portador para recuperaciones del mismo origen. `open_app({ app, path, embed: true })` es la trampilla de escape genérica para rutas como paneles completos, bandejas de entrada filtradas, vistas de borradores de calendario, análisis y páginas de extensión, y debe usarse libremente cuando la aplicación completa es la superficie de revisión/edición más clara.

`embedApp()` incluye el origen de la solicitud MCP en el recurso CSP para que el iniciador pueda recuperar y, cuando se solicite explícitamente, encuadrar la ruta de la aplicación propia firmada. Dispatch agrega los orígenes exactos de las aplicaciones otorgadas a su recurso `open_app`, de modo que un único conector de Dispatch puede integrar correo, calendario, diapositivas y el resto sin permitir todos los orígenes HTTPS. Pase solo marcos adicionales o dominios de recursos para una aplicación MCP personalizada que realmente incorpore un reproductor de terceros o cargue recursos de terceros.

Dentro de esas rutas `embedApp()`, `sendToAgentChat()` admite integración. Las indicaciones enviadas automáticamente se transmiten al host MCP como `ui/update-model-context` más `ui/message`, por lo que un botón en la aplicación integrada puede continuar intencionalmente la conversación Claude/ChatGPT desde el estado de la aplicación seleccionada. El contexto oculto se envía como contexto modelo; el giro visible del usuario sigue siendo solo el mensaje de la aplicación, lo que evita el aterrador consentimiento del host en torno a las rutas internas de los archivos de estado de la aplicación. `submit: false` mantiene el comportamiento de precompletación/revisión local.

## Puente de aplicación MCP de primera clase {#mcp-app-bridge}

MCP Las inserciones de aplicaciones son inserciones de ruta, no miniproductos separados. `embedApp()` comienza desde el objetivo `link` de la acción, crea una sesión de inserción de corta duración e inicia esa ruta de aplicación firmada. Los hosts de aplicaciones MCP estándar pueden navegar por el marco de la aplicación MCP cuando el host puede hidratar la ruta directamente.

```an-diagram title="Dos rutas de puente anfitrión, una ruta señalizada" summary="Claude trasplanta la vía hidratada y utiliza el ui/_bridge directo; ChatGPT obtiene un iframe controlado a través de window.openai y retransmite las acciones del host a través de postMessage. Ambos apuntan a la misma ruta de aplicación señalizada."
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><strong>Claude web</strong><span class=\"diagram-pill accent\">single-frame transplant</span><small class=\"diagram-muted\">hidrata HTML firmado de la app en el iframe de Claude y luego usa el puente de host directo `ui/_`</small></div><div class=\"diagram-card\" data-rough><strong>ChatGPT web</strong><span class=\"diagram-pill accent\">controlled route iframe</span><small class=\"diagram-muted\">`window.openai`host APIs ·`agentNative.mcpHost.*` postMessage relay</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Same signed app route<br><small class=\"diagram-muted\">ruta normal + componentes React</small></div></div>",
"css": ".diagram-bridge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-bridge .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-bridge .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;max-width:300px}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}.diagram-bridge .diagram-box{padding:16px 18px;text-align:center}"
}

```

Claude web utiliza una ruta de trasplante de un solo fotograma: el documento de recursos recupera la aplicación firmada HTML y la hidrata dentro del iframe de la aplicación MCP de Claude porque Claude no permite de manera confiable iframes secundarios propiedad de la aplicación ni navegación por marcos externos. La web ChatGPT obtiene un iframe de ruta controlada porque su puente de aplicaciones nos brinda hosts `window.openai` estables API y control de altura limitado. Todas las rutas apuntan a la misma ruta de la aplicación firmada y representan la ruta normal y los componentes React. Diseñe rutas integradas para que una recarga con el mismo URL firmado reconstruya la misma vista.

Para la misma aplicación `open_app({ embed: true })`, el marco crea el ticket de inicio de inserción durante la llamada de la herramienta original y almacena el URL de inicio firmado en metadatos ocultos de la herramienta. El actions personalizado puede devolver `embedStartUrl` por la misma ruta rápida; la capa MCP elimina el URL con boleto del `structuredContent` visible en el modelo y de los metadatos normales de enlace abierto. Cuando no hay ningún inicio de inserción URL presente, el recurso recurre al asistente `create_embed_session` exclusivo de la aplicación. Esto mantiene los hosts de producción que restringen las llamadas a herramientas iniciadas por iframe en la ruta directa sin filtrar sesiones únicas de aplicaciones URL en la transcripción. Si un usuario vuelve a abrir un chat antiguo después de que haya expirado un ticket de inicio único, la ruta de inicio devuelve una pequeña página de actualización y publica `agentNative.embedSessionExpired` en el contenedor; `embedApp()` borra el inicio obsoleto URL y genera un ticket nuevo a través de `create_embed_session` cuando todavía tiene la ruta de la aplicación original.

ChatGPT obtiene una ruta de compatibilidad dedicada a través de `window.openai`: el documento de lanzamiento lee `toolInput`, `toolOutput` y `toolResponseMetadata` directamente, luego llama a `create_embed_session` a través de `window.openai.callTool(...)`. Los hosts de aplicaciones MCP estándar utilizan el puente `ui/*` JSON-RPC. Las rutas directamente hidratadas pueden llamar a `ui/update-model-context`, `ui/message`, `ui/open-link` y `ui/request-display-mode` a través de los asistentes del puente del host. La ruta trasplantada de Claude utiliza el mismo puente huésped directo de `ui/*` después de la hidratación. Cuando se utiliza la ruta ChatGPT o iframe de diagnóstico explícito, el contenedor transmite el mismo host actions a través de solicitudes postMessage `agentNative.mcpHost.*`. Mantenga la forma del resultado idéntica para ambas rutas: devuelva un `link` enfocado y contenido estructurado conciso.

No configure el estándar `_meta.ui.domain` en una aplicación URL. MCP Apps trata ese campo como específico del host: Claude valida dominios sandbox estilo `{hash}.claudemcpcontent.com`, mientras que ChatGPT usa sus propios metadatos `openai/widgetDomain`. Omita `ui.domain` a menos que esté emitiendo deliberadamente un valor específico del host; el anfitrión elegirá un origen de zona de pruebas predeterminado.

Las páginas de extensión mantienen su zona de pruebas en los chats incrustados de MCP sin tener que navegar por un segundo iframe de ruta. El uso normal de la aplicación genera `/_agent-native/extensions/:id/render` como un iframe secundario en espacio aislado. En el modo puente de chat MCP, el marco representa el mismo documento de extensión que el `srcDoc` en el espacio aislado dentro del iframe de ruta, evitando fallas del host `frame-ancestors` / `X-Frame-Options` y preservando al mismo tiempo `sandbox="allow-scripts allow-forms"`.

El shell de recursos posee el tamaño del host externo. `embedApp({ height })` tiene como valor predeterminado `560px`, fija el shell en `320-900px` y reserva `44px` para la barra de herramientas pequeña, por lo que la ventana gráfica de ruta es `height - 44px`. Mantenga las rutas de aplicaciones integradas desplazables internamente y permita que el iniciador informe esa altura intrínseca limitada en lugar de la altura completa del documento; de lo contrario, el cambio de tamaño automático del host puede convertir una página de aplicación normal en un artefacto de chat muy alto. Un shell modificado solo afecta los nuevos recursos de la aplicación MCP y las nuevas llamadas a herramientas. Los marcos de conversación antiguos ChatGPT/Claude pueden mantener el comportamiento anterior de los recursos, así que verifique el tamaño con una renderización en línea nueva antes de juzgar una solución.

### Modos de inserción {#embed-modes}

Claude utiliza la ruta de trasplante de fotograma único de forma predeterminada. También puede forzarlo en otros hosts con `embedMode: "transplant"` o `frame: "transplant"` al depurar el comportamiento de carga del módulo del host. Puede forzar el iframe de diagnóstico anidado con `embedMode: "iframe"`, `renderMode: "iframe"`, `nested: true` o `frame: "iframe"`. Si el iframe está bloqueado, `embedApp()` lo reemplaza con una alternativa de aplicación abierta: el usuario puede volver a intentarlo en línea, abrir una sesión de inserción recién creada a través del host o usar la ruta visible URL. Mantén útil el objetivo `link` de la acción por sí solo porque sigue siendo la trampilla de escape universal.

Al probar Claude a través de ngrok, utilice una compilación de producción (`npx @agent-native/core@latest build` y luego `npx @agent-native/core@latest start`) o una vista previa/producción implementada de URL. La ruta de trasplante de fotograma único de Claude funciona con fragmentos de activos de producción; Los módulos de desarrollo Vite sin formato, como `/app/root.tsx`, pueden protegerse mediante la autenticación de la aplicación y fallar en las importaciones dinámicas desde el origen del recurso Claude.

## Puente de host API {#host-bridge}

El puente del host es deliberadamente pequeño:

| Modo                  | Tipo de mensaje                       | Úsalo para                                                           |
| --------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| ruta de host directa  | `ui/update-model-context`             | Contexto oculto para el modelo anfitrión                             |
| ruta de host directa  | `ui/message`                          | Publicar un cambio de usuario visible como anfitrión                 |
| ruta de host directa  | `ui/open-link`                        | Abra una aplicación o URL externo a través del host                  |
| ruta de host directa  | `ui/request-display-mode`             | Solicitar `inline`, `fullscreen` o `pip`                             |
| Trasplante Claude     | `ui/*`                                | Mismo puente huésped directo después de la hidratación               |
| ChatGPT / ruta iframe | `agentNative.mcpHostContext`          | Tema, configuración regional, plataforma de alojamiento, dimensiones |
| ChatGPT / ruta iframe | `agentNative.embeddedAppReady`        | Confirmar la ruta iframe cargada                                     |
| ChatGPT / ruta iframe | `agentNative.mcpHost.*` / `.response` | Retransmisión de contenedor para solicitudes de host                 |

Las rutas integradas pueden usar `updateMcpAppModelContext()`, `openMcpAppHostLink()`, `requestMcpAppDisplayMode()`, `getMcpAppHostContext()` y `useMcpAppHostContext()` de `@agent-native/core/client`. `sendToAgentChat()` utiliza la misma ruta desde las inserciones de la aplicación completa para los mensajes enviados automáticamente.

El modo de visualización es el mejor esfuerzo. El `McpAppRenderer` en la aplicación actualmente informa un contexto de alojamiento web en línea y un modo de visualización solo en línea; Los hosts externos pueden aceptar solicitudes de visualización más grandes, ignorarlas o responder con un error de modo no compatible. Mantenga siempre utilizable la ruta en línea.

## Soporte al cliente y almacenamiento en caché {#client-support}

La lista oficial actual de clientes de aplicaciones MCP incluye Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT y Cursor; El soporte del host aún varía según el plan, el canal de lanzamiento y la versión del cliente, así que consulte [MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix). Las aplicaciones ChatGPT personalizadas MCP están disponibles a través del modo desarrollador para espacios de trabajo Business y Enterprise/Edu en la web ChatGPT; consulte las notas [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta) de OpenAI.

Claude Code, Codex y otros clientes CLI/editor de código siguen recibiendo los mismos recursos y metadatos cuando admiten aplicaciones MCP, pero los tratan como hosts de enlace a menos que haya verificado la representación de iframe en línea en esa superficie exacta. El enlace profundo sigue siendo el recurso confiable cuando un host decide no representar un iframe. En la práctica, cada aplicación nativa del agente debe crearse con ambas: aplicaciones MCP para revisión/edición en línea en hosts compatibles y `link` para un retorno universal a la aplicación completa.

Claude y ChatGPT pueden almacenar en caché metadatos de herramientas y recursos para un conector personalizado existente. Después de cambiar los metadatos de la aplicación MCP, verifique con una nueva llamada a la herramienta; Si el host todavía usa el descriptor anterior, vuelva a conectar el conector Claude o vuelva a escanear/revisar el conector ChatGPT para que actualice el catálogo. Si Claude registra una advertencia sobre `_meta.ui.csp` o `_meta.ui.permissions` viviendo en el descriptor de la herramienta después de una implementación, ese conector está usando metadatos obsoletos: elimine/vuelva a conectar el conector Claude e inicie una nueva conversación.

## Pruebas {#testing}

Pruebe las aplicaciones MCP con los accesorios livianos alrededor de `embedApp()` y `McpAppRenderer`; cubren CSP, contexto del host, inicio de aplicaciones y comportamiento de mensajes puente sin necesidad de un host externo real. Al validar la web ChatGPT o Claude, active una nueva llamada a la herramienta después de los cambios de shell y mida el iframe visible. Es posible que los fotogramas renderizados previamente en la misma conversación aún muestren la altura almacenada en caché o el comportamiento de inicio.

## Relacionado {#related}

- [External Agents](/docs/external-agents): conexión de Claude, ChatGPT, Codex y Cursor a aplicaciones alojadas; Matriz de compatibilidad de aplicaciones MCP; niveles de catálogo; enlaces profundos.
- [MCP Protocol](/docs/mcp-protocol): el servidor MCP, autenticación, herramientas y `ask-agent` montados automáticamente.
- [Actions](/docs/actions) — `defineAction`, el constructor de `link`, `publicAgent`.

```

```
