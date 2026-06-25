---
title: "Calendario"
description: "Un calendario impulsado por agentes con sincronización Google Calendar y enlaces de reserva estilo Calendly. Programe, busque espacios y administre la disponibilidad en un inglés sencillo."
---

# Calendario

Una aplicación de calendario impulsada por agentes. Conecte su Google Calendar y el agente podrá leer su agenda, encontrar espacios libres, crear eventos y administrar enlaces de reserva estilo Calendly, todo en inglés sencillo. Reemplaza el combo Google Calendar + Calendly con una aplicación de tu propiedad.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1.4px solid var(--wf-line)'><button>Week</button><button>Today</button><button>‹</button><button>›</button><div style='flex:1'></div><strong>3-9 de mayo de 2026</strong><div style='flex:1'></div><button class='primary'>Nuevo evento</button></div><div style='display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));grid-template-rows:36px repeat(5,72px);gap:7px;padding:14px;flex:1'><div></div><strong>dom. 3</strong><strong>lun. 4</strong><strong>mar. 5</strong><strong>mié. 6</strong><strong>jue. 7</strong><strong>vie. 8</strong><strong>sáb. 9</strong><small class='wf-muted'>7 AM</small><div class='wf-box' style='opacity:.45'></div><div></div><div></div><div></div><div></div><div></div><div></div><small class='wf-muted'>9 AM</small><div class='wf-box'>Reunión general</div><div class='wf-box'>Daily de ingeniería</div><div class='wf-box'>Daily de ingeniería</div><div class='wf-box'>Daily de ingeniería</div><div></div><div class='wf-box'>Planning</div><div></div><small class='wf-muted'>11 AM</small><div class='wf-box'>Revisión de diseño</div><div></div><div class='wf-box'>Crítica de diseño</div><div class='wf-box'>Roadmap</div><div class='wf-box'>Demo del viernes</div><div></div><div></div><small class='wf-muted'>1 PM</small><div></div><div class='wf-box'>1:1</div><div class='wf-box'>Bloque de concentración</div><div></div><div></div><div class='wf-box'>Reunión general</div><div></div><small class='wf-muted'>3 PM</small><div></div><div></div><div></div><div class='wf-box'>Reunión skip-level</div><div></div><div></div><div></div></div></div>"
}
```

Cuando abres la aplicación, la vista del calendario activo es la superficie principal. El agente aún sabe qué día, semana o evento estás viendo, por lo que puedes decir "programar una llamada de 30 minutos con Alex en este día" sin tener que explicarlo todo.

```an-diagram title="Cómo fluye una solicitud de programación" summary="Ya sea que haga clic en el calendario o le pregunte al agente, las mismas acciones se leen en vivo desde Google Calendar y se escriben nuevamente en la misma vista."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Tú haces clic<br><small class=\"diagram-muted\">arrastrar, barra de herramientas, atajos</small></div><div class=\"diagram-node\">Le pides al agente<br><small class=\"diagram-muted\">\"find a 1-hour slot next week\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-events · check-availability · create-event</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Google Calendar<br><small class=\"diagram-muted\">en vivo, varias cuentas</small></div><div class=\"diagram-box\">SQL<br><small class=\"diagram-muted\">reservas · disponibilidad</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">La vista del calendario se actualiza en vivo</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Qué puedes hacer con él

- **Vea su Google Calendar real** en vista de día, semana o mes, con varias cuentas superpuestas.
- **Suscríbase a las fuentes ICS** (tiempo libre de recursos humanos, horarios de conferencias, calendarios de equipo): solo lectura, combinados en la misma vista.
- **Establezca disponibilidad semanal** con soporte de zona horaria: el agente usa esto cuando busca espacios libres.
- **Cree enlaces de reserva públicos** en `/book/{slug}` para cosas como "introducción de 15 minutos" o "demostración de 30 minutos". Configure duraciones, campos personalizados y qué herramienta de conferencia usar.
- **Pregúntele al agente cualquier cosa relacionada con el horario**: "¿Estoy libre el jueves por la tarde?" "Encuentra un espacio de 1 hora la próxima semana y ponle 'Planificación con Alex'". "Pausar mi enlace de reserva de demostración."
- **Comparte enlaces de reserva** con compañeros de equipo para que ellos también puedan administrarlos.

## Para empezar

