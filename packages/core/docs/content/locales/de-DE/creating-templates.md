---
title: "Vorlagen erstellen"
description: "So erstellen und veröffentlichen Sie Ihre eigenen agentennativen App-Vorlagen."
---

# Vorlagen erstellen

Vorlagen sind vollständige, forkbare agentennative Apps, die einen echten Arbeitsablauf lösen. Die Erstanbieter-Vorlagen werden mit derselben Framework-Oberfläche erstellt, die Sie verwenden: React-Routen für UI, Drizzle SQL für Daten, actions für Vorgänge, Arbeitsbereichsressourcen für Agentenverhalten und Abfragesynchronisierung, damit der Agent und UI aufeinander abgestimmt bleiben.

Eine gute Vorlage:

- Löst einen Workflow durchgängig, mit nützlichen Seed-Daten oder einem Leerzustandsfluss.
- Speichert den dauerhaften Zustand in SQL-Dateien, nicht in JSON-Dateien.
- Definiert App-Vorgänge als `defineAction()` actions.
- Macht Navigation und Auswahl durch den Anwendungsstatus möglich.
- Liefert ein klares `AGENTS.md` und ein fokussiertes skills für nicht offensichtliche Arbeitsabläufe.
- Registriert Onboarding-Schritte für erforderliche Anbieter und Geheimnisse.
- Funktioniert als eigenständige App und als Teil eines Multi-App-Arbeitsbereichs.

## Im Chat starten {#start-from-chat}

Verwenden Sie die Chat-Vorlage, wenn Sie eine minimale App mit bereits vorhandener Framework-Verkabelung wünschen:

```bash
npx @agent-native/core@latest create my-template --template chat --standalone
```

Führen Sie für einen Arbeitsbereich mit mehreren Apps die Auswahl aus und schließen Sie Chat mit allen gewünschten Domänenvorlagen ein:

```bash
npx @agent-native/core@latest create my-platform
```

Chat bietet Ihnen Authentifizierung, dauerhafte Chat-Threads, von SQL unterstützte Ressourcen, Tools, Anwendungsstatus, actions und Abfragesynchronisierung. Sie fügen das Domänenmodell und das Produkt UI hinzu.

