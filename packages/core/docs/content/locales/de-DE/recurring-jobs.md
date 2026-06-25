---
title: "Wiederkehrende Jobs"
description: "Cron-geplante Eingabeaufforderungen, die der Agent selbstständig ausführt – tägliche Übersichten, wöchentliche Berichte, stündliche Abfragen."
---

# Wiederkehrende Jobs

Ein **wiederkehrender Job** ist eine Eingabeaufforderung, die nach einem Cron-Zeitplan ausgeführt wird. So erledigt der Agent die Dinge selbst: „Jeden Morgen um 7 Uhr fasse ich meine Nacht-E-Mails zusammen“, „postet jeden Montag die Anmeldenummern der letzten Woche an Slack“, „sucht jede Stunde nach veralteten Entwürfen und löscht sie.“

Wiederkehrende Aufträge werden nach dem Takt der Uhr ausgelöst. Um auf _Ereignisse_ (eine erstellte Buchung, eine empfangene E-Mail) zu reagieren – dasselbe `jobs/`-Dateiformat plus Bedingungen – siehe [Automations](/docs/automations).

Jobs leben im [workspace](/docs/workspace) bei `jobs/<name>.md` – nur eine Markdown-Datei mit YAML-Frontmatter. Keine Registrierung, keine Verkabelung. Legen Sie die Datei ab und das Framework übernimmt sie.

## Eine Jobdatei {#job-file}

```an-annotated-code title="jobs/morning-digest.md"
{
  "filename": "jobs/morning-digest.md",
  "language": "markdown",
  "code": "---\nschedule: \"0 7 * * *\"\nenabled: true\nrunAs: creator\n---\n\n# Morning digest\n\nSummarize the emails received overnight. Group by sender domain.\nPin the top 3 threads that look like they need a reply today to the\n\"Needs reply\" label. Draft replies for any that are obvious.",
  "annotations": [
    { "lines": "2", "label": "When", "note": "Standard 5-field cron — `0 7 * * *` is every day at 07:00." },
    { "lines": "3", "label": "Pause switch", "note": "Flip to `false` to stop the job without deleting it." },
    { "lines": "4", "label": "Identity", "note": "`creator` runs with the owner's identity and `ANTHROPIC_API_KEY`; `shared` uses the org's key." },
    { "lines": "7-12", "label": "The prompt", "note": "The body is just a prompt — the agent runs it at each firing with all its normal tools and workspace context." }
  ]
}
```

Das ist es. Der Hauptteil ist eine Eingabeaufforderung, die der Agent bei jeder geplanten Auslösung ausführt. Der Agent hat Zugriff auf dieselben Tools und denselben Arbeitsbereichskontext wie in einem interaktiven Chat – actions, skills, Speicher, verbundene MCP-Server, Subagenten.

## Frontmatter {#frontmatter}

