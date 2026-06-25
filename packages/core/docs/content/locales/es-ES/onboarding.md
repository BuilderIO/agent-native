---
title: "Incorporación y claves API"
description: "Lista de verificación de instalación para la configuración de primera ejecución: claves API, OAuth y conexiones de proveedores"
---

# Incorporación

Cuando abras por primera vez una aplicación creada en el marco nativo del agente, verás un
Lista de verificación de **Configuración** en la barra lateral del agente. Mantiene cerrada la configuración de primera ejecución
al chat del agente: conecte un motor de IA, opcionalmente apunte la aplicación a compartido
infraestructura y agregue proveedores solo cuando los necesite.

```an-diagram title="La lista de verificación de configuración" summary="Solo se requiere conectar un motor de IA. El panel realiza un seguimiento de la finalización y se oculta automáticamente una vez que se hace todo lo necesario."
{
  "html": "<div class=\"ob\"><div class=\"diagram-card\"><span class=\"diagram-pill warn\">required</span><strong>Conectar un motor de IA</strong><small class=\"diagram-muted\">Connect Builder (one click) or paste an LLM key</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Database</strong><small class=\"diagram-muted\">set <code>DATABASE_URL</code></small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Authentication</strong><small class=\"diagram-muted\">OAuth / access token</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Entrega de correo</strong><small class=\"diagram-muted\">Resend / SendGrid</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">all required done &rarr; panel auto-hides</div></div>",
  "css": ".ob{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ob .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 14px}.ob .diagram-arrow{font-size:22px}"
}
```

## Para usuarios finales

### Lo que verás

- Un panel de **Configuración** encima del chat del agente con una lista de verificación como "Conectar una IA
  motor", "Entrega de correo electrónico", etc.
- Un contador en la parte superior (por ejemplo, "1 de 4") muestra cuántos pasos están listos.
- El paso actual se expande; los pasos terminados muestran una marca verde y permanecen
  legibles si los abres.
- Los pasos requeridos muestran una pequeña pastilla roja **obligatoria**. El panel permanece visible
  hasta completar cada paso requerido.
- Una vez hecho todo lo necesario, el panel se oculta automáticamente.
- Todo el panel se puede contraer con el galón en la parte superior derecha, o
  oculto por completo con **Ocultar configuración** en la parte inferior.

### Cómo completar cada paso

Los pasos ofrecen uno o más **métodos**: diferentes formas de satisfacer lo mismo
requisito. La ruta principal se muestra primero; los caminos secundarios se mantienen compactos
detrás de un selector o divulgación cuando un paso tiene varios proveedores equivalentes.

- **Conectar un servicio (un clic)** — p.e. _Connect Builder_ para lo administrado
  Puerta de entrada de IA. Haga clic en el botón, se abre una ventana, inicia sesión, la ventana se cierra
  y el paso se marca como completo. No hay claves para copiar.
- **Pegue una clave API o complete un formulario**, p. elija un proveedor LLM, base de datos,
  Proveedor OAuth o proveedor de correo electrónico, pegue los valores y haga clic en **Guardar**.
  Los campos secretos utilizan una entrada de contraseña para que el valor no se muestre en la pantalla. Guardado
  Los valores van a su `.env` local (o configuración del espacio de trabajo) — consulte
  [Security](/docs/security) para saber dónde viven.
- **Abrir un vínculo**: algunos pasos apuntan a una página de inicio de sesión o a documentos. Haga clic
  **Continuar** y finalizar el flujo en la nueva pestaña.
- **Pregúntele al agente**: algunos pasos ofrecen la opción "Dejar que el agente lo configure".
  Haz clic en él y el agente contestará en el chat y te guiará por cualquier
  configuración externa (creación de credenciales OAuth, etc.).

### Los pasos integrados que normalmente verás

- **Conectar un motor de IA** (obligatorio): el único paso obligatorio. Conectar
  Builder para una puerta de enlace administrada con un solo clic o abra la clave del proveedor secundario
  selector y pega tu propia clave LLM.
- **Base de datos** (opcional): configura `DATABASE_URL` cuando quieras usar una base de datos específica
  Cadena de conexión a la base de datos SQL.
- **Autenticación** (opcional): las cuentas de correo electrónico/contraseña integradas funcionan mediante
  predeterminado. Agregue OAuth o inicie sesión con token de acceso solo cuando desee esas rutas.
