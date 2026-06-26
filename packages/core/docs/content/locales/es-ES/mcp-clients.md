---
title: "Clientes MCP"
description: "Conecte la aplicación nativa de su agente a servidores MCP locales (claude-in-chrome, sistema de archivos, dramaturgo, etc.) para que el agente obtenga sus herramientas."
---

# Clientes MCP

**Esta página: brinde a su agente más herramientas.** Apunte una aplicación nativa del agente a los servidores MCP (locales o remotos) para que sus herramientas aparezcan en el chat del agente. Esta es la dirección _cliente_, la imagen reflejada de [MCP Protocol](/docs/mcp-protocol) (que convierte su aplicación en un _servidor_ MCP).

| Si quieres…                                                                                        | Leer                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Conecta un agente/host externo a tu aplicación                                                     | [External Agents](/docs/external-agents) |
| Dale a tu agente más herramientas (consume otros servidores MCP)                                   | **Esta página** — Clientes de MCP        |
| Crea UI en línea que se rendericen en Claude/ChatGPT                                               | [MCP Apps](/docs/mcp-apps)               |
| Referencia del servidor MCP de nivel inferior (autenticación, herramientas, montaje personalizado) | [MCP Protocol](/docs/mcp-protocol)       |

Con un archivo de configuración, cada aplicación nativa del agente en su espacio de trabajo obtiene acceso a las herramientas proporcionadas por los servidores MCP en su máquina: `claude-in-chrome` para la automatización del navegador, `@modelcontextprotocol/server-filesystem` para leer archivos, `@playwright/mcp` para pruebas del navegador y cualquier otra cosa que diga MCP.

