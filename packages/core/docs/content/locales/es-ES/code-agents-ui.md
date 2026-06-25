---
title: "Agent-Native Código UI"
description: "Cree y personalice superficies de código Agent-Native con el paquete UI compartido, el puente de host de escritorio y el almacén de ejecución CLI."
---

# Agent-Native Código UI

> **¿Para quién es?** autores de alojamiento que crean o personalizan un espacio de trabajo de codificación
> superficie (CLI, escritorio o una plantilla de navegador) en el paquete de código compartido UI.

## ¿Qué documento de codificación quiero? {#which-doc}

| Quieres...                                                                           | Usar                                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------- |
| Renderizar un código Claude/estilo Codex **espacio de trabajo de codificación UI**   | **Agent-Native Código UI** (esta página) |
| Ejecute Claude Code / Codex / Pi **como agente**, con su propio bucle + herramientas | [Harness Agents](/docs/harness-agents)   |
| Cambiar el backend que ejecuta la **herramienta `run-code`**                         | [Adapters](/docs/sandbox-adapters)       |
| Preparar una herramienta CLI (`gh`, `ffmpeg`) para que el agente la llame            | [Adapters](/docs/sandbox-adapters)       |

Agent-Native Code es la superficie de codificación Agent-Native: un espacio de trabajo local estilo Claude Code/Codex para sesiones de codificación, comandos de barra diagonal, migraciones, auditorías, transcripciones, controles de ejecución y seguimientos. Un comando simple `npx @agent-native/core@latest` abre este espacio de trabajo; `npx @agent-native/core@latest code` es el subcomando explícito para la misma experiencia.

Hay tres capas:

- **CLI**: `npx @agent-native/core@latest` y `npx @agent-native/core@latest code` inician, reanudan, inspeccionan y detienen ejecuciones.
- **Escritorio**: la pestaña Código de la barra lateral izquierda agrega inicio de terminal nativo, vistas web de aplicaciones y enlaces profundos de escritorio mientras se usa el mismo modelo de ejecución.
- **UI compartido**: `@agent-native/code-agents-ui` renderiza la superficie reutilizable React.

```an-diagram title="Tres capas en una sola tienda" summary="CLI, Desktop y la interfaz de usuario compartida son superficies diferentes en el mismo almacén de ejecución y ejecutor respaldado por archivos; los hosts lo adaptan a través del contrato CodeAgentsHost."
{
  "html": "<div class=\"diagram-layers\"><div class=\"diagram-row\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">CLI</span><small class=\"diagram-muted\">iniciar · reanudar · estado · detener</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Desktop</span><small class=\"diagram-muted\">terminal nativo · webviews · enlaces profundos</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">Compartird UI</span><small class=\"diagram-muted\">@agent-native/code-agents-ui</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill\">CodeAgentsHost</span><small class=\"diagram-muted\">host contract</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>Almacén de ejecuciones en archivos + ejecutor<br><small class=\"diagram-muted\">@agent-native/core/code-agents</small></div></div>",
  "css": ".diagram-layers{display:flex;flex-direction:column;gap:10px;align-items:center}.diagram-layers .diagram-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.diagram-layers .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-layers .diagram-arrow{font-size:22px;line-height:1}.diagram-layers .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

La división actual converge intencionalmente: la barra lateral del agente estándar y los equipos de agentes se ejecutan en el ciclo de vida principal de `run-manager`, mientras que el código Agent-Native utiliza sesiones locales de larga duración respaldadas por el almacén de ejecución de código basado en archivos y el vocabulario compartido del controlador de ejecución en segundo plano.

El UI compartido está controlado por el host. No sabe si se está ejecutando en Electron, una plantilla de navegador o un futuro shell alojado. Los hosts proporcionan una implementación `CodeAgentsHost`.

```ts
import { CodeAgentsApp, type CodeAgentsHost } from "@agent-native/code-agents-ui";
import "@agent-native/code-agents-ui/styles.css";

const host: CodeAgentsHost = {
  listRuns: (goalId) => listRunsSomehow(goalId),
  listCodePacks: () => listCodePacksSomehow(),
  createRun: (request) => createRunSomehow(request),
  subscribeTranscript: (request, callback) =>
    subscribeToTranscriptSomehow(request, callback),
  readTranscript: (request) => readTranscriptSomehow(request),
  appendFollowUp: (request) => appendFollowUpSomehow(request),
  updateRun: (request) => updateRunSomehow(request),
  retryRun: (request) => retryRunSomehow(request),
  rerunRun: (request) => rerunRunSomehow(request),
  controlRun: (goalId, runId, command, permissionMode) =>
    controlRunSomehow({ goalId, runId, command, permissionMode }),
};

