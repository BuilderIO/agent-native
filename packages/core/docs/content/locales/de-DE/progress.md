---
title: "Fortschritt"
description: "Live-Fortschrittssignal für Agentenaufgaben mit langer Laufzeit – starten, aktualisieren, abschließen"
---

# Fortschritt

Lange Agentenaufgaben sollten sich nicht hinter einem Spinner verstecken. `progress_runs` gibt dem Agenten die Möglichkeit, anzukündigen: „Ich arbeite daran, ich bin zu 45 % fertig, hier ist der aktuelle Schritt“ – was der UI als schwebende Ausführungsleiste mit einem Prozentbalken rendert.

```ts
import {
  startRun,
  updateRunProgress,
  completeRun,
} from "@agent-native/core/progress";

const run = await startRun({
  owner: "steve@builder.io",
  title: "Triage 128 unread emails",
  step: "Fetching inbox",
});

for (let i = 1; i <= total; i++) {
  await updateRunProgress(run.id, run.owner, {
    percent: Math.round((i / total) * 100),
    step: `Classifying ${i}/${total}`,
  });
}

await completeRun(run.id, run.owner, "succeeded");
```

Separates Problem von [notifications](/docs/notifications): Benachrichtigungen werden einmal ausgelöst (_"X ist passiert"_), der Fortschritt ist ein kontinuierlicher Status (_"X ist zu 45 % erledigt"_). Die beiden setzen sich zusammen – `completeRun` gefolgt von `notify(..., severity: "info")` teilt dem Benutzer mit, wann die Arbeit beendet ist, auch wenn er nicht auf das Fach geachtet hat.

## Der Lebenszyklus {#lifecycle}

| Status      | Übergang                                 |
| ----------- | ---------------------------------------- |
| `running`   | Anfänglich – festgelegt durch `startRun` |
| `succeeded` | Happy-Path-Terminal                      |
| `failed`    | Fehlerterminal                           |
| `cancelled` | Benutzer unterbrochen                    |

```an-diagram title="Lebenszyklus ausführen" summary="startRun öffnet eine laufende Zeile; updateRunProgress patcht es; completeRun verschiebt es in einen Terminalstatus und stempelt completed_at."
{
  "html": "<div class=\"diagram-run\"><div class=\"diagram-box\" data-rough>startRun()</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel running\" data-rough><span class=\"diagram-pill accent\">running</span><small class=\"diagram-muted\">updateRunProgress() &#8635; percent + step</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col terminal\"><span class=\"diagram-pill ok\">succeeded</span><span class=\"diagram-pill warn\">failed</span><span class=\"diagram-pill\">cancelled</span><small class=\"diagram-muted\">completeRun() &rarr; sets completed_at</small></div></div>",
  "css": ".diagram-run{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-run .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:12px 16px}.diagram-run .terminal{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.diagram-run .diagram-arrow{font-size:22px;line-height:1}"
}
```

Terminalstatus gesetzt `completed_at`. Das Fach UI zeigt nur `running`-Zeilen; Abgeschlossene Zeilen bleiben für `action=list`-Abfragen in der Datenbank.

## API {#api}

### `startRun(input)` {#start}

Erstellen Sie einen Lauf. Gibt das vollständige `AgentRun` mit einer generierten ID zurück.

```ts
const run = await startRun({
  owner: "steve@builder.io",
  title: "Ingest 1M rows",
  step: "Opening CSV",
  metadata: { jobId: "abc123", artifactPath: "s3://..." },
});
```

Gibt `run.progress.started` auf dem Ereignisbus aus.

### `updateRunProgress(id, owner, input)` {#update}

Patcht ein beliebiges Feld eines laufenden Laufs. Alle ausgelassenen Felder bleiben unverändert.

```ts
await updateRunProgress(run.id, run.owner, {
  percent: 75,
  step: "Writing to target DB",
});
```

Gibt `run.progress.updated` auf dem Ereignisbus aus. Gibt den aktualisierten `AgentRun` oder `null` zurück, wenn der Lauf nicht existiert oder nicht dem Aufrufer gehört.

### `completeRun(id, owner, status, extras?)` {#complete}

Übergang in einen Terminalstatus. `succeeded` legt implizit `percent=100` fest.

```ts
await completeRun(run.id, run.owner, "succeeded", {
  step: "All 1M rows ingested",
  metadata: { totalDurationMs: 98_123 },
});
```

Gibt außerdem `run.progress.updated` mit dem Terminalstatus aus.

### Eintrag {#list}

```ts
import { listRuns, getRun, deleteRun } from "@agent-native/core/progress";

const active = await listRuns("steve@builder.io", { activeOnly: true });
const run = await getRun("run-id", "steve@builder.io");
await deleteRun("run-id", "steve@builder.io");
```

## HTTP API {#http}

Wird durch das Core-Routes-Plugin bei `/_agent-native/runs/*` gemountet. **Schreibgeschützt über HTTP** – Schreibvorgänge durchlaufen die Agent-Tools, da der Agent der kanonische Autor ist. Alle Routen unterliegen dem Eigentümerbereich.