También puedes [connect remote (HTTP) MCP servers at runtime](#remote-via-ui) (usuarios individuales u organizaciones enteras) sin editar un archivo de configuración.

Cada fuente se resuelve en un **administrador MCP** en tiempo de ejecución, y cada herramienta que aprende aterriza en el registro de herramientas del agente bajo un prefijo `mcp__<server-id>__<tool>` a prueba de colisiones, que se puede buscar por intención a través de `tool-search`.

```an-diagram title="Dirección del cliente: muchas fuentes, un registro de herramientas" summary="Los archivos de configuración, el entorno y la interfaz de usuario en tiempo de ejecución se fusionan en el administrador MCP; sus herramientas aparecen con prefijo y se pueden buscar mediante herramientas junto con las acciones de su aplicación. Este es el espejo de la dirección del servidor."
{
  "html": "<div class=\"mcp-merge\"><div class=\"diagram-col sources\"><div class=\"diagram-box\" data-rough>Workspace <code>mcp.config.json</code><br><small class=\"diagram-muted\">compartido entre apps</small></div><div class=\"diagram-box\" data-rough>Raíz de la app <code>mcp.config.json</code><br><small class=\"diagram-muted\">sobrescritura por app</small></div><div class=\"diagram-box\" data-rough><code>MCP_SERVERS</code> env<br><small class=\"diagram-muted\">CI / producción</small></div><div class=\"diagram-box\" data-rough>Remoto desde la UI de ajustes<br><small class=\"diagram-muted\">personal &amp; org scope</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Gestor MCP</span><small class=\"diagram-muted\">merge &middot; hot-reload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col out\"><div class=\"diagram-node\">Herramienta del agente registry<br><small class=\"diagram-muted\"><code>mcp__&lt;server-id&gt;__&lt;tool&gt;</code></small></div><div class=\"diagram-node\"><code>tool-search</code><br><small class=\"diagram-muted\">descubrir por intención</small></div></div></div>",
  "css": ".mcp-merge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-merge .diagram-col{display:flex;flex-direction:column;gap:8px}.mcp-merge .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-merge .diagram-arrow{font-size:22px;line-height:1}.mcp-merge code{font-size:.85em}"
}
```

> La dirección opuesta (convertir _tu_ aplicación en un servidor MCP que otros hosts consumen) se encuentra en [MCP Protocol](/docs/mcp-protocol) y [External Agents](/docs/external-agents).

## Explorador integrado y capacidades de uso de computadora {#built-in-capabilities}

El agente nativo incluye opciones de desarrollo local para servidores stdio MCP comunes.
Están desactivados de forma predeterminada y se pueden habilitar por usuario o solo por organización
cuando la aplicación se ejecuta localmente. Se omiten los tiempos de ejecución alojados y de producción sin servidor
estos elementos integrados incluso si existen filas de configuración antiguas y los recursos del espacio de trabajo
El árbol no los muestra como recursos `mcp-servers/*.json` predeterminados.

| Capacidad                            | Identificación del servidor | Comando                                                                 |
| ------------------------------------ | --------------------------- | ----------------------------------------------------------------------- |
| Herramientas de desarrollo de Chrome | `chrome-devtools`           | `npx -y chrome-devtools-mcp@latest --autoConnect --no-usage-statistics` |
| Navegador de dramaturgos             | `playwright`                | `npx -y @playwright/mcp@latest`                                         |
| Uso de la computadora                | `computer-use`              | `npx -y computer-use-mcp@latest`                                        |

Solo se puede habilitar una capacidad del navegador en un ámbito a la vez. Al habilitar Chrome DevTools se deshabilita Playwright para ese mismo usuario u organización, y al habilitar Playwright se deshabilita Chrome DevTools.

El uso de la computadora es solo para macOS. En otras plataformas, aparece como no disponible y se omite incluso si una fila de configuración anterior lo contiene.

Chrome DevTools usa `--autoConnect` de forma predeterminada. Eso se adjunta a una instancia de Chrome en ejecución elegible; no crea un perfil de navegador aislado ni inicia sesión en el perfil habitual del usuario por usted. Requiere Chrome 144+ con la depuración remota habilitada. Se puede agregar una configuración manual de `browser-url` más adelante cuando una implementación necesite un punto final de depuración específico.

Las funciones integradas se conservan en la tabla `settings` del marco en `u:<email>:mcp-builtin-capabilities` para alternancias personales y `o:<orgId>:mcp-builtin-capabilities` para alternancias de equipo. Cuando están habilitados, se fusionan en el administrador de tiempo de ejecución MCP con el mismo formato de visibilidad de alcance que los servidores remotos, por ejemplo, `mcp__user_<emailhash>_playwright__*` o `mcp__org_<orgId>_chrome-devtools__*`.

### Notas de configuración para el usuario

Utilice una copia de configuración explícita y concisa para las funciones integradas sensibles:

- **Chrome DevTools** se adjunta a un destino de depuración de Chrome en ejecución. Informar a los usuarios
  está destinado a pruebas de navegador y verificación de inicio de sesión, y que
  Es posible que sea necesario habilitar la depuración remota de Chrome antes de que aparezcan las herramientas.
- **Dramaturgo** inicia un navegador aislado. Lo recomiendo para determinista
  Control de calidad cuando no se requiere el perfil activo de Chrome del usuario.
- **Uso de computadora** puede operar aplicaciones locales. Manténgalo desactivado de forma predeterminada, explique el
  Indicaciones de accesibilidad y grabación de pantalla de macOS, y pregunte antes de tomar
  actions sensibles como compras, cambios financieros o cambios de cuenta.

### Puntos finales integrados

| Método | Ruta                         | Propósito                                                                                                       |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/_agent-native/mcp/builtin` | Enumere las capacidades integradas, los ámbitos habilitados, los identificadores combinados y el estado activo. |
| POST   | `/_agent-native/mcp/builtin` | Actualizar un alcance. Cuerpo: `{ scope, enabledIds }` o `{ scope, id, enabled }`.                              |

## Agregar un servidor MCP local {#adding-a-server}

Cree `mcp.config.json` en la raíz de su espacio de trabajo (o en la raíz de una aplicación individual; la raíz del espacio de trabajo gana cuando ambas existen):

```jsonc
{
  "$schema": "https://agent-native.com/schema/mcp.config.json",
  "servers": {
    "claude-in-chrome": {
      "command": "claude-in-chrome-mcp",
      "args": [],
      "env": { "LOG_LEVEL": "info" },
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@latest",
        "/Users/me/projects",
      ],
    },
  },
}
```

La forma es pequeña: un mapa `servers` codificado por ID de servidor, donde cada entrada es un iniciador estándar (`command` + `args` + `env` opcional) o una entrada remota `{ "type": "http", "url", "headers" }`.

```an-annotated-code title="mcp.config.json, anotado"
{
  "filename": "mcp.config.json",
  "language": "jsonc",
  "code": "{\n  \"$schema\": \"https://agent-native.com/schema/mcp.config.json\",\n  \"servers\": {\n    \"claude-in-chrome\": {\n      \"command\": \"claude-in-chrome-mcp\",\n      \"args\": [],\n      \"env\": { \"LOG_LEVEL\": \"info\" }\n    },\n    \"filesystem\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem@latest\", \"/Users/me/projects\"]\n    }\n  }\n}",
  "annotations": [
    { "lines": "3", "label": "identificación del servidor", "note": "La clave se convierte en el prefijo de la herramienta: las herramientas de este servidor aparecen como `mcp__claude-in-chrome__*` en el registro del agente, por lo que no pueden colisionar con las acciones de su plantilla." },
    { "lines": "4-6", "label": "stdio launcher", "note": "`command` + `args` generan un binario local. Los servidores Stdio están destinados al **desarrollo local**; no son operativos en los tiempos de ejecución perimetrales." },
    { "lines": "6", "label": "entorno de proceso", "note": "Optional `env` is passed to the spawned process. Keep secrets out of committed config; prefer `MCP_SERVERS` or the settings UI for tokens." }
  ]
}
```

En el siguiente inicio de la aplicación verás:

```
[mcp-client] loaded config from /path/to/mcp.config.json (3 server(s))
[mcp-client] connected to claude-in-chrome: 12 tools
[mcp-client] connected to playwright: 9 tools
[mcp-client] connected to filesystem: 4 tools
```

Las herramientas están registradas en el registro de herramientas del agente con el prefijo `mcp__<server-id>__<tool-name>` para que no puedan colisionar con el actions de su plantilla. También se incluyen en `tool-search`, por lo que los agentes pueden descubrir capacidades MCP recién conectadas por intención en lugar de necesitar el nombre exacto con el prefijo por adelantado.

## Precedencia de configuración {#precedence}

La configuración MCP se resuelve en este orden, el primer partido gana:

1. **Raíz del espacio de trabajo `mcp.config.json`**: detectado a través de `agent-native.workspaceCore` en `package.json`. Compartido en todas las aplicaciones del espacio de trabajo.
2. **Raíz de la app `mcp.config.json`**: anulación por aplicación si no desea que haya un servidor MCP disponible en cada aplicación.
3. **`MCP_SERVERS` env var**: cadena JSON con la misma forma, para CI/producción donde un archivo no tiene sentido.

## Implementaciones de producción: `MCP_SERVERS` {#mcp-servers-env}

Para implementaciones de producción, prefiera servidores HTTP MCP remotos y configure la configuración completa
forma (o el mapa del servidor interno) como una variable de entorno:

```bash
MCP_SERVERS='{"servers":{"zapier":{"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer paste-token-value-here"}}}}'
```

`MCP_SERVERS` se analiza como JSON, por lo que los marcadores de posición `${...}` no se expanden
dentro de la cadena. Si almacena el token en otro secreto, expándalo antes
escribiendo el valor final de JSON.

Los servidores Stdio MCP generan archivos binarios locales y están pensados para el desarrollo local.
Las herramientas MCP solo se activan en tiempos de ejecución de Node: Cloudflare Workers y otras ventajas
Los objetivos omiten silenciosamente MCP y continúan con el resto de la aplicación funcionando
normalmente.

## Detección automática: `claude-in-chrome` {#autodetect}

Si **no** tiene `mcp.config.json` y el binario `claude-in-chrome-mcp` está en `PATH` (o en la conocida ubicación de instalación `~/.claude-in-chrome/bin/claude-in-chrome-mcp`), el agente nativo lo registra automáticamente como servidor MCP predeterminado. Configure `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1` para excluirse.

Esto significa que los usuarios que han instalado la extensión claude-in-chrome obtienen control del navegador en cada aplicación nativa del agente que abren sin cambios de configuración.

## Servidores MCP remotos a través de la configuración UI {#remote-via-ui}

Los servidores MCP (Protocolo de contexto modelo) le brindan a su agente nuevas capacidades, como conectarse a Zapier, Cloudflare, Composio o las herramientas internas de su empresa. Una vez conectado, el agente puede utilizar esas herramientas al igual que las integradas.

### Cómo conectar un servidor MCP remoto

1. **Nombre del servidor**: una etiqueta breve para su propia referencia (por ejemplo, "zapier", "slack-tools").
2. **URL**: el punto final HTTPS que le proporcionó el proveedor del servidor MCP (por ejemplo, `https://mcp.zapier.com/s/abc123/mcp`). Esto generalmente se encuentra en el panel del proveedor o en los documentos de integración.
3. **Descripción** (opcional): una nota sobre lo que hace este servidor.
4. **Encabezados**: credenciales de autenticación que requiere el servidor, una por línea. La mayoría de los servidores necesitan un encabezado `Authorization`. Ejemplo: `Authorization: Bearer sk-your-key-here`. Los documentos del proveedor le indicarán qué poner aquí.