Wenn Sie noch keine wiederverwendbare UI-Vorlage erstellen, verwenden Sie die kopflose Auffahrt in [Getting Started](/docs/getting-started#1-create-your-app): Definieren Sie eine Aktion, führen Sie sie mit `pnpm agent` aus und fügen Sie UI später hinzu, wenn der Workflow eine dauerhafte Oberfläche benötigt.

## Projektstruktur {#project-structure}

Jede Vorlage folgt dem gleichen allgemeinen Layout:

```an-file-tree title="Projektstruktur des Templates"
{
  "title": "my-template/",
  "entries": [
    { "path": "app/", "note": "React-Frontend" },
    { "path": "app/root.tsx", "note": "HTML-Shell und Provider" },
    { "path": "app/routes/", "note": "React-Router-Dateirouten" },
    { "path": "app/components/", "note": "Template-UI" },
    { "path": "app/hooks/", "note": "UI-State- und Daten-Hooks" },
    { "path": "actions/", "note": "defineAction-Operationen: die einzige Quelle der Wahrheit" },
    { "path": "server/db/schema.ts", "note": "Drizzle-Schema" },
    { "path": "server/plugins/db.ts", "note": "Additive Migrationen" },
    { "path": "server/plugins/", "note": "Startup-Integrationen" },
    { "path": "server/routes/api/", "note": "Benutzerdefinierte Routen nur, wenn Aktionen nicht ausreichen" },
    { "path": "shared/types.ts", "note": "Gemeinsame Client-/Server-Typen" },
    { "path": ".agents/skills/", "note": "<skill>/SKILL.md: Agent-Anleitung für komplexe Workflows" },
    { "path": "AGENTS.md", "note": "Template-spezifische Agent-Anweisungen" },
    { "path": "package.json" },
    { "path": "react-router.config.ts" },
    { "path": "vite.config.ts" }
  ]
}
```

Fügen Sie kein `data/`-Verzeichnis für den Anwendungsstatus hinzu. Dauerhafte App-Daten gehören in SQL, und UI liest sie über actions oder typisierte Server-Handler.

Die vier Bereiche jeder Vorlage sind über eine gemeinsame Aktionsoberfläche und eine SQL-Datenbank miteinander verbunden – der Agent und der UI sind gleichberechtigte Partner bei denselben Vorgängen:

```an-diagram title="Wie die vier Bereiche einer Vorlage miteinander verbunden sind" summary="Die Benutzeroberfläche und der Agent erreichen SQL beide über dieselben Aktionen; Anwendungsstatus und Abfragesynchronisierung sorgen dafür, dass sie aufeinander abgestimmt sind."
{
  "html": "<div class=\"diagram-tmpl\"><div class=\"diagram-col\"><div class=\"diagram-node\">React-UI<br><small class=\"diagram-muted\">app/routes · Komponenten</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">AGENTS.md · skills</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Aktionen</span><small class=\"diagram-muted\">defineAction()</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL über Drizzle<br><small class=\"diagram-muted\">additive schema</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">Polling-Sync</div></div>",
  "css": ".diagram-tmpl{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-tmpl .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-tmpl .diagram-arrow{font-size:22px;line-height:1}.diagram-tmpl .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Modelldaten in SQL {#data-models}

Definieren Sie Domänentabellen mit den Framework-Drizzle-Helfern, damit Schemata über SQLite, Postgres, D1, Turso, Supabase, Neon und andere unterstützte Backends hinweg portierbar bleiben:

```ts
// server/db/schema.ts
import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const projects = table("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status", {
    enum: ["draft", "active", "archived"],
  })
    .notNull()
    .default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...ownableColumns(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const projectShares = createSharesTable("project_shares");
```

Schemaänderungen müssen additiv sein. Fügen Sie Tabellen und Spalten über `runMigrations()` in `server/plugins/db.ts` hinzu; Verwenden Sie niemals destruktive SQL, `drizzle-kit push`, Tabellenumbenennungen oder Spaltenlöschungen.

Für App-Lese- und Schreibvorgänge verwenden Sie den Abfrage-Builder von Drizzle und die portablen Operatoren von `drizzle-orm`. Schreiben Sie keinen Produktcode mit rohem SQL, wenn Drizzle die Abfrage ausdrücken kann, und importieren Sie nicht aus `drizzle-orm/sqlite-core` oder `drizzle-orm/pg-core` in Vorlagen.

```ts
// server/plugins/db.ts
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    },
  ],
  { table: "my_app_migrations" },
);
```

Verwenden Sie die Dokumente [Database](/docs/database) und [Security](/docs/security), bevor Sie Schemas hinzufügen, die Benutzer- oder Organisationsdaten enthalten.

## Vorgänge als Aktionen definieren {#actions}

Aktionen sind die einzige Quelle der Wahrheit für das App-Verhalten. Der Agent ruft sie als Tools auf, das Frontend ruft sie über Hooks auf und andere Apps können sie über MCP/A2A erreichen.

```an-annotated-code title="actions/create-project.ts"
{
  "filename": "actions/create-project.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { getDb } from \"../server/db/index.js\";\nimport { nanoid } from \"nanoid\";\nimport { z } from \"zod\";\nimport * as schema from \"../server/db/schema\";\n\nexport default defineAction({\n  description: \"Create a project.\",\n  schema: z.object({\n    title: z.string().min(1).describe(\"Project title\"),\n  }),\n  run: async ({ title }, ctx) => {\n    const db = getDb();\n    const id = nanoid();\n    await db.insert(schema.projects).values({\n      id,\n      title,\n      ownerEmail: ctx.userEmail,\n      orgId: ctx.orgId,\n    });\n    return { id, title };\n  },\n});",
  "annotations": [
    { "lines": "2", "note": "`getDb` is created per app via `createGetDb(schema)` in `server/db/index.ts`." },
    { "lines": "8", "label": "Werkzeugoberfläche", "note": "`description` ist das, was der Agent liest, um zu entscheiden, wann diese Aktion als Tool aufgerufen werden soll." },
    { "lines": "9-11", "label": "Typisierter Vertrag", "note": "Ein zod `schema` validiert Eingaben von Agent, UI, HTTP, MCP und A2A." },
    { "lines": "18-19", "label": "Begrenztes Schreiben", "note": "Stempeln Sie `ownerEmail` / `orgId` von `ctx`, damit die Zeile den korrekten Bereich für Freigabe- und Zugriffsprüfungen aufweist." }
  ]
}
```

Verwenden Sie `http: { method: "GET" }` oder `readOnly: true` für schreibgeschütztes actions. Verwenden Sie `parallelSafe: true` nur für mutierende actions, die sicher gleichzeitig mit Werkzeugaufrufen für die gleiche Drehung ausgeführt werden können. Verwenden Sie `toolCallable: false` für actions mit hohem Explosionsradius, das nicht mit Sandbox-Tools ausgeführt werden sollte.

## Erstellen Sie das UI {#ui}

Routen leben in `app/routes/` und verwenden das Dateirouting von React Router v8. Fragen Sie Daten über actions- oder API-Handler ab und machen Sie Mutationen standardmäßig optimistisch.

```tsx
import { useActionMutation, useActionQuery } from "@agent-native/core/client";

