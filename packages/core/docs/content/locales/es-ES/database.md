---
title: "Base de datos"
description: "Conecte una base de datos SQL portátil a su aplicación nativa del agente y escriba código Drizzle independiente del proveedor."
---

# Base de datos

Las aplicaciones nativas del agente utilizan [Drizzle ORM](https://orm.drizzle.team) y admiten backends portátiles SQL. Para cualquier cosa más allá del desarrollo local, conecte una base de datos persistente SQL (Postgres, libSQL/Turso u otro backend compatible con Drizzle) configurando `DATABASE_URL`. Cuando esa variable no está configurada, la aplicación recurre a un archivo SQLite local de configuración cero para que pueda comenzar a desarrollar de inmediato.

```an-diagram title="Un esquema, muchos backends" summary="El código de la aplicación utiliza los ayudantes independientes del dialecto del marco. El dialecto se detecta automáticamente desde DATABASE_URL en tiempo de ejecución; unset significa un archivo SQLite local."
{
  "html": "<div class=\"diagram-db\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">@agent-native/core/db/schema</span><small class=\"diagram-muted\">table · text · integer · real · now</small><small class=\"diagram-muted\">+ Drizzle query DSL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>DATABASE_URL<br><small class=\"diagram-muted\">dialect auto-detected</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Postgres<br><small class=\"diagram-muted\">Neon · Supabase</small></span><span class=\"diagram-pill\">libSQL / Turso</span><span class=\"diagram-pill\">Cloudflare D1</span><span class=\"diagram-pill warn\">SQLite file<br><small class=\"diagram-muted\">unset = local dev only</small></span></div></div>",
  "css": ".diagram-db{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-db .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-db .diagram-arrow{font-size:22px;line-height:1}.diagram-db .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

## Valor predeterminado local: archivo SQLite {#default-sqlite}

Cuando `DATABASE_URL` no está configurado, la aplicación crea una base de datos SQLite en `data/app.db`. Este es el valor predeterminado de configuración cero para el desarrollo local: no se requiere configuración. Está destinado únicamente al desarrollo; para producción, configure `DATABASE_URL` en una base de datos persistente SQL.

No confíe en ese archivo local para las aplicaciones implementadas. Los contenedores, las funciones sin servidor y los entornos de vista previa pueden restablecer su sistema de archivos, lo que significa que un archivo SQLite local puede desaparecer entre reinicios. Configure `DATABASE_URL` en una base de datos alojada persistente antes de su uso en producción.

## Conectar una base de datos de producción {#production}

Configure `DATABASE_URL` en su archivo `.env` o entorno de proveedor de implementación para conectar una base de datos alojada. No se requiere Turso; utilice cualquier backend SQL compatible con Drizzle que se ajuste a su implementación:

```bash
# Neon Postgres
DATABASE_URL=postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb?sslmode=require

# Supabase Postgres
DATABASE_URL=postgres://postgres.xxxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Postgres simple
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# Turso (libSQL)
DATABASE_URL=libsql://my-db-org.turso.io
DATABASE_AUTH_TOKEN=your-token
```

El marco detecta automáticamente el dialecto del URL y configura el Drizzle en consecuencia. Los adaptadores integrados cubren Postgres URL, libSQL/Turso URL, SQLite file URL y enlaces Cloudflare D1. Las opciones de producción comunes incluyen entornos administrados Neon, Supabase, Turso/libSQL, Postgres simple, SQLite duradero y Builder.io cuando estén disponibles.

## Base de datos administrada Builder.io {#builder-managed}

_Planificado (aún no disponible):_ cuando esté conectado a Builder.io, su aplicación podrá utilizar una base de datos administrada y aprovisionada automáticamente, sin necesidad de cadenas de conexión.

## Dónde vive el cliente DB {#db-client}

Cada plantilla crea un cliente Drizzle único y diferido llamando a `createGetDb(schema)` desde `@agent-native/core/db`. La ubicación canónica es `server/db/index.ts`:

```ts
// server/db/index.ts
import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
```

Importe `getDb` desde esta ruta local de plantilla (`../../server/db/index.js` en rutas, `../server/db/index.js` en actions) en lugar de hacerlo directamente desde `@agent-native/core`. La exportación principal devuelve una instancia genérica sin tipo; El `getDb()` de la plantilla lleva sus tipos de esquema. Consulte [Server](/docs/server#request-context) para saber cómo lo importan actions y las rutas personalizadas.

## Esquemas y consultas independientes del dialecto {#schema}

El código de la base de datos de la aplicación debe usar el esquema de Drizzle y consultar DSL para que pueda ejecutarse en todos los proveedores. Nunca escriba la sintaxis exclusiva de SQLite (`INSERT OR REPLACE`, `AUTOINCREMENT`, `datetime('now')`) o la sintaxis exclusiva de Postgres en el código de producto.

Utilice los ayudantes de esquema del marco de `@agent-native/core/db/schema`:

```ts
import { table, text, integer, real, now } from "@agent-native/core/db/schema";

export const tasks = table("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  priority: integer("priority").notNull().default(0),
  weight: real("weight"),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});