Haga clic en **Probar** para verificar la conexión antes de guardar. Si tiene éxito, verá la cantidad de herramientas disponibles. Haga clic en **Conectar** para agregarlo.

### Ámbito personal frente a organización

Se admiten dos ámbitos:

- **Personal**: solo el usuario que ha iniciado sesión obtiene las herramientas. Almacenado como una configuración de ámbito de usuario.
- **Equipo**: todos los miembros de la organización activa obtienen las herramientas. Los propietarios y administradores pueden agregar; los miembros ven la lista como de solo lectura. Almacenado como una configuración del ámbito de la organización.

Agrega y elimina la recarga en caliente en el administrador MCP en ejecución: sin reinicio del proceso ni reinicio del servidor. Las nuevas herramientas `mcp__<scope>-<name>__*` le aparecen al agente en el siguiente mensaje y se pueden buscar a través de `tool-search`.

HTTPS URL se aceptan en todas partes; `http://` simple solo se permite para `localhost` durante el desarrollo. La autenticación opcional se ingresa como un token de portador que se envía a través de `Authorization: Bearer …` en cada solicitud.

En el fondo, estos servidores persisten en la tabla `settings` del marco bajo la clave `u:<email>:mcp-servers-remote` (Personal) o `o:<orgId>:mcp-servers-remote` (Equipo) y se fusionan con `mcp.config.json` al inicio.

