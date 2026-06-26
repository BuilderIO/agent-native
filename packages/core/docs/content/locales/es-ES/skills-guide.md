---
title: "Guía Skills"
description: "Cómo funciona skills en el agente nativo: marco skills, dominio skills y creación de skills personalizado."
---

# Guía Skills

Skills son archivos Markdown que brindan al agente un conocimiento profundo sobre patrones y flujos de trabajo específicos.

## ¿Qué son skills? {#what-are-skills}

Skills vive en `.agents/skills/<name>/SKILL.md` y contiene orientación detallada para el agente. Cada habilidad se centra en una preocupación: cómo almacenar datos, cómo sincronizar el estado y cómo delegar el trabajo en el chat del agente.

El frontmatter de cada habilidad, `name` y `description`, siempre se inyecta en el bloque skills del indicador del sistema para que el agente sepa qué skills existe. El conjunto completo de habilidades se carga según demanda cuando el agente decide que una habilidad es relevante para la tarea (también aparece a través de `docs-search`). Esta es la razón por la que es importante mantener descripciones breves y específicas para cada activador: la descripción es lo único que lee el agente antes de decidir si carga el resto.

```an-diagram title="Divulgación progresiva" summary="Sólo el nombre + descripción de cada habilidad está siempre en contexto. El cuerpo completo se carga según demanda cuando la tarea coincide."
{
  "html": "<div class=\"sk-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Siempre en el prompt del sistema</span><div class=\"sk-list\"><span class=\"diagram-pill\">storing-data &mdash; <small class=\"diagram-muted\">add data models&hellip;</small></span><span class=\"diagram-pill\">real-time-sync &mdash; <small class=\"diagram-muted\">wire polling&hellip;</small></span><span class=\"diagram-pill\">create-skill &mdash; <small class=\"diagram-muted\">add a skill&hellip;</small></span></div><small class=\"diagram-muted\">just name + description (cheap)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><small class=\"diagram-muted\">task matches a description</small><span class=\"diagram-pill accent\">load on demand</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Full <code>SKILL.md</code> body<br><small class=\"diagram-muted\">reglas, código, qué hacer y qué evitar</small></div></div>",
  "css": ".sk-flow{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.sk-flow .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;min-width:240px}.sk-flow .sk-list{display:flex;flex-direction:column;gap:6px}.sk-flow .center{display:flex;flex-direction:column;align-items:center;gap:6px}.sk-flow .diagram-arrow{font-size:22px}"
}
```

## Marco skills {#framework-skills}

Estos son los skills incluidos con la **plantilla predeterminada**. El conjunto exacto disponible en cualquier aplicación determinada depende de la plantilla desde la que realizó el scaffolding; consulte el directorio `.agents/skills/` de esa plantilla para conocer lo que realmente se envía.

| Habilidad              | Cuándo utilizar                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `storing-data`         | Agregar modelos de datos, leer/escribir configuración o estado                           |
| `real-time-sync`       | Sincronización de sondeo de cableado, depuración UI no se actualiza                      |
| `delegate-to-agent`    | Delegar el trabajo de IA de UI o actions al agente                                       |
| `actions`              | Creando o ejecutando el agente actions                                                   |
| `self-modifying-code`  | Edición del código fuente, los componentes o los estilos de la aplicación                |
| `create-skill`         | Añadiendo nuevo skills para el agente                                                    |
| `capture-learnings`    | Grabación de correcciones y patrones                                                     |
| `frontend-design`      | Crear o diseñar cualquier UI web, componentes o páginas                                  |
| `adding-a-feature`     | La lista de verificación de cuatro áreas: UI, actions, skills, estado de la aplicación   |
| `internationalization` | Actualización de copia localizada de UI, catálogos de idiomas y estilos seguros para RTL |
| `shadcn-ui`            | Usando primitivas y componentes shadcn/ui                                                |
| `security`             | Autenticación, control de acceso y manejo de secretos                                    |
| `real-time-collab`     | Edición colaborativa multiusuario                                                        |
| `agent-engines`        | Intercambiar o configurar el motor del agente subyacente                                 |
| `notifications`        | Patrones de notificaciones push y en la aplicación                                       |
| `progress`             | Seguimiento y visualización del progreso de la tarea en segundo plano                    |
| `inline-embeds`        | Incrustar aplicaciones o iframes dentro del chat del agente                              |

