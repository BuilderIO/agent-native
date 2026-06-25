---
title: "Análisis"
description: "Haga preguntas sobre análisis en inglés sencillo y obtenga gráficos y paneles. Un reemplazo de código abierto para Amplitude, Mixpanel y Looker."
---

# Análisis

Haga preguntas sobre análisis en inglés sencillo y obtenga gráficos y paneles. El agente se conecta a BigQuery, GA4, Amplitude, el recopilador de eventos propio integrado, HubSpot, Jira y una docena de fuentes más, escribe la consulta por usted, la valida y representa la respuesta como un gráfico, una tabla o un panel de control guardado.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:500px;box-sizing:border-box'><h1 style='margin:0'>Plantillas Agent-Native</h1><p class='wf-muted' style='margin:0'>Adopción e interacción durante las últimas 12 semanas.</p><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card'><small class='wf-muted'>Usuarios activos semanales</small><br/><strong>24,318</strong><br/><span class='wf-pill accent'>+12.4%</span></div><div class='wf-card'><small class='wf-muted'>Nuevos registros</small><br/><strong>1,842</strong><br/><span class='wf-pill accent'>+8.7%</span></div><div class='wf-card'><small class='wf-muted'>Ingresos MRR</small><br/><strong>$48,210</strong><br/><span class='wf-pill accent'>+21.3%</span></div></div><div style='display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1'><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Usuarios activos semanales</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:38%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:44%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:58%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:74%;flex:1;background:var(--wf-accent-soft)'></div></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Ingresos en el tiempo</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:32%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:48%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:63%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:80%;flex:1;background:var(--wf-accent-soft)'></div></div></div></div><div class='wf-card'><strong>Registros por fuente</strong><br/><small class='wf-muted'>El gráfico inferior empieza debajo de los gráficos principales.</small></div></div>"
}
```

Es un reemplazo de código abierto para Amplitude, Mixpanel y Looker, para equipos que desean poseer el código, las consultas y los datos.

```an-diagram title="Pregunta para graficar" summary="El agente consulta el diccionario de datos, escribe SQL, lo valida con el almacén y luego genera un gráfico o guarda un panel."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">Lenguaje claro<br>question</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">reads data dictionary</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Escribe SQL</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">Validar en modo dry-run</div><small class=\"diagram-muted\">BigQuery / fuente</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Gráfico, tabla o<br>saved panel</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Qué puedes hacer con él

- **Haga preguntas sobre datos en un lenguaje sencillo.** "¿Qué porcentaje de registros del mes pasado se convirtieron en pagos?" o "Muéstrame usuarios activos semanales durante los últimos 6 meses". El agente elige la fuente correcta, escribe SQL y genera el gráfico.
- **Cree paneles SQL reutilizables** con filtros, vistas guardadas y consultas paramétricas.
- **Ejecute análisis ad hoc** que crucen varias fuentes de datos y se guarden como investigaciones que se pueden volver a ejecutar con la pregunta, las instrucciones y los hallazgos originales.
- **Mantenga un diccionario de datos vivo** de métricas, tablas y recetas SQL para que el agente utilice los nombres de columna correctos cada vez (ya no tendrá que adivinar `is_closed` cuando en realidad es `hs_is_closed`).
- **Comparte paneles** con tu equipo: privados de forma predeterminada, compartibles por usuario o por organización con funciones de espectador/editor/administrador.
- **Conéctese a muchas fuentes** listas para usar: BigQuery, GA4, Mixpanel, Amplitude, PostHog, HubSpot, Jira, Apollo, Pylon, Gong, Common Room, Twitter, además de fuentes SEO específicas de la aplicación.
- **Reutilizar integraciones de espacios de trabajo** cuando un espacio de trabajo ya se ha conectado y
  otorgó un proveedor a Analytics. El proveedor de tiendas de integración compartida
  referencias de identidad y credenciales; Analytics mantiene la selección de fuentes específicas de la aplicación
  entradas del diccionario de datos, panel SQL e historial de análisis.

## Empezando

