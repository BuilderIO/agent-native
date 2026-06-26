---
title: "Conexiones del espacio de trabajo"
description: "Metadatos, subvenciones y referencias de credenciales de proveedores compartidos para integraciones de conexión única y uso en todas partes."
---

# Conexiones del espacio de trabajo

Las conexiones del espacio de trabajo son el marco primitivo para los metadatos de integración reutilizables. Hacen posible "conectarse una vez, otorgar aplicaciones, reutilizar credenciales" sin pretender que cada proveedor sea completamente genérico.

## Inicio rápido {#quickstart}

### Los cuatro conceptos

- **Conexión**: una cuenta de proveedor denominada (`team-slack`, `acme-hubspot`). Registra la identificación del proveedor, la etiqueta de la cuenta, el estado, los alcances y la configuración segura. Nunca almacena valores secretos.
- **Conceder**: permiso para que una aplicación específica utilice una conexión. Una aplicación sin una concesión no puede ver las credenciales de la conexión.
- **credentialRef**: un puntero a un secreto de almacén (`{ key: "SLACK_BOT_TOKEN", scope: "org" }`). La conexión dice dónde vive el token; la bóveda guarda el valor.
- **Preparación**: el estado combinado que ve una aplicación: `connected` (otorgado + credenciales presentes), `needs_grant`, `needs_credentials`, `needs_attention` o `not_configured`.

```an-diagram title="Conéctese una vez, otorgue aplicaciones, reutilice credenciales" summary="Una conexión contiene metadatos del proveedor (nunca secretos) y referencias de credenciales que apuntan a la bóveda. Las subvenciones por aplicación lo desbloquean. Las aplicaciones leen un único estado de preparación."
{
  "html": "<div class=\"diagram-conn\"><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill accent\">Connection</span><div class=\"diagram-box\" data-rough>named provider account<br><small class=\"diagram-muted\">provider, label, estado, permisos, configuración &middot; never stores secret values</small></div><div class=\"diagram-muted\">credentialRef &rarr; pointer to a vault secret</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill\">Grant</span><div class=\"diagram-box\" data-rough>per-app permission<br><small class=\"diagram-muted\">no grant = no credential access</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill ok\">Readiness</span><small class=\"diagram-muted\">what the app sees</small><div class=\"sev-row\"><span class=\"diagram-pill ok\">connected</span><span class=\"diagram-pill warn\">needs_grant</span></div><div class=\"sev-row\"><span class=\"diagram-pill warn\">needs_credentials</span><span class=\"diagram-pill warn\">needs_attention</span></div><div class=\"sev-row\"><span class=\"diagram-pill\">not_configured</span></div></div></div>",
  "css": ".diagram-conn{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-conn .col{display:flex;flex-direction:column;gap:8px;padding:14px;min-width:220px}.diagram-conn .diagram-arrow{font-size:22px;line-height:1}.diagram-conn .sev-row{display:flex;gap:8px;flex-wrap:wrap}"
}
```

### Ejemplo resuelto: Slack

Conecta Slack una vez y concédelo a Brain and Analytics:

```ts
import {
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";

await upsertWorkspaceConnection({
  id: "acme-slack",
  provider: "slack",
  label: "Acme Slack",
  accountId: "T012345",
  accountLabel: "Acme",
  status: "connected",
  scopes: ["channels:history", "groups:history", "chat:write"],
  config: {
    teamDomain: "acme",
    channelHints: ["product", "dev-fusion", "customer-success"],
  },
  credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
});

await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "analytics",
});
```