| Feld         | Typ                           | Standard         | Beschreibung                                                                                                                                   |
| ------------ | ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule`   | Cron-Ausdruck                 | _(erforderlich)_ | Standard-Cron mit 5 Feldern. `"0 7 * * *"` = jeden Tag um 07:00; `"0 */4 * * *"` = alle 4 Stunden.                                             |
| `enabled`    | boolean                       | `true`           | Wechseln Sie zu `false`, um den Job anzuhalten, ohne ihn zu löschen.                                                                           |
| `runAs`      | `"creator"` \| `"shared"`     | `"creator"`      | `"creator"` wird mit der Identität des Jobeigentümers und `ANTHROPIC_API_KEY` ausgeführt. `"shared"` verwendet den Schlüssel der Organisation. |
| `createdBy`  | E-Mail                        | _(auto)_         | Wird ausgefüllt, wenn der Job über den Arbeitsbereich UI oder durch den Agenten erstellt wird.                                                 |
| `orgId`      | Zeichenfolge                  | _(auto)_         | Organisationsbereich; Von der aktiven Organisation des Erstellers geerbt.                                                                      |
| `lastRun`    | ISO-Zeitstempel               | _(verwaltet)_    | Wird vom Planer nach jedem Lauf geschrieben.                                                                                                   |
| `lastStatus` | `"success"` \| `"error"` \| … | _(verwaltet)_    | Neuestes Ergebnis.                                                                                                                             |
| `lastError`  | Zeichenfolge                  | _(verwaltet)_    | Fehlermeldung, wenn der letzte Lauf fehlgeschlagen ist.                                                                                        |
| `nextRun`    | ISO-Zeitstempel               | _(verwaltet)_    | Berechnet aus `schedule`; Wird vom Planer verwendet, um zu entscheiden, wann das nächste Mal ausgelöst wird.                                   |

Die Felder `last*` und `nextRun` werden vom Scheduler geschrieben. Sie können sie lesen, um den Verlauf anzuzeigen, aber bearbeiten Sie sie nicht manuell – beim nächsten Durchlauf werden sie überschrieben.

## Cron-Syntax {#cron}

Standard-Cron mit 5 Feldern (Minute, Stunde, Tag des Monats, Monat, Wochentag):

| Cron           | Bedeutung                 |
| -------------- | ------------------------- |
| `*/5 * * * *`  | Alle 5 Minuten            |
| `0 * * * *`    | Jede volle Stunde         |
| `0 */4 * * *`  | Alle 4 Stunden            |
| `0 7 * * *`    | Jeden Tag um 07:00 Uhr    |
| `0 9 * * 1`    | Jeden Montag um 09:00 Uhr |
| `0 17 * * 1-5` | Wochentags um 17:00       |
| `0 0 1 * *`    | Erster Tag jedes Monats   |

Das Framework umfasst Cron-Dienstprogramme (`isValidCron()` und `describeCron()`) zum Validieren und Rendern von Cron-Strings, die intern von der Ressourcen- und Scheduler-Ebene verwendet werden.

## Job erstellen {#creating}

### Auf der Registerkarte „Arbeitsbereich“

`+` → **Geplante Aufgabe** im Arbeitsbereichsbereich. Füllen Sie die Eingabeaufforderung und den Zeitplan aus. Speichert als `jobs/<slug>.md` und beginnt mit der Ausführung beim nächsten passenden Tick.

### Indem Sie den Agenten fragen

> „Erstellen Sie jeden Morgen um 7 Uhr eine geplante Aufgabe, die meine ungelesenen E-Mails zusammenfasst.“

Der Agent schreibt die Datei für Sie.

### Von Hand

Legen Sie eine Markdown-Datei über die Ressource APIs des Frameworks in `jobs/` ab:

```ts
import { resourcePut } from "@agent-native/core/resources";