export default function ProjectsPage() {
  const { data: projects = [] } = useActionQuery("list-projects", {});
  const create = useActionMutation("create-project");

  return (
    <button onClick={() => create.mutate({ title: "Launch plan" })}>
      New project ({projects.length})
    </button>
  );
}
```

Verdrahten Sie die Live-Synchronisierung einmal in der Nähe der App-Shell, damit React Abfrage-Caches aktualisiert werden, wenn der Agent, eine andere Registerkarte oder eine Aktion Daten ändert:

```tsx
import { useDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

export function AppSync() {
  const queryClient = useQueryClient();
  useDbSync({ queryClient });
  return null;
}
```

**Das agentennative Versprechen: Agentenschreibvorgänge werden im UI ohne manuelle Aktualisierung angezeigt.** `useActionQuery` ist der einfache Weg – jeder Hook wird erneut abgerufen, wenn eine mutierende Aktion `source: "action"` ausgibt. Wenn Sie mit einem benutzerdefinierten Schlüssel nach dem rohen `useQuery` greifen (z. B. einem Low-Level-Client-Helper, der den Integrationsstatus liest), falten Sie den Zähler pro Quelle in den queryKey für gezielte Aktualisierungen:

```tsx
import { useChangeVersions } from "@agent-native/core/client";

const v = useChangeVersions(["dashboards", "action"]);
useQuery({
  queryKey: ["dashboard", id, v],
  queryFn: () => fetchDashboard(id),
  placeholderData: (prev) => prev, // no flicker on refetch
});
```

Gemeinsame Quellen: `"action"` (jede erfolgreiche Agentenaktion – der zuverlässige Fallback), `"app-state"`, `"settings"` sowie jede benutzerdefinierte Ressourcenquelle, die Ihr Shop über `recordChange` ausgibt. Das vollständige Muster finden Sie im `real-time-sync`-Skill.

## Anwendungsstatus hinzufügen {#application-state}

Durch den Anwendungsstatus weiß der Agent, was der Benutzer sieht. Fügen Sie mindestens Folgendes hinzu:

- Ein UI-Hook, der den semantischen `navigation`-Status schreibt, wenn sich Routen, ausgewählte Datensätze, aktive Registerkarten oder Editorauswahlen ändern.
- Eine `view-screen`-Aktion, die diesen Status liest und den aktuellen Bildschirm-Snapshot zurückgibt.
- Eine `navigate`-Aktion, die einen einmaligen `navigate`-Befehl schreibt, den UI nutzen soll.

Verwenden Sie `useAgentRouteState` für den UI-Hook, damit Anwendungsstatus-Schreibvorgänge, tabulatorbezogene Befehlslesevorgänge, Löschung nach dem Lesen und Schutz vor doppelten Befehlen konsistent bleiben:

```tsx
import { useAgentRouteState } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

export function useNavigationState() {
  useAgentRouteState({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, searchParams }) => ({
      view: pathname === "/" ? "home" : pathname.slice(1),
      selectedId: searchParams.get("id"),
    }),
    getCommandPath: (command: any) => command.path ?? "/",
    navigateOptions: { replace: true, flushSync: true },
  });
}
```

Behalten Sie gemeinsam nutzbare Filter in URL-Abfrageparametern bei. Das Framework stellt sie dem Agenten als `<current-url>` zur Verfügung und der integrierte Agent kann sie mit `set-search-params` ändern; `navigation` sollte semantische IDs und Aliase enthalten, keine zweite Kopie der vollständigen Abfragezeichenfolge.

Bevorzugen Sie für die App-Navigation einen `navigate`-Befehl, der einen gleichen Ursprung enthält
`path`, wenn URL bekannt ist. Schreiben Sie nicht auch `__set_url__` für denselben Zug;
Dieser Schlüssel ist für die Framework-URL-Tools und nur URL-Filteränderungen reserviert.

```ts
// actions/navigate.ts
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the UI.",
  schema: z.object({
    view: z.enum(["home", "project"]),
    projectId: z.string().optional(),
    path: z.string().optional(),
  }),
  run: async (args) => {
    await writeAppState("navigate", args);
    return { ok: true };
  },
});
```

Das vollständige Muster finden Sie unter [Context Awareness](/docs/context-awareness).

## Verwenden Sie API-Routen sparsam {#api-routes}

Bevorzugen Sie actions für App-Vorgänge. Erstellen Sie benutzerdefinierte Nitro-Routen nur für Oberflächen, die nicht sauber actions sein können:

- Datei-Upload oder binäres Streaming.
- Öffentliche anonyme Seiten und webhooks.
- OAuth-Rückrufe und anbieterspezifische Protokollhandler.
- Vom Server gerenderter öffentlicher Inhalt.

Benutzerdefinierte Routen, die besitzbare Daten berühren, müssen `getSession(event)` aufrufen und die Datenbankarbeit in `runWithRequestContext({ userEmail, orgId }, fn)` umschließen, bevor Zugriffshilfen verwendet werden.

## Agentenanweisungen schreiben {#write-agents-md}

`AGENTS.md` ist die Agentenkarte Ihrer App – eine kleine, überstreichbare Datei mit einem
Zweckzeile, Kernregeln, Anwendungsstatusschlüssel, eine Aktionstabelle und ein skills
Index:

```markdown
# Meine Vorlage