```an-schema title="El modelo de conexión" summary="A connection records safe provider metadata and credentialRefs (pointers, not secrets). Each grant unlocks one app — one connection, many grants."
{
  "entities": [
    {
      "id": "conn",
      "name": "workspace_connections",
      "note": "Cuenta de proveedor designada. Nunca almacena valores secretos.",
      "fields": [
        { "name": "id", "type": "string", "pk": true, "note": "e.g. acme-slack" },
        { "name": "provider", "type": "string", "note": "ID de proveedor estable, p. flojo" },
        { "name": "label", "type": "string" },
        { "name": "accountId", "type": "string", "nullable": true },
        { "name": "accountLabel", "type": "string", "nullable": true },
        { "name": "status", "type": "string", "note": "e.g. connected" },
        { "name": "scopes", "type": "string[]", "nullable": true },
        { "name": "config", "type": "json", "nullable": true, "note": "configuración segura y no secreta" },
        { "name": "credentialRefs", "type": "json", "nullable": true, "note": "pointers to vault keys, e.g. { key, scope }" }
      ]
    },
    {
      "id": "grant",
      "name": "workspace_connection_grants",
      "note": "Permiso por aplicación para usar una conexión.",
      "fields": [
        { "name": "connectionId", "type": "string", "fk": "conn.id" },
        { "name": "appId", "type": "string", "note": "p.ej. cerebro, analítica" }
      ]
    }
  ],
  "relations": [
    { "from": "conn", "to": "grant", "kind": "1-n", "label": "grants apps" }
  ]
}
```

### Cómo llaman las aplicaciones

Antes de pedirle a un usuario que pegue una nueva clave, verifique primero que esté lista:

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

const catalog = await listWorkspaceConnectionProviderCatalogForApp({
  appId: "brain",
  templateUse: "brain",
  provider: "slack",
  includeConnections: "all",
});

const slack = catalog.providers[0];
if (slack.workspaceConnection.grantState === "needs_grant") {
  // Show "Grant Brain access" instead of asking for a second Slack token.
}
if (slack.readiness.status === "needs_credentials") {
  // Show the missing credential ref names, never a secret value.
}
```

## Referencia {#reference}

### Catálogo de proveedores

Importar el catálogo de `@agent-native/core/connections`:

```ts
import {
  getWorkspaceConnectionProvider,
  listWorkspaceConnectionProvidersForTemplate,
  workspaceConnectionProviderSupports,
} from "@agent-native/core/connections";

const brainProviders = listWorkspaceConnectionProvidersForTemplate("brain");
const slack = getWorkspaceConnectionProvider("slack");