Demostración en vivo: [analytics.agent-native.com](https://analytics.agent-native.com).

Cuando abres la aplicación por primera vez:

1. Inicia sesión con Google.
2. Abra la página **Fuentes de datos** desde la barra lateral.
3. Cada fuente tiene un tutorial: conecta las que necesitas (comienza con una, como BigQuery, GA4, Amplitude o seguimiento propio).
4. Abra un nuevo chat con el agente y haga una pregunta: "¿Cuántas suscripciones obtuvimos la semana pasada?"

La primera pregunta es suficiente para confirmar que la conexión funciona. A partir de ahí, pídale al agente que "guarde esto como un panel" o "cree un panel de descripción general de 4 paneles para nuestras métricas clave".

### Indicaciones útiles

- "Cree un panel que muestre los usuarios activos semanales durante los últimos 6 meses."
- "¿Qué porcentaje de registros del mes pasado se convirtieron en pagos?"
- "Agregue un gráfico que compare los ingresos por plan a este panel."
- "Reordene los paneles de este panel para que la métrica MRR sea lo primero".
- "Analice nuestros acuerdos cerrados y perdidos del primer trimestre y guarde el análisis."
- "Vuelva a ejecutar el análisis de abandono con los datos de este mes."
- "Documente esta métrica en el diccionario de datos."

El agente siempre sabe lo que estás viendo (panel de control actual, filtros, vista), por lo que puedes decir "este panel" o "ese panel" sin ser explícito.

## Tres cosas que debes saber

La aplicación tiene tres superficies principales en las que pasarás el tiempo:

- **SQL Paneles**: paneles reutilizables con filtros y vistas guardadas. Lo mejor para métricas que verificas periódicamente.
- **Análisis ad hoc**: investigaciones extensas que se obtienen de múltiples fuentes, con instrucciones para volver a ejecutarlas guardadas al lado. Ideal para preguntas puntuales que tal vez quieras volver a abordar.
- **Diccionario de datos**: el catálogo canónico de métricas, tablas, columnas y recetas SQL. El agente lo consulta antes de escribir cualquier SQL, por lo que utiliza nombres de columnas de almacén reales y conoce advertencias como "excluye correos electrónicos internos".

El diccionario se genera preguntando al agente: "importa nuestras definiciones dbt" o "extrae las métricas de nuestro manual Notion" y hace el trabajo.

## Para desarrolladores

El resto de este documento es para cualquiera que bifurque la plantilla de Analytics o la amplíe.

### Inicio rápido

Cree una nueva aplicación de Analytics desde CLI:

```bash
npx @agent-native/core@latest create my-analytics --standalone --template analytics
```

Desarrollador local:

```bash
cd my-analytics
pnpm install
pnpm dev
```

El CLI imprime el desarrollador local URL. Inicia sesión con Google y luego abre la página **Fuentes de datos** para conectar BigQuery, GA4, seguimiento propio, HubSpot, Jira y el resto.

### Características clave

**Haga preguntas, obtenga gráficos.** El agente elige una fuente de datos, escribe y valida SQL y luego genera un gráfico, una tabla, una métrica o un panel guardado.

**Paneles e investigaciones.** Los paneles reutilizables mantienen los paneles SQL, los filtros, las vistas guardadas y el uso compartido; Los análisis ad hoc guardan hallazgos más largos con instrucciones de repetición.

**Diccionario de datos vivientes.** Las definiciones de métricas, los propietarios, las tablas de origen y las advertencias conocidas brindan al agente el vocabulario real del almacén antes de escribir consultas.

**Amplia superficie de conector.** BigQuery, GA4, análisis de productos, CRM, soporte, comunidad, GitHub/Jira, SEO y eventos propios `/track` llegan a través de actions al que el agente puede llamar.

### Trabajar con el agente

El agente siempre sabe lo que estás mirando. El estado actual de la pantalla se inyecta en cada mensaje como un bloque `<current-screen>`: contiene la vista activa, el panel o análisis abierto y los filtros seleccionados.

El mensaje del sistema del agente recibe un bloque `<data-dictionary>` inyectado con las entradas de métricas aprobadas para la organización activa. Cuando solicita un panel, el agente consulta primero el diccionario y utiliza el documento `table` / `columns` / `queryTemplate` palabra por palabra; no adivina los nombres de las columnas.

**Contexto que tiene automáticamente:**

- **Vista actual**: `overview`, `adhoc` (con `dashboardId`), `analyses` (con `analysisId`), `data-dictionary`, `data-sources` o `settings`.
- **Organización activa**: abarca todas las consultas y escrituras.
- **Entradas de diccionario aprobadas**: para el espacio de trabajo activo.

**Ediciones del panel.** El agente utiliza la acción `update-dashboard` para editar paneles. Admite dos modos:

- `ops` — Parches de puntero JSON para ediciones quirúrgicas (mover un panel, reemplazar una cadena SQL, eliminar un filtro).
- `config`: reemplazo completo de la configuración del tablero.

El SQL de cada panel de BigQuery se realiza un ensayo en el almacén antes de que se guarde el panel. Si una columna es incorrecta, el guardado se rechaza con el error de BigQuery: el agente corrige el SQL y vuelve a intentarlo en lugar de conservar los paneles rotos.

### Conectar fuentes de datos

Abra la página **Fuentes de datos** (`/data-sources`) para conectar proveedores. Cada
la fuente expone una lista de claves de entorno, un tutorial y un botón **Probar conexión**.
Cuando Analytics se ejecuta en un espacio de trabajo, `data-source-status` también informa
Otorgó conexiones de espacio de trabajo reutilizables para `appId=analytics` para que el agente pueda
solicite una concesión de aplicación en lugar de otra copia de la misma clave de proveedor.
Para proveedores reutilizables como Slack, HubSpot, Notion y GitHub, los datos
Las fuentes UI muestran el estado de la integración compartida directamente: listo a través del espacio de trabajo,
necesita concesión, necesita credenciales o credenciales locales.

Las integraciones de espacios de trabajo reutilizables son la dirección del tiempo de ejecución para los proveedores compartidos:
el marco almacena la identidad del proveedor, los metadatos de la cuenta, las referencias de credenciales y
concesiones por aplicación una vez; Analytics almacena la interpretación de la fuente de datos, fuente de
opciones de verdad, definiciones de métricas, paneles y análisis.

Las credenciales se almacenan a través de la capa de configuración/entorno del marco; no hay secretos en git. La producción requiere:

| Variable                                 | Propósito                                                             |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`                           | Conexión persistente SQL URL                                          |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Autenticación                                                         |
| `GOOGLE_SIGN_IN_CLIENT_ID` / `_SECRET`   | Cliente de inicio de sesión de Google preferido (OAuth 2.0)           |
| `GOOGLE_CLIENT_ID` / `_SECRET`           | Reserva de inicio de sesión antiguo/cliente de integración Google API |
| `BIGQUERY_PROJECT_ID`                    | Proyecto BigQuery                                                     |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`    | Cuenta de servicio de BigQuery JSON                                   |
| `ANTHROPIC_API_KEY`                      | Chat del agente                                                       |

Las claves específicas del proveedor (HubSpot, Jira, Gong, Pylon, etc.) están documentadas en el tutorial de cada fuente en la página Fuentes de datos. Si agrega una nueva acción que necesita una clave API, aparece como una nueva fuente en esa página a través del registro de incorporación de la plantilla.

Nota: la credencial OAuth de BigQuery para el inicio de sesión de Google es **independiente**
credencial de la cuenta de servicio de BigQuery JSON. Cree el cliente de inicio de sesión en
Consola GCP → API y servicios → Credenciales → ID de cliente OAuth y prefiere el
Nombres de entorno `GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` para que esto
El cliente de inicio de sesión de bajo alcance permanece separado de los clientes de integración API de Google.

### Modelo de datos

Tablas principales (ver `templates/analytics/server/db/schema.ts`):

```an-schema title="Modelo de datos Analytics" summary="Dashboards y análisis son los recursos; vistas, compartidos y una caché de consultas cuelgan de ellos. Las tablas de organización provienen de @agent-native/core/org."
{
  "entities": [
    {
      "id": "dashboards",
      "name": "dashboards",
      "note": "Paneles Explorer y SQL",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "kind", "type": "text", "note": "\"explorer\" or \"sql\"" },
        { "name": "config", "type": "text", "note": "JSON que coincide con SqlDashboardConfig" }
      ]
    },
    {
      "id": "dashboard_views",
      "name": "dashboard_views",
      "note": "Ajustes preestablecidos de filtro guardados por panel",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "dashboard_id", "type": "text", "fk": "dashboards.id" }
      ]
    },
    {
      "id": "analyses",
      "name": "analyses",
      "note": "Investigaciones ad hoc que se pueden volver a ejecutar",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "question", "type": "text" },
        { "name": "instructions", "type": "text", "note": "Volver a ejecutar los pasos" },
        { "name": "dataSources", "type": "text", "note": "Fuentes tocadas" },
        { "name": "resultMarkdown", "type": "text" },
        { "name": "resultData", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "bigquery_cache",
      "name": "bigquery_cache",
      "note": "Caché de resultados codificado por hash SQL",
      "fields": [
        { "name": "sql_hash", "type": "text", "pk": true },
        { "name": "bytes_processed", "type": "integer" }
      ]
    }
  ],
  "relations": [
    { "from": "dashboards", "to": "dashboard_views", "kind": "1-n", "label": "saved views" }
  ]
}
```

Además de las tablas compartidas por recurso (`dashboard_shares`, `analysis_shares`) y las tablas de organización (`organizations`, `org_members`, `org_invitations`) proporcionadas por `@agent-native/core/org`. El diccionario de datos se encuentra en la tabla `settings` del marco bajo claves de ámbito.

- **`dashboards`**: paneles de Explorer y SQL. `kind` es `"explorer"` o `"sql"`; `config` es un blob JSON que coincide con `SqlDashboardConfig`.
- **`dashboard_shares`**: subvenciones compartidas por recurso (principal, función).
- **`dashboard_views`**: ajustes preestablecidos de filtro guardados por panel.
- **`analyses`**: investigaciones ad hoc con `question`, `instructions`, `dataSources`, `resultMarkdown` y `resultData` opcional.
- **`analysis_shares`**: subvenciones compartidas por recurso para análisis.
- **`bigquery_cache`**: caché de resultados de consultas codificados por hash SQL con contabilidad procesada en bytes.

Además de las tablas de organización (`organizations`, `org_members`, `org_invitations`) proporcionadas por `@agent-native/core/org`.

El diccionario de datos se encuentra en la tabla `settings` del marco bajo claves de alcance; consulte `list-data-dictionary` y `save-data-dictionary-entry` actions para ver la forma completa.

### Personalizarlo

La plantilla de Analytics está destinada a bifurcarse y ampliarse. Todo vive en `templates/analytics/`:

- **`AGENTS.md`**: la guía de nivel superior del agente. Vistas de documentos, actions y flujos de trabajo.
- **`actions/`**: cada operación invocable por el agente. Agregue un nuevo archivo para agregar una nueva acción. Los más notables:
  - `update-dashboard.ts`: ediciones del panel (operaciones + reemplazo completo)
  - `save-analysis.ts` / `list-analyses.ts`: análisis ad hoc
  - `save-data-dictionary-entry.ts` / `list-data-dictionary.ts` — diccionario
  - `bigquery.ts`: ejecución sin formato de BigQuery
  - `view-screen.ts` / `navigate.ts`: conciencia del contexto
- **`app/routes/`**: rutas basadas en archivos. Cada ruta es una fina envoltura alrededor de una página en `app/pages/`.
- **`app/pages/adhoc/sql-dashboard/`**: renderizador del panel SQL, editor de paneles, barra de filtros y vistas guardadas.
- **`app/pages/analyses/`**: lista de análisis y vista detallada.
- **`app/pages/DataSources.tsx`**: la fuente de datos que incorpora UI.
- **`app/pages/DataDictionary.tsx`**: el navegador y editor de diccionarios.
- **`.agents/skills/`**: guías de patrones que el agente lee según demanda:
  - `dashboard-management`: almacenamiento, resolución de alcance, forma de configuración del panel
  - `data-querying`: qué script utilizar, patrones de filtrado
  - `adhoc-analysis`: flujo de trabajo para investigaciones de fuentes cruzadas
  - `data-querying`, `real-time-sync`, `frontend-design`, `storing-data`, `self-modifying-code`
- **`.builder/skills/<provider>/SKILL.md`**: errores específicos del proveedor (BigQuery, HubSpot, Jira, GA4, etc.). Leer antes de consultar; actualiza cuando aprendas algo nuevo.
- **`server/db/schema.ts`**: esquema Drizzle para paneles, recursos compartidos, vistas, análisis y caché de BigQuery.
- **`server/lib/dashboards-store.ts`**: lectura/escritura del panel con resolución de alcance y migración de KV heredado.
- **`server/lib/bigquery.ts`**: cliente de BigQuery, validador de prueba y lógica de caché.

Para agregar una nueva fuente de datos, coloque un script en `actions/` que llame al proveedor y devuelva resultados a través del asistente `output()`. Está disponible para el agente inmediatamente y se puede utilizar dentro de los paneles del panel (si expone el resultado a través de un controlador de servidor).

Para agregar un nuevo tipo de gráfico, extienda la unión `ChartType` en `app/pages/adhoc/sql-dashboard/types.ts`, manéjela en `SqlChartCard.tsx` y el agente podrá usarla en cualquier panel.

Para conocer un patrón más amplio sobre cómo ampliar plantillas, consulte [Skills guide](/docs/skills-guide) y [Actions](/docs/actions).