```

| Ayudante  | Propósito                                                                |
| --------- | ------------------------------------------------------------------------ |
| `table`   | Definir una tabla: delega en `pgTable` o `sqliteTable`                   |
| `text`    | Columna de texto, compatible con `{ enum: [...] }`                       |
| `integer` | Columna entera, `{ mode: "boolean" }` se asigna al booleano Postgres     |
| `real`    | Columna flotante: `real` en SQLite, `double precision` en Postgres       |
| `now`     | Marca de tiempo actual independiente del dialecto para `.default(now())` |

La tabla `tasks` anterior define las mismas columnas en cada backend:

```an-schema title="la tabla de tareas" summary="Definida una sola vez con los helpers del framework; el dialecto se elige en tiempo de ejecución a partir de DATABASE_URL."
{
  "entities": [
    {
      "id": "tasks",
      "name": "tasks",
      "note": "Domain table. Add owner_email (or ...ownableColumns()) so SQL-level scoping can filter rows to the authenticated user.",
      "fields": [
        { "name": "id", "type": "text", "pk": true, "nullable": false },
        { "name": "title", "type": "text", "nullable": false },
        { "name": "priority", "type": "integer", "nullable": false, "note": "default 0" },
        { "name": "weight", "type": "real", "nullable": true },
        { "name": "done", "type": "integer (boolean mode)", "nullable": false, "note": "default false; maps to a Postgres boolean" },
        { "name": "owner_email", "type": "text", "nullable": false, "note": "enables data scoping" },
        { "name": "created_at", "type": "text", "nullable": false, "note": "default now()" }
      ]
    }
  ]
}
```

Nunca importe desde `drizzle-orm/sqlite-core` o `drizzle-orm/pg-core` directamente. Utilice siempre `@agent-native/core/db/schema`.

Las tablas que almacenan datos de cara al usuario deben incluir una columna `owner_email` para que el alcance del nivel SQL del marco pueda filtrar filas para el usuario autenticado; consulte [Security](/docs/security#data-scoping). Las tablas que también admiten el uso compartido con otros usuarios u organizaciones deberían difundir `...ownableColumns()`, lo que agrega `owner_email`, `org_id` y `visibility` en una sola llamada; consulte [Sharing](/docs/sharing#building).

Para lecturas y escrituras, utilice el generador de consultas de Drizzle y los operadores portátiles de `drizzle-orm`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../server/db/index.js";
import { tasks } from "../server/db/schema.js";

const db = getDb();

const openTasks = await db
  .select()
  .from(tasks)
  .where(and(eq(tasks.ownerEmail, userEmail), eq(tasks.done, false)))
  .orderBy(desc(tasks.createdAt));

await db.update(tasks).set({ done: true }).where(eq(tasks.id, taskId));
```

## Trampillas de escape SQL sin procesar {#raw-sql}

Raw SQL no es el código de aplicación predeterminado API. Úselo solo para migraciones aditivas, controles de estado, consultas avanzadas cuidadosamente revisadas que Drizzle no puede expresar o mantenimiento único. Manténgalo parametrizado e independiente del dialecto. Para marcas de tiempo en esquemas Drizzle, prefiera `.default(now())`; para la migración SQL, use `runMigrations()` para que las reescrituras de compatibilidad compatibles con el marco y las declaraciones controladas por dialecto permanezcan centralizadas.

