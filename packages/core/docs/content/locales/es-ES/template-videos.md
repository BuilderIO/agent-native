---
title: "Vídeo"
description: "Un estudio de vídeo programático para gráficos en movimiento, demostraciones de productos y texto cinético. Genera animaciones a partir de un mensaje y ajústalas en una línea de tiempo."
---

# Vídeo

Un estudio de vídeo programático para el tipo de gráficos en movimiento, demostraciones de productos y vídeos de texto cinético que son complicados de crear fotogramas clave a mano. Pídale al agente "una revelación del logotipo de 6 segundos que se desvanece a los 2 segundos" y creará la animación. Ajuste el tiempo, la aceleración y los movimientos de la cámara en una línea de tiempo y luego renderice en MP4 o WebM.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Revelación del logotipo</h1><span class='wf-pill accent'>6 seconds</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Render</button></div><div class='wf-card' style='flex:1;display:flex;align-items:center;justify-content:center;min-height:250px'><div style='text-align:center'><strong>Vista previa de Remotion</strong><br/><small class='wf-muted'>logo scales in as the title fades</small></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><div style='display:flex;gap:8px;align-items:center'><span class='wf-pill'>0s</span><span class='wf-pill'>2s</span><span class='wf-pill'>4s</span><span class='wf-pill'>6s</span><div style='flex:1'></div><button>Nueva pista</button></div><div class='wf-box'>Fundido del título · frames 0-48</div><div class='wf-box'>Escala del logotipo · frames 48-120</div><div class='wf-box'>Avance de cámara · frames 72-144</div></div></div>"
}
```

Cuando abras el estudio, verás una lista de composiciones en la pantalla de inicio. Haga clic en uno y obtendrá un reproductor en la parte superior, una línea de tiempo en la parte inferior y un panel de propiedades a la derecha. El agente siempre sabe qué composición tienes abierta.

```an-diagram title="Animación como datos" summary="Una composición es un componente React; Cada animación se lee de una pista para que el agente y la línea de tiempo editen los mismos datos."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Timeline<br><small class=\"diagram-muted\">arrastrar, redimensionar, recorrer</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">\"fade in at 2s\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">AnimationTrack</span><small class=\"diagram-muted\">startFrame / easing / animatedProps</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Composición React<br><small class=\"diagram-muted\">Remotion &lt;Player&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">MP4 / WebM</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Qué puedes hacer con él

- **Genere animaciones a partir de un mensaje.** "Agregue una tarjeta de título que se desvanece a los 2 segundos y se mantiene hasta los 5". El agente edita la composición.
- **Ajusta el tiempo en una línea de tiempo.** Arrastra y cambia el tamaño de las pistas de animación, recorre fotogramas y establece curvas suavizadas visualmente.
- **Anima la cámara.** Gira, amplía e inclina con herramientas en pantalla. Haga clic en la herramienta, arrastre la vista previa y se creará automáticamente un fotograma clave.
- **Comience desde una composición en blanco o un ejemplo.** La plantilla incluye una composición en código (`BlankComposition`) para comenzar; Composiciones de ejemplo (texto cinético, revelaciones de logotipos, ráfagas de partículas, demostraciones interactivas de UI, presentaciones de diapositivas) se cargan desde la base de datos y usted puede agregar las suyas propias.
- **Edite curvas de relajación visualmente.** Más de 30 curvas incluidas: potencia, espalda, rebote, circo, elástica, exposición, seno y física de resorte.
- **Renderiza en MP4 o WebM** con supermuestreo 1x, 2x o 3x para obtener texto y vectores nítidos durante el zoom de la cámara.

Esta es más una herramienta para desarrolladores que otras plantillas: las composiciones son componentes React, por lo que los usuarios avanzados (o el agente) pueden escribir tipos de animación completamente nuevos desde cero. Pero los ajustes cotidianos ("hacer la escritura más lenta", "reducir el recuento de partículas a 12") son solo charlas.

## Para empezar