### Puntos finales HTTP

| Método | Ruta                                                  | Propósito                                                                                 |
| ------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/_agent-native/mcp/servers`                          | Enumera los servidores personales y de organización del usuario actual con estado activo. |
| POST   | `/_agent-native/mcp/servers`                          | Agregar un servidor. Carrocería: `{ scope, name, url, headers?, description? }`.          |
| DELETE | `/_agent-native/mcp/servers/:id?scope=user\|org`      | Remove a server and reconfigure the manager.                                              |
| POST   | `/_agent-native/mcp/servers/:id/test?scope=user\|org` | Dry-run the existing server's connect + list-tools.                                       |
| POST   | `/_agent-native/mcp/servers/test`                     | Ejecute en seco un URL arbitrario antes de persistir. Cuerpo: `{ url, headers? }`.        |

Los servidores Stdio todavía no funcionan fuera de los tiempos de ejecución de Node, pero los servidores remotos HTTP MCP funcionan en cualquier entorno con `fetch`, incluidas las versiones de producción de escritorio.

## Servidores MCP compartidos a través de un concentrador {#hub}

Si su espacio de trabajo ejecuta varias aplicaciones nativas del agente (por ejemplo, envío + correo + clips), puede configurar **una** aplicación como centro y hacer que las demás extraigan sus servidores MCP de alcance organizativo automáticamente. No se permite copiar y pegar por aplicación URL ni tokens al portador. Consulte [Multi-App Workspace](/docs/multi-app-workspace) para conocer el enfoque canónico que utiliza los recursos MCP del espacio de trabajo de envío.

El envío es el centro convencional: ya coordina todas las aplicaciones.

```an-diagram title="Modelo de concentrador: una aplicación sirve servidores MCP de alcance organizativo" summary="Dispatch contiene los servidores MCP de ámbito de organización; las aplicaciones de consumo las extraen y combinan como mcp__hub_<orgId>_<name>__*. Solo se comparten las filas del ámbito de la organización: las credenciales personales permanecen intactas."
{
  "html": "<div class=\"mcp-hub\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch hub</span><small class=\"diagram-muted\">servidores MCP con alcance de organización</small><small class=\"diagram-muted\"><code>GET /mcp/hub/servers</code></small></div><div class=\"diagram-col arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div></div><div class=\"diagram-col consumers\"><div class=\"diagram-box\" data-rough>Mail<br><small class=\"diagram-muted\"><code>mcp__hub_&lt;orgId&gt;_&lt;name&gt;__*</code></small></div><div class=\"diagram-box\" data-rough>Clips<br><small class=\"diagram-muted\">pull + merge cada ~60 s</small></div></div></div><p class=\"diagram-muted note\">Bearer-gated by <code>AGENT_NATIVE_MCP_HUB_TOKEN</code>. Personal (user-scope) servers are never re-exposed.</p>",
  "css": ".mcp-hub{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-hub .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-hub .diagram-col{display:flex;flex-direction:column;gap:10px}.mcp-hub .arrows .diagram-arrow{font-size:22px;line-height:1}.mcp-hub .note{margin:8px 0 0;font-size:.85em}.mcp-hub code{font-size:.85em}"
}
```

Para configuraciones de espacios de trabajo nuevos, prefiera **Enviar recursos MCP del espacio de trabajo** cuando
quiero el mismo modelo de concesión para todas las aplicaciones y para aplicaciones seleccionadas que utiliza el espacio de trabajo skills
instrucciones y recursos de referencia. Agregue un recurso de espacio de trabajo con:

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${keys.MCP_SERVER_TOKEN}"
  },
  "description": "Shared Herramienta MCPs for workspace apps"
}
```