| Methode  | Pfad                              |
| -------- | --------------------------------- |
| `GET`    | `/_agent-native/runs?active=true` |
| `GET`    | `/_agent-native/runs/:id`         |
| `DELETE` | `/_agent-native/runs/:id`         |

```an-api title="Aktive Läufe auflisten" method="GET" path="/_agent-native/runs"
{
  "method": "GET",
  "path": "/_agent-native/runs",
  "summary": "List the caller's runs. The RunsTray polls this with active=true.",
  "description": "Read-only and owner-scoped — every row has an `owner` column and every query filters on it, so callers only ever see their own runs. Writes (start/update/complete) go through the agent's `manage-progress` tool, not HTTP.",
  "auth": "Session cookie (owner-scoped)",
  "params": [
    { "name": "active", "in": "query", "type": "boolean", "required": false, "description": "When true, returns only `running` rows." }
  ],
  "responses": [
    { "status": "200", "description": "Array of AgentRun rows owned by the caller." }
  ]
}
```

## UI-Komponente {#ui}

```tsx
import { RunsTray } from "@agent-native/core/client/progress";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <RunsTray />
    </header>
  );
}
```

Inline-Header-Widget – montieren Sie es neben der Benachrichtigungsglocke. Zeigt ein Drehsymbol und ein Zählabzeichen an, wenn Läufe aktiv sind. Durch Klicken wird ein Dropdown-Menü mit einem Live-Prozentbalken pro Lauf geöffnet. Blendet den Auslöser vollständig aus, wenn keine aktiven Ausführungen erfolgen. Fragt `/_agent-native/runs?active=true` alle `pollMs` ab (Standard 3 s). Verwendet shadcn-semantische Token, passt sich an helle und dunkle Themen an.

## Agent-Tool {#agent-tool}

In jeder Vorlage ist ein einzelnes `manage-progress`-Tool registriert. Der Parameter `action` wählt die Operation aus:

| Aktion     | Zweck                                                                       |
| ---------- | --------------------------------------------------------------------------- |
| `start`    | Anruf am Anfang einer langen Aufgabe. Gibt eine runId zurück.               |
| `update`   | Rufen Sie während der Aufgabe regelmäßig mit `percent` und/oder `step` auf. |
| `complete` | Terminal – eines von `succeeded`, `failed`, `cancelled`.                    |
| `list`     | Inspizieren Sie die letzten Ausführungen (Filter nach `active=true`).       |

### Wann soll ein Lauf gestartet werden? {#when-to-start}

- Für alles > ~5 Sekunden verwenden. Ein Spinner ohne Kontext fühlt sich eingefroren an.
- Aktualisierung an natürlichen Prüfpunkten, nicht bei jeder Iteration. Alle 5–10 % sind ausreichend.
- **Rufen Sie `manage-progress` immer** mit `action=complete` auf, auch in Fehlerpfaden. Eine verwaiste `running`-Zeile ist schlimmer als keine Zeile.
- Koppeln Sie nach Abschluss mit `notify`, damit der Benutzer das Ergebnis sieht, wenn er das Fach nicht aktiv beobachtet.

## Ereignisbus {#event-bus}

Zwei Ereignisse werden auf dem [event bus](/docs/automations#event-bus) ausgegeben:

| Ereignis               | Nutzlast                           |
| ---------------------- | ---------------------------------- |
| `run.progress.started` | `{ runId, title, step? }`          |
| `run.progress.updated` | `{ runId, percent, step, status }` |

[Automations](/docs/automations) kann diese abonnieren – zum Beispiel _"Wenn ein Lauf länger als 5 Minuten dauert, benachrichtigen Sie mich"_:

```yaml
---
triggerType: event
event: run.progress.updated
condition: "status is failed"
mode: agentic
---
Benachrichtigen me that run {{runId}} has failed.
```

## Wie es funktioniert {#internals}

- **Owner Scoping** – jede Zeile hat eine `owner`-Spalte; Jede Abfrage filtert danach. Benutzer sehen nur ihre eigenen Läufe.
- **Umfrageintegration** – jede Mutation ruft `recordChange()` auf, sodass Vorlagen, die [`useDbSync`](/docs/client) verwenden, ohne zusätzliche Verkabelung automatisch ungültig werden.
- **Tabellenname** – das Framework verfügt außerdem über eine `agent_runs`-Tabelle für die interne Nachverfolgung des Agent-Chat-Turn-Lebenszyklus. Das Fortschrittsprimitiv verwendet `progress_runs`, um die beiden Anliegen getrennt zu halten.
- **Prozent-Klammerung** – Werte werden auf `[0, 100]` geklemmt und beim Schreiben auf eine Ganzzahl gerundet.

## Was kommt als nächstes?

- [**Notifications**](/docs/notifications) – koppeln Sie es mit `manage-progress` (`action=complete`), um dem Benutzer mitzuteilen, wann die Arbeit beendet ist
- [**Automations**](/docs/automations) – langsamer Watchdog läuft über `run.progress.updated`
- [**Client**](/docs/client) – `useDbSync` für Echtzeit-Cache-Ungültigmachung