Demostración en vivo: [videos.agent-native.com](https://videos.agent-native.com).

Cuando abres el estudio:

1. Elige una composición de la pantalla de inicio.
2. Pruebe el agente: "agregue un logotipo revelado que se desvanece a los 2 segundos". Mira la actualización de la línea de tiempo.
3. Arrastra las pistas para volver a cronometrar, haz clic en la herramienta de la cámara y recorre el reproductor.

### Indicaciones útiles

- "Agregue una tarjeta de título que aparezca gradualmente a los 2 segundos y se mantenga hasta los 5."
- "Cambie la cámara para hacer zoom 2x en el logotipo entre los fotogramas 60 y 90."
- "Haz que la escritura se revele más lentamente: un 40 % más."
- "La explosión de partículas es demasiado densa. Baja la cuenta a 12."
- "Crea una nueva composición llamada intro-loop, 1080x1080, 6 segundos."
- "Agregue una animación de clic en la zona del botón y anime el cursor hacia ella."
- "Dale a esta pista una relajación de resorte en lugar de una relajación."

Si seleccionas una pista en la línea de tiempo y presionas Cmd+I, el agente selecciona esa selección; "hacer esta más ágil" simplemente funciona.

## Para desarrolladores

El resto de este documento es para cualquiera que bifurque la plantilla de vídeo o la extienda. Esta plantilla tiene más código que las demás: cada composición es un componente React y cada animación son datos en una pista.

### Arquitectura

Todo lo que ves en el estudio es código. Una composición es un `CompositionEntry` en `app/remotion/registry.ts` que apunta a un componente React en `app/remotion/compositions/`. Cada animación en ese componente se lee desde un `AnimationTrack` para que los usuarios puedan arrastrarla, cambiar su tamaño y volver a cronometrarla en la línea de tiempo UI. El agente puede crear nuevas composiciones, agregar pistas, ajustar la aceleración y escribir componentes completos del React que se conectan al registro.

El estudio se ejecuta en el `<Player>` de Remotion para la vista previa y en el Remotion CLI para el renderizado final. La salida predeterminada es 1920 x 1080 a 30 fps.

### Inicio rápido

Crea una nueva aplicación de vídeo desde CLI:

```bash
npx @agent-native/core@latest create my-video-app --standalone --template videos
cd my-video-app
pnpm install
pnpm dev
```

Abre el estudio en tu navegador, crea una composición y comienza desde cero. Pregúntele al agente algo como "agregue un logotipo revelado que se desvanezca en 2 segundos" y editará la composición por usted.

### Características clave

**Composiciones basadas en React.** Los vídeos son componentes de React respaldados por Remotion, con composiciones de usuario respaldadas por SQL y un registro de código opcional para los valores predeterminados locales.

**Animación en primera línea de tiempo.** Las pistas de duración, fotogramas clave, curvas suavizadas, movimientos de cámara y pistas de expresión programática editan los mismos datos de composición.

**Sistemas de movimiento ajustables.** Los parámetros, las trayectorias del cursor, las zonas de desplazamiento interactivas, la navegación por rango y la reproducción repetida hacen que las animaciones generadas se puedan ajustar sin código.

**Renderizado y persistencia.** La configuración de composición, la calidad, los fps, los valores de pista y las anulaciones persisten por composición y se renderizan en MP4 o WebM a través de Remotion.

### Trabajar con el agente

El agente siempre sabe qué composición tienes abierta. El estado de navegación (`{ view, compositionId }`) se escribe en la tabla `application_state` del marco y la acción `view-screen` lo devuelve más una sugerencia que apunta a `app/remotion/registry.ts`. No es necesario que le diga al agente en qué composición se encuentra; pídale que actúe en "ésta" y lo hará.

Debajo del capó, el agente llama a actions como `navigate`, `save-composition` y `generate-animated-component`. Los registros de composición respaldados por SQL se crean o actualizan a través de `save-composition`; Los componentes de Remotion respaldados por código aún residen en `app/remotion/compositions/*.tsx` y están registrados en `app/remotion/registry.ts`.

### Modelo de datos

El esquema del lado del servidor está en `templates/videos/server/db/schema.ts`:

```an-schema title="Modelo de datos de vídeo" summary="Composiciones respaldadas por SQL más sistemas de diseño y carpetas encajables, cada una con una tabla de recursos compartidos."
{
  "entities": [
    {
      "id": "compositions",
      "name": "compositions",
      "note": "User-created compositions and overrides; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "type", "type": "text" },
        { "name": "data", "type": "text", "note": "Composición completa JSON blob" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
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
      "id": "folders",
      "name": "folders",
      "note": "Nestable folders; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "name", "type": "text" }
      ]
    },
    {
      "id": "folder_memberships",
      "name": "folder_memberships",
      "note": "Unión de muchos a muchos",
      "fields": [
        { "name": "folder_id", "type": "text", "fk": "folders.id" },
        { "name": "composition_id", "type": "text", "fk": "compositions.id" }
      ]
    }
  ],
  "relations": [
    { "from": "folders", "to": "folder_memberships", "kind": "1-n", "label": "members" },
    { "from": "compositions", "to": "folder_memberships", "kind": "1-n", "label": "in folders" }
  ]
}
```

Cada tabla también tiene una tabla de recursos compartidos de marco coincidente (`composition_shares`, `design_system_shares`, `folder_shares`) producida por `createSharesTable()`.

- `compositions`: ID, título, tipo, `data` (blob de composición completa JSON), columnas de propiedad, marcas de tiempo.
- `composition_shares`: concesiones de acciones estándar producidas por `createSharesTable()`.
- `design_systems`: tokens de marca reutilizables (colores, tipografía, espaciado, recursos, instrucciones personalizadas, bandera `is_default`) con `ownableColumns`.
- `design_system_shares`: subvenciones compartidas para sistemas de diseño.
- `folders`: carpetas encajables para la organización de la biblioteca, con `ownableColumns`.
- `folder_shares`: permisos para compartir carpetas.
- `folder_memberships`: unión de muchos a muchos entre un `folder_id` y un `composition_id`.

### Carpetas y sistemas de diseño

Las composiciones se pueden organizar en carpetas y diseñar con sistemas de diseño. Actions: `create-folder`, `rename-folder`, `delete-folder`, `move-composition-to-folder`. Sistema de diseño actions: `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `set-default-design-system`, `apply-design-system`, `analyze-brand-assets`. Importar actions: `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF).

