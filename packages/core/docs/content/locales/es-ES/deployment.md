---
title: "Implementación"
description: "Implemente aplicaciones nativas del agente en cualquier plataforma con ajustes preestablecidos de Nitro: Node.js, Vercel, Netlify, Cloudflare, AWS y más."
---

# Implementación

Las aplicaciones nativas del agente usan [Nitro](https://nitro.build) internamente, lo que significa que puedes implementarlas en cualquier plataforma sin cambios de configuración: solo establece un ajuste preestablecido.

## Antes de implementar: elija una base de datos persistente {#persistent-database}

Cada aplicación implementada necesita una base de datos SQL persistente. En el desarrollo local, el agente nativo recurre a un archivo SQLite en `data/app.db`; eso es conveniente en su máquina, pero no es duradero en contenedores, vistas previas o entornos sin servidor donde se puede restablecer el sistema de archivos.

Configure `DATABASE_URL` en su proveedor de implementación antes de promocionar una aplicación a producción. El agente nativo utiliza Drizzle para esquemas y consultas, por lo que la capa de datos es portátil entre backends SQL compatibles con Drizzle y el marco detecta automáticamente el dialecto de URL. Consulte [Database](/docs/database#production) para obtener la lista de adaptadores y detalles del dialecto.

Utilice `DATABASE_AUTH_TOKEN` solo cuando su proveedor de base de datos requiera un token separado, como Turso/libSQL. Para los espacios de trabajo, todas las aplicaciones heredan la raíz `DATABASE_URL` de forma predeterminada; configure `<APP_NAME>_DATABASE_URL` cuando una aplicación deba usar una base de datos diferente.

## Implementación del espacio de trabajo: un origen, muchas aplicaciones {#workspace-deploy}

Si tu proyecto es [workspace](/docs/multi-app-workspace), puedes enviar todas las aplicaciones que contiene a un único origen con un solo comando:

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Cada aplicación se crea con `APP_BASE_PATH=/<name>` y `VITE_APP_BASE_PATH=/<name>` y luego se empaqueta para el ajuste preestablecido Nitro de destino. Cloudflare Pages es el valor preestablecido predeterminado y utiliza un trabajador despachador generado en `dist/_worker.js`; Netlify usa una función por aplicación en `.netlify/functions-internal/<app>-server` más redireccionamientos generados; Vercel escribe un `.vercel/output` a nivel de espacio de trabajo utilizando Build Output API.

```an-diagram title="Un origen, muchas aplicaciones" summary="Cada aplicación de espacio de trabajo se crea con su propia ruta base y se monta bajo un prefijo de ruta en un único origen, por lo que el inicio de sesión y la aplicación cruzada A2A son del mismo origen y gratuitos."
{
  "html": "<div class=\"diagram-ws\"><div class=\"diagram-panel\" data-rough><strong>https://your-agents.com</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/mail/*</span><small class=\"diagram-muted\">apps/mail</small></div><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/calendar/*</span><small class=\"diagram-muted\">apps/calendar</small></div><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/forms/*</span><small class=\"diagram-muted\">apps/forms</small></div></div><div class=\"diagram-col wins\"><span class=\"diagram-pill ok\">shared login session</span><span class=\"diagram-pill ok\">A2A entre apps sin configuración</span></div></div>",
  "css": ".diagram-ws{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-ws .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-ws .diagram-row{display:flex;align-items:center;gap:8px}.diagram-ws .wins{display:flex;flex-direction:column;gap:8px;align-items:flex-start}"
}
```

La implementación del mismo origen te ofrece dos grandes beneficios gratis:

- **Sesión de inicio de sesión compartida**: inicie sesión en cualquier aplicación, todas las aplicaciones están iniciadas.
- **Zero-config cross-app A2A**: etiquetar `@calendar` desde el correo es una recuperación del mismo origen; nada de CORS, nada de firmas JWT entre hermanos.

Publicar el resultado con:

```bash
wrangler pages deploy dist
```

Para implementaciones unificadas de Netlify, utilice el ajuste preestablecido de Netlify:

```bash
npx @agent-native/core@latest deploy --preset netlify
```

Para implementaciones unificadas de Vercel, utilice el ajuste preestablecido de Vercel:

```bash
npx @agent-native/core@latest deploy --preset vercel
```

Al configurar un comando de compilación de proveedor, use el mismo comando con `--build-only`. Vercel debería ejecutar `npx @agent-native/core@latest deploy --preset vercel --build-only`; el comando escribe `.vercel/output` directamente, por lo que no se requiere ningún `vercel.json` para el enrutamiento del espacio de trabajo.

Las compilaciones de espacios de trabajo alojados requieren `A2A_SECRET` en el entorno del proveedor de implementación.
Esto hace que los currículums Slack, webhooks entrante y A2A entre aplicaciones funcionen mediante firma
procesadores en segundo plano. Las comprobaciones de artefactos locales `--build-only` aún se ejecutan sin él.

Aún se admite la implementación independiente por aplicación, solo `cd apps/<name> && npx @agent-native/core@latest build` como un andamio independiente.

## Cómo funciona {#how-it-works}

Cuando ejecuta `npx @agent-native/core@latest build`, Nitro construye tanto el cliente SPA como el servidor API en `.output/`:

```an-file-tree title="Salida de compilación"
{
  "entries": [
    { "path": ".output/", "note": "Autónomo: cópialo a cualquier entorno y ejecútalo" },
    { "path": ".output/public/", "note": "SPA compilada (assets estáticos)" },
    { "path": ".output/server/index.mjs", "note": "Punto de entrada del servidor" },
    { "path": ".output/server/chunks/", "note": "Fragmentos de código del servidor" }
  ]
}
```

El resultado es autónomo: copie `.output/` a cualquier entorno y ejecútelo.

```an-diagram title="Construir para implementar" summary="Un árbol de origen se basa en un valor preestablecido Nitro; la misma salida autónoma se ejecuta en Node, Vercel, Netlify, Cloudflare, AWS o Deno. Cada instancia apunta al mismo DATABASE_URL persistente."
{
  "html": "<div class=\"diagram-deploy\"><div class=\"diagram-box\" data-rough>Fuente de la app</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">build</span><small class=\"diagram-muted\">Nitro preset</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Node.js</span><span class=\"diagram-pill\">Vercel</span><span class=\"diagram-pill\">Netlify</span><span class=\"diagram-pill\">Cloudflare</span><span class=\"diagram-pill\">AWS Lambda</span><span class=\"diagram-pill\">Deno</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>DATABASE_URL persistente<br><small class=\"diagram-muted\">shared by every instance</small></div></div>",
  "css": ".diagram-deploy{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-deploy .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-deploy .diagram-arrow{font-size:22px;line-height:1}.diagram-deploy .diagram-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}"
}
```

## Configuración del preajuste {#setting-the-preset}

De forma predeterminada, Nitro se compila para Node.js. Para apuntar a una plataforma diferente, configure el ajuste preestablecido en su `vite.config.ts`:

```ts
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "vercel" } })],
});
```

O utilice la variable de entorno `NITRO_PRESET` en el momento de la compilación:

```bash
NITRO_PRESET=netlify npx @agent-native/core@latest build
```

## Node.js (predeterminado) {#nodejs}

El valor predeterminado predeterminado. Construir y ejecutar:

```bash
npx @agent-native/core@latest build
node .output/server/index.mjs
```

Establezca `PORT` para configurar el puerto de escucha (predeterminado: `3000`).

Utilice la línea actual Node.js LTS para implementaciones de producción. A partir de mayo de 2026,
es Node.js 24; Node.js 20 llegó al final de su vida útil el 30 de abril de 2026 y ya no
recibe actualizaciones de seguridad ascendentes.

### Acoplador {#docker}

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/.output .output
# data/ es un directorio SQLite creado en tiempo de ejecución; no copie una base de datos de desarrollo en prod.
# Para producción, configure DATABASE_URL en una instancia alojada de Postgres o Turso.
RUN mkdir -p /app/data
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

## Vercel {#vercel}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "vercel" } })],
});
```

Implemente a través de Vercel CLI o git push:

```bash
vercel deploy
```

Para un espacio de trabajo, cree cada aplicación en un paquete Vercel Build Output API:

```bash
npx @agent-native/core@latest deploy --preset vercel
```

Para implementaciones de Vercel Git, configure el comando de compilación en:

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

La compilación del espacio de trabajo copia la salida Nitro `vercel` de cada aplicación en la raíz `.vercel/output`, le da a cada función su propio entorno de ruta de montaje y escribe la configuración de ruta que sirve a las aplicaciones en `/<app-id>`.

## Netlificar {#netlify}

El ajuste preestablecido Nitro `netlify` funciona bien y, en la práctica, nos ha brindado inicios en frío mucho más rápidos que Cloudflare Pages (~200 ms TTFB frente a ~9 s) para plantillas que se comunican con Postgres externo (Neon). Configure el valor preestablecido en `vite.config.ts`:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "netlify" } })],
});
```