Guárdelo en `mcp-servers/<name>.json` con el tipo `mcp-server`. Todas las aplicaciones
los recursos los carga cada aplicación del espacio de trabajo; los recursos seleccionados se cargan sólo en
aplicaciones con una concesión de envío activa. Los marcadores de posición secretos se resuelven desde la aplicación
almacenamiento secreto, así que coloque tokens de portador sin procesar en Dispatch Vault y haga referencia a ellos
con `${keys.NAME}` en lugar de almacenarlos en el cuerpo del recurso.

Las aplicaciones actualizan su configuración MCP fusionada aproximadamente una vez por minuto, por lo que es un recurso central
las ediciones, los cambios de concesión y las eliminaciones entran en vigor sin una implementación. Establecer
`AGENT_NATIVE_MCP_CONFIG_REFRESH_MS=0` para deshabilitar esa actualización en segundo plano, o
configúrelo en un valor de al menos `5000` milisegundos para ajustar el intervalo.

El modo central anterior que aparece a continuación sigue siendo útil para "compartir cada ámbito de organización MCP
servidor de Dispatch” y para implementaciones que ya utilizan el MCP
configura UI como fuente de la verdad.

### 1. Habilite hub-serve en la aplicación hub (despacho)

Establezca una var de entorno en la implementación de despacho:

```bash
AGENT_NATIVE_MCP_HUB_TOKEN=<a-long-random-secret>
```

Dispatch ahora monta `GET /_agent-native/mcp/hub/servers`, que devuelve cada servidor MCP del ámbito de la organización almacenado en su tabla `settings`, con encabezados URL + completos, autenticados por el token.

### 2. Aplicaciones que consumen puntos en el centro

Establecer en cada consumidor (correo, clips, lo que sea):

```bash
AGENT_NATIVE_MCP_HUB_URL=https://dispatch.acme.com
AGENT_NATIVE_MCP_HUB_TOKEN=<the-same-secret>
```

Al inicio, cada consumidor extrae la lista de servidores del concentrador y la combina en su propio administrador MCP. Las herramientas aparecen para el agente como `mcp__hub_<orgId>_<name>__*`, distintas del `mcp__org_…` local del consumidor, por lo que no hay colisiones.

### 3. Lo que se comparte