- **Entrega de correo electrónico** (opcional): útil antes de la implementación para restablecer contraseñas,
  invitaciones a equipos y notificaciones para compartir. Utilice el proveedor que ya utiliza;
  El desarrollo local puede funcionar sin él.

Las plantillas pueden agregar sus propios pasos además de estos, p. una plantilla CRM podría
agregue "Conectar Gmail", una plantilla de documentos podría agregar "Elija un espacio de trabajo predeterminado". Ver
[Authentication](/docs/authentication) para obtener detalles de configuración de inicio de sesión.

### Volviendo a la lista de verificación

Si presionas **Ocultar configuración**, el panel desaparece para esa sesión del navegador.
Los pasos obligatorios que aún no se han completado aparecerán nuevamente en la próxima carga. Una vez
Todo lo necesario está hecho, el panel se oculta automáticamente para siempre, no hay nada
Queda por hacer.

## Para desarrolladores

Si estás creando una plantilla, registra los pasos de incorporación para que aparezcan en
la lista de verificación de la barra lateral del usuario. El marco maneja el renderizado y la finalización
seguimiento y despido: simplemente declara cuál es el paso y cómo es
satisfecho.

El sistema se **monta automáticamente**. Las plantillas no necesitan conectar nada para obtener
los cuatro pasos integrados (LLM, base de datos, autenticación, correo electrónico). Para agregar aplicaciones específicas
pasos (Gmail, Slack, Notion, etc.), llame a `registerOnboardingStep()` desde un
complemento de servidor.

### Rutas montadas automáticamente

Todas las rutas se encuentran bajo `/_agent-native/onboarding/`:

| Ruta                                                | Propósito                                 |
| --------------------------------------------------- | ----------------------------------------- |
| `GET /_agent-native/onboarding/steps`               | Enumerar pasos con estado de finalización |
| `POST /_agent-native/onboarding/steps/:id/complete` | Marcar paso como completo (anular)        |
| `POST /_agent-native/onboarding/dismiss`            | Cerrar el banner de incorporación         |
| `POST /_agent-native/onboarding/reopen`             | Despido claro (volver a mostrar panel)    |
| `GET /_agent-native/onboarding/dismissed`           | Leer despido + bandera completa           |

```an-api title="Enumerar los pasos de incorporación"
{
  "method": "GET",
  "path": "/_agent-native/onboarding/steps",
  "summary": "Enumere todos los pasos registrados con su estado de finalización",
  "description": "Drives the sidebar checklist — returns each step's id, title, methods, required flag, and whether `isComplete` currently passes.",
  "responses": [
    { "status": "200", "description": "Array of steps with completion status for the current user/app." }
  ]
}
```

### Agregar un paso desde una plantilla