One workspace for projects, tasks, and notes.

## Grundregeln

- Data lives in SQL über Drizzle. Use actions for all writes; schema is additive.
- Use `view-screen` before acting on "this project" if the screen is unclear.

## Anwendungsstatus

- `navigation.view`: `home` | `project`
- `navigation.projectId`: selected project on a project page

## Aktionen

| Action           | Purpose                  |
| ---------------- | ------------------------ |
| `list-projects`  | List accessible projects |
| `create-project` | Create a project         |
```

Aktualisieren Sie `AGENTS.md`, wann immer Sie eine neue Aktion, Route, einen neuen Statusschlüssel oder eine wiederkehrende Aktion hinzufügen
Workflow. [Writing Agent Instructions](/docs/writing-agent-instructions) ist der
vollständige Anleitung – wie man `AGENTS.md` überstreichbar hält, was zu jedem der vier gehört
Anleitungsoberflächen und wie man Fertigkeits- und Werkzeugbeschreibungen für den Agenten formuliert
löst sie zuverlässig aus.

## Skills hinzufügen {#skills}

Verwenden Sie skills für detaillierte Muster, die `AGENTS.md` aufblähen würden: anbieterspezifische APIs, Import-/Exportformate, komplexe Bearbeitungsabläufe oder Domänenterminologie.

```markdown
---
name: project-imports
description: How to import projects from the legacy CSV export.
---

# Projektimporte

Use this skill when the user uploads a legacy project CSV.

## Regeln