El registro en `app/remotion/registry.ts` es la fuente de verdad en el código de lo que se envía con la plantilla. La tabla SQL almacena composiciones y anulaciones creadas por el usuario. El estado del estudio (ediciones de pistas por composición, anulaciones de accesorios, configuraciones de composición) se refleja en `localStorage` en `videos-tracks:<id>`, `videos-props:<id>` y `videos-comp-settings:<id>`, y se fusiona nuevamente con los valores predeterminados del registro al cargar.

Formas centrales de TypeScript (`app/types.ts`):

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` — `property`, `from`, `to`, `unit`, además de `keyframes`, `programmatic`, `description`, `codeSnippet`, `parameters`, `parameterValues` opcionales.
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

Las composiciones son privadas por defecto. La visibilidad puede ser `private`, `org` o `public`, y las concesiones compartidas otorgan roles `viewer`, `editor` o `admin`, conectados a través de la primitiva de uso compartido del marco.

### Personalizarlo

La carpeta de la plantilla es `templates/videos/` (el slug de cara al usuario es `video`, pero la carpeta está en plural).

**Actions** — `templates/videos/actions/`

- `view-screen.ts`: devuelve el estado de navegación actual del agente.
- `navigate.ts`: navega a una composición (`--compositionId <id>`) o a la vista de inicio (`--view home`).
- `save-composition.ts`: crea o actualiza un registro de composición respaldado por SQL.
- `generate-animated-component.ts`: genera un nuevo archivo de componente Remotion con texto estándar.
- `validate-compositions.ts`: compruebe todas las composiciones registradas para detectar problemas estructurales.
- `list-compositions.ts`, `get-composition.ts`, `update-composition.ts`, `delete-composition.ts`: lee, actualiza y elimina registros de composición respaldados por SQL.

**Rutas** — `templates/videos/app/routes/`

- `_index.tsx` — casa estudio; representa el shell y la lista de composición.
- `c.$compositionId.tsx`: editor de composición (línea de tiempo, reproductor, panel de propiedades).
- `components.tsx`: explorador de bibliotecas de componentes.
- `team.tsx` — gestión de equipos.

**Partes internas remotas** — `templates/videos/app/remotion/`

- `registry.ts`: la lista de composición autorizada.
- `compositions/`: un `.tsx` por composición, más un cañón `index.ts`.
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx`: envuelve el contenido de la composición con la transformación de la cámara.
- `hooks/`, `ui-components/`, `components/`: ayudas de elementos interactivos, representación del cursor, envoltorios de elementos animados.

**Estudio UI** — `templates/videos/app/components/`

- `Timeline.tsx`: la línea de tiempo totalmente controlada (`viewStart` / `viewEnd` no poseen ningún estado internamente).
- `VideoPlayer.tsx`: contenedor remoto `<Player>` con reproducción con rango restringido.
- `TrackPropertiesPanel.tsx`, `CompSettingsEditor.tsx`, `PropsEditor.tsx`: los paneles del lado derecho.
- `CameraToolbar.tsx`, `CameraControls.tsx`: herramientas de cámara y controles numéricos.

**Instrucciones del agente**: `templates/videos/AGENTS.md` es la guía detallada que lee el agente. Cubre la regla de animación como pista, el sistema de cámara, el sistema de cursor, las unidades de filtro CSS, el registro de componentes interactivos, el espaciado UI y las listas de verificación para crear o editar composiciones.

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md`: cómo crear y registrar composiciones.
- `animation-tracks/SKILL.md`: cómo editar pistas y accesorios animados.
- Además del marco estándar skills: `actions`, `self-modifying-code`, `delegate-to-agent`, `storing-data`, `security`, `frontend-design`, `create-skill`, `capture-learnings`.

Para agregar una nueva composición, siga la lista de verificación en `AGENTS.md`: cree el componente, declare `FALLBACK_TRACKS`, use `findTrack` / `trackProgress` / `getPropValue` (nunca codifique marcos), exporte desde `compositions/index.ts`, agregue un `CompositionEntry` al registro y ejecute `pnpm typecheck`.