if (workspaceConnectionProviderSupports("slack", "messages")) {
  // Offer a Slack source, sync check, or onboarding step.
}
```

Los identificadores de proveedor iniciales son:

| Proveedor      | Capacidades                             | Usos comunes                                 |
| -------------- | --------------------------------------- | -------------------------------------------- |
| `slack`        | buscar, importar, mensajes              | cerebro, despacho, análisis                  |
| `github`       | buscar, importar, codificar, documentos | cerebro, análisis, despacho                  |
| `notion`       | buscar, importar, documentos            | cerebro, contenido, despacho                 |
| `gmail`        | buscar, importar, mensajes              | correo, cerebro, despacho                    |
| `google_drive` | buscar, importar, documentos            | cerebro, contenido, diapositivas             |
| `hubspot`      | buscar, importar, crm                   | análisis, cerebro, correo                    |
| `granola`      | buscar, importar, reuniones, documentos | cerebro, calendario, despacho                |
| `clips`        | buscar, importar, reuniones             | cerebro, clips, vídeos                       |
| `generic`      | buscar, importar, documentos            | webhooks personalizado y entrega de archivos |

Las claves de credenciales son solo nombres, como `SLACK_BOT_TOKEN` o `GITHUB_TOKEN`. Los metadatos del proveedor nunca deben incluir valores de credenciales reales.

### Tienda de conexión API

```ts
import {
  listWorkspaceConnectionProviderCatalogForApp,
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  summarizeWorkspaceConnectionProviderForApp,
  summarizeWorkspaceConnectionProviderReadiness,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  revokeWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";

const connections = await listWorkspaceConnections({ includeDisabled: true });
const grants = await listWorkspaceConnectionGrants({ appId: "brain" });

const appGrant = summarizeWorkspaceConnectionProviderForApp({
  providerId: "slack",
  appId: "brain",
  connections,
  grants,
});

const readiness = summarizeWorkspaceConnectionProviderReadiness({
  provider: slack!,
  appId: "brain",
  connections,
  grants,
});

const brainCatalog = await listWorkspaceConnectionProviderCatalogForApp({
  appId: "brain",
  templateUse: "brain",
});
```

La matriz `credentialRefs` apunta a las claves del almacén; no es almacenamiento de credenciales. Por ejemplo, `{ key: "SLACK_BOT_TOKEN", scope: "org" }` le dice a una aplicación autorizada que busque el secreto de la bóveda con ámbito de organización denominado `SLACK_BOT_TOKEN` cuando necesita llamar a Slack. Las referencias a nivel de conexión describen la cuenta del proveedor; Las referencias a nivel de concesión pueden limitar o anular lo que debe usar una aplicación específica.

Las filas de conexión tienen como ámbito la organización activa cuando hay una presente. Sin una organización, su ámbito es el usuario autenticado. Las filas de concesión utilizan el mismo ámbito.

**Campo `allowedApps` heredado:** `allowedApps: []` significa que todas las aplicaciones en el mismo ámbito pueden usar la conexión; `allowedApps: ["dispatch"]` otorga acceso a través del campo heredado. Utilice filas `workspace_connection_grants` explícitas para una nueva configuración: facilitan la revocación, la auditoría y la preparación por aplicación. `revokeWorkspaceConnectionGrant(connectionId, appId)` elimina una concesión explícita pero no cambia el `allowedApps` heredado.

Utilice `summarizeWorkspaceConnectionProviderForApp()` y `summarizeWorkspaceConnectionProviderReadiness()` para el estado de la aplicación en lugar de realizar comprobaciones de subvenciones manuales. Los resúmenes compartidos devuelven `grantState`, `grantAvailability`, nombres de referencia de credenciales seguras, filas de conexión por aplicación y campos de preparación como `readyConnectionCount` y `missingRequiredCredentialKeys`.

Para las pantallas de configuración de aplicaciones nuevas, prefiera `listWorkspaceConnectionProviderCatalogForApp()` como límite de nivel superior: combina el catálogo de proveedores, las conexiones con alcance, las concesiones explícitas, los resúmenes de acceso por aplicación y la preparación del proveedor en una sola forma segura.

### Cómo complementa esto la bóveda

La bóveda de credenciales responde: "¿Dónde se almacena el secreto, quién puede acceder a él y qué aplicaciones se lo otorgan?"

Los metadatos del proveedor de conexión del espacio de trabajo responden: "¿Qué proveedor es este, qué puede hacer, qué claves de credenciales podría necesitar y qué plantillas deberían ofrecerlo?"

```an-diagram title="Almacén de conexión versus bóveda" summary="La bóveda posee el valor secreto. La conexión posee los metadatos del proveedor más credentialRefs (punteros). En el momento de la ejecución, la aplicación resuelve la referencia a través de una conexión otorgada y lee el valor de la bóveda."
{
  "html": "<div class=\"diagram-vault\"><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill accent\">Almacén de conexiones</span><div class=\"diagram-box\" data-rough>provider account + metadata<br><small class=\"diagram-muted\">estado, permisos, configuración</small></div><div class=\"diagram-box\" data-rough>credentialRef<br><small class=\"diagram-muted\">{ key: SLACK_BOT_TOKEN, scope: org }</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Acción de app</span><small class=\"diagram-muted\">resolves at execution time through a granted ref</small><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill ok\">Vault</span><div class=\"diagram-box\" data-rough>secret value<br><small class=\"diagram-muted\">nunca se devuelve al agente ni a la UI</small></div></div></div>",
  "css": ".diagram-vault{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-vault .col{display:flex;flex-direction:column;gap:8px;padding:14px;min-width:220px}.diagram-vault .diagram-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px}.diagram-vault .diagram-arrow{font-size:22px;line-height:1}"
}
```

Usar ambos juntos:

1. El envío (u otro flujo de configuración del espacio de trabajo) crea el secreto de la bóveda subyacente o la referencia de credencial OAuth.
2. El almacén de conexiones del espacio de trabajo registra la cuenta del proveedor, los metadatos seguros, las referencias de credenciales y las concesiones de aplicaciones.
3. Cada aplicación lee los metadatos del proveedor del catálogo y los resúmenes de conexión/concesión del almacén compartido.
4. La aplicación UI muestra que está lista: conectada, otorgada pero en mal estado, necesita concesión, faltan credenciales o solo metadatos.
5. SQL específico de la aplicación almacena solo identificadores de fuente, cursores, filtros, ventanas de sincronización, definiciones de métricas, reglas de revisión y opciones de usuario específicas de la aplicación.
6. La aplicación actions resuelve las credenciales en el momento de la ejecución a través de referencias de conexión otorgadas y la bóveda, y nunca devuelve valores secretos.

### Tiempo de ejecución del lector del proveedor

La capa proveedor-lector es primero un contrato, no una promesa de que cada proveedor tenga un lector en vivo compartido. Las definiciones del lector describen las operaciones admitidas, los requisitos de credenciales y el estado de implementación: `metadata-only`, `template-owned` o `shared`. El tiempo de ejecución resuelve la conexión del espacio de trabajo otorgado y las referencias de credenciales para una aplicación, llama a un controlador registrado y devuelve elementos normalizados sin exponer valores secretos.

La mayoría de los controladores en vivo siguen siendo propiedad de las plantillas en la actualidad, lo que significa que Brain todavía posee el comportamiento de ingesta de Slack/GitHub y Analytics aún posee la interpretación analítica. Promocione a un lector a `shared` solo cuando las llamadas, la paginación, los permisos y la semántica de resultados de API específicos del proveedor sean realmente reutilizables en todas las plantillas.

### Patrón de preparación de la aplicación

Las aplicaciones que consumen credenciales de proveedores compartidas deben exponer una acción de preparación de solo lectura y una pequeña superficie de configuración que cubra:

- **Catálogo de proveedores:** ID de proveedor, etiqueta, capacidades, usos de plantilla recomendados y nombres de claves de credenciales requeridas de `@agent-native/core/connections`.
- **Resumen del espacio de trabajo:** recuento de conexiones, recuentos activos/concedidos, estado de concesión, nombres de referencia de credenciales y etiquetas de cuentas no secretas de `@agent-native/core/workspace-connections`.
- **Preparación del proveedor:** `ready`, `needs_credentials`, `needs_attention`, `checking`, `disabled` o `not_configured` a través de `summarizeWorkspaceConnectionProviderReadiness()`.
- **Estado de la fuente:** fuentes configuradas locales de la aplicación, cursores, estado de sincronización y siguiente acción.

La página Fuentes de Brain es la implementación de referencia. Muestra proveedores de conexión de espacio de trabajo reutilizables junto a los registros de origen de Brain, etiqueta los estados de concesión como `connected`, `granted`, `needs_grant` o `not_connected` y muestra el estado del proveedor como listo, claves faltantes, concesión necesaria, necesita reparación o solo metadatos.

### Construyendo un conector reutilizable

Cuándo un nuevo proveedor debería funcionar en varias plantillas:

1. **Metadatos del proveedor:** agregue o reutilice un proveedor en `@agent-native/core/connections`. Esta es la identificación estable, la etiqueta para mostrar, la lista de capacidades, los usos recomendados de la plantilla y los nombres de las claves de credenciales.
2. **Conexión del espacio de trabajo:** Dispatch u otra superficie de configuración del espacio de trabajo almacena los metadatos seguros, el estado, los alcances, `credentialRefs` y las concesiones de aplicaciones de la cuenta conectada a través de `@agent-native/core/workspace-connections`.
3. **Fuente local de la aplicación:** Brain, Analytics, Mail u otra aplicación almacena solo las opciones específicas de la aplicación que posee, como canales Slack, repositorios GitHub, filtros de objetos HubSpot, cursores de sincronización o cadencia de sondeo.

No duplique OAuth/almacenamiento de tokens en cada aplicación. El registro de conexión dice "este es Acme Slack y su token se encuentra en `SLACK_BOT_TOKEN`"; la fuente local de la aplicación dice "Brain puede ingerir `#product` y `#dev-fusion` de esa conexión Slack".

### Configuración del plano de control de despacho

Dispatch expone el plano de control actions que escribe las mismas funciones de tienda compartida que una aplicación podría llamar directamente:

```ts
// templates/dispatch/actions/upsert-workspace-connection.ts delegates to this.
await upsertWorkspaceConnection({
  id: "team-slack",
  provider: "slack",
  label: "Acme Slack",
  accountId: "T012345",
  accountLabel: "acme",
  status: "connected",
  scopes: ["channels:history", "groups:history"],
  config: { teamDomain: "acme", preferredChannels: ["product", "dev-fusion"] },
  credentialRefs: [
    {
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      provider: "slack",
      label: "Slack bot token",
    },
  ],
});

// Then grant the apps that should reuse the provider.
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "analytics",
});
```

Utilice `allowedApps: []` solo cuando una conexión deba estar disponible para todas las aplicaciones en el mismo ámbito. Prefiere filas de concesión explícitas para la configuración de producción.

### Resolución de credenciales

El código de ejecución de la aplicación resuelve los valores de credenciales de `credentialRefs` concedido a través del almacén en el alcance de la solicitud activa. `source-credentials.ts` de Brain es la implementación de referencia actual: enumera las conexiones del espacio de trabajo para el proveedor, verifica `getWorkspaceConnectionAppAccess` para `appId: "brain"`, fusiona referencias de credenciales de nivel de conexión y de nivel de concesión, y lee el primer secreto de bóveda con alcance coincidente. Otras aplicaciones deberían seguir esa forma en lugar de buscar `process.env`.

## Notas de diseño {#design-notes}

<details>
<summary>Política de promoción de lectores y ruta para "conectarse una vez, utilizar en todas partes"</summary>

### Límite local de la aplicación

El límite entre las conexiones compartidas y las fuentes locales de la aplicación es intencional. Lo que hoy es reutilizable es la identidad del proveedor, la resolución de referencia de credenciales, las concesiones por aplicación, la preparación del proveedor, los metadatos de cuenta seguros y el contrato normalizado entre proveedor y lector. Lo que aún no es genérico es la lectura más activa del proveedor API, la propiedad del flujo OAuth, los cursores de ingesta, los filtros de origen, la cadencia de sincronización y la interpretación del dominio. Estos permanecen en la aplicación propietaria del flujo de trabajo a menos que una implementación de lector se promueva explícitamente como compartida.

Los conectores de origen de aplicaciones no deben leer variables de entorno de nivel de implementación como respaldo para las credenciales de origen de usuario/organización. Las variables de entorno son globales para la implementación y no expresan concesiones de espacio de trabajo.

Los agentes deben seguir una regla simple: si un usuario solicita conectarse a Slack, GitHub, HubSpot, Gmail, Google Drive, Granola u otro proveedor compartido, primero inspeccione el catálogo de conexiones del espacio de trabajo. Si el proveedor es `connected`, úselo. Si es `needs_grant`, solicite o realice la concesión de la aplicación. Si es `needs_credentials`, solicite la clave de la bóveda que falta. Sólo solicite una nueva clave sin formato cuando no exista una conexión reutilizable.

### Ruta para "conectarse una vez y utilizar en todas partes"

El catálogo de proveedores y el almacén de subvenciones son la base de una capa de espacio de trabajo más amplia:

- Los identificadores de proveedores compartidos y los nombres de capacidades mantienen las plantillas alineadas.
- El inventario a nivel de espacio de trabajo puede mostrar qué proveedores están configurados en Brain, Mail, Analytics, Dispatch y aplicaciones futuras.
- Las filas de conexión registran etiquetas de cuenta, estado, aplicaciones permitidas, referencias de credenciales y comprobaciones de estado sin cambiar los ID de proveedor de la plantilla.
- Las filas de concesión permiten que el propietario de un espacio de trabajo se conecte una vez y luego habilitan aplicaciones individuales a medida que el espacio de trabajo las adopta.
- Los agentes pueden dirigir el trabajo entre aplicaciones sabiendo qué proveedores ya están conectados y qué aplicaciones tienen concesiones.
- La búsqueda federada puede solicitar proveedores con capacidades `search`, `docs`, `messages`, `meetings`, `crm` o `code` en lugar de codificar la lista de conectores de cada aplicación.
- Los lectores específicos del proveedor, los flujos de actualización OAuth, los puntos de control de ingesta y los modelos de datos propiedad de las aplicaciones se pueden compartir más adelante, pero no están implicados en una conexión de espacio de trabajo actual.

Mantenga los límites estrictos: es seguro mostrar los metadatos del proveedor; los valores de credenciales permanecen en la bóveda.

</details>
