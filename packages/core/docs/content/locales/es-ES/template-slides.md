---
title: "Diapositivas"
description: "Genere presentaciones a partir de un mensaje, edítelas visualmente y presentelas en pantalla completa. Un reemplazo de código abierto para Google Slides, Pitch y PowerPoint."
---

# Diapositivas

Genere presentaciones completas a partir de un mensaje, edite diapositivas visualmente y presente en pantalla completa. Pídale al agente "una presentación de 10 diapositivas para un servicio de suscripción de café" y observe cómo se transmite diapositiva por diapositiva al editor en segundos. Un reemplazo de código abierto para Google Slides, Pitch y PowerPoint.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Actualización del consejo del T3</h1><span class='wf-pill accent'>Diapositiva de título</span><div style='flex:1'></div><button>Preview</button><button>Present</button><button class='primary'>Compartir</button></div><main style='display:grid;grid-template-columns:1fr 220px;gap:12px;flex:1;min-height:0'><section class='wf-card' style='display:flex;align-items:center;justify-content:center;text-align:center;padding:36px'><div><strong style='font-size:28px'>Actualización del consejo del T3</strong><br/><small>Maya Chen · directora ejecutiva</small><div style='height:46px'></div><span class='wf-pill'>Impulso del producto</span></div></section><section style='display:flex;flex-direction:column;gap:10px'><div class='wf-card'><strong>Esquema de la diapositiva</strong><div class='wf-box'>1 Título</div><div class='wf-box'>2 Orden del día</div><div class='wf-box'>3 Métricas</div><div class='wf-box'>4 Enviado</div></div><div class='wf-card' style='flex:1'><strong>Notas del presentador</strong><p class='wf-muted' style='margin:8px 0 0'>Abrir con el progreso del lanzamiento y la historia de retención.</p></div></section></main><div style='display:grid;grid-template-columns:repeat(5,1fr);gap:8px'><div class='wf-box'>1 Título</div><div class='wf-box'>2 Orden del día</div><div class='wf-box'>3 Métricas</div><div class='wf-box'>4 Enviado</div><div class='wf-box'>5 Riesgos</div></div></div>"
}
```

Cuando abre una plataforma, el lienzo de diapositivas, el esquema, las notas y la tira de película permanecen en una superficie del editor mientras el agente aún puede crear, revisar y navegar por las diapositivas a través de actions.

```an-diagram title="Incitar a cubierta" summary="Solicite una plataforma y el agente transmitirá las diapositivas una a la vez a través de las mismas acciones que podría llamar desde CLI."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">Prompt<br><small class=\"diagram-muted\">\"10-slide pitch deck\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">elige diseños</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">create-deck</div><div class=\"diagram-pill\">add-slide &#215; n</div><small class=\"diagram-muted\">paralelo, en streaming</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>decks (SQL)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">El editor renderiza en vivo</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Qué puedes hacer con él

- **Genere presentaciones a partir de un mensaje.** "Genere una presentación de 10 diapositivas para un servicio de suscripción de café, la audiencia son los inversores".
- **Edite diapositivas visualmente**: haga doble clic en el texto para editarlo, haga clic en un bloque para acceder al menú de burbujas, utilice `/` en el menú de barra diagonal para insertar bloques.
- **Genere imágenes con IA.** Imágenes destacadas, maquetas de productos e ilustraciones, preferiblemente delegadas a Recursos, con la generación de imágenes administrada por Builder lista para habilitar claves de proveedor directas y una vez implementadas como alternativa actual.
- **Busca fotografías de archivo y logotipos de empresas.** "Busque el logotipo de stripe.com y agréguelo a la diapositiva 2".
- **Presentación en pantalla completa** con navegación por teclado, controles que se ocultan automáticamente y notas del orador.
- **Comenta, colabora y comparte.** Varias personas pueden editar el mismo mazo en tiempo real. Genera un URL público de solo lectura o compártelo con compañeros de equipo específicos.
- **Importar desde PDF.** Convierta un PDF en un mazo de inicio: el agente lo analiza y diseña el contenido.
- **Importar desde otros formatos.** Importe PPTX, DOCX, Google Docs, repositorios GitHub o cualquier URL como punto de partida. Exporte a PPTX, Presentaciones de Google o HTML.
- **Aplicar sistemas de diseño.** Los tokens de marca, las instrucciones personalizadas y las paletas predeterminadas se guardan como sistemas de diseño y se aplican a nuevas plataformas.
- **Restaurar versiones anteriores.** Se captura una instantánea de cada cambio de plataforma; enumerar o restaurar cualquier versión anterior.