Demostración en vivo: [calendar.agent-native.com](https://calendar.agent-native.com).

Cuando abres la aplicación por primera vez:

1. Haga clic en **Configuración**.
2. Haga clic en **Conectar Google Calendar** y apruebe.
3. (Opcional) Conecta más cuentas de Google si quieres superponer personal y trabajo.
4. Abre la vista principal: se cargará tu calendario real.

Para crear su primer enlace de reserva:

1. Haga clic en **Enlaces de reserva** en la barra lateral.
2. Haga clic en **Nuevo enlace de reserva**, establezca un título y una duración.
3. Comparte el URL público: los visitantes eligen entre los espacios disponibles.

O simplemente pregúntele al agente: "Cree un enlace de introducción de reserva de 15 minutos con un campo de nombre".

### Indicaciones útiles

- "¿Qué hay en mi calendario hoy?"
- "¿Tengo libre el jueves por la tarde durante 30 minutos?"
- "Busca un espacio de 1 hora la próxima semana y ponle 'Planificación con Alex'".
- "Reprograme este evento para el viernes a las 2 p. m.". (cuando se selecciona un evento)
- "Cambiar a la vista de día y saltar al próximo lunes."
- "Crea un enlace de reserva llamado 'Introducción de 15 minutos' a los 15 minutos con un campo de nota."
- "Pausar el enlace de reserva de mi 'demostración de 30 minutos'."
- "Bloquear los viernes por la tarde según mi disponibilidad."
- "¿Qué reuniones tengo sobre el 'lanzamiento' este mes?"

El agente consultará a Google Calendar en vivo para cualquier pregunta sobre el cronograma; nunca adivinará.

## Para desarrolladores

El resto de este documento es para cualquiera que bifurque la plantilla de Calendario o la amplíe.

### Inicio rápido

Crea un nuevo espacio de trabajo con la plantilla Calendario:

```bash
npx @agent-native/core@latest create my-app --standalone --template calendar
cd my-app
pnpm install
pnpm dev
```

Abre `http://localhost:8082` (el puerto de desarrollo predeterminado de Calendar).

Para conectar Google Calendar en desarrollo, abra la vista Configuración, pegue un `GOOGLE_CLIENT_ID` y un `GOOGLE_CLIENT_SECRET` de [Google Cloud Console](https://console.cloud.google.com/) y haga clic en "Conectar Google Calendar". La redirección OAuth URI es `http://localhost:8082/_agent-native/google/callback` en desarrollo. Los tokens se almacenan en la tabla `oauth_tokens` SQL y se actualizan automáticamente.

### Características clave

**Vistas de calendario en vivo.** Vistas de día, semana y mes leídas directamente desde cuentas de Google conectadas, con feeds ICS opcionales de solo lectura estratificados en el mismo horario.

**Disponibilidad y búsqueda de espacios libres.** Las reglas de disponibilidad semanal, la compatibilidad con zonas horarias y los eventos existentes alimentan la misma acción de disponibilidad que utilizan UI y el agente.

**Enlaces de reserva.** Las páginas públicas `/book/{slug}` recopilan nombre, correo electrónico, campos personalizados, preferencias de conferencia y tokens de cancelación/reprogramación.

**Gestión compartible.** Los enlaces de reserva son privados de forma predeterminada, pero se pueden compartir con compañeros de equipo a través del marco compartido actions.

**Vistas previas de eventos en línea.** El agente puede insertar tarjetas de eventos compactas en el chat con título, hora, ubicación, asistentes y un botón para regresar.

### Trabajar con el agente

El agente ve lo que estás mirando. La vista del calendario actual, la fecha seleccionada y el evento seleccionado se incluyen en cada mensaje como un bloque `current-screen`, por lo que puedes decir "este evento" o "este día" y se resuelve correctamente.

Debajo del capó, el agente llama a actions como `list-events`, `check-availability`, `create-event`, `navigate` y `update-availability`. Debido a que los eventos se encuentran en Google Calendar, el agente siempre consulta el API en lugar de adivinar; no devolverá resultados vacíos sin ejecutar primero un script.

### Modelo de datos

Definido en `templates/calendar/server/db/schema.ts`. Sólo los datos que no son eventos se almacenan localmente:

- `bookings`: citas confirmadas desde páginas de reservas públicas. Almacena nombre, correo electrónico, inicio, fin, slug, notas opcionales, respuestas de campos personalizados, enlace de reunión, un `cancelToken` para que el público administre URL y un estado de `confirmed` o `cancelled`.
- `booking_links`: definiciones de enlaces estilo Calendly. Slug, título, descripción, `duration` principal, lista `durations` opcional, `customFields`, `conferencing`, `color` y una bandera `isActive`. Utiliza el `ownableColumns` del marco para que se aplique el sistema de uso compartido.
- `booking_slug_redirects`: recuerda viejos slugs cuando se cambia el nombre de un enlace para que los URL públicos existentes sigan funcionando.
- `booking_link_shares`: comparte subvenciones para enlaces de reserva.

```an-schema title="Modelo de datos de Calendar" summary="Solo los datos que no son eventos se almacenan localmente: los eventos viven en Google Calendar. Los enlaces de reserva utilizan ownableColumns, por lo que se aplica el sistema para compartir."
{
  "entities": [
    {
      "id": "booking_links",
      "name": "booking_links",
      "note": "Calendly-style link definitions (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "note": "public page at /book/{slug}" },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "duration", "type": "int", "note": "primary duration in minutes" },
        { "name": "durations", "type": "json", "nullable": true, "note": "alternative durations" },
        { "name": "customFields", "type": "json", "nullable": true },
        { "name": "conferencing", "type": "string", "note": "Google Meet / Zoom / personalizado" },
        { "name": "color", "type": "string", "nullable": true },
        { "name": "isActive", "type": "bool", "note": "pause without deleting" }
      ]
    },
    {
      "id": "bookings",
      "name": "bookings",
      "note": "Citas confirmadas desde páginas de reserva públicas",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "fk": "booking_links.slug" },
        { "name": "name", "type": "string" },
        { "name": "email", "type": "string" },
        { "name": "start", "type": "datetime" },
        { "name": "end", "type": "datetime" },
        { "name": "notes", "type": "string", "nullable": true },
        { "name": "customFields", "type": "json", "nullable": true, "note": "custom field responses" },
        { "name": "meetingLink", "type": "string", "nullable": true },
        { "name": "cancelToken", "type": "string", "note": "powers /booking/manage/{token}" },
        { "name": "status", "type": "enum", "note": "confirmado | cancelado" }
      ]
    },
    {
      "id": "booking_slug_redirects",
      "name": "booking_slug_redirects",
      "note": "Mantiene funcionando el antiguo URLs público después de cambiar el nombre de un enlace.",
      "fields": [
        { "name": "oldSlug", "type": "string", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" }
      ]
    },
    {
      "id": "booking_link_shares",
      "name": "booking_link_shares",
      "note": "Compartir subvenciones para reservar enlaces",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "visor | redactor | administración" }
      ]
    }
  ],
  "relations": [
    { "from": "booking_links", "to": "bookings", "kind": "1-n", "label": "has bookings" },
    { "from": "booking_links", "to": "booking_slug_redirects", "kind": "1-n", "label": "has old slugs" },
    { "from": "booking_links", "to": "booking_link_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

Las reglas de disponibilidad y la configuración por usuario se encuentran en la tabla de configuración, con la clave `calendar-availability`. Los tokens OAuth de Google se encuentran en la tabla marco `oauth_tokens`. El estado efímero UI (vista actual, fecha, evento seleccionado) vive en `application_state` bajo la clave `navigation`.

### Personalizarlo

Cada parte de la aplicación es fuente editable. Empiece aquí:

- `templates/calendar/actions/`: cada operación invocable por el agente. Agregue un nuevo archivo con `defineAction` para exponer la nueva capacidad tanto al agente como al frontend. Archivos clave: `check-availability.ts`, `create-event.ts`, `list-events.ts`, `create-booking-link.ts`, `update-availability.ts`, `add-external-calendar.ts`, `navigate.ts`, `view-screen.ts`.
- `templates/calendar/app/routes/`: el UI. `_app._index.tsx` es el calendario, `_app.availability.tsx` es el editor de horarios, `_app.booking-links._index.tsx` y `_app.booking-links.$id.tsx` administran los enlaces de reservas, `_app.bookings.tsx` enumera las reservas, `_app.settings.tsx` es la configuración y `book.$slug.tsx` más `meet.$username.$slug.tsx` son las páginas de reservas públicas.
- `templates/calendar/server/db/schema.ts`: agrega columnas o tablas con Drizzle. Mantenga el código independiente del dialecto para que la plantilla se ejecute en SQLite, Postgres, Turso, D1 y Neon.
- `templates/calendar/AGENTS.md`: instrucciones del agente. Actualízalo cuando le enseñes al agente nuevas capacidades o convenciones.
- `templates/calendar/.agents/skills/`: patrones detallados que sigue el agente. skills relevantes: `event-management`, `availability-booking`, `real-time-sync`, `storing-data`, `delegate-to-agent`, `frontend-design`.
- `templates/calendar/shared/api.ts`: los tipos de TypeScript compartidos (`AvailabilityConfig`, `BookingLink`, `ExternalCalendar`, etc.) utilizados tanto por el servidor como por el cliente.

Si agrega una función, recuerde actualizar las cuatro áreas: UI, acción, habilidad o entrada AGENTS.md y cualquier estado de la aplicación que el agente necesite ver. Eso es lo que mantiene al agente y al UI en paridad.