…o configure `NITRO_PRESET=netlify` en el momento de la compilación.

Para un espacio de trabajo, implemente todas las aplicaciones desde un sitio de Netlify ejecutando:

```bash
npx @agent-native/core@latest deploy --preset netlify
```

La compilación del espacio de trabajo escribe recursos estáticos en `dist/_workspace_static/` y enruta cada aplicación a su propia función Netlify sin redirecciones forzadas de activos, por lo que archivos como `/mail/assets/...` se sirven estáticamente antes de que la función del servidor maneje las rutas de las aplicaciones.

## Páginas de Cloudflare {#cloudflare-pages}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "cloudflare_pages" } })],
});
```

## AWS Lambda {#aws-lambda}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "aws_lambda" } })],
});
```

## Implementación de Deno {#deno-deploy}

```ts
// vite.config.ts
export default defineConfig({
  plugins: [agentNative({ nitro: { preset: "deno_deploy" } })],
});
```

## Variables de entorno {#environment-variables}

### Compilación/Tiempo de ejecución {#env-runtime}

| Variables                   | Descripción                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | Puerto del servidor (solo Node.js)                                                                                                                                                    |
| `NITRO_PRESET`              | Anular el valor preestablecido de compilación en el momento de la compilación                                                                                                         |
| `APP_BASE_PATH`             | Monte la aplicación bajo un prefijo (por ejemplo, `/mail`). Establecido automáticamente por `npx @agent-native/core@latest deploy`; déjelo sin configurar para que sea independiente. |
| `AGENT_PROD_CODE_EXECUTION` | Modo de ejecución de código de producción opcional: `off` (predeterminado), `sandboxed` o `trusted`. Ver [Production Code Execution](#production-code-execution).                     |

Las variables de conexión de la base de datos (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `<APP_NAME>_DATABASE_URL` por aplicación) se encuentran en [Database](/docs/database#production).

### Requerido en producción {#env-required-prod}

Estos deben configurarse antes de promocionar una aplicación para una implementación de producción real. Los valores faltantes se cierran fallidamente (el marco se niega a iniciar/se niega a manejar solicitudes) o recurren a un comportamiento más débil con una advertencia fuerte.

| Variable                 | Descripción                                                                                                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | Cadena aleatoria de más de 32 caracteres. Las cookies de sesión de signos AND son la alternativa HMAC para `OAUTH_STATE_SECRET` y `SECRETS_ENCRYPTION_KEY`. Requerido: el marco se inicia al inicio si falta en producción.                                                                              |
| `BETTER_AUTH_URL`        | Origen público de esta aplicación (por ejemplo, `https://mail.example.com`). Se utiliza para el dominio de cookies y la construcción de redirecciones OAuth.                                                                                                                                             |
| `ANTHROPIC_API_KEY`      | Clave API para el agente de producción integrado. **En implementaciones multiinquilino**, el marco se niega a recurrir a esto cuando el usuario no tiene una clave por usuario; es necesario traer su propia clave. Las instalaciones autohospedadas de un solo inquilino la utilizan como clave global. |
| `OAUTH_STATE_SECRET`     | Clave HMAC dedicada para sobres de estado OAuth (Google, Atlassian, Zoom). Vuelve a `BETTER_AUTH_SECRET` cuando no está configurado, pero se recomienda un valor dedicado para que rotar uno no invalide el otro. Generar a través de `openssl rand -hex 32`.                                            |
| `A2A_SECRET`             | HMAC compartido para A2A JSON-RPC entre aplicaciones. Sin él, cada terminal A2A y el terminal automático `/_agent-native/integrations/process-task` devuelven 503 en producción.                                                                                                                         |
| `SECRETS_ENCRYPTION_KEY` | Clave AES-256-GCM para la bóveda de secretos cifrados en reposo. Vuelve a `BETTER_AUTH_SECRET`. Se producen fallos graves en producción cuando ambos están desarmados.                                                                                                                                   |

### Autenticación e identidad {#env-auth}

Las credenciales del proveedor OAuth (Google, GitHub), los respaldos de portador estáticos de MCP (`ACCESS_TOKEN` / `ACCESS_TOKENS`) y los conmutadores de verificación de correo electrónico están documentados en [Authentication](/docs/authentication). Configúrelos allí según el modo de autenticación que elija.

### Entrante Webhooks {#env-webhooks}

Cada integración de mensajería requiere su propio secreto de firma en producción (los controladores fallan en solicitudes falsificadas cuando falta el secreto). Las variables por integración se enumeran en [Messaging](/docs/messaging) y [Security](/docs/security). Solo para desarrollo local, `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` vuelve a optar por "advertir y aceptar"; nunca lo configure en producción.

### Configuración de seguridad (optación) {#security-config}

Los valores predeterminados son estrictos. Un puñado de indicadores de participación relajan el comportamiento (rastreos de pila de depuración, webhooks no verificado, reserva de clave con ámbito de espacio de trabajo, conmutador multiorganización del concentrador MCP, escrituras env-var en tiempo de ejecución). Están documentados con sus compensaciones de seguridad en [Security](/docs/security). No los establezcas a menos que quieras específicamente el camino relajado.

### Herencia del espacio de trabajo .env {#env-inheritance}

Dentro de un espacio de trabajo, la raíz `.env` se carga automáticamente en cada aplicación, por lo que las claves compartidas como `ANTHROPIC_API_KEY`, `A2A_SECRET`, `BETTER_AUTH_SECRET` y `OAUTH_STATE_SECRET` solo deben configurarse una vez. El `apps/<name>/.env` por aplicación gana en caso de conflicto.

### Generando secretos fuertes {#env-generate-secrets}

Para cualquier secreto marcado como "32+ caracteres aleatorios" (`BETTER_AUTH_SECRET`, `OAUTH_STATE_SECRET`, `A2A_SECRET`, `SECRETS_ENCRYPTION_KEY`), genere valores nuevos con:

```bash
openssl rand -hex 32
```

Gírelos reemplazando la var de entorno en cada instancia y volviéndolos a implementar: los sobres de estado de sesiones/OAuth firmados con la clave anterior dejan de ser válidos, por lo que es posible que los usuarios deban iniciar sesión nuevamente.

## Herramientas del agente de producción {#production-agent-tools}

Los agentes de producción obtienen las herramientas de marco actions plus registradas de la aplicación de
el complemento de chat del agente. Las escrituras en bases de datos están habilitadas de forma predeterminada porque la base de datos sin formato
herramientas están dirigidas al usuario/organización autenticado, pero los propietarios de aplicaciones pueden limitar el
cuando una implementación debería ser más obstinada:

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  // Default: "write" (also true)
  databaseTools: "read", // "write" | "read" | "off"
  extensionTools: false,
});
```

- `databaseTools: "write"`: predeterminado. Registros `db-schema`, `db-query`,
  `db-exec` y `db-patch`. Las escrituras tienen como ámbito el usuario/organización actual y
  Los cambios de esquema están bloqueados.
- `databaseTools: "read"`: registra solo `db-schema` y `db-query`; agentes
  inspecciona los datos con SQL pero debes usar la aplicación escrita actions para las escrituras.
- `databaseTools: "off"` o `false`: elimina las herramientas de base de datos sin procesar del
  superficie del agente para que los actions de la aplicación sean la única ruta de acceso a los datos.
- `extensionTools: false`: elimina la gestión de extensiones del marco actions y
  orientación rápida (`create-extension`, `update-extension`, etc.) para aplicaciones que
  No quiero que el agente cree miniaplicaciones en espacio aislado.

## Ejecución del código de producción {#production-code-execution}

De forma predeterminada, los agentes de producción se ejecutan sin herramientas de ejecución de código. Pueden llamar a la aplicación actions, herramientas de base de datos, herramientas MCP, herramientas de navegador/sesión y otras herramientas de marco registradas, pero no obtienen acceso al shell ni al sistema de archivos.

Las implementaciones compatibles con nodos pueden optar por la ejecución de código de producción a través del complemento de chat del agente o una anulación del entorno:

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  codeExecution: { production: "sandboxed" },
});
```