Para los casos en los que realmente necesita SQL sin formato fuera de las consultas Drizzle:

- `getDbExec()`: convierte automáticamente los parámetros de `?` a `$1` para Postgres
- `isPostgres()`: comprobación del dialecto en tiempo de ejecución
- `intType()`: devuelve el tipo entero correcto para el dialecto actual

## Migraciones y actualizaciones de esquemas {#migrations}

En entornos alojados, varias vistas previas de implementación, sucursales y el servidor de producción comparten la misma base de datos subyacente. Por lo tanto, las actualizaciones del esquema de la base de datos deben seguir restricciones estrictas para evitar la pérdida de datos y la interrupción del servicio.

### La regla de "Cero cambios destructivos"

Todas las actualizaciones del esquema de la base de datos deben ser **estrictamente aditivas**.

- **No elimine tablas ni columnas.**
- **No cambie el nombre de tablas o columnas.** Cambiar el nombre de una columna o tabla parece una secuencia de soltar + crear a Drizzle, que eliminará permanentemente sus datos de producción existentes.
- Si es necesario cambiar el nombre o reemplazar una columna, agregue la nueva columna junto con la anterior, actualice el código de su aplicación para leer y escribir en ambas, migre los datos y retire la columna anterior solo en una versión posterior una vez que no haya implementaciones activas que hagan referencia a ella.

> [!WARNING]
> **Nunca ejecute `drizzle-kit push` en una base de datos de producción.**
> Los esquemas de bases de datos de plantilla solo definen tablas de dominio específicas de la aplicación; no definen tablas marco centrales (`user`, `session`, `application_state`, etc.). Si ejecuta `drizzle-kit push` en producción, Drizzle detectará estas tablas de marco como "no en el esquema" e intentará eliminarlas, lo que provocará una falla inmediata en todo el sistema y pérdida de datos.

### Ruta de migración segura

En lugar de enviarlos directamente, los cambios de esquema deben aplicarse mediante migraciones SQL ejecutadas al inicio de la aplicación. Implemente migraciones aditivas dentro de un complemento de servidor (por ejemplo, `server/plugins/db.ts`) invocando el asistente `runMigrations()` del marco:

```an-annotated-code title="Un complemento de migración aditiva"
{
  "filename": "server/plugins/db.ts",
  "language": "ts",
  "code": "import { runMigrations } from \"@agent-native/core/db\";\n\nexport default runMigrations(\n  [\n    {\n      version: 1,\n      sql: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,\n    },\n    {\n      // Dialect-gated: runs only on the matching backend. Omit the other key\n      // to make it a no-op on that dialect.\n      version: 2,\n      sql: {\n        postgres: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS tsv tsvector`,\n        sqlite: `SELECT 1`, // no-op; tsvector is Postgres-only\n      },\n    },\n  ],\n  { table: \"my_app_migrations\" },\n);",
  "annotations": [
    { "lines": "6-7", "label": "Sólo aditivo", "note": "Es seguro volver a ejecutar `ADD COLUMN IF NOT EXISTS` y nunca pierde datos. Los cambios de nombre se ven como soltar+crear a Drizzle, así que agregue y luego migre." },
    { "lines": "13-16", "label": "Puerta de dialecto", "note": "Pase un objeto indexado por dialecto para ejecutar SQL diferente por backend. Haga que la otra clave sea un no-op (`SELECT 1`) para funciones exclusivas de Postgres o de SQLite." },
    { "lines": "19", "label": "Tabla de versiones por aplicación", "note": "Cada aplicación rastrea sus propias versiones aplicadas, por lo que las migraciones son idempotentes entre reinicios e instancias." }
  ]
}
```

## Variables de entorno {#environment-variables}

| Variable              | Propósito                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Cadena de conexión SQL persistente (no configurada = SQLite local, que solo es duradera para el desarrollo local) |
| `DATABASE_AUTH_TOKEN` | Token de autenticación para proveedores que requieren un token separado, como Turso/libSQL                        |