Solo se comparten servidores de **ámbito de organización**. Los servidores de ámbito de usuario (personales) permanecen con el usuario que los agregó; el centro nunca vuelve a exponer las credenciales personales en todas las aplicaciones.

Las respuestas del Hub incluyen los encabezados de autenticación completos (tokens de portador, etc.). El transporte es HTTPS, el punto final requiere el secreto compartido y solo devuelve filas del alcance de la organización; trate el token URL + del concentrador como una credencial de base de datos.

### 4. Recarga en caliente vs reinicio

El UI local agrega recarga en caliente en cada aplicación a través de `McpClientManager.reconfigure()`, sin reinicio. Los servidores de origen central son seleccionados por la misma actualización periódica en segundo plano (aproximadamente 60 s, ajustable o deshabilitable a través de `AGENT_NATIVE_MCP_CONFIG_REFRESH_MS`) que utiliza la ruta de recursos del espacio de trabajo, por lo que los cambios realizados en Dispatch se propagan a todas las aplicaciones de consumo en aproximadamente un minuto sin reiniciar. Además, cualquier mutación local en una aplicación de consumo activa inmediatamente una reconfiguración de esa aplicación.

### Resumen de puntos finales

| Método | Ruta                             | Propósito                                                                                                                                                                       |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/_agent-native/mcp/hub/servers` | Servir a todos los servidores del ámbito de la organización con credenciales completas (con acceso al portador, solo montado cuando se configura `AGENT_NATIVE_MCP_HUB_TOKEN`). |
| GET    | `/_agent-native/mcp/hub/status`  | Devuelve `{ serving, consuming, hubUrl }` para la tarjeta UI de configuración.                                                                                                  |

## Ruta de estado {#status-route}

Cada aplicación expone `GET /_agent-native/mcp/status` para herramientas e incorporación:

```an-api
{
  "method": "GET",
  "path": "/_agent-native/mcp/status",
  "summary": "Estado del cliente MCP para herramientas e incorporación",
  "description": "Reports which configured servers connected, the total live tool count, the merged prefixed tool list, and any per-server connection errors. Use it to build \"detected — your agent can now drive X\" hints or to debug connection problems.",
  "responses": [
    {
      "status": "200",
      "description": "Configured vs connected servers, tool inventory, and per-server errors.",
      "example": "{\n  \"configuredServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"connectedServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"totalTools\": 21,\n  \"tools\": [\n    {\n      \"source\": \"claude-in-chrome\",\n      \"name\": \"mcp__claude-in-chrome__navigate\",\n      \"description\": \"Navigate the browser to a URL\"\n    }\n  ],\n  \"errors\": {}\n}"
    }
  ]
}
```

```json
{
  "configuredServers": ["claude-in-chrome", "playwright"],
  "connectedServers": ["claude-in-chrome", "playwright"],
  "totalTools": 21,
  "tools": [
    {
      "source": "claude-in-chrome",
      "name": "mcp__claude-in-chrome__navigate",
      "description": "Navigate the browser to a URL"
    }
  ],
  "errors": {}
}
```

Utilice esto para crear sugerencias de incorporación de "Claude-in-chrome detectado: su agente ahora puede manejar Chrome" o depurar problemas de conexión de MCP.

## Modos de fallo {#failures}

Las fallas individuales del servidor MCP nunca desactivan el agente:

- Un `command` mal configurado → se omite el servidor, su error aparece en `/mcp/status` debajo de `errors.<server-id>` y todos los demás servidores continúan funcionando.
- Falta el MCP SDK en `node_modules` → todas las funciones de MCP se omiten con una advertencia; El chat del agente sigue funcionando sin herramientas MCP.
- Ejecutar en un tiempo de ejecución perimetral → El cliente MCP no funciona.

El agente nativo siempre arrancará; La configuración rota de MCP solo significa menos herramientas.

## Seguridad {#security}

Las herramientas MCP se ejecutan en su máquina con cualquier permiso que tenga el proceso generado. Trate a `mcp.config.json` como cualquier otra lista de ejecutables que esté dispuesto a dejar que el agente maneje. Las herramientas de los servidores MCP aparecen en el bucle de uso de herramientas del agente al igual que el actions de su plantilla, así que asegúrese de confiar en cada servidor que configure.