```an-annotated-code title="Registrar un paso de incorporación personalizado"
{
  "filename": "server/plugins/my-onboarding.ts",
  "language": "ts",
  "code": "import { defineNitroPlugin } from \"@agent-native/core/server\";\nimport { registerOnboardingStep } from \"@agent-native/core/onboarding\";\nimport { listOAuthAccounts } from \"@agent-native/core/oauth-tokens\";\n\nexport default defineNitroPlugin(() => {\n  registerOnboardingStep({\n    id: \"gmail\",\n    order: 100,\n    title: \"Connect Gmail\",\n    description: \"Grant read/send access so the agent can work with email.\",\n    methods: [\n      {\n        id: \"oauth\",\n        kind: \"link\",\n        primary: true,\n        label: \"Sign in with Google\",\n        payload: { url: \"/_agent-native/google/auth-url?scope=mail\", external: false },\n      },\n      {\n        id: \"delegate\",\n        kind: \"agent-task\",\n        label: \"Let the agent set it up\",\n        badge: \"beta\",\n        payload: { prompt: \"Walk me through connecting Gmail. Set env vars as needed.\" },\n      },\n    ],\n    isComplete: async () => {\n      const accounts = await listOAuthAccounts(\"google\");\n      return accounts.length > 0;\n    },\n  });\n});",
  "annotations": [
    { "lines": "5", "label": "Montado automáticamente", "note": "Regístrese desde un plugin Nitro: el marco maneja la renderización, el seguimiento de finalización y el descarte." },
    { "lines": "7", "label": "Identificación estable", "note": "Volver a registrarse con el mismo `id` después de la carga predeterminada anula un paso integrado." },
    { "lines": "12-19", "label": "método primario", "note": "`primary: true` marks the big CTA. `kind: \"link\"` sends the user into the OAuth flow." },
    { "lines": "20-26", "label": "Ruta del delegado", "note": "`kind: \"agent-task\"` hands the setup to the agent chat with a prompt." },
    { "lines": "28-31", "label": "Verificación de finalización", "note": "`isComplete` se ejecuta en el lado del servidor. Los tokens OAuth se encuentran en la tienda `oauth_tokens`; compruébalo, no en `process.env.GMAIL_REFRESH_TOKEN`." }
  ]
}
```

### Comprobación de las conexiones del espacio de trabajo en la incorporación

Al crear plantillas que interactúan con servicios externos (como Slack, Google Workspace, GitHub o HubSpot), debe verificar si el espacio de trabajo ya se ha conectado y ha otorgado la conexión de ese proveedor a su aplicación. Esto evita que los usuarios tengan que duplicar credenciales (como claves API o tokens de actualización) en sus variables de entorno local cuando existe una conexión central administrada.

Puedes verificar la preparación de la conexión en tu devolución de llamada `isComplete` usando el catálogo de conexiones APIs:

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

// Inside registerOnboardingStep:
isComplete: async () => {
  // Check if a managed workspace connection exists and is ready
  const catalog = await listWorkspaceConnectionProviderCatalogForApp({
    appId: "mail",
    templateUse: "mail",
    provider: "gmail",
  });
  const connection = catalog.providers[0];

  if (
    connection?.readiness.status === "ready" &&
    connection.workspaceConnection.grantState === "granted"
  ) {
    return true;
  }

  // Fall back to local environment variable check
  return !!process.env.GMAIL_REFRESH_TOKEN;
};
```

Consulte la documentación de [Workspace Connections](/docs/workspace-connections) para obtener la lista completa de métodos del catálogo de proveedores de conexión.

### Tipos de métodos

| Amable             | Carga útil                                            | Usar para                                               |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------- |
| `link`             | `{ url, external? }`                                  | Enviar usuario a una página de documentos o flujo OAuth |
| `form`             | `{ fields, writeScope? }`                             | Recopilar variables de entorno (claves, secretos, URL)  |
| `builder-cli-auth` | `{ scope: "llm" \| "browser" \| "image-generation" }` | Connect Builder (unlocks shared infra)                  |
| `agent-task`       | `{ prompt }`                                          | Enviar un mensaje al chat del agente para manejar       |

La bandera `primary: true` marca un método como el gran CTA para su paso.
Utilice `badge: "soon"` más `disabled: true` cuando una ruta de configuración deba ser visible
antes de que esté disponible.

### Escaleras integradas

| Identificación | Obligatorio | Descripción                                                 |
| -------------- | ----------- | ----------------------------------------------------------- |
| `llm`          | sí          | Conexión Builder o clave de proveedor LLM                   |
| `database`     | no          | Base de datos predeterminada o cualquier SQL `DATABASE_URL` |
| `auth`         | no          | Cuentas integradas, OAuth opcional o token de acceso        |
| `email`        | no          | Reenviar o SendGrid para correo electrónico transaccional   |

Cualquiera de estos puede anularse volviendo a registrarse con el mismo `id` después del
carga predeterminada.

### Uso del cliente

El panel ya está dentro de `<AgentPanel>`. Para crear un diseño personalizado:

```tsx
import {
  OnboardingPanel,
  OnboardingBanner,
  useOnboarding,
} from "@agent-native/core/client/onboarding";

function MySidebar() {
  const { allComplete, dismissed, currentStepId } = useOnboarding();
  if (allComplete || dismissed) return <Chat />;
  return (
    <>
      <OnboardingPanel />
      <Chat />
    </>
  );
}
```

Para obtener información sobre dónde se almacenan los valores de los pasos y cómo se manejan los secretos,
ver [Security](/docs/security). Para puntos de contacto de mensajería del usuario final (invitaciones,
restablecimiento de contraseña) que dependen del paso **Entrega de correo electrónico**, consulte
[Messaging](/docs/messaging).