`context-awareness` y `a2a-protocol` son skills a nivel de marco de trabajo disponibles en el directorio `.agents/skills/` en la raíz del repositorio; consulte el `.agents/skills/` de cada plantilla para conocer lo que hereda.

## Dominio skills {#domain-skills}

Las plantillas incluyen skills específico para su dominio. Estos se encuentran en el mismo directorio `.agents/skills/` pero cubren patrones específicos de plantilla. Consulte el directorio `.agents/skills/` de cada plantilla para obtener la lista completa; una muestra representativa:

- **Plantilla de correo** — `email-drafts`, `draft-queue`
- **Plantilla de formularios**: `form-building`, `form-publishing`, `form-responses`
- **Plantilla de análisis**: `adhoc-analysis`, `bigquery`, `cross-source-analysis`, `dashboard-management`, `data-querying`, `provider-api`, `gong`, `hubspot`, `prometheus`
- **Plantilla de diapositivas**: `create-deck`, `deck-management`, `design-systems`, `slide-editing`, `slide-images`

El dominio skills sigue el mismo formato que el marco skills. Codifican patrones específicos de la plantilla que el agente debe seguir.

## skills respaldado por aplicación {#app-backed-skills}

skills, respaldado por una aplicación, empaqueta una aplicación nativa del agente como un artefacto del mercado de habilidades. El paquete puede incluir instrucciones del agente, skills exportado, metadatos del conector MCP, instrucciones de inicio alojadas/locales y superficies UI como aplicaciones MCP.

