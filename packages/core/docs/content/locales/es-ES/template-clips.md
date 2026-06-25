---
title: "vídeos"
description: "Grabación de pantalla asíncrona, notas de reuniones sincronizadas con el calendario y dictado de voz mediante pulsar para hablar: pegue enlaces de Clips en los agentes y podrán leer transcripciones, imágenes y resúmenes."
search: "Clips registros del navegador registros del desarrollador registros de la consola registros de red buscar XHR Aplicación de escritorio de grabadora de diagnóstico de extensión de Chrome"
---

# Clips

Una aplicación que lo captura todo: grabaciones de pantalla, notas de reuniones de su calendario y dictado de voz con Fn-hold. El agente transcribe, titula, resume e indexa todo; luego le permite preguntar "busque el clip donde discutimos el plan de implementación" y busca en todas las transcripciones que haya realizado.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Clips de ingeniería</h1><span class='wf-pill accent'>Library</span><span class='wf-pill'>Meetings</span><span class='wf-pill'>Dictation</span><div style='flex:1'></div><button>Import</button><button class='primary'>Record</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Revisión de OKR</strong><small>35 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Flujo de incorporación</strong><small>12 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Reproducción de bug</strong><small>4 min</small></div></div><div class='wf-card' style='display:flex;gap:10px;align-items:center'><span class='wf-pill accent'>Legible por agentes</span><span>Transcripción + fotogramas listos para enlaces compartidos</span><div style='flex:1'></div><button>Compartir</button></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:8px'><strong>Búsqueda de transcripciones</strong><div class='wf-box'>Capítulo coincidente 03:12 · riesgos de despliegue y traspaso de propietario</div><div class='wf-box'>Resumen de la reunión y acciones</div></div></div>"
}
```

Piense en la línea de Loom + Granola + Wispr Flow en una sola aplicación, pero el agente es un editor de primera clase en todas las superficies, y las grabaciones, reuniones y dictados son suyos, no de un proveedor de SaaS. Clips también hace que las grabaciones compartidas sean legibles para el agente: pegue un enlace normal para compartir de Clips en un agente y este podrá "escuchar" la transcripción como texto y "ver" marcos de pantalla con marca de tiempo como imágenes; no se necesita video sin formato. La visualización de cuadros funciona en cualquier agente con capacidad de imagen (ChatGPT, Código Claude, Cursor, Codex); Los chats web de solo texto aún obtienen la transcripción completa y pueden tomar un fotograma que usted cargue.

```an-diagram title="Capturar, transcribir, reutilizar" summary="Tres tipos de captura aterrizan en una biblioteca; el agente transcribe, titula y resume, luego cada transcripción se puede buscar y compartir."
{
  "html": "<div class=\"diagram-clips\"><div class=\"diagram-col\"><div class=\"diagram-node\">Grabación de pantalla</div><div class=\"diagram-node\">Reunión de calendario</div><div class=\"diagram-node\">Dictado manteniendo Fn</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Una biblioteca<br><small class=\"diagram-muted\">recordings + transcripts (SQL)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">título · resumen · capítulos</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">Buscar</div><div class=\"diagram-pill\">Compartir</div><div class=\"diagram-pill\">Legible por agentes links</div></div></div>",
  "css": ".diagram-clips{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-clips .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-clips .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-clips .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Qué puedes hacer con él

- **Graba tu pantalla** con una grabadora integrada, superposición de cámara web, captura de audio y pausa/recorte.
- **Capture reuniones de su calendario.** Conecte Google Calendar, vea las próximas reuniones en la barra lateral y presione grabar en cualquiera. Obtienes una transcripción en vivo más un resumen de IA, notas con viñetas y elementos de acción en el momento en que finaliza.
- **Dictado pulsar para hablar.** Mantenga presionada la tecla Fn en su máquina, hable y el texto limpio aparecerá en cualquier aplicación que esté usando. Cada dictado se mantiene en un historial con capacidad de búsqueda con originales y versiones limpiadas por IA, una al lado de la otra.
- **Obtenga un título, un resumen y marcadores de capítulo generados automáticamente** para cada grabación: el agente los completa y los mantiene actualizados.
- **Busca en todas las transcripciones**: grabaciones de pantalla, reuniones y dictados, todo en una sola biblioteca. "Busque el clip donde analizamos el plan de implementación".
- **Compartir clips** con permisos por clip (público, de equipo, privado). El seguimiento de enlaces y los comentarios encadenados también funcionan.
- **Vista previa de clips públicos en Slack** con un despliegue reproducible estilo Loom después del
  workspace instala tu aplicación Clips Slack.
- **Capture registros del navegador con la extensión de Chrome.** Las grabaciones del navegador pueden
  adjunte registros de consola redactados y obtenga metadatos/XHR, lo cual es útil para
  errores de productos y reproducciones solo del navegador.
- **Pegue enlaces de clips en los agentes** para que puedan descubrir el contexto legible por el agente: metadatos, segmentos de transcripción, fotogramas recomendados e imágenes de fotogramas con marca de tiempo sin recibir el archivo de vídeo sin formato.
- **Vistas inteligentes de la biblioteca.** Agrupar por proyecto, filtrar por orador, etiquetar automáticamente según el contenido.
- **Edite la transcripción a través del chat.** "Corregir la palabra mal transcrita en el minuto 1:42". "Saque tres citas para una publicación de blog". El agente edita la transcripción y el UI se actualiza en vivo.

## Registros del navegador y diagnósticos del desarrollador

Utiliza la extensión Clips de Chrome cuando necesites una grabación y registros del navegador
la pestaña que estás depurando. La extensión inicia una grabación de pestaña activa y puede
guardar registros de consola redactados, excepciones JavaScript y recuperar/red XHR
metadatos como método, URL redactado, estado, duración y texto de error. Eso
no guarda los cuerpos de las solicitudes, los cuerpos de las respuestas ni los encabezados.

La página de grabación del navegador normal puede guardar diagnósticos desde la página de grabación
en sí mismo. La extensión de Chrome es la ruta para los registros de desarrollador de pestañas activas y
reproducciones solo para navegador. En Clips UI, use la opción Chrome para los registros del navegador y
la aplicación de escritorio para la ruta de captura diaria más fluida.

La lista de extensiones de Chrome Agent-Native Clips es
`https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`.
Si alojas tu propio servidor de Clips, mantén oculta la opción de extensión de Chrome hasta
tu listado de la tienda web está activo. Conjunto `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1`
después de la aprobación para mostrar la extensión junto a las indicaciones de descarga de la aplicación de escritorio. Establecer
`VITE_CLIPS_CHROME_EXTENSION_URL` solo si necesita anular el valor predeterminado
listado URL.

## Clips legibles por el agente

Pegue un enlace para compartir clips públicos normales en un agente. La página para compartir anuncia
un contexto de agente compacto URL, y ese contexto apunta a la transcripción y el marco
API, por lo que los modelos que solo aceptan texto o imágenes fijas aún pueden entender qué
sucedió en la grabación.

Cualquier agente que pueda recuperar una imagen URL en su visión: ChatGPT, código Claude,
Agentes conectados al cursor, Codex y MCP: lee la transcripción y ve el
cuadros. Algunos chats web de solo texto leen la transcripción pero no extraen imágenes encuadradas
entran solos; allí, sube un fotograma clave o abre el clip en un formato con capacidad de imagen
agente.

| Punto final                                       | Qué obtienen los agentes                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/agent-context.json?id=<recordingId>`        | Metadatos del clip, estado de la transcripción, capítulos, CTA, marcos recomendados y enlaces a la transcripción/marco API               |
| `/api/agent-transcript.json?id=<recordingId>`     | Segmentos de transcripción con marca de tiempo con `startMs`, `endMs`, marcas de tiempo legibles, texto y etiquetas de origen opcionales |
| `/api/agent-frame.jpg?id=<recordingId>&atMs=<ms>` | Un fotograma JPEG extraído del vídeo en una marca de tiempo del vídeo original                                                           |

Los puntos finales siguen las mismas reglas de público/contraseña/caducidad que la página para compartir.
Los clips protegidos con contraseña requieren la contraseña una vez; regresan respuestas exitosas
Enlaces tokenizados de corta duración para que los agentes posteriores no necesiten el texto sin formato
contraseña.

Las vistas previas de Slack utilizan el mismo límite de uso compartido. El webhook `/api/slack/unfurl`
solo devuelve un bloque Slack `video` reproducible para clips públicos listos sin un
contraseña, hit de caducidad, marcador de archivo o marcador de papelera. Otros clips todavía obtienen el
Metadatos de miniaturas/títulos de páginas para compartir normales y requieren abrir clips.

```an-api title="Punto de entrada del contexto del agente"
{
  "method": "GET",
  "path": "/api/agent-context.json",
  "summary": "Descripción compacta y legible por el agente de un clip compartido",
  "description": "Returns clip metadata, transcript status, chapters, CTAs, recommended frames, and links to the transcript and frame APIs. Advertised by the public share page so a text- or image-only agent can understand a recording without ingesting raw video.",
  "auth": "Same public / password / expiry rules as the share page",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Clip metadata plus transcript and frame API links" }
  ]
}
```

```an-api title="Transcripción con marca de tiempo"
{
  "method": "GET",
  "path": "/api/agent-transcript.json",
  "summary": "Transcripción con marca de tiempo segments for a shared clip",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Segments with startMs, endMs, readable timestamps, text, and optional source labels" }
  ]
}
```

```an-api title="Marco en una marca de tiempo"
{
  "method": "GET",
  "path": "/api/agent-frame.jpg",
  "summary": "Un fotograma JPEG extraído del vídeo en una marca de tiempo del vídeo original.",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" },
    { "name": "atMs", "in": "query", "type": "integer", "required": true, "description": "Original-video timestamp in milliseconds" }
  ],
  "responses": [
    { "status": "200", "description": "image/jpeg frame" }
  ]
}
```

## Cómo empezar

Demostración en vivo: [clips.agent-native.com](https://clips.agent-native.com).

1. **Abrir biblioteca.** Explorar grabaciones de pantalla, grabaciones de reuniones, dictados,
   carpetas y espacios desde un solo lugar.
2. **Grabar o importar.** Capture una grabación de pantalla, comience desde un calendario
   reunión o utilice el dictado pulsar para hablar.
3. **Deja que el agente lo limpie.** Genera un título, resumen, capítulos, acción
   elementos o texto de transcripción limpio.
4. **Buscar y reutilizar.** Solicite el clip, la cita, la acción o la decisión que desee
   necesita y luego comparte el resultado con la visibilidad adecuada.

### Indicaciones útiles

- "Resuma este clip para una actualización del producto."
- "Encuentre la reunión donde discutimos el plan de implementación".
- "Extraiga tres citas de clientes de esta transcripción."
- "Crear elementos de acción a partir de la última llamada de ventas."
- "Limpia este dictado y conviértelo en un ticket Linear."

## Para desarrolladores

El resto de este documento es para cualquiera que bifurque la plantilla Clips o la extienda.

### Inicio rápido

```bash
npx @agent-native/core@latest create my-clips --standalone --template clips
cd my-clips
pnpm install
pnpm dev
```

Clips es una plantilla más grande con una grabadora nativa (incluye un complemento de escritorio para captura local). Se necesitan tres pasos de configuración antes de poder cargar las grabaciones:

1. **Almacenamiento de video (obligatorio).** Conecte un backend de almacenamiento a través del asistente de incorporación. El camino más sencillo es Builder.io (gratis durante la versión beta, con un solo clic). Para almacenamiento autohospedado, configure `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y, opcionalmente, `S3_REGION` y `S3_PUBLIC_BASE_URL`. Cloudflare R2 y DigitalOcean Spaces utilizan las mismas variables de entorno con el prefijo `R2_*`.
2. **Google Calendar (opcional).** Para sincronizar las próximas reuniones, conecte una cuenta Google Calendar desde Configuración. La devolución de llamada OAuth URL en desarrollo es `http://localhost:8094/_agent-native/google/callback`. Configure un cliente Google OAuth en [Google Cloud Console](https://console.cloud.google.com/) con los Gmail y Google Calendar API habilitados.
3. **Permisos de captura de pantalla.** En macOS, otorgue permiso de Grabación de pantalla al navegador (o a la aplicación complementaria de escritorio) en Configuración del sistema → Privacidad y seguridad → Grabación de pantalla. Las grabaciones del navegador pueden guardar la consola redactada y recuperar diagnósticos/XHR desde la página de la grabadora. Una vez que la lista de extensiones de Chrome esté disponible, habilite `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1` para que los usuarios puedan elegir la extensión para los registros del navegador de pestaña activa o la aplicación de escritorio para obtener la ruta de captura nativa más fluida.
4. **Vistas previas de Slack (opcional).** Cree una aplicación Slack con `links:read`, `links:write` y `links.embed:write`; suscríbete a `link_shared`; agregue su dominio compartido de Clips en **App Unfurl Domains**; establezca la Solicitud URL en `https://your-clips.example.com/api/slack/unfurl`; y agregue la redirección OAuth URL `https://your-clips.example.com/api/slack/oauth/callback`. Configure `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` y `SLACK_SIGNING_SECRET` y luego conecte espacios de trabajo desde Configuración de clips.

### Aloja tu propio servidor de Clips

La aplicación Clips alojada en [clips.agent-native.com](https://clips.agent-native.com)
es solo una copia implementada de la plantilla Clips. Para ejecutar su propio servidor, utilice scaffold
la plantilla, impleméntela como cualquier otra aplicación nativa del agente y luego apunte al escritorio
aplicación de bandeja en su implementación.

1. **Crea la aplicación.**

   ```bash
   npx @agent-native/core@latest crear mis-clips --independiente --clips de plantilla
   cd mis-clips
   Instalación pnpm
   ```

2. **Configurar el estado de producción.** Establecer un `DATABASE_URL` persistente, el normal
   variables de autenticación/secretos de producción de [Deployment](/docs/deployment) y un
   proveedor de almacenamiento de vídeo. Builder.io Connect es la ruta de almacenamiento más sencilla; para
   almacenamiento autohospedado, utilice variables `S3_*` o `R2_*` para un sistema compatible con S3
   cubo.

3. **Implemente la aplicación web.** Para una implementación de nodo simple:

   ```bash
   Construcción pnpm
   nodo .salida/servidor/index.mjs
   ```

   También puedes usar cualquier objetivo Nitro de [Deployment](/docs/deployment), como
   como Netlify, Vercel, Cloudflare Pages, AWS Lambda o Deno Deploy. Asegúrate
   `BETTER_AUTH_URL` es el origen público de los clips, por ejemplo
   `https://clips.example.com`.

4. **Conecta la aplicación de la bandeja del escritorio.** Abre la configuración de Clips Desktop y configura
   **Servidor de clips URL** a la base pública URL de su implementación, por ejemplo
   `https://clips.example.com`. Si la aplicación está montada en una ruta del espacio de trabajo,
   incluye esa ruta, como `https://example.com/clips`. Haga clic en **Conectar**,
   luego inicia sesión con una cuenta en ese servidor de Clips.

5. **Habilite la extensión de Chrome después de la publicación.** Mantener
   `VITE_CLIPS_CHROME_EXTENSION_ENABLED` desarmado hasta el listado de Chrome Web Store
   está aprobado. Luego configúrelo en `1` para revelar la opción de registro del navegador al lado de
   indicaciones de la aplicación de escritorio. El listado predeterminado URL es
   `https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`;
   configure `VITE_CLIPS_CHROME_EXTENSION_URL` solo si su implementación utiliza un
   Listado de extensiones diferentes.

6. **Conecta integraciones opcionales.** Google Calendar impulsa la pestaña Reuniones,
   `GEMINI_API_KEY` o Builder.io Connect potencian la limpieza de transcripciones y títulos
   `GROQ_API_KEY` puede proporcionar respaldo de voz a texto, y Slack OAuth
   La conexión en Configuración permite el despliegue jugable de Slack.

Para desarrollo local, ejecute la aplicación web con `pnpm dev` y apunte al escritorio
aplicación de bandeja en `http://localhost:8094`.

### Características clave

**Una biblioteca, tres tipos de captura.** Las grabaciones de pantalla, las reuniones del calendario y los dictados de pulsar para hablar comparten una biblioteca con capacidad de búsqueda.

**Transcripción y proceso de IA.** Las grabaciones obtienen segmentos de transcripción con marca de tiempo, títulos generados, resúmenes y marcadores de capítulo.

**Edición no destructiva.** Recortar, dividir, eliminar palabras de relleno, eliminar silencios y unir permanecen en `edits_json` para que el medio original permanezca intacto.

**Enlaces para compartir legibles por los agentes.** Los enlaces para compartir públicos exponen la transcripción y enmarcan los API para que los agentes puedan entender las grabaciones sin ingerir vídeo sin procesar.

**Slack reproducible se despliega.** Los enlaces públicos para compartir pueden representar un bloque Slack `video`
que apunta al reproductor `/embed/:id` existente. Esta es una aplicación de espacio de trabajo Slack
instalación, no un comportamiento global del rastreador: los metadatos normales de Open Graph/Twitter son
el recurso alternativo cuando la aplicación no está instalada.

### Modelo de datos

Todos los datos residen en SQL a través de Drizzle ORM. Esquema: `templates/clips/server/db/schema.ts`. Las grabaciones, las reuniones, los dictados, las cuentas de calendario y el vocabulario llevan el estándar `ownableColumns` y tienen una tabla de recursos compartidos de marco coincidente, por lo que encajan en el modelo de uso compartido por usuario/por organización.

```an-schema title="Modelo de datos central Clips" summary="recordings is the source of truth for media; transcripts, meetings, and dictations compose with it rather than duplicating video. (Engagement and org tables omitted for clarity — see the full table below.)"
{
  "entities": [
    {
      "id": "recordings",
      "name": "recordings",
      "note": "Core resource; source of truth for media. ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "video_url", "type": "text", "note": "plus format / size / duration / thumbnails" },
        { "name": "status", "type": "text" },
        { "name": "edits_json", "type": "text", "note": "Ediciones no destructivas" },
        { "name": "chapters_json", "type": "text", "nullable": true },
        { "name": "password", "type": "text", "nullable": true, "note": "Privacidad: contraseña/caducidad" }
      ]
    },
    {
      "id": "recording_transcripts",
      "name": "recording_transcripts",
      "note": "Divida para que las vistas de biblioteca y transcripción se procesen rápidamente",
      "fields": [
        { "name": "recording_id", "type": "text", "fk": "recordings.id" },
        { "name": "segments_json", "type": "text", "note": "{ startMs, endMs, text }" },
        { "name": "full_text", "type": "text" },
        { "name": "language", "type": "text" },
        { "name": "status", "type": "text" }
      ]
    },
    {
      "id": "clips_meetings",
      "name": "clips_meetings",
      "note": "Calendar-sourced or ad-hoc; owns a recording",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "recording_id", "type": "text", "fk": "recordings.id", "nullable": true },
        { "name": "summary_md", "type": "text", "nullable": true },
        { "name": "bullets_json", "type": "text", "nullable": true },
        { "name": "action_items_json", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "clips_dictations",
      "name": "clips_dictations",
      "note": "Push-to-talk dictation history; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "full_text", "type": "text", "note": "crudo" },
        { "name": "cleaned_text", "type": "text", "nullable": true },
        { "name": "source", "type": "text", "note": "fn-mantener, etc." },
        { "name": "target_app", "type": "text", "nullable": true }
      ]
    }
  ],
  "relations": [
    { "from": "recordings", "to": "recording_transcripts", "kind": "1-1", "label": "transcript" },
    { "from": "recordings", "to": "clips_meetings", "kind": "1-1", "label": "captured by" }
  ]
}
```

| Tabla                                           | Qué contiene                                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordings`                                    | El recurso principal: título, vídeo URL/formato/tamaño, duración, miniaturas, estado, `edits_json`, `chapters_json` no destructivos, privacidad (contraseña, caducidad) y alternancia del reproductor |
| `recording_transcripts`                         | Transcripción por grabación: `segments_json` (`{startMs,endMs,text}`), `full_text`, idioma y estado                                                                                                   |
| `recording_tags`                                | Etiquetas de formato libre en una grabación                                                                                                                                                           |
| `recording_ctas`                                | Botones de llamada a la acción (etiqueta, URL, color, ubicación) superpuestos en una grabación                                                                                                        |
| `recording_comments`                            | Comentarios encadenados y con marca de tiempo con mapa de reacción emoji y bandera resuelta                                                                                                           |
| `recording_reactions`                           | Emoji reactions fijado a la marca de tiempo de un vídeo (se permiten espectadores anónimos)                                                                                                           |
| `recording_viewers` / `recording_events`        | Ver análisis: tiempo de visualización por espectador y finalización, además de eventos granulares (ver-inicio, ver-progreso, búsqueda, pausa, cta-clic, reacción)                                     |
| `clips_meetings`                                | Reuniones ad hoc o basadas en calendario: programación/intervalos reales, plataforma, notas de usuario, IA `summary_md`, `bullets_json`, `action_items_json` y el enlace a su `recording_id`          |
| `meeting_participants` / `meeting_action_items` | Asistentes y elementos de acción extraídos para una reunión                                                                                                                                           |
| `calendar_accounts` / `calendar_events`         | Cuentas de calendario conectadas (los tokens OAuth se encuentran en `app_secrets`, solo se hace referencia aquí) e instantáneas de eventos sincronizadas                                              |
| `clips_dictations`                              | Historial de dictado Pulsar para hablar: `full_text` sin formato, `cleaned_text` opcional, aplicación de origen (`fn-hold`, etc.) y de destino                                                        |
| `clips_vocabulary`                              | Correcciones de vocabulario personal (término → reemplazo preferido) que sesgan dictados futuros                                                                                                      |
| `spaces` / `space_members` / `folders`          | Organización de la biblioteca: espacios (contenedores temáticos), sus miembros y carpetas anidables                                                                                                   |
| `organization_settings`                         | Sidecar de clips por organización: color de marca, logotipo, visibilidad predeterminada                                                                                                               |

Las grabaciones y transcripciones son tablas intencionalmente separadas para que las vistas de biblioteca y transcripción puedan procesarse rápidamente. Las reuniones se componen con grabaciones en lugar de duplicar medios: una reunión es propietaria de la grabación que captura, pero la fila `recordings` sigue siendo la fuente de verdad para el vídeo y la transcripción por segmento.

Las rutas en UI se encuentran en `templates/clips/app/routes/`: la aplicación autenticada se encuentra en `_app.*` (biblioteca, espacios, carpetas, reuniones, dictados, ideas, papelera, configuraciones), con superficies públicas en `r.$recordingId`, `share.$shareId`, `embed.$shareId` y `invite.$token`.

### Clave actions

Cada operación invocable por el agente es un archivo TypeScript en `templates/clips/actions/`, montado automáticamente en `POST /_agent-native/actions/:name` y ejecutable desde CLI como `pnpm action <name>`. Hay ~80 actions; las agrupaciones útiles:

- **Ciclo de vida de grabación**: `create-recording`, `finalize-recording`, `update-recording`, `set-thumbnail`, `archive-recording` / `restore-recording` / `trash-recording` / `delete-recording-permanent`, `move-recording`, `tag-recording`.
- **Transcripción e IA** — `request-transcript`, `cleanup-transcript`, `regenerate-title` / `regenerate-summary` / `regenerate-chapters`, `set-chapters`, `generate-workflow`. (`cleanup-transcript` y `finalize-meeting` son llamadas de canalización de medios del lado del servidor; la mayoría de las otras funciones de IA se delegan en el chat del agente).
- **Edición**: `trim-recording`, `split-recording`, `remove-filler-words`, `remove-silences`, además de `stitch-recordings`, `undo-edit`, `clear-edits` no destructivos. Las ediciones se acumulan en `edits_json`; el cliente concatena/exporta a través de ffmpeg.wasm.
- **Reuniones**: `create-meeting`, `start-meeting-recording` / `stop-meeting-recording`, `finalize-meeting`, `update-meeting`, `get-meeting`, `list-meetings`, además de cableado de calendario `connect-calendar` / `disconnect-calendar` / `sync-calendars` / `list-calendar-accounts`.
- **Dictado**: `create-dictation`, `cleanup-dictation`, `update-dictation`, `list-dictations` y `add-vocabulary-term`/`list-vocabulary` para personalizar el vocabulario.
- **Organización de la biblioteca**: `create-space` / `rename-space` / `delete-space`, `add-space-member` / `remove-space-member`, `create-folder` / `rename-folder` / `delete-folder`, `add-recording-to-space`.
- **Compartir, comentarios y participación**: marco compartido actions más `create-cta` / `update-cta` / `delete-cta`, `add-comment` / `reply-to-comment` / `resolve-comment` / `react-to-comment` / `delete-comment`, `react-to-recording`, `list-viewers`.
- **Organizaciones y miembros**: `create-organization`, `set-organization-branding`, `invite-member` / `accept-invite` / `decline-invite` / `get-invite`, `remove-member`, `update-member-role`, `list-organization-state`, `list-notifications`.
- **Búsqueda, información valiosa y exportación**: `search-recordings` (coincide con títulos, descripciones, texto de transcripción y comentarios, con marcas de tiempo), `get-recording-insights`, `get-organization-insights`, `export-insights-csv`, `export-to-brain`.
- **Contexto y navegación**: `view-screen` (clip actual, cabezal de reproducción, rango de transcripción seleccionado) y `navigate`; `refresh-list` después de mutaciones.

### Personalizarlo

Clips es una plantilla completa y clonable: bifurquela y pídale al agente que la extienda. Algunos ejemplos:

- "Añade un botón de eliminación de palabras de relleno que elimine ums y uhs de la transcripción y vuelva a unir el vídeo."
- "Publicar automáticamente mis notas en Slack #eng cada vez que finaliza una reunión". (Conecte primero Slack a través de [Messaging](/docs/messaging).)
- "Agregue una tecla de acceso rápido que coloque el último dictado en Linear como un ticket nuevo."
- "Agrupa la biblioteca por proyecto: detecta el proyecto desde las primeras palabras de cada transcripción."
- "Agregue un botón 'Generar publicación de blog a partir de este clip' que redacta una publicación a partir de la transcripción y la guarda como borrador."
- "Permitir que los espectadores dejen la marca de tiempo reactions en un clip compartido".

El agente edita rutas, componentes, la canalización de transcripción y el esquema según sea necesario. Consulte [Templates](/docs/cloneable-saas) para ver el flujo completo de clonación, personalización e implementación y [Getting Started](/docs/getting-started) si esta es su primera plantilla nativa de agente.

## ¿Qué sigue?

- [**Templates**](/docs/cloneable-saas): el modelo de clonar y poseer
- [**Context Awareness**](/docs/context-awareness): cómo conoce el agente el clip y el cabezal de reproducción actuales
- [**Agent Teams**](/docs/agent-teams): delegar la limpieza de transcripciones a un subagente especializado