await resourcePut(
  ownerEmail,
  "jobs/morning-digest.md",
  `---
schedule: "0 7 * * *"
enabled: true
---
Summarize overnight emails.`,
);
```

## Wie der Planer ausgeführt wird {#how-scheduler-runs}

Der Scheduler ist ein Framework-Plugin (die interne `processRecurringJobs()`-Routine), das prozessintern ausgeführt wird: Ein `setInterval` wird alle 60 Sekunden (mit einer Startverzögerung von 10 Sekunden) innerhalb des Agenten-Chat-Plugins ausgelöst, wo auch immer der Server läuft.

```an-diagram title="One scheduler tick" summary="Every 60s the scheduler finds due jobs, runs each as a fresh agent thread, and writes the outcome back to the job file."
{
  "html": "<div class=\"sched\"><div class=\"diagram-box accent\"><code>setInterval</code> &bull; 60s &#8635;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">1 &middot; scan</span><small class=\"diagram-muted\">list every enabled <code>jobs/*.md</code> across all owners</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; due?</span><small class=\"diagram-muted\">compare <code>nextRun</code> to now</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">3 &middot; run</span><small class=\"diagram-muted\">fresh agent thread, job body as the user message &mdash; actions, SQL, A2A, email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">4 &middot; record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code>, recompute <code>nextRun</code></small></div></div>",
  "css": ".sched{display:flex;flex-direction:column;gap:6px;max-width:520px}.sched .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.sched .diagram-box{align-self:flex-start}.sched .diagram-arrow{font-size:18px;align-self:center}"
}
```

```an-callout
{ "tone": "risk", "body": "**Scale-to-zero caveat.** The scheduler is in-process, so on serverless hosts jobs only fire while an instance is warm. If reliable scheduling matters, keep an instance warm with keep-alive pings or use an always-on host (Fly, Render, a VPS)." }
```

## Debuggen eines Jobs {#debugging}

- Öffnen Sie `jobs/<name>.md` im Arbeitsbereich – die Vorderseite zeigt `lastRun`, `lastStatus`, `lastError`, `nextRun`.
- **Testen Sie es ohne zu warten:** Es gibt kein Force-Fire-Tool. Um die gleiche Arbeit bei Bedarf auszuführen, fügen Sie entweder die Eingabeaufforderung des Jobs in den Agenten-Chat ein und lassen Sie ihn dort ausführen, oder stellen Sie den Zeitplan vorübergehend auf die nächste Minute ein, damit der Planer ihn beim nächsten Tick übernimmt (und stellen Sie dann den echten Cron wieder her).
- **Pause:** umdrehen `enabled: false`. Die Datei bleibt bestehen und wird einfach nicht mehr ausgeführt.

## Agent-Tool {#agent-tool}

In jeder Vorlage ist ein einzelnes `manage-jobs`-Tool registriert. Der Parameter `action` wählt die Operation aus:

| Aktion   | Parameter                                                             | Zweck                                                                          |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `create` | `name`, `schedule`, `instructions` (erforderlich); `scope`, `runAs`   | Erstellen Sie einen neuen wiederkehrenden Auftrag                              |
| `list`   | `scope` (`personal`, `shared` oder alle)                              | Alle Jobs mit Status auflisten (geplant, aktiviert, letzte/nächste Ausführung) |
| `update` | `name` (erforderlich); `schedule`, `instructions`, `enabled`, `runAs` | Bestehenden Job bearbeiten                                                     |
| `delete` | `name` (erforderlich)                                                 | Einen Auftrag löschen – immer zuerst mit dem Benutzer bestätigen               |

**Persönlicher vs. gemeinsamer Bereich.** Jeder Job befindet sich entweder im persönlichen Bereich (läuft als und ist nur für den Ersteller sichtbar) oder im freigegebenen/organisatorischen Bereich (wird im Namen des Erstellers ausgeführt, ist aber für Organisationsmitglieder sichtbar). Die Parameter `scope` und `runAs` steuern dies zum Zeitpunkt der Erstellung. Organisationsadministratoren können alle freigegebenen Jobs aktualisieren oder löschen. Nicht-Administrator-Mitglieder können nur ihre eigenen verwalten.

## Unterscheidet sich vom Planungspaket {#vs-scheduling-package}

Verwechseln Sie wiederkehrende Aufträge nicht mit `@agent-native/scheduling`:

- **Wiederkehrende Jobs (diese Seite)** – Cron-geplante Eingabeaufforderungen, die der Agent im Hintergrund ausführt. Framework-Ebene. Lebt im Arbeitsbereich. Läuft auf jeder agentennativen App.
- **`@agent-native/scheduling`** – ein wiederverwendbares Domänenpaket zum Erstellen von Kalender-/Buchungsfunktionen (Veranstaltungstypen, Verfügbarkeitsfenster, Buchungen). Unterstützt die `calendar`-Vorlage und benutzerdefinierte Planungsoberflächen.

Wiederkehrende Aufträge lauten: „Wie bringe ich den Agent dazu, eigenständig zu handeln?“ Das Planungspaket lautet: „Wie erstelle ich eine Kalender-App?“ Verschiedene Anliegen.

## Was kommt als nächstes?

- [**Automations**](/docs/automations) – Ereignisauslöser und Bedingungen zum gleichen `jobs/`-Format hinzufügen
- [**Workspace**](/docs/workspace) – wo Jobs neben skills, Speicher und benutzerdefinierten Agents leben
- [**Actions**](/docs/actions) – die Werkzeuge, die ein Job erfordert
- [**Agent Teams**](/docs/agent-teams) – Jobs erzeugen oft Subagenten, um parallele Arbeit zu erledigen
