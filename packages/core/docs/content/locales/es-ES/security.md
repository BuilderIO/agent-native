---
title: "Seguridad"
description: "Modelo de seguridad para aplicaciones nativas del agente: validación de entradas, prevención de inyección SQL, XSS, alcance de datos, gestión de secretos y patrones de autenticación."
---

# Seguridad

Las aplicaciones nativas del agente están diseñadas para ser seguras de forma predeterminada. El marco proporciona protecciones automáticas en múltiples capas: obtiene aislamiento de datos de nivel SQL, consultas parametrizadas, validación de entradas y autenticación listas para usar.

## Lo que obtienes gratis y lo que posees {#what-you-own}

```an-diagram title="Defensa en capas" summary="El marco posee la mayor parte de la superficie de amenazas; usted posee dos cosas: etiquetar tablas para determinar el alcance y validar entradas externas."
{
  "html": "<div class=\"sec-layers\"><div class=\"diagram-card free\"><span class=\"diagram-pill ok\">Lo controla el framework</span><small class=\"diagram-muted\">SQL isolation &middot; parameterized queries &middot; XSS escaping &middot; auth guard &middot; CSRF cookies &middot; secret encryption</small></div><div class=\"diagram-card you\"><span class=\"diagram-pill warn\">Tú lo controlas</span><small class=\"diagram-muted\">A. tag tables with ownableColumns() &amp; route through access guards<br>B. give every action a Zod schema &amp; send user URLs through the SSRF guard</small></div></div>",
  "css": ".sec-layers{display:flex;flex-direction:column;gap:12px}.sec-layers .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px}"
}
```

Cuando se basa en los patrones estándar, el marco ya maneja la mayor parte de la superficie de amenazas por usted:

- **Aislamiento de datos**: el agente SQL se reescribe para que solo pueda ver las filas del usuario actual (y de la organización activa). Ver [Data Scoping](#data-scoping).
- **Inyección SQL**: `db-query`/`db-exec` y Drizzle siempre parametrizan. Ver [SQL Injection Prevention](#sql-injection).
- **XSS** — Escape automático de React, desinfección TipTap y `react-markdown`. Ver [XSS Prevention](#xss).
- **Auth & CSRF**: cada `defineAction` está protegido por autenticación; las cookies son `httpOnly` + `SameSite=lax`. Ver [Authentication](#auth).
- **Cifrado secreto**: las credenciales y la bóveda se cifran en reposo. Ver [Secrets Management](#secrets).

Eso deja una pequeña superficie en la que realmente tienes que pensar:

- **A. Etiquete sus tablas para determinar el alcance.** Agregue `owner_email` (y `org_id` para datos del equipo) a través de [`ownableColumns()`](#data-scoping) y enrute las lecturas/escrituras de Drizzle a través de [access guards](#access-guards).
- **B. Validar y enrutar entradas externas.** Asigne a cada acción un Zod [`schema:`](#input-validation) y envíe cualquier recuperación del lado del servidor de un usuario/agente URL a través de [SSRF guard](#ssrf).

Si haces bien esos dos, el resto serán los valores predeterminados. El [Production Checklist](#production-checklist) es la confirmación de una página antes del envío.

## Seguridad por diseño {#secure-by-design}

La arquitectura del marco evita vulnerabilidades comunes cuando se utilizan los patrones estándar:

| Vulnerabilidad           | Protección del marco                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| Inyección SQL            | Consultas parametrizadas en `db-query`/`db-exec` y Drizzle ORM                |
| XSS                      | React escapa automáticamente de JSX; TipTap desinfecta el texto enriquecido   |
| Fugas de datos           | Alcance a nivel de SQL mediante vistas temporales (`owner_email`, `org_id`)   |
| Omisión de autenticación | Auth Guard protege automáticamente todos los puntos finales `defineAction`    |
| Inyección de entrada     | Validación del esquema Zod en `defineAction`                                  |
| CSRF                     | Galletas `SameSite=lax` + `httpOnly`                                          |
| Exposición secreta       | `.env` gitignorado; credenciales y bóveda cifradas en reposo (AES-256-GCM)    |
| SSRF                     | `ssrfSafeFetch` bloquea destinos internos/metadatos + reenlace de redirección |

## Validación de entrada {#input-validation}

Utilice `defineAction` con un Zod `schema:` para cada acción. El marco valida la entrada automáticamente antes de que se ejecute el código:

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";

export default defineAction({
  description: "Create a note",
  schema: z.object({
    title: z.string().min(1).max(200).describe("Note title"),
    content: z.string().optional().describe("Note body"),
  }),
  run: async (args) => {
    // args is guaranteed valid — invalid input never reaches here
  },
});
```

La entrada no válida devuelve mensajes de error claros (400 para HTTP, error estructurado para llamadas de agente). El formato heredado `parameters:` no proporciona validación en tiempo de ejecución.

## Prevención de inyecciones SQL {#sql-injection}

Las herramientas `db-query` y `db-exec` del marco utilizan consultas parametrizadas. La entrada del usuario se pasa como argumentos, nunca se interpola en la cadena SQL:

```ts
// SAFE — parameterized query (framework default)
await exec({ sql: "INSERT INTO notes (title) VALUES (?)", args: [title] });

// SAFE — Drizzle ORM (always generates parameterized queries)
await db.insert(notes).values({ title, ownerEmail: email });

// DANGEROUS — string concatenation (never do this)
await exec(`INSERT INTO notes (title) VALUES ('${title}')`);
```

```an-callout
{
  "tone": "risk",
  "body": "Nunca construyas SQL mediante concatenación de cadenas o literales de plantilla. Pase la entrada del usuario como `args` a `exec` / `db-query`, o use Drizzle; ambos siempre parametrizan. Las comprobaciones `pnpm guards` detectan consultas concatenadas y sin ámbito en el momento de CI."
}
```

## Prevención XSS {#xss}

React escapa automáticamente de todas las expresiones JSX. Directrices adicionales:

- Nunca utilice `dangerouslySetInnerHTML` con contenido controlado por el usuario
- Nunca utilice `innerHTML`, `eval()` o `document.write()`
- Para editar texto enriquecido, utilice TipTap (dependencia del marco): desinfecta a través de su esquema
- Para renderizar rebajas, utilice `react-markdown`: convierte a elementos React de forma segura

## Recuperación del lado del servidor (SSRF) {#ssrf}

Cualquier `fetch` del lado del servidor de un URL controlado por un usuario o agente debe pasar por la protección del marco SSRF, o puede apuntar a metadatos de la nube (`169.254.169.254`), `localhost` o servicios internos:

```ts
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

const res = await ssrfSafeFetch(userProvidedUrl, {}, { maxRedirects: 3 });
```

`ssrfSafeFetch` bloquea objetivos privados/internos, vuelve a verificar la IP resuelta en el momento de la conexión (nueva vinculación de DNS) y vuelve a validar cada salto de redireccionamiento para que un URL público no pueda redirigir a la red privada. La extensión proxy iframe, `upload-image`, y el importador de token de diseño lo atraviesan. Para una verificación previa al vuelo únicamente, utilice `isBlockedExtensionUrlWithDns(url)` con `redirect: "manual"`.

## Alcance de los datos {#data-scoping}

En producción, el marco restringe automáticamente las consultas del agente SQL a los datos del usuario actual. Esto se aplica en el nivel SQL: los agentes no pueden evitarlo. Esta sección es la referencia canónica para el proceso de determinación del alcance; los documentos [Authentication](/docs/authentication) y [Multi-Tenancy](/docs/multi-tenancy) se vinculan aquí para conocer la mecánica.

### El proceso de determinación del alcance {#scoping-pipeline}

El alcance fluye desde la sesión autenticada hasta el SQL que ejecuta el agente:

```
session.orgId → AGENT_ORG_ID → SQL row scoping
```

```an-diagram title="El canal de alcance" summary="El agente SQL nunca toca las tablas base directamente: lee una vista temporal cuyo ámbito es la identidad actual, por lo que un nombre de tabla simple solo puede devolver filas propias."
{
  "html": "<div class=\"scope-pipe\"><div class=\"diagram-node\">Sesión iniciada<br><small class=\"diagram-muted\">email &middot; orgId</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Request context<br><small class=\"diagram-muted\">AGENT_ORG_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Temporary VIEW<br><small class=\"diagram-muted\">WHERE owner_email = ? AND org_id = ?</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">SQL del agente<br><small class=\"diagram-muted\">bare table names only</small></div></div>",
  "css": ".scope-pipe{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.scope-pipe .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.scope-pipe .diagram-arrow{font-size:22px;line-height:1}"
}
```

La sesión iniciada transporta `email` y (cuando una organización está activa) `orgId`. El marco establece el contexto de la solicitud de esa sesión, expone la organización activa al agente SQL como `AGENT_ORG_ID` y reescribe cada consulta para que solo pueda ver las filas que posee la identidad actual. Se aplica la misma ruta ya sea que la consulta provenga de UI, una acción o el agente: el agente no puede leer datos de una organización de la que el usuario no es miembro.

### Alcance por usuario (`owner_email`)

Cada tabla con datos específicos del usuario **debe** tener una columna de texto `owner_email`. Utilice el nombre de propiedad camelCase Drizzle: `accessFilter` dice `resourceTable.ownerEmail`:

```ts
import {
  table,
  text,
  integer,
  ownableColumns,
} from "@agent-native/core/db/schema";

// Minimal: just the owner column
export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  ownerEmail: text("owner_email").notNull(), // REQUIRED — camelCase property
});

// Or use ownableColumns() to add owner_email + org_id + visibility in one call
export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  ...ownableColumns(),
});
```

El marco crea vistas temporales SQL que filtran las consultas automáticamente:

```sql
CREATE TEMPORARY VIEW "notes" AS
  SELECT * FROM main."notes"
  WHERE "owner_email" = 'alice@example.com';
```

Las declaraciones INSERT se inyectan automáticamente `owner_email` cuando la columna aún no está presente.

Las herramientas `db-query` / `db-exec` rechazan referencias a tablas calificadas por esquema (`public.<table>`, `main.<table>`): un nombre calificado se resuelve en la tabla base y omitiría la vista temporal anterior. Los agentes utilizan nombres de tablas simples; el alcance se aplica automáticamente.

### Alcance por organización (`org_id`)

Para aplicaciones multiusuario donde los equipos comparten datos, agregue una columna `org_id`. Cuando ambas columnas están presentes, las consultas tienen como alcance ambas: `WHERE owner_email = ? AND org_id = ?`.

El asistente de esquema `ownableColumns()` agrega `owner_email`, `org_id` y `visibility` en una sola llamada, por lo que las nuevas tablas con reconocimiento de inquilinos obtienen el contrato de alcance completo de forma predeterminada:

```ts
import { table, text, ownableColumns } from "@agent-native/core/db/schema";

export const projects = table("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(), // adds owner_email + org_id + visibility
});
```

```an-schema title="What ownableColumns() adds" summary="Las tres columnas que hacen que una tabla sea compatible con los inquilinos y se pueda compartir."
{
  "entities": [
    {
      "id": "ownable",
      "name": "ownable resource",
      "note": "Any table that spreads ...ownableColumns()",
      "fields": [
        { "name": "owner_email", "type": "text", "nullable": false, "note": "Creator. Auto-filled by write actions; auto-injected on INSERT." },
        { "name": "org_id", "type": "text", "nullable": true, "note": "Organización activa del propietario en el momento de la creación. Impulsa las comprobaciones de visibilidad de la organización." },
        { "name": "visibility", "type": "enum", "nullable": false, "note": "privado | organización | público: valor predeterminado aproximado, el valor predeterminado es privado." }
      ]
    }
  ]
}
```

### Guardias de acceso en actions {#access-guards}

El agente sin procesar SQL está dentro del alcance de las vistas temporales anteriores. El código de acción que consulta directamente con Drizzle debe pasar por los asistentes de acceso del marco para que las lecturas y escrituras permanezcan en el ámbito de la identidad actual:

- **`accessFilter`**: devuelve el predicado `WHERE` que limita una consulta a las filas que el usuario/organización actual puede ver. Úselo en consultas de lista/lectura.
- **`resolveAccess`**: resuelve el alcance de acceso efectivo (propietario, organización, compartido) para la solicitud actual.
- **`assertAccess`**: protege una escritura o lectura de un solo registro y lo descarta si la identidad actual no puede actuar en la fila de destino.

Las tablas creadas con `ownableColumns()` requieren estas lecturas y escrituras de alcance; Las rutas Nitro personalizadas deben establecer el contexto de la solicitud antes de consultar los datos que se pueden poseer. La verificación `guard-no-unscoped-queries` (ejecutada a través de `pnpm guards`) aplica esto en el momento de la CI. Consulte la habilidad `sharing` para obtener el ayudante completo API.

### Validación

```bash
pnpm action db-check-scoping           # Verifique que todas las tablas tengan propietario_email
pnpm action db-check-scoping --require-org  # También requiere org_id
```

## Gestión de secretos {#secrets}

| Tipo secreto                                           | Dónde almacenar                                            |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Claves de nivel de implementación (una por aplicación) | Archivo `.env` (gitignorado, solo del lado del servidor)   |
| Claves API por usuario/por organización                | `saveCredential` / `resolveCredential` (cifrado en reposo) |
| Secretos registrados (bóveda de la barra lateral)      | Bóveda `app_secrets` (cifrada en reposo)                   |
| Tokens OAuth (Google, GitHub)                          | Tienda `oauth_tokens` a través de `saveOAuthTokens()`      |
| Fichas de sesión                                       | Automático (Better Auth se encarga de esto)                |

Las credenciales por usuario/por organización y la bóveda están cifradas en reposo con AES-256-GCM, codificadas por `SECRETS_ENCRYPTION_KEY` (recurriendo a `BETTER_AUTH_SECRET`); la producción se niega a comenzar sin uno. Para cifrar cualquier fila de credenciales de texto sin formato preexistente, ejecute `pnpm action db-migrate-encrypt-credentials` (idempotente, no destructivo).

Nunca almacene secretos en `settings`, `application_state`, código fuente o respuestas de acción. Utilice las credenciales/bóveda API anteriores: manejan tanto el cifrado como el alcance por usuario.

## Autenticación {#auth}

La autenticación es automática. Consulte los documentos de [Authentication](/docs/authentication) para conocer la configuración completa.

**Puntos clave de seguridad:**

- Los puntos finales `defineAction` están protegidos automáticamente por la protección de autenticación
- Las rutas `/api/` personalizadas deben llamar a `getSession(event)` y comprobar el resultado
- Las operaciones de cambio de estado deben utilizar POST (el valor predeterminado para actions)
- Las cookies `SameSite=lax` + `httpOnly` previenen la mayoría de los ataques CSRF

## Verificación de identidad A2A {#a2a-identity}

Cuando las aplicaciones se llaman entre sí a través del protocolo A2A, verifican la identidad mediante tokens JWT firmados con un secreto compartido:

```bash
A2A_SECRET=your-shared-secret-at-least-32-chars
```

1. La aplicación A firma un JWT que contiene `sub: "steve@example.com"`
2. La aplicación B verifica la firma JWT con el mismo secreto
3. La aplicación B lee el reclamo `sub` verificado en el contexto de la solicitud
4. Se aplica el alcance de los datos: la aplicación B solo muestra los datos de Steve

Sin `A2A_SECRET` en producción, cada punto final A2A y el punto final de activación automática `/_agent-native/integrations/process-task` devuelven **503**. Configúrelo en cada aplicación que llame o reciba tráfico A2A. (Para el desarrollo local, el marco aún permite llamadas no autenticadas).

## Entrante Webhooks {#webhooks}

Los controladores de webhooks entrantes (Resend, SendGrid, Slack, Telegram, WhatsApp, Recall.ai, Deepgram, Zoom, Google Docs Pub/Sub) rechazan solicitudes falsificadas de forma predeterminada en producción: cuando falta la var de entorno secreta de firma correspondiente, el controlador devuelve 401 en lugar de aceptar y enviar.

Esta era anteriormente una postura de "advertir y aceptar": establezca el secreto que de otro modo se perdería o opte por volver al comportamiento anterior con `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` solo para desarrolladores locales. Consulte [Messaging](/docs/messaging#env-vars) para conocer las variables secretas de firma por integración.

## Lista de verificación de producción {#production-checklist}

### Autenticación y secretos

- [ ] `BETTER_AUTH_SECRET` configurado en una cadena aleatoria de más de 32 caracteres (`openssl rand -hex 32`), a menos que se trate de una implementación de espacio de trabajo alojado que se derive de `A2A_SECRET`
- [ ] `OAUTH_STATE_SECRET` configurado en una cadena aleatoria separada de más de 32 caracteres (no reutilice `BETTER_AUTH_SECRET`); consulte [OAuth State Signing](#oauth-state)
- [ ] `A2A_SECRET` configurado en cada aplicación que llama o recibe tráfico A2A; consulte [A2A Identity Verification](#a2a-identity)
- [ ] Conjunto `SECRETS_ENCRYPTION_KEY` (o confíe en el respaldo `BETTER_AUTH_SECRET`): consulte [Secrets Management](#secrets)
- [ ] `AUTH_SKIP_EMAIL_VERIFICATION` **no** está configurado en producción (o está configurado solo en implementaciones de vista previa de control de calidad)

### Secretos de webhook (establece los que utilices para las integraciones que utilices)

- [ ] Conjunto de secretos de firma para cada integración entrante habilitada; consulte [Inbound Webhooks](#webhooks) y [Messaging](/docs/messaging#env-vars) para obtener la lista por integración
- [ ] `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS` **no** está configurado en prod

### Esquema

- [ ] Cada tabla orientada al usuario tiene `owner_email`, las tablas multiusuario también `org_id`; consulte [Data Scoping](#data-scoping)
- [ ] Las lecturas/escrituras de tablas propias pasan por [access guards](#access-guards)
- [ ] Todos los actions usan `defineAction` con Zod `schema:`; consulte [Input Validation](#input-validation)
- [ ] Las recuperaciones del lado del servidor de usuarios/agentes URL pasan por `ssrfSafeFetch`; consulte [SSRF](#ssrf)
- [ ] No hay `dangerouslySetInnerHTML` con contenido de usuario (o la salida se ejecuta a través de DOMPurify)
- [ ] Ningún SQL concatenado con cadenas
- [ ] `pnpm guards` está limpio (`guard-no-unscoped-queries`, `guard-no-env-credentials`, `guard-no-env-mutation`, `guard-no-localhost-fallback`, `guard-no-unscoped-credentials`, `guard-no-drizzle-push`)
- [ ] Probado con dos cuentas de usuario para verificar el aislamiento de datos

### Endurecimiento varios

- [ ] `AGENT_NATIVE_DEBUG_ERRORS` **no** está configurado en producción real (solo en vistas previas de depuración)
- [ ] `AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK` **no** está configurado a menos que su organización realmente comparta claves de espacio de trabajo; consulte [Cross-User Tooling Secrets](#tooling-secrets)
- [ ] En implementaciones multiinquilino, **los usuarios traen su propio `ANTHROPIC_API_KEY`**: el marco se niega a recurrir a la var de entorno de nivel de implementación

---

Las secciones siguientes cubren indicadores de entornos especializados que solo utiliza en implementaciones específicas. La mayoría de las aplicaciones nunca los tocan.

## Firma de estado OAuth {#oauth-state}

Los flujos OAuth (Google, Atlassian, Zoom) firman su sobre estatal con una clave HMAC dedicada:

```bash
OAUTH_STATE_SECRET=$(openssl rand -hex 32)
```

Esto solía recurrir a `GOOGLE_CLIENT_SECRET` (una credencial compartida con Google): una filtración del secreto de Google habría permitido a los atacantes falsificar sobres de estado OAuth. La clave dedicada es independiente de cualquier secreto de terceros. Si `OAUTH_STATE_SECRET` no está configurado, el marco vuelve a `BETTER_AUTH_SECRET`; Las implementaciones de espacios de trabajo alojados también pueden derivar una clave OAuth por propósito a partir del `A2A_SECRET` ya requerido. Si ninguno de esos secretos del servidor está disponible, los flujos OAuth fallan en producción.

Los parámetros de consulta `redirect_uri` también se validan con una lista de permitidos (rutas del mismo origen + marco `/_agent-native/...`). Los flujos OAuth personalizados en las plantillas deben utilizar el asistente `isAllowedOAuthRedirectUri()` del marco antes de firmar el estado.

## Secretos de herramientas para usuarios cruzados {#tooling-secrets}

Las herramientas y automatizaciones que hacen referencia a `${keys.NAME}` resuelven secretos por usuario de forma predeterminada. El respaldo del ámbito del espacio de trabajo está **desactivado de forma predeterminada** en esta versión; de lo contrario, un miembro malintencionado de la organización podría establecer un espacio de trabajo `OPENAI_API_KEY` y recopilar las llamadas API de otros miembros.

Si su organización realmente comparte claves para todo el espacio de trabajo (por ejemplo, una única clave corporativa de Stripe), vuelva a optar por el comportamiento anterior con:

```bash
AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK=1
```

Las escrituras secretas en el ámbito del espacio de trabajo aún requieren la función de propietario/administrador de la organización, independientemente de esta marca.
