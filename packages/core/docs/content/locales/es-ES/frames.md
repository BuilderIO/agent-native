---
title: "Marcos"
description: "El marco de desarrollo local, el panel de agente integrado y el marco de la nube: las formas en que un agente de IA se ejecuta junto con su aplicación."
---

# Marcos

Cada aplicación nativa del agente se ejecuta con un agente de IA junto a la aplicación UI. Un **marco** es
el contenedor que aloja ambos: muestra su aplicación y le da al agente un lugar para
chatear, ejecutar y (en desarrollo) editar código. Hay tres fotogramas que comparten un tiempo de ejecución:

- **Panel de agente integrado**: se envía dentro de cada aplicación desde `@agent-native/core`.
  Esta es la barra lateral que muestra su aplicación, en desarrollo y en producción.
- **Marco de desarrollo local**: un contenedor delgado que carga la aplicación en ejecución en un iframe
  y agrega el mismo panel de agente más un terminal CLI integrado al lado. Usado
  para el desarrollo local de plantillas en este repositorio.
- **Builder.io marco de nube**: un marco alojado y administrado con colaboración,
  edición visual y ejecuciones paralelas del agente.

El código de tu aplicación es idéntico independientemente del marco que lo aloje. El agente habla
a su aplicación a través del mismo actions y estado de la aplicación en todos los casos.

```an-diagram title="Tres fotogramas, un tiempo de ejecución" summary="Su aplicación y el panel de agentes son los mismos en todos los cuadros; sólo cambia la envoltura que los rodea."
{
  "html": "<div class=\"diagram-frames\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">Panel incrustado</span><small class=\"diagram-muted\">incluido en cada app · dev + prod</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Marco de desarrollo local</span><small class=\"diagram-muted\">app en iframe + panel + terminal CLI</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Marco cloud de Builder.io</span><small class=\"diagram-muted\">alojado: colaboración · edición visual · ejecuciones paralelas</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>Mismo runtime<br><small class=\"diagram-muted\">tu app · acciones · estado de aplicación</small></div></div>",
  "css": ".diagram-frames{display:flex;flex-direction:column;gap:10px;align-items:stretch}.diagram-frames .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-frames .diagram-arrow{font-size:22px;line-height:1;align-self:center}"
}
```

## Panel de agente integrado {#embedded-agent}

El panel integrado es la barra lateral del agente que representa su aplicación. Se envía con
`@agent-native/core`: no hay ningún paquete independiente para instalar, y es el mismo
componente en desarrollo y producción

- Exportado como `AgentPanel` desde `@agent-native/core/client`, con un
  variante de producción exclusiva `ProductionAgentPanel`.
- Proporciona la superficie completa de chat/CLI/espacio de trabajo, por lo que la entrada del agente permanece encendida
  la pila de compositores compartida utilizada en el resto del marco.
- Lee `application_state.navigation` en cada turno, por lo que ya sabe cuál
  vista en la que te encuentras y qué está seleccionado; no tienes que volver a explicar "esto".

### Modos de herramienta Aplicación vs Código {#tool-modes}

El panel se ejecuta en uno de dos modos de herramienta:

- **Modo de aplicación**: el agente solo tiene las herramientas propias de su aplicación: el actions usted
  definido con `defineAction`, además de navegación y contexto. Sin sistema de archivos o
  acceso al shell. Esto es lo que obtienen los usuarios finales.
- **Modo de código**: agrega las herramientas de codificación compartidas (`bash`, `read`, `edit`, `write`)
  y acceso a la base de datos además de las herramientas de la aplicación, para que el agente pueda cambiar las funciones de la aplicación
  fuente propia. Las solicitudes de código están cerradas: cuando un mensaje requiere código
  (`type: "code"`) y no hay ningún marco con capacidad de código conectado, el panel muestra un
  diálogo que explica que los cambios de código necesitan Agent Native Desktop o Builder;
  cuando se conecta una trama, la solicitud se dirige a ella y a un agente de código
  se muestra mientras funciona (`useSendToAgentChat`). Para lo canónico
  lista de herramientas de codificación y contratos UI compartidos, consulte
  [Agent-Native Code UI](/docs/code-agents-ui).

```an-diagram title="Puerta de solicitud de código" summary="Un mensaje escrito con código necesita un marco con capacidad para codificar. Con uno conectado, la solicitud se dirige allí; sin uno, el panel explica que los cambios de código necesitan Desktop o Builder."
{
  "html": "<div class=\"diagram-gate\"><div class=\"diagram-node\" data-rough>message<br><small class=\"diagram-muted\">type: \\\"code\\\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>code-capable frame connected?</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">yes &rarr; route to frame, show code-agent indicator</div><div class=\"diagram-pill warn\">no &rarr; dialog: needs Desktop or Builder</div></div></div>",
  "css": ".diagram-gate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-gate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-gate .diagram-arrow{font-size:22px;line-height:1}.diagram-gate .center{text-align:center}"
}
```