Los modos disponibles son:

- `off`: el valor predeterminado. No hay herramientas de ejecución de código registradas en producción.
- `sandboxed`: registra `run-code`, un ejecutor aislado Node.js JavaScript con un entorno limpio, un directorio temporal nuevo, límites de salida/tiempo y un puente de host local para herramientas registradas en la lista permitida, como `provider-api-request`, `provider-api-docs`, `provider-api-catalog`, `web-request` y el puente de archivos del espacio de trabajo respaldado por recursos utilizado por `workspaceRead` / `workspaceWrite`.
- `trusted`: registra `run-code` más el registro completo de la herramienta de codificación (`bash`, `read`, `edit`, `write`). Úselo solo para implementaciones de un solo inquilino o controladas por un operador donde el acceso completo al host es intencional.

Configure `AGENT_PROD_CODE_EXECUTION=sandboxed` o `AGENT_PROD_CODE_EXECUTION=trusted` para anular la opción del complemento para una implementación específica sin un cambio de código. `AGENT_PROD_CODE_EXECUTION=off` fuerza la ejecución del código incluso cuando la opción del complemento lo habilita.

El entorno limitado `run-code` es un aislamiento a nivel de proceso, no un contenedor de sistema operativo. Elimina los secretos de la aplicación del entorno del proceso secundario y utiliza el modelo de permisos de Node cuando está disponible, pero el propio Node no bloquea la red saliente; las llamadas autenticadas deben pasar por los asistentes de puente que expone la herramienta.