export function CodeSurface() {
  return <CodeAgentsApp apps={[]} host={host} />;
}
```

Los hosts pueden mezclar fuentes de ejecución en la misma lista. Sesiones locales de código Agent-Native
puede aparecer junto a Agent Teams u otros adaptadores que se ejecutan en segundo plano siempre que cada uno
la entrada se normaliza a `CodeAgentRun`. Cuando un host suministra `sourceLabel`,
`source` o `kind`, el concentrador muestra una pequeña etiqueta de origen como "Código local"
o "Equipos de agentes" en la lista de ejecución y el encabezado de la sesión seleccionada. Omitir esos campos
para una superficie de fuente única; el estado vacío y el diseño base permanecen sin cambios.

## Host de escritorio

El escritorio usa el UI compartido pero mantiene capacidades privilegiadas en Electron:

- abrir una terminal nativa
- renderizar superficies respaldadas por aplicaciones opcionales con `AppWebview`
- manejo de enlaces `agentnative://open?...`
- seguimiento de procesos de ejecución local
- registro de dirección frente a seguimientos en cola para carreras activas
- reintentar y volver a ejecutar sesiones de código nativo, incluidas `/migrate` y `/audit`
- detener un proceso iniciado

Esa separación importa. Las plantillas pueden reutilizar el UI, pero el control del proceso nativo debe permanecer en el escritorio o en el CLI.

## Autenticación Codex CLI {#codex-cli-auth}

El código Agent-Native puede utilizar un inicio de sesión local Codex CLI en lugar de una clave OpenAI API.
Instale Codex CLI en su `PATH`, inicie sesión una vez y luego reinicie el escritorio o
Código UI si ya estaba abierto:

```bash
npm install -g @openai/codex@latest
codex login
codex login status
```

El escritorio y el CLI leen `codex login status` y ejecutan `codex exec`, por lo que
reutilice cualquier suscripción ChatGPT o autenticación de clave API de su Codex CLI instalado
informes. Esto es independiente del paquete `@ai-sdk/harness-codex` utilizado por
[Harness Agents](/docs/harness-agents); el adaptador de arnés puede copiar local
Codex CLI se autentica en un entorno limitado de confianza solo cuando `codexCliAuth: true` está
explícitamente habilitado.

## Host del navegador

Se ha eliminado la antigua plantilla oculta `code`. Para crear una superficie de código alojada en el navegador, cree una aplicación normal y monte el paquete UI compartido con una implementación de host:

```bash
npx @agent-native/core@latest create my-code-ui --template chat
cd my-code-ui
pnpm add @agent-native/code-agents-ui
pnpm install
pnpm dev
```

Su host puede empaquetar el almacén de ejecución local a través de actions normal. Estos son
actions propiedad del host, usted mismo lo definiría: no se incluyen en el marco
actions: asigna cada método `CodeAgentsHost` al almacén de ejecución, por ejemplo:

- una acción de "ejecuciones de lista" que respalda a `listRuns`
- una acción de "enumerar paquetes de códigos" que respalda a `listCodePacks`
- una acción de "crear ejecución" que respalda a `createRun`
- una acción de "leer transcripción" que respalda a `readTranscript`
- una acción de "añadir seguimiento" que respalda a `appendFollowUp`
- una acción de "ejecución de actualización" que respalda a `updateRun`
- una acción de "ejecución de control" que respalda a `controlRun`

Cada uno llama a `@agent-native/core/code-agents`, lo que expone lo mismo
almacenamiento de ejecución respaldado por archivos y ejecutor utilizado por CLI.

## Controles de ejecución CLI

El CLI de nivel superior se comporta como el código Claude o Codex:

```bash
npx @agent-native/core@latest
npx @agent-native/core@latest "fix the failing auth tests"
npx @agent-native/core@latest code
```

Utilice `npx @agent-native/core@latest code` cuando desee el espacio de nombres explícito. Barra diagonal incorporada
los objetivos y los comandos del proyecto se pueden ejecutar dentro del espacio de trabajo interactivo o directamente
desde el shell:

```bash
npx @agent-native/core@latest code /migrate ./legacy-app --emit ./migration-dossier
npx @agent-native/core@latest code /audit --url https://example.com
npx @agent-native/core@latest code /release-check
```

Aquí `/migrate` y `/audit` son objetivos integrados (los objetivos integrados son
`task`, `migrate` y `audit`). `/release-check` se muestra como ejemplo de un
comando de proyecto: definido en `.agents/commands/`, no un objetivo integrado. Proyecto
los comandos provienen de `.agents/commands/*.md`; proviene del proyecto skills
`.agents/skills/*/SKILL.md`. Los comandos de control operan en la misma carrera
registra que la pestaña Código de escritorio y el UI compartido muestran:

```bash
npx @agent-native/core@latest code list
npx @agent-native/core@latest code status --last
npx @agent-native/core@latest code attach --last
npx @agent-native/core@latest code logs --last
npx @agent-native/core@latest code resume --last
npx @agent-native/core@latest code stop --last
npx @agent-native/core@latest code ui
```

`resume` agrega contexto y continúa una ejecución, `status` informa la última ejecución
estado, `stop` le pide al controlador activo que detenga el trabajo y `ui` abre el local
Superficie de código. Estos son controles de ejecución, no una ruta de implementación separada. Si un
El comando de alto riesgo se detiene para su aprobación, `approve --last` ejecuta el que está pendiente
comando y luego le indica que reanude la sesión.

Los modos de ejecución hacen que la política de edición sea explícita por sesión:

| Modo                      | Bandera CLI | Comportamiento                                                                                                                         |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Modo de planificación** | `--plan`    | Inspeccione, planifique y explique sin escribir archivos ni ejecutar mutaciones.                                                       |
| **Modo automático**       | `--auto`    | Edite archivos, ejecute comprobaciones y pausar solo para operaciones de archivos, git, publicación o datos genuinamente destructivas. |

El modo automático es el predeterminado para las sesiones locales del Código Agent-Native. Usar el modo Plan para
evaluación, arquitectura, revisión o cualquier tarea donde desee una propuesta antes
ediciones.

Para listas, paneles o paneles de supervisión multisuperficie, prefiera el compartido
exportaciones ejecutadas en segundo plano desde `@agent-native/core/code-agents` leyendo el código
ejecutar archivos directamente. Normalizan las sesiones de Código locales con el mismo vocabulario
utilizado por el trabajo en segundo plano alojado: ID de ejecución, estado, cwd, necesidades de entrada,
necesidades de aprobación, eventos de transcripción y raíz de artefacto.

Los equipos de agentes alojados también están expuestos desde la ruta de chat del agente para el navegador
hosts que necesitan una lista compatible con Code Hub sin importaciones directas de servidor:
`GET /_agent-native/agent-chat/runs/list?goalId=agent-team` devuelve
`{ status: "ok", goalId, runs }`, donde cada ejecución incluye `kind`,
`source`, `sourceLabel`, `status`, `title`, marcas de tiempo y metadatos de tareas.
`GET /_agent-native/agent-chat/runs/:id/background-events` devuelve el
eventos de transcripción en segundo plano compartidos para una ejecución de Agent Teams.

Los hosts respaldados por adaptadores también pueden adjuntar metadatos de origen:

```ts
{
  id: run.id,
  goalId: "task",
  title: run.title,
  source: "agent-teams",
  sourceLabel: "Agent Teams",
  kind: "background-run",
  status: run.status,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
}
```

## Ejecutar tienda

Las ejecuciones del código local Agent-Native se almacenan en:

```text
~/.agent-native/code-agents
```

Configure `AGENT_NATIVE_CODE_AGENTS_HOME` para aislar una plantilla o un almacén de ejecución de prueba.

```bash
AGENT_NATIVE_CODE_AGENTS_HOME=./data/code-agents pnpm dev
```

## Contrato de anfitrión

`CodeAgentsHost` es intencionalmente pequeño:

| Método                                                | Propósito                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `listRuns(goalId?)`                                   | Enumerar sesiones para el objetivo seleccionado                          |
| `listCodePacks?()`                                    | Lista `.agents/commands` y `.agents/skills`                              |
| `createRun(request)`                                  | Iniciar una nueva ejecución                                              |
| `subscribeTranscript?(request, callback)`             | Enviar actualizaciones de transcripción a la conversación compartida     |
| `readTranscript(request)`                             | Eventos de transcripción de encuestas como alternativa de compatibilidad |
| `appendFollowUp(request)`                             | Añadir un seguimiento, ya sea dirigiendo el trabajo activo o en cola     |
| `updateRun(request)`                                  | Modo de actualización o ejecutar metadatos                               |
| `retryRun?(request)`                                  | Reintentar la ejecución seleccionada en el lugar                         |
| `rerunRun?(request)`                                  | Iniciar una nueva ejecución desde un mensaje anterior                    |
| `controlRun(goalId, runId, command, permissionMode?)` | Reanudar, aprobar, actualizar o detener                                  |
| `openTerminal?(request)`                              | Gancho de terminal nativo opcional                                       |

Los hosts del navegador deberían devolver un elegante error `openTerminal` en lugar de intentar emular el inicio del terminal nativo.

## Compositor compartido

El código Agent-Native usa el mismo `AgentComposerFrame` + `PromptComposer` /
Pila `TiptapComposer` exportada desde `@agent-native/core/client/composer` como
barra lateral del agente de framework. No bifurque uno por separado
área de texto, selector de herramientas de codificación, selector de carga, botón de voz, selector de modelo o entrada para enviar
implementación para superficies tipo código. Si un host necesita un control adicional, pase
a través de los puntos de extensión del compositor compartido para que la barra lateral, Código UI y
El chat cerebral mantiene el mismo modelo de interacción y campo visual.

La ruta Ask de Brain utiliza `AgentChatSurface`, que ya está respaldada por
compositor de barra lateral estándar. El código usa `PromptComposer` directamente porque el host
es propietario de la creación de ejecuciones, las transcripciones y la entrega de seguimiento.

## Herramientas de codificación compartidas

El agente de desarrollo de la barra lateral y el código Agent-Native utilizan el mismo mínimo
perfil de herramienta de codificación: `bash`, `read`, `edit` y `write`. `bash` es el valor predeterminado
para enumerar/buscar archivos, ejecutar pruebas e invocar proyectos CLI; `read`
muestra fragmentos de archivos numerados por líneas; `edit` aplica reemplazos de texto exactos; y
`write` está reservado para archivos nuevos o reescrituras completas intencionales. Alias más antiguos
como `shell`, `read-file`, `write-file`, `list-files` y `search-files`
son solo de compatibilidad y no forman parte de la superficie anunciada predeterminada.

El código específico UI pertenece al compositor, no dentro de un campo de chat bifurcado. El
El código compartido UI puede agregar espacios para:

- Controles del modo Auto/Planificación.
- El cwd seleccionado, el selector de proyectos y los metadatos de ejecución.
- Opciones exclusivas del host, como abrir una terminal.

Todo lo demás permanece en el compositor compartido: archivos adjuntos, referencias, barra diagonal y
inserción de habilidades, manejo de texto pegado, dictado de voz, borradores, teclado
atajos y semántica de envío.

La transcripción de cara al usuario debe permanecer conversacional. Los hosts de código se normalizan sin formato
eventos de transcripción/estado/herramienta en el renderizador de conversación compartido: asistente
El texto se fusiona en un solo turno, el ruido del ciclo de vida de la señal baja permanece fuera del principal
La actividad de superficies y herramientas se representa como resúmenes compactos en línea con detalles
disponible cuando sea necesario.

## Comandos de barra diagonal

El código Agent-Native trata la migración como una capacidad, no como una categoría de aplicación separada. `/migrate` puede ser un objetivo integrado, un comando de proyecto o un paquete de instrucciones personalizado además del mismo contrato de host.

### Migración a Agent-Native con `/migrate` {#migrate}