El "modo de código" es el conmutador de capacidad del agente, distinto del modo de desarrollo del entorno
(`NODE_ENV` / Vite). El enlace del cliente es `useCodeMode()`. (Ver
[Compatibility notes](#compatibility) para los alias de retrocompatibilidad.)

En el marco de desarrollo local, el engranaje de configuración alterna entre estos modos. Cambiando
El modo Código desactivado oculta la barra lateral del marco y muestra el agente dentro de la aplicación
barra lateral dentro del iframe, para que puedas obtener una vista previa exactamente de lo que ven los usuarios finales.

## Terminal integrado y conmutación CLI {#cli-terminal}

En desarrollo, el panel incluye un terminal integrado (`AgentTerminal`, también
de `@agent-native/core/client`) respaldado por un servidor PTY. Puedes ejecutar un verdadero
codificar CLI justo al lado de la aplicación y alternar entre ellas; el terminal se reinicia
con el CLI seleccionado.

Los CLI compatibles provienen del registro principal CLI
(`packages/core/src/terminal/cli-registry.ts`). Sólo estos comandos están permitidos
para generar: el servidor PTY valida el comando solicitado en el registro
Lista de permitidos para evitar la inyección:

| CLI            | Comando    | Instalar paquete            |
| -------------- | ---------- | --------------------------- |
| Código Claude  | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io     | `builder`  | (integrado)                 |
| Codex          | `codex`    | `@openai/codex`             |
| Géminis CLI    | `gemini`   | `@google/gemini-cli`        |
| Código abierto | `opencode` | `opencode-ai`               |

Si el CLI seleccionado no se encuentra en `PATH`, el terminal vuelve a ejecutarlo
a través de `npx --yes <install-package>@latest` (donde existe un paquete de instalación). El
el comando predeterminado es `claude`. Cambie CLI desde la configuración del panel del agente en cualquier
tiempo.

## Marco de nube Builder.io {#cloud-frame}

[Builder.io](https://www.builder.io) proporciona un marco administrado que aloja el
misma aplicación y mismo panel de agente, en la nube:

- Colaboración en tiempo real: varios usuarios pueden mirar e interactuar a la vez.
- Edición visual, roles y permisos.
- Ejecución paralela del agente para una iteración más rápida.
- Bueno para uso en equipo, donde todos comparten un entorno alojado.

Las solicitudes de código del panel integrado se dirigen al marco Builder de la misma manera
se dirigen al marco de desarrollo local, por lo que el comportamiento dev-vs-prod anterior es
consistente en ambos.

## API en tiempo de ejecución {#runtime-apis}

Estos se envían con `@agent-native/core` y son los que usa su aplicación para hablar con el
agente, independientemente del marco que lo aloje:

1. **Enviar un mensaje**: `sendToAgentChat()` envía un mensaje al agente. El
   El gancho `useSendToAgentChat()` lo envuelve con la activación de solicitud de código descrita
   arriba y devuelve un elemento `codeRequiredDialog` para renderizar. Ver
   [Drop-in Agent](/docs/drop-in-agent) para uso completo y opciones.
2. **Estado de generación**: `useAgentChatGenerating()` realiza un seguimiento cuando el agente está
   en ejecución, por lo que UI puede mostrar el progreso sin sondear al agente directamente.
3. **Sincronización de sondeo**: la sincronización respaldada por la base de datos mantiene actualizados los cachés de UI cuando el agente
   cambia los datos o el estado de la aplicación.
4. **Sistema de acción**: `pnpm action <name>` envía al mismo invocable
   actions el agente invoca como herramienta, por lo que cualquier cosa que el agente pueda hacer, tú puedes hacerlo
   guión.

## Ejecutándolo {#running}

El panel de agente integrado es parte de cada aplicación: cree una plantilla y ya está
ya está ahí:

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

El marco de desarrollo local (el paquete privado `@agent-native/frame` en el repositorio del marco) es un paquete de herramientas interno que no está publicado en npm. Carga el servidor de desarrollo de la aplicación activa en un iframe y monta el panel integrado junto a él, seleccionando la aplicación a través del parámetro de consulta `app`. El terminal CLI integrado requiere el escritorio Agent Native, que proporciona el código local y el acceso PTY que necesita el terminal; sin él, el panel muestra la superficie de chat y le solicita que abra el Escritorio para usar el CLI.

## Notas de compatibilidad {#compatibility}

El concepto de "modo de código" se denominaba anteriormente "modo de desarrollo", por lo que se han realizado algunas retrocompatibilidades
los nombres persisten. Puedes ignorarlos a menos que mantengas una integración anterior
código:

- La var de entorno subyacente `AGENT_MODE`, la `/_agent-native/agent-chat/mode`
  punto final (cuya clave de carga útil sigue siendo `devMode`) y `agent-chat.mode`
  La clave de configuración no se modifica.
- `useDevMode()` permanece como un alias obsoleto para `useCodeMode()`.