## Empezando

Demostración en vivo: [slides.agent-native.com](https://slides.agent-native.com).

Cuando abres la aplicación:

1. Haz clic en **Nueva plataforma**.
2. Pregúntele al agente: "Genere una presentación de 10 diapositivas para un servicio de suscripción de café; la audiencia son los inversores".
3. Vea la transmisión de diapositivas. Haga clic en cualquier diapositiva para editarla o siga pidiéndole al agente que la refine.

### Indicaciones útiles

- "Genere una presentación de 10 diapositivas para un servicio de suscripción de café, la audiencia son los inversores".
- "Agregar una diapositiva de precios después de la diapositiva 3."
- "Agrande el título de esta diapositiva y cambie el color de acento a verde."
- "Genera una imagen principal para la diapositiva actual: oscura, minimalista y cinematográfica".
- "Busque el logotipo de stripe.com y agréguelo a la diapositiva 2."
- "Reemplace la palabra 'clientes' con 'miembros' en todas partes de esta plataforma."
- "Resuma este PDF como una presentación de 6 diapositivas". (conecte el PDF)

Seleccione texto en una diapositiva y presione Cmd+I para enfocar al agente con esa selección; actuará solo en lo que usted seleccionó.

## Para desarrolladores

El resto de este documento es para cualquiera que bifurque la plantilla de Presentaciones o la amplíe.

### Inicio rápido

Cree una nueva aplicación de Presentaciones desde CLI:

```bash
npx @agent-native/core@latest create my-slides --standalone --template slides
cd my-slides
pnpm install
pnpm dev
```

### Características clave {#key-features}

**Generación de solicitud de presentación.** Solicite una presentación y el agente transmitirá las diapositivas al editor utilizando el mismo sistema de creación y edición actions que puede ejecutar usted mismo.

**Lienzo de diapositivas editable.** La edición de texto en línea, las inserciones de barras diagonales, la edición de código, el orden de arrastrar y soltar, deshacer/rehacer, los comentarios y el modo de presentación se encuentran todos en la superficie de la plataforma.

**Importar y exportar.** Incorpore repositorios PPTX, DOCX, Google Docs, PDF, URL y GitHub; exporte a PPTX, Presentaciones de Google, HTML o un enlace para compartir.

**Sistemas de diseño y medios.** Los sistemas de marca guardados, la generación de imágenes, la búsqueda de stock y la búsqueda de logotipos mantienen las presentaciones más cerca de la dirección visual deseada.

**Colaboración e historial.** La edición de Yjs en tiempo real, los comentarios en cadena, los roles compartidos y las instantáneas de la versión del mazo están integrados.

### Trabajar con el agente

El chat del agente se encuentra en la barra lateral. Puede crear presentaciones, editar diapositivas individuales, generar imágenes, buscar logotipos y navegar por el UI, todo utilizando el mismo actions que ejecutarías desde el CLI.

#### Lo que ve el agente

Cuando una plataforma está abierta, el agente ve automáticamente:

- Los actuales `deckId` y `slideIndex`.
- La lista completa de diapositivas en la plataforma abierta.
- El contenido HTML de la diapositiva seleccionada actualmente.

Esto se inyecta en cada mensaje como un bloque `current-screen`, por lo que el agente nunca tiene que adivinar qué significa "esta diapositiva". Los datos provienen de la clave de estado de la aplicación `navigation`, que el UI escribe en cada navegación. Ver `templates/slides/actions/view-screen.ts`.

#### Seleccionar texto para ediciones enfocadas

Seleccione texto en una diapositiva y presione Cmd+I para enfocar al agente con esa selección precargada. El agente actuará sólo según lo que hayas seleccionado.

#### Vistas previas de diapositivas en línea en el chat

El agente puede incrustar una vista previa de diapositivas en vivo directamente en una respuesta de chat utilizando la barrera de incrustación del marco. Representa un iframe sin cromo a través de `app/routes/slide.tsx` para que puedas ver el resultado sin salir de la conversación.

### Modelo de datos

Todos los datos de la plataforma se encuentran en SQL a través de Drizzle ORM. Esquema: `templates/slides/server/db/schema.ts`.

```an-schema title="Modelo de datos Slides" summary="Un deck posee sus diapositivas como JSON en decks.data; comentarios, versiones, compartidos y sistemas de diseño cuelgan de él."
{
  "entities": [
    {
      "id": "decks",
      "name": "decks",
      "note": "Slides live as JSON in data; carries ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true, "note": "e.g. deck-1712345-abc" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "JSON: { title, slides: [{ id, content, layout }] }" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "slide_comments",
      "name": "slide_comments",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "slide_id", "type": "text", "note": "Desliza el comentario sigue vivo" },
        { "name": "thread_id", "type": "text", "note": "Enhebrado" },
        { "name": "parent_id", "type": "text", "nullable": true },
        { "name": "content", "type": "text" },
        { "name": "quoted_text", "type": "text", "nullable": true },
        { "name": "author_email", "type": "text" },
        { "name": "author_name", "type": "text" },
        { "name": "resolved", "type": "boolean" }
      ]
    },
    {
      "id": "deck_versions",
      "name": "deck_versions",
      "note": "Instantáneas de un momento dado para restaurar",
      "fields": [
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "Cubierta completa JSON" },
        { "name": "change_label", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "deck_share_links",
      "name": "deck_share_links",
      "note": "Instantáneas de enlaces compartidos públicos persistentes",
      "fields": [
        { "name": "token", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "slides", "type": "text", "note": "Instantánea JSON de diapositivas" },
        { "name": "aspect_ratio", "type": "text", "nullable": true },
        { "name": "created_at", "type": "text" }
      ]
    }
  ],
  "relations": [
    { "from": "decks", "to": "slide_comments", "kind": "1-n", "label": "comments" },
    { "from": "decks", "to": "deck_versions", "kind": "1-n", "label": "snapshots" }
  ]
}
```

Las tablas de recursos compartidos del marco (`deck_shares`, `design_system_shares`) asignan principales a funciones de visor/editor/administrador por recurso.

#### mazos

| Columna      | Tipo  | Notas                                                     |
| ------------ | ----- | --------------------------------------------------------- |
| `id`         | texto | Clave principal, p.e. `deck-1712345-abc`                  |
| `title`      | texto | Título del mazo                                           |
| `data`       | texto | Blob JSON: `{ title, slides: [{ id, content, layout }] }` |
| `created_at` | texto | Marca de tiempo                                           |
| `updated_at` | texto | Marca de tiempo                                           |

Cada mazo también lleva el estándar `ownableColumns` (propietario, visibilidad, token compartido) por lo que encaja en el modelo de uso compartido del marco.

#### comentarios_diapositivas

| Columna                       | Notas                                              |
| ----------------------------- | -------------------------------------------------- |
| `id`                          | Clave principal                                    |
| `deck_id`                     | Plato principal                                    |
| `slide_id`                    | Deslice el comentario sigue activo                 |
| `thread_id`, `parent_id`      | Enhebrado                                          |
| `content`, `quoted_text`      | Cuerpo del comentario y extracto de texto opcional |
| `author_email`, `author_name` | Autor                                              |
| `resolved`                    | Bandera booleana                                   |

#### cubierta_compartida

Tabla de recursos compartidos proporcionada por el marco (creada a través de `createSharesTable`) que asigna principales (usuarios u organizaciones) a roles (espectador, editor, administrador) por mazo.

#### versiones_de_mazo

Instantáneas de un momento dado de una plataforma: `deck_id`, `title`, `data` (plataforma completa JSON) y una `change_label` opcional. Utilizado por `list-deck-versions` / `restore-deck-version`.

#### sistemas_de_diseño

Fichas de marca reutilizables: `data` (colores/tipografía/espaciado), `assets`, `custom_instructions` y una bandera `is_default`. Utiliza `ownableColumns` para que los sistemas de diseño se puedan compartir por usuario o por organización.

#### design_system_shares

Tabla de recursos compartidos de marco para sistemas de diseño, asignando principales a roles (visor, editor, administrador).

#### enlaces_compartidos_deck

Instantáneas de enlaces compartidos públicos persistentes codificadas por `token`. Cada fila almacena un `title`, una instantánea de matriz JSON `slides`, un `aspect_ratio` opcional y un `created_at`. Los enlaces compartidos persistentes aquí significan que sobreviven a los reinicios del servidor y funcionan en instancias sin servidor.

#### Estructura de diapositiva

Cada diapositiva dentro de `decks.data` es:

```json
{
  "id": "slide-1",
  "layout": "title",
  "content": "<div class=\"fmd-slide\" style=\"...\">...</div>"
}
```

`content` es HTML sin formato: el renderizador (`app/components/deck/SlideRenderer.tsx`) proporciona el fondo negro y una relación de aspecto fija, y el HTML proporciona todo lo que hay dentro. También se admite la incrustación enriquecida: diagramas Excalidraw mediante `ExcalidrawSlide.tsx` y gráficos Mermaid mediante `MermaidRenderer.tsx`.

### Personalizarlo {#customizing}

La plantilla de Presentaciones es totalmente bifurcable. Lugares clave para buscar al ampliarlo:

#### Actions — `templates/slides/actions/`

Cada operación invocable por el agente se encuentra aquí como un archivo TypeScript. Algunos que tocarás con frecuencia:

- `create-deck.ts`: plataforma nueva desde cero o reemplazo masivo.
- `add-slide.ts`: agregue una diapositiva; prefiero esto para la generación de streaming.
- `update-slide.ts`: búsqueda/reemplazo quirúrgico o intercambio de contenido completo.
- `view-screen.ts`: instantánea de lo que ve el usuario.
- `generate-image.ts`, `edit-image.ts`, `image-search.ts`, `logo-lookup.ts`: herramientas de imagen.
- `extract-pdf.ts` — Ingestión de PDF.

Cada acción se monta automáticamente en `POST /_agent-native/actions/:name` y se puede llamar desde CLI como `pnpm action <name>`. Agregue un nuevo archivo aquí para darle al agente una nueva capacidad.

#### Rutas: `templates/slides/app/routes/`

- `_index.tsx` — lista de mazos.
- `deck.$id.tsx`: el editor.
- `deck.$id_.present.tsx` — modo de presentación.
- `share.$token.tsx`: página pública para compartir de solo lectura.
- `slide.tsx`: inserción de una sola diapositiva utilizada en las vistas previas del chat.
- `settings.tsx` — configuración de plantilla.
- `team.tsx`: gestión de organizaciones y equipos.

#### Componentes del editor: `templates/slides/app/components/editor/`

La mayor parte de la personalización de UI se realiza aquí: `SlideEditor.tsx`, `EditorToolbar.tsx`, `EditorSidebar.tsx`, menús de burbujas, menú de barra diagonal y los paneles para generación de imágenes, búsqueda e historial.

#### Skills — `templates/slides/.agents/skills/`

Agente skills que explica patrones cuando el agente necesita modificar código:

- `create-deck/`: cómo crear una nueva presentación con diapositivas.
- `slide-editing/`: cómo editar diapositivas individuales.
- `deck-management/`: cómo se almacenan y se accede a los mazos.
- `slide-images/`: generación de imágenes y flujo de trabajo de búsqueda.

#### AGENTS.md

`templates/slides/AGENTS.md` es el enrutador corto que el agente lee en cada conversación. Apunta al skills bajo `.agents/skills/` y establece las reglas básicas, el contrato de estado de la aplicación y el índice de habilidades. Las plantillas de diapositivas HTML exactas para cada diseño se encuentran en `.agents/skills/create-deck/SKILL.md`: actualice esa habilidad cada vez que agregue o cambie un patrón de diseño de diapositiva.

#### Rutas API

Para los casos en los que actions no es la opción adecuada (carga de archivos, transmisión), la plantilla expone un pequeño conjunto de puntos finales REST: `GET/POST /api/decks`, `GET/PUT/DELETE /api/decks/:id`. Ver `templates/slides/server/routes/api/`.