`/migrate` es el objetivo integrado para mover una aplicación existente, URL o un producto descrito a Agent-Native. Es un objetivo de barra diagonal en el espacio de trabajo de Código, no una plantilla separada para estructurar ni un producto único, por lo que comparte el mismo almacén de sesiones, transcripción, controles de ejecución y centro de escritorio como cualquier otra sesión de Código, y puede reanudarlas, adjuntarlas, inspeccionarlas y detenerlas de la misma manera.

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site plus dashboard"
npx @agent-native/core@latest code /migrate --describe "A Rails admin app with reports and CSV imports" --emit
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app   # shortcut into the same goal
```

Las rutas de origen locales son de sólo lectura; La salida generada debe vivir fuera del árbol de origen. Utilice `--emit <dir>` para escribir un expediente de migración portátil (`AGENTS.md`, `MIGRATION_PLAYBOOK.md`, evaluación y un inventario de `ir.json` cuando esté disponible) y entréguelo a otro agente codificador en lugar de abrir la superficie de ejecución interna. `/migrate` reutiliza el sistema de credenciales normal del marco; no existe un almacén de claves específico de la migración. El paquete `@agent-native/migrate` expone un motor reutilizable (`createMigrationRun`, `discoverMigration`, `planMigration`, adaptadores de origen/destino) para flujos de trabajo personalizados.

Los comandos específicos del proyecto se encuentran en:

```text
.agents/commands/*.md
```

Utilícelos para flujos de trabajo de equipo, como comprobaciones de versiones, variantes de migración, actualizaciones del marco o auditorías.

El proyecto skills se encuentra en:

```text
.agents/skills/*/SKILL.md
```

Cuando el host implementa `listCodePacks`, el UI compartido muestra los comandos del proyecto y el skills en el riel. Las filas de comando insertan `/<command>` y las filas de habilidades insertan un mensaje enfocado "Usa la habilidad <skill>..." para que el riel siga siendo procesable. Los objetivos de barra integrados `/migrate` y `/audit` permanecen reservados para los controles de código globales Agent-Native, al igual que los nombres de control de ejecución como `status` y `resume`; son subcomandos invocados sin barra (`npx @agent-native/core@latest code status`, `npx @agent-native/core@latest code resume`), no objetivos de barra.

No cree un registro de comandos de barra diagonal independiente para un nuevo host de código. Proyecto
Los comandos y skills se descubren desde `.agents/commands/*.md` y
`.agents/skills/*/SKILL.md`; el UI debería representar esos paquetes e insertar mensajes
a través del compositor compartido.

## Administrador de ejecución del agente en segundo plano

El trabajo del agente de codificación en segundo plano debe reutilizar la misma base del administrador de ejecución que el
resto de Agent-Native:

- Utilice el almacén/ejecutor de ejecución de código para sesiones de código locales.
- Utilice la base/adaptador de ejecución en segundo plano compartido cuando sea necesario incluir una superficie en la lista,
  inspeccionar o unir sesiones de Código local con otro trabajo en segundo plano.
- Utilice el núcleo `run-manager` para las ejecuciones del agente alojado, de modo que se transmitan, se cancelen y se produzcan latidos
  La reanudación, los tiempos de espera suaves y la limpieza de ejecución atascada se comportan de manera consistente.
- Utilice `agent-teams` / `spawnTask()` cuando UI esté delegando trabajo a un
  subagente en segundo plano desde un chat de aplicación normal.

No agregue un corredor de agente de fondo paralelo solo porque una nueva superficie necesita un
diseño diferente. Construya un adaptador de host o una ranura UI encima del compartido
en su lugar, base run-manager.

## Seguimientos

Los seguimientos de ejecuciones activas admiten dos modos de entrega:

- Al presionar Enter o hacer clic en enviar, se registra un mensaje de dirección inmediato que indica que
  El corredor activo se aplica en el siguiente punto de continuación seguro.
- Al presionar Cmd+Entrar en macOS o Ctrl+Entrar en otro lugar se pone en cola el mensaje para ejecutarse
  después de que termine el turno actual.

Las ejecuciones inactivas mantienen el comportamiento compatible: se agrega el seguimiento y la ejecución se reanuda inmediatamente.

Eso le da a Code la misma forma de mensajería bidireccional orientada al usuario que Agent Teams:
el usuario puede seguir hablando con el trabajo activo, pero la ejecución solo lo consume
mensaje en un punto de continuación seguro. Si un corredor no puede girar inmediatamente,
debe persistir el seguimiento como trabajo en cola en lugar de abandonarlo o acelerarlo.

## Envío remoto

El escritorio puede exponer el ejecutor del agente de código local a un relé de envío implementado para que
El chat telefónico o de Telegram puede iniciar, monitorear y continuar sesiones mientras
la computadora está despierta.

La conexión es solo saliente desde el escritorio:

1. El escritorio se empareja con Dispatch y almacena un token de dispositivo localmente.
2. Encuestas largas de escritorio `/_agent-native/integrations/remote/poll`.
3. Sesiones móviles y Telegram `/code` ponen en cola los comandos en la base de datos de retransmisión.
4. El escritorio reclama comandos, gestiona el almacén de ejecución local y publica resultados y
   transcribir eventos de regreso a Dispatch.
5. El móvil lee `hosts`, `runs` y `transcript` desde Dispatch; nunca habla
   directamente al escritorio.

```an-diagram title="El Dispatch remoto es solo saliente" summary="El móvil nunca habla directamente con el escritorio. Desktop realiza encuestas largas a Dispatch, reclama comandos, gestiona el almacén de ejecución local y refleja los resultados."
{
  "html": "<div class=\"diagram-remote\"><div class=\"diagram-node\" data-rough>Móvil / Telegram<br><small class=\"diagram-muted\">/code · sesiones</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Relay de Dispatch<br><small class=\"diagram-muted\">hosts · ejecuciones · transcripción</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-node\" data-rough>Desktop<br><small class=\"diagram-muted\">long-polls · reclama · dirige el almacén de ejecuciones</small></div></div>",
  "css": ".diagram-remote{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-remote .diagram-arrow{font-size:22px;line-height:1}"
}
```

Los puntos finales de retransmisión remota canónicos son:

```an-api title="Trabajo en cola de reclamaciones de escritorio"
{
  "method": "POST",
  "path": "/_agent-native/integrations/remote/poll",
  "summary": "El escritorio realiza una encuesta prolongada al relé para reclamar comandos en cola",
  "description": "Outbound-only from a paired Desktop host. Desktop authenticates with its device token and claims work that mobile or Telegram enqueued.",
  "auth": "Desktop device token",
  "responses": [
    { "status": "200", "description": "Claimed commands for this host (may be empty after the long-poll window)." }
  ]
}
```

| Método     | Ruta                                                     | Llamante             | Propósito                                                  |
| ---------- | -------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `POST`     | `/_agent-native/integrations/remote/register`            | Sesión de escritorio | Empareja un host de escritorio y devuelve un token una vez |
| `GET`      | `/_agent-native/integrations/remote/hosts`               | Móvil/sesión         | Listar hosts emparejados                                   |
| `DELETE`   | `/_agent-native/integrations/remote/devices/:id`         | Móvil/sesión         | Revocar un host emparejado                                 |
| `POST`     | `/_agent-native/integrations/remote/devices/:id/revoke`  | Móvil/sesión         | Revocar un host emparejado                                 |
| `POST/GET` | `/_agent-native/integrations/remote/poll`                | Token de escritorio  | Reclamar trabajo                                           |
| `POST`     | `/_agent-native/integrations/remote/result`              | Token de escritorio  | Trabajo completo o fallido                                 |
| `POST`     | `/_agent-native/integrations/remote/run-events`          | Token de escritorio  | Eventos de transcripción reflejada                         |
| `GET`      | `/_agent-native/integrations/remote/runs`                | Móvil/sesión         | Listar sesiones                                            |
| `GET`      | `/_agent-native/integrations/remote/runs/:id`            | Móvil/sesión         | Leer resumen de la sesión                                  |
| `GET`      | `/_agent-native/integrations/remote/runs/:id/transcript` | Móvil/sesión         | Leer transcripción reflejada                               |
| `POST`     | `/_agent-native/integrations/remote/push/register`       | Móvil/sesión         | Registrar Expo/token push móvil                            |

Telegram usa el mismo relé a través de Dispatch. Los comandos admitidos son:

```text
/code <prompt>
/code list
/code status <run>
/code continue <run> <text>
/code approve <id>
/code deny <id>
/code stop <run>
```

## Estilo

Importar la hoja de estilo del paquete:

```ts
import "@agent-native/code-agents-ui/styles.css";
```

La hoja de estilo utiliza las mismas propiedades personalizadas HSL de estilo shadcn que las plantillas y el shell del escritorio. Prefiere cambiar tokens o anulaciones de clases pequeñas en la aplicación host antes de bifurcar el UI compartido.

## Límites

La plantilla del navegador es local primero. Puede iniciar y reanudar ejecuciones mientras su servidor de nodo local está activo. Para el ciclo de vida del proceso nativo, el inicio de terminal y las vistas web de aplicaciones, utilice Escritorio.