> **Detalles completos a continuación:** la mecánica de skills respaldado por aplicaciones (formato de manifiesto, comandos CLI, adaptadores de mercado, hash de actualización automática) se tratan en [App-backed skills — full details](#app-backed-skills-full).

## Creando skills personalizado {#creating-skills}

Crea una habilidad cuando:

- Hay un patrón que el agente debe seguir repetidamente
- Un flujo de trabajo necesita orientación paso a paso
- Quieres aplicar scaffolding a los archivos desde una plantilla

No crees una habilidad cuando:

- La guía ya existe en otra habilidad; en su lugar, amplíela
- La guía es única: colóquela en `AGENTS.md` o en la memoria del espacio de trabajo

## Formato de habilidad {#skill-format}

Cada habilidad es un archivo Markdown con frontmatter YAML:

```an-annotated-code title="Anatomía de un SKILL.md"
{
  "filename": ".agents/skills/project-imports/SKILL.md",
  "language": "markdown",
  "code": "---\nname: project-imports\ndescription: >-\n  How to import projects from the legacy CSV export. Use when the user uploads\n  a project CSV or asks to migrate projects from the old system.\n---\n\n# Project Imports\n\n## Rule\n\nAlways validate the CSV header row before writing any rows. Reject unknown\ncolumns rather than silently dropping them.\n\n## How\n\n1. Call `get-import-schema` to fetch the expected columns.\n2. Parse the first CSV row and diff against the schema.\n3. If any required columns are missing, return an error — do not proceed.\n4. Stream remaining rows through `create-project-item` in batches of 50.\n\n## Don't\n\n- Don't hold all rows in memory — stream them.\n- Don't create duplicate projects; check for an existing name first.\n\n## Related Skills\n\n- **storing-data** — SQL schema and write patterns for new rows\n- **sharing** — exposing a project to other users after import",
  "annotations": [
    { "lines": "2", "label": "clave de descubrimiento", "note": "The `name` matches the folder; it is how the skill is invoked as `/project-imports`." },
    { "lines": "3-5", "label": "El gatillo", "note": "Este `description` es el **único** texto siempre en contexto. Haz que indique con precisión *cuándo* se aplica la habilidad." },
    { "lines": "9-14", "label": "Reglas primero", "note": "Empiece con la regla estricta y el porqué; el agente lee el cuerpo solo cuando la tarea coincide." },
    { "lines": "27-30", "label": "Enlace cruzado", "note": "Señale las habilidades relacionadas para que el agente pueda encadenarlas en lugar de volver a recibir orientación." }
  ]
}
```

El sistema de herramientas del agente utiliza los frontmatter `name` y `description` para descubrir habilidades. La descripción debe indicar cuándo se activa la habilidad; sea específico acerca de las situaciones.

Guarde el archivo en `.agents/skills/my-skill/SKILL.md`. El nombre del directorio debe coincidir con `name` en frontmatter.

> **Ver también:** [Writing Agent Instructions](/docs/writing-agent-instructions) para saber cómo redactar descripciones de habilidades, aplicar la divulgación progresiva y mantener `AGENTS.md` eficiente. Ambas páginas utilizan la habilidad `project-imports` como ejemplo de ejecución.

## Alcance de la habilidad: tiempo de ejecución frente a desarrollo {#skill-scope}

Un campo frontal opcional `scope` controla para qué agente es una habilidad:

| `scope`   | ¿Cargado por el agente de tiempo de ejecución? | Usar para                                                                                             |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `both`    | Sí (predeterminado)                            | Skills útil para el agente en la aplicación. Este es el valor predeterminado cuando se omite `scope`. |
| `runtime` | Sí                                             | Skills está destinado únicamente al agente de tiempo de ejecución en la aplicación.                   |
| `dev`     | No                                             | Skills está destinado únicamente al agente codificador del ser humano (por ejemplo, código Claude).   |

```markdown
---
name: release-checklist
description: >-
  Steps for cutting a release. Use when preparing or publishing a new version.
scope: dev
---
```

Cuando `scope` está ausente (o se establece en un valor no reconocido), el valor predeterminado es `both`, por lo que todas las habilidades existentes se siguen cargando en tiempo de ejecución; este campo es totalmente compatible con versiones anteriores. Una habilidad `scope: dev` es invisible para el agente en tiempo de ejecución en todas partes: está excluida del bloque skills inyectado en el indicador del sistema y de los resultados de `docs-search`.

### Exponer una habilidad exclusiva para desarrolladores a su agente de codificación {#dev-only-skills}

El tiempo de ejecución nativo del agente lee skills de `.agents/skills/`. El código Claude lee skills de `.claude/skills/` de forma independiente. Para que una habilidad esté disponible para su agente de codificación pero oculta para el agente en tiempo de ejecución:

- Márquelo como `scope: dev` en `.agents/skills/<name>/SKILL.md` para que el agente de ejecución nunca lo cargue, y/o
- Coloque o refleje la habilidad debajo de `.claude/skills/<name>/SKILL.md` para que el código Claude la recoja.

Esto reemplaza el antiguo truco de confiar en el código Claude que solo lee `.claude/skills`: `scope: dev` hace que la división entre desarrollo y tiempo de ejecución sea una opción explícita de primera clase.

```an-diagram title="¿Qué agente carga qué habilidad?" summary="El alcance decide si el agente de tiempo de ejecución en la aplicación ve una habilidad. Las habilidades de desarrollo son visibles solo para su agente de codificación."
{
"html": "<div class=\"sc-grid\"><div class=\"diagram-card\"><span class=\"diagram-pill\">.agents/skills/</span><div class=\"sc-row\"><span class=\"diagram-pill ok\">scope: both</span><small class=\"diagram-muted\">default</small></div><div class=\"sc-row\"><span class=\"diagram-pill ok\">scope: runtime</span></div><div class=\"sc-row\"><span class=\"diagram-pill warn\">scope: dev</span></div></div><div class=\"sc-targets\"><div class=\"diagram-box\">Runtime agent<br><small class=\"diagram-muted\">reads <code>both</code> + <code>runtime</code></small></div><div class=\"diagram-box\">Agente de código<br><small class=\"diagram-muted\">Claude Code reads <code>.claude/skills/</code> + <code>dev</code></small></div></div></div>",
"css": ".sc-grid{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}.sc-grid .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.sc-grid .sc-row{display:flex;align-items:center;gap:8px}.sc-grid .sc-targets{display:flex;flex-direction:column;gap:10px}"
}

```

> **Consulte también:** [Writing Agent Instructions](/docs/writing-agent-instructions) para saber cómo redactar descripciones de habilidades, aplicar la divulgación progresiva y mantener `AGENTS.md` optimizado.

## Skills frente a AGENTS.md {#skills-vs-agents-md}

> **AGENTS.md**: descripción general. Enumera todos los scripts, describe el modelo de datos y explica la arquitectura de la aplicación. El agente lee esto primero para entender la aplicación.
>
> **Skills**: inmersiones profundas. Cada habilidad se centra en un patrón con reglas detalladas, ejemplos de código y listas de lo que se debe/no se debe hacer. El agente los lee cuando necesita seguir un patrón específico.

`AGENTS.md` le dice al agente _qué_ hace la aplicación. Skills le dice al agente _cómo_ hacer cosas específicas correctamente. Ambos son necesarios: `AGENTS.md` para orientación, skills para ejecución.

## Skills frente a memoria {#skills-vs-memory}

> **Skills**: guías prácticas reutilizables y escritas. Se aplica a todos los usuarios y se invoca a pedido cuando la tarea coincide.
>
> **Memoria (`LEARNINGS.md` / `memory/MEMORY.md`)**: aprendizajes compartidos del proyecto y memoria estructurada personal cargada en cada turno.

Si el conocimiento se aplica a _todos_ los que trabajan en la aplicación ("siempre prefiera CTE a las subconsultas"), es una habilidad o `LEARNINGS.md` compartida. Si se trata de _este usuario en particular_ ("A Steve le gustan las respuestas concisas"), pertenece a `memory/MEMORY.md`. Consulte [Workspace Memory](/docs/workspace#memory) para conocer el tratamiento completo.

---

# Avanzado

## skills respaldado por la aplicación: detalles completos {#app-backed-skills-full}

El paquete skills respaldado por una aplicación es una aplicación nativa del agente como un artefacto del mercado de habilidades.
El paquete puede incluir instrucciones del agente, conector skills y MCP exportado
metadatos, instrucciones de inicio alojadas/locales y superficies UI como aplicaciones MCP.

Cada habilidad respaldada por la aplicación comienza con `agent-native.app-skill.json` en la raíz de la aplicación:

```json
{
  "schemaVersion": 1,
  "id": "assets",
  "hosted": {
    "url": "https://assets.agent-native.com",
    "mcpUrl": "https://assets.agent-native.com/_agent-native/mcp"
  },
  "mcp": { "serverName": "agent-native-assets" },
  "skills": [
    {
      "path": ".agents/skills/asset-generation",
      "visibility": "both",
      "exportAs": "assets"
    }
  ]
}
```

La visibilidad de las habilidades controla lo que se envía:

| Visibilidad | Significado                                                               |
| ----------- | ------------------------------------------------------------------------- |
| `internal`  | Utilizado por el propio agente de la aplicación, no exportado a mercados. |
| `exported`  | Exportado a mercados, pero la aplicación no lo necesita internamente.     |
| `both`      | Usado internamente y exportado.                                           |

Alojado es la ruta de instalación predeterminada. El lanzamiento local es explícito para la personalización,
trabajo sin conexión o uso sensible a la privacidad.

```bash
# Camino feliz: instrucciones exportadas más conector MCP alojado.
npx @agent-native/core@latest skills add visual-plan
npx @agent-native/core@latest skills add assets

# Edición de docs/blog/MDX con Content primero en el repositorio.
npx @agent-native/core@latest skills add content --mode local-files --scope project

# Vercel/open Habilidades CLI: solo instrucciones exportadas, sin configuración MCP.
npx skills@latest add BuilderIO/agent-native --skill assets

# Registre un conector MCP alojado para clientes de agentes locales.
npx @agent-native/core@latest app-skill ensure --manifest templates/assets/agent-native.app-skill.json

# Materializar y ejecutar fuente local editable.
npx @agent-native/core@latest app-skill launch --manifest templates/assets/agent-native.app-skill.json --local --into ./assets-local

# Cree adaptadores de mercado: complemento Codex, habilidades Claude marketplace, Vercel,
# Habilidades plain/Claude y configuraciones MCP.
npx @agent-native/core@latest app-skill pack --manifest templates/assets/agent-native.app-skill.json --out ./dist/assets-skill

# Instale un paquete exportado local con Vercel/open Skills CLI.
npx skills@latest add ./dist/assets-skill --skill assets -a codex -y

# Agregue el mercado Claude Code generado y luego instale su complemento Assets.
claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace
claude plugin install agent-native-assets@agent-native-apps
```

Mantén los secretos fuera de los archivos de habilidades. El manifiesto debe contener el conector exclusivo URL
metadatos; La configuración de OAuth/dispositivo se realiza en el host MCP o mediante el modo normal de la aplicación
flujo de configuración.

El adaptador `skills` de Vercel Labs es un paquete `skills/<name>/SKILL.md` portátil
para `npx skills@latest add ...`, pero el `skills` CLI sin formato solo instala instrucciones.
No ejecuta scripts de postinstalación definidos por repositorio ni registra conectores MCP.
Mantenga Agent Native CLI como ruta de documentos predeterminada para los agentes locales porque
también registra el conector MCP. `BuilderIO/agent-native` es un auténtico GitHub
fuente del repositorio para Vercel/open Skills CLI; `skills.sh` es un descubrimiento y
directorio de clasificación, no un espacio de nombres de paquete estilo npm.

El adaptador del mercado de códigos Claude escribe
`adapters/claude-marketplace/.claude-plugin/marketplace.json` más un anidado
directorio de complementos que contiene `skills/<name>/SKILL.md` y `.mcp.json`. En Claude
Codifique, agregue el mercado, instale `agent-native-assets@agent-native-apps`,
Vuelva a cargar los complementos y luego autentique el conector MCP exclusivo de URL desde `/mcp`.

Los manifiestos de complementos generados están configurados para actualizarse automáticamente: el código Claude
conjuntos de entradas del mercado `autoUpdate: true` (con control de versiones commit-SHA) y
El complemento Codex `version` incorpora un hash de contenido de los paquetes skills y MCP
punto final, por lo que los complementos instalados recogen los cambios de habilidades sin volver a empaquetarlos. El
La aplicación Plan se publica de esta manera como un mercado listo para agregar en la raíz del repositorio:
consulte [Plan plugin & marketplace](/docs/plan-plugin) para la instalación de un extremo a otro
y flujo de actualización automática.

Para usuarios que instalan skills copiado a través del CLI universal en lugar de
Mercado de complementos, use los comandos de actualización CLI:

```bash
npx @agent-native/core@latest skills status visual-plan
npx @agent-native/core@latest skills update visual-plan
```

`skills update` escanea proyectos conocidos de Codex/Claude y carpetas de habilidades de usuario, compara
la carpeta copiada se aplica a la habilidad incluida más reciente y reescribe las carpetas obsoletas en
lugar. Agent Native skills recién copiado incluye un `agent-native-skill.json`
marcador para que la salida de estado futura pueda identificar la fuente y el hash.

Las aplicaciones y espacios de trabajo Agent Native generados también incluyen el marco proporcionado
skills en `.agents/skills` (o `packages/shared/.agents/skills` en un
espacio de trabajo). Actualice esos skills andamiados desde el CLI actual/más reciente con:

```bash
npm run skills:update
# o, sin depender del script del paquete local:
npx @agent-native/core@latest skills update scaffold --project
```

`AGENTS.md` y `.agents/skills` siguen siendo canónicos. El comando de actualización también repara
Enlaces de compatibilidad Claude (`CLAUDE.md` y `.claude/skills`) para que vea el código Claude
las mismas instrucciones sin mantener una segunda copia.