## Actualizando UI en producción {#updating-ui-in-production}

Una de las características principales del agente nativo es que el agente puede modificar el código fuente de su aplicación: componentes, rutas, estilos, actions. Durante el desarrollo local, esto funciona perfectamente porque el agente tiene acceso total al sistema de archivos.

En una implementación de producción estándar con [production code execution](#production-code-execution) excluido, el agente tiene acceso a las herramientas de la aplicación (actions, base de datos, MCP), pero no al sistema de archivos. Esto significa que el agente puede leer y escribir datos, ejecutar actions e interactuar con servicios externos, pero no puede editar los componentes de React ni agregar nuevas rutas en una instancia implementada.

### Builder.io: Edición visual en producción {#builderio}

[Builder.io](https://www.builder.io) resuelve este problema proporcionando un entorno de nube administrado donde el agente conserva la capacidad de modificar el UI de su aplicación en producción. Conecte su repositorio a Builder.io y solicite los cambios de UI directamente, sin necesidad de volver a implementarlo.

**Cómo funciona:**

1. Conecte su repositorio nativo del agente a Builder.io
2. Builder.io proporciona un marco en la nube con el agente, edición visual y colaboración en tiempo real
3. Solicite al agente que realice cambios UI: edita sus componentes, rutas y estilos en vivo
4. Los cambios se confirman en su repositorio

Consulte [Frames](/docs/frames) para obtener más información sobre el panel de agente integrado frente a las opciones del marco de nube.

## Implementaciones de instancias múltiples {#multi-instance}

Las aplicaciones nativas del agente almacenan todo el estado en SQL a través de Drizzle y sincronizan el UI a través de [polling](/docs/key-concepts#polling-sync) con la base de datos: sin estado del sistema de archivos, sin sesiones fijas, sin cachés en memoria. Eso significa que las implementaciones de múltiples instancias y sin servidor funcionan de inmediato: apunte cada instancia al mismo `DATABASE_URL` y convergerán automáticamente. Ver [Key Concepts — Data in SQL](/docs/key-concepts#data-in-sql) y [Portability](/docs/key-concepts#hosting-agnostic).