- Validate required columns before creating rows.
- Use `create-project` for each project so ownership and sync are correct.
- Save rejected rows as a note attached to the import summary.
```

Vorlage skills in `.agents/skills/<name>/SKILL.md` speichern. Wenn Benutzer die Anleitung zur Laufzeit bearbeiten können sollen, zeigen Sie sie auch über Arbeitsbereichsressourcen an.

## Einrichtungsschritte registrieren {#onboarding}

Wenn eine Vorlage einen API-Schlüssel, eine OAuth-Verbindung oder ein Anbieterkonto benötigt, registrieren Sie einen Onboarding-Schritt, anstatt die Anforderung in einem README zu vergraben.

```ts
// server/plugins/onboarding.ts
import { defineNitroPlugin } from "@agent-native/core/server";
import { registerOnboardingStep } from "@agent-native/core/onboarding";

export default defineNitroPlugin(() => {
  registerOnboardingStep({
    id: "github",
    title: "Connect GitHub",
    description: "Needed to import repositories and pull requests.",
    order: 100,
    methods: [
      {
        id: "token",
        kind: "form",
        primary: true,
        label: "Save token",
        payload: {
          fields: [
            { key: "GITHUB_TOKEN", label: "GitHub token", secret: true },
          ],
        },
      },
    ],
    isComplete: () => !!process.env.GITHUB_TOKEN,
  });
});
```

Siehe [Onboarding & API Keys](/docs/onboarding).

## Machen Sie es arbeitsplatzbereit {#workspace-ready}

Vorlagen sollten natürlich in [Multi-App Workspaces](/docs/multi-app-workspace) passen, normalerweise koordiniert von [Dispatch](/docs/dispatch).

Checkliste:

- Befestigen Sie A2A über das Framework-Agent-Chat-Plugin oder `mountA2A()`, damit Geschwister-Apps Ihren Agenten anrufen können.
- Halten Sie die Beschreibungen der Agentenkarten spezifisch genug, damit Dispatch die Arbeit genau weiterleiten kann.
- Registrieren Sie die erforderlichen Geheimnisse/Onboarding, damit das Setup in der Seitenleiste angezeigt wird und Dispatch gemeinsame Anmeldeinformationen verwalten kann.
- Behalten Sie übergreifende Anweisungen im Arbeitsbereich `AGENTS.md` oder in den Arbeitsbereichsressourcen bei und kopieren Sie sie nicht in jede App.
- Verwenden Sie Freigabe-/Zugriffshelfer für alle besitzbaren Ressourcen, damit organisationsbezogene Arbeitsbereiche isoliert bleiben.

## Eine Vorlage veröffentlichen {#publishing}

Vor dem Teilen:

1. Führen Sie `pnpm install`, `pnpm typecheck` und die Tests der Vorlage aus.
2. Stellen Sie sicher, dass es funktioniert, ohne dass optionale Anbieterschlüssel konfiguriert sind.
3. Überprüfen Sie Authentifizierung, Freigabe und Datenisolation für zwei Benutzer.
4. Dokumentieren Sie die erforderlichen Umgebungsvariablen und Onboarding-Schritte.
5. Fügen Sie Beispiele oder Seed-Zeilen durch additive Migrationen ein, nicht durch verfolgte Laufzeitdatendateien.

Community-Vorlagen können aus einem GitHub-Repo erstellt werden:

```bash
npx @agent-native/core@latest create my-app --template github:user/repo
```

## Beitrag zum Framework Monorepo {#contributing}

### Unveröffentlichte Framework-Änderungen testen {#test-unpublished-framework-changes}

Wenn Sie innerhalb des Frameworks Monorepo arbeiten und ein generiertes benötigen
Arbeitsbereich, um unveröffentlichte Paket- oder Vorlagenänderungen zu verwenden, führen Sie „Create“ mit dem
Lokalpaket-Flag:

```bash
AGENT_NATIVE_CREATE_USE_LOCAL_CORE=1 pnpm --filter @agent-native/core create my-platform
```

Der generierte Arbeitsbereich verknüpft die lokalen `@agent-native/core` und
`@agent-native/dispatch`-Pakete, also Änderungen an Core APIs, Dispatch-Arbeitsbereich
-Verhalten oder Erstanbieter-Vorlagen können vor der Veröffentlichung getestet werden. Das Paket
`prepack`-Skripte erstellen `dist` vor dem Verknüpfen, wodurch die generierten Daten erhalten bleiben
Arbeitsbereich zeigte auf aktuelle Build-Ausgabe.
