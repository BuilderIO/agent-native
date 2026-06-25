---
title: "Agententeams"
description: "Der Hauptagent delegiert die Arbeit an Unteragenten, die in ihren eigenen Threads ausgeführt werden und als Live-Vorschau-Chips inline im Chat erscheinen."
---

# Agententeams

Der Agenten-Chat ist ein **Orchestrator**, kein Monolith. Wenn der Hauptagent auf eine Aufgabe trifft, die besser einem Spezialisten obliegt – „diese E-Mail mit meiner Stimme schreiben“, „eine BigQuery-Analyse durchführen“, „diese PR überprüfen“ –, erzeugt er einen Unteragenten in seinem eigenen Thread, seinen eigenen Tools und seinem eigenen Kontext. Der Subagent wird als Live-Vorschau-**Chip** inline im Hauptchat angezeigt; Klicken Sie darauf, um die vollständige Konversation als Tab zu öffnen.

Dadurch bleibt der Hauptthread fokussiert, Unteragenten können parallel ausgeführt werden und Sie erhalten einen sauberen Prüfpfad für alle delegierten Arbeiten.

Agent Teams läuft auf dem Kern-Run-Manager: Ereignisse werden gestreamt und bleiben bestehen, Abbrüche werden über SQL weitergegeben und Aufgaben überleben serverlose Kaltstarts.

## Das mentale Modell {#mental-model}

- **Hauptchat** – der Orchestrator. Liest Ihre Anfrage, Delegierte. Schwere Arbeit erledigt sich selten von selbst.
- **Subagenten** – werden mit ihrem eigenen Thread, ihrer eigenen Systemeingabeaufforderung und ihrem eigenen Toolset ausgeführt. Jeder ist einem „benutzerdefinierten Agenten“-Profil im [workspace](/docs/workspace) zugeordnet.
- **Chips** – die umfangreiche Vorschaukarte, die inline im Hauptchat angezeigt wird und den aktuellen Schritt des Subagenten, die Streaming-Ausgabe und die abschließende Zusammenfassung anzeigt. Standardmäßig minimiert; Wird beim Klicken auf die vollständige Konversation erweitert.
- **Bidirektionale Nachrichtenübermittlung** – der Hauptagent kann Folgenachrichten an einen laufenden Unteragenten senden; Ein Subagent kann eine Nachricht zurücksenden, wenn er einen unklaren Punkt erreicht.

Der Status des Subagenten wird in der Tabelle `application_state` SQL (unter `agent-task:<taskId>`) beibehalten, sodass Aufgaben serverlose Kaltstarts überleben und über mehrere Prozesse hinweg funktionieren.

```an-diagram title="Orchestrator und Spezialisten" summary="Der Hauptchat wird an Unteragenten delegiert, die in ihren eigenen Threads ausgeführt werden und als Inline-Chips Rückmeldung geben."
{
  "html": "<div class=\"at-orc\"><div class=\"diagram-card main\"><span class=\"diagram-pill accent\">Hauptchat</span><small class=\"diagram-muted\">orchestrator &mdash; reads your request, delegates</small></div><div class=\"at-fan\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"at-subs\"><div class=\"diagram-box\">Code-Review<br><small class=\"diagram-muted\">own thread &amp; prompt</small></div><div class=\"diagram-box\">BigQuery-Analyse<br><small class=\"diagram-muted\">own tools</small></div><div class=\"diagram-box\">E-Mail per Sprache<br><small class=\"diagram-muted\">own context</small></div></div></div><div class=\"diagram-pill\">each appears inline as a live chip &#8635;</div></div>",
  "css": ".at-orc{display:flex;flex-direction:column;align-items:center;gap:12px}.at-orc .diagram-card{padding:14px 18px;display:flex;flex-direction:column;gap:4px;align-items:center}.at-orc .at-fan{display:flex;flex-direction:column;align-items:center;gap:8px}.at-orc .diagram-arrow{font-size:22px}.at-orc .at-subs{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.at-orc .diagram-box{text-align:center}"
}
```

## Wann soll ein Subagent erzeugt werden? {#when-to-spawn}

Erscheint, wenn die Aufgabe:

- Benötigt eine andere **Systemaufforderung** (eine spezielle Stimme oder einen speziellen Ton, z. B. „Codeüberprüfung“).
- Verfügt über eine **lang laufende** Toolkette, die den Hauptkontext verunreinigen würde.
- Kann **parallel** mit anderen Aufgaben ausgeführt werden, die der Hauptagent ausführt.
- Ist im Besitz eines **anderen Teams**, das bereits über ein benutzerdefiniertes Agentenprofil verfügt.

Spawnen Sie nicht für triviale One-Shot-Arbeiten – rufen Sie die Aktion direkt auf.

## Aufrufen eines Subagenten {#invoking}

Drei Möglichkeiten, einen Subagenten zu starten, von der geringsten bis zur explizitesten:

### 1. `@mention` ein benutzerdefinierter Agent {#mention}

Der Benutzer gibt `@agent-name` im Chat-Verfassenr ein. Ein Dropdown-Menü mit Workspace-Subagenten wird angezeigt. Wenn Sie eines auswählen, wird ein Chip eingefügt. Beim Senden delegiert der Hauptagent die Nachricht an diesen Unteragenten.

Benutzerdefinierte Agenten befinden sich im Arbeitsbereich von `agents/<slug>.md` – einer Markdown-Datei mit YAML-Frontmatter. Informationen zum Format finden Sie unter [Custom Agents](/docs/workspace#custom-agents).

### 2. Der Hauptagent delegiert automatisch {#auto-delegate}

Das Framework stellt dem Hauptagenten ein `agent-teams`-Tool zur Verfügung. Wenn das Modell entscheidet, dass eine Aufgabe zu einem registrierten Subagentenprofil passt, ruft es das Tool mit `action: "spawn"` und einem optionalen `agent`-Parameter auf, der ein Profil von `agents/*.md` benennt. Ein Chip erscheint; Der Subagent wird ausgeführt. Der Hauptagent wartet (oder geht parallel weiter) und übernimmt das Ergebnis, wenn der Unteragent fertig ist.

Der vollständige `agent-teams`-Aktionssatz ist:

| Aktion        | Zweck                                                     |
| ------------- | --------------------------------------------------------- |
| `spawn`       | Starten Sie eine neue Subagentenaufgabe                   |
| `status`      | Überprüfen Sie den Fortschritt eines laufenden Subagenten |
| `read-result` | Erhalten Sie die Ausgabe eines fertigen Subagenten        |
| `send`        | Eine Nachricht an einen laufenden Subagenten senden       |
| `list`        | Alle Aufgaben für den aktuellen Benutzer anzeigen         |

### 3. Programmatischer Spawn {#programmatic-spawn}

Für Integrationen auf Framework-Ebene verwenden Sie `spawnTask()` von `@agent-native/core/server`:

```ts
import { spawnTask } from "@agent-native/core/server";

const task = await spawnTask({
  description: "Draft an outreach email to this lead",
  instructions: "Match Steve's voice from memory/MEMORY.md.",
  ownerEmail: user.email,
  systemPrompt: mailAgentSystemPrompt,
  actions: mailActions,
  // Pass either apiKey or engine — engine takes precedence.
  apiKey: process.env.ANTHROPIC_API_KEY, // optional if engine is provided
  parentSend: emit, // streaming sender for the parent chat response
});
```

Der meiste App-Code ruft dies nicht direkt auf – das Framework erledigt dies unter der Haube für `@mentions` und für das `agent-teams`-Tool. Greifen Sie nach `spawnTask()` nur, wenn Sie einen neuen Einstiegspunkt verknüpfen (z. B. eine Schaltfläche, die einen Hintergrundjob startet, der als Subagent ausgeführt wird).

## Aufgabenlebenszyklus {#lifecycle}

```an-diagram title="Was spawnTask() macht" summary="Jeder Spawn erstellt einen Thread, behält den Status bei SQL bei und streamt Chip-Ereignisse bis zur Fertigstellung."
{
  "html": "<div class=\"at-life\"><div class=\"diagram-box\"><code>spawnTask()</code></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">create thread</span><small class=\"diagram-muted\">new row in <code>chat_threads</code>, description as first message</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">persist state</span><small class=\"diagram-muted\"><code>agent-task:&lt;id&gt;</code> &rarr; <code>application_state</code>, status=running</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">stream</span><small class=\"diagram-muted\"><code>agent_task_started</code> &rarr; chip appears; <code>agent_task_step</code> &rarr; chip updates live</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">complete</span><small class=\"diagram-muted\">status=completed, write summary + preview, emit <code>agent_task_done</code></small></div></div>",
  "css": ".at-life{display:flex;flex-direction:column;align-items:stretch;gap:6px;max-width:560px}.at-life .diagram-card{display:flex;flex-direction:column;gap:3px;padding:10px 14px}.at-life .diagram-box{align-self:flex-start}.at-life .diagram-arrow{font-size:18px;align-self:center}"
}
```

Der übergeordnete Agent kann den Subagenten jederzeit mit einer Nachverfolgung über `sendToTask(taskId, message)` fortsetzen. Wenn der Subagent einen Fehler macht, zeichnet `markTaskErrored(taskId, reason)` den Fehler auf und zeigt ihn dem Benutzer an.

Zwei-Wege-Nachrichtenübermittlung ist dauerhaft. Übergeordnete Folgemaßnahmen für laufende Unteragenten sind
wird während des Aufgabenlebenszyklus bereitgestellt; wenn der Subagent sie nicht verarbeiten kann
Im aktuellen Schritt sollten sie in der Warteschlange bleiben und an einem Safe angewendet werden
Fortsetzungspunkt. Unteragenten können auch eine Nachricht zurückschicken, wenn sie eine Klärung benötigen
anstatt unsichtbar zu blockieren.

## Aufgabenstatus lesen {#reading-state}

Aus Servercode oder anderem actions:

```ts
import { getTask, listTasks } from "@agent-native/core/server";

const task = await getTask(taskId); // single task
const tasks = await listTasks(); // all tasks for the user (sorted newest first)
```

Schlüsselfelder `AgentTask`:

```ts
interface AgentTask {
  taskId: string;
  threadId: string;
  description: string;
  status: "running" | "completed" | "errored";
  preview: string; // short one-liner for the chip
  summary: string; // full summary once completed
  currentStep: string; // latest step label (updated while running)
  createdAt: number;
  // Additional fields: parentThreadId, name, updatedAt, startedAt,
  // completedAt, runId, error
}
```

## Benutzerdefinierte Agentenprofile {#profiles}

Subagenten werden benutzerdefinierten Agentenprofilen zugeordnet – Markdown-Dateien unter `agents/<slug>.md` im Arbeitsbereich, die im `@mention`-Dropdown-Menü angezeigt werden und als Delegierungsziele dienen. [Workspace — Custom Agents](/docs/workspace#custom-agents) besitzt das vollständige Format (Frontmatter, `tools`, `delegate-default`, Modellüberschreibungen).

## Delegationstiefenschutz {#depth-guard}

Unteragenten können Unteragenten hervorbringen, was ein unkontrolliertes/Kostenrisiko darstellt: Eine unbegrenzte Kette von Delegationen könnte sich auf unbestimmte Zeit ausbreiten. Das Framework erzwingt eine **feste Obergrenze für die Delegationstiefe**, serverseitig, unabhängig von etwaigen Schutzmaßnahmen auf Toolebene.

Der Chat der obersten Ebene hat die Tiefe `0`. Ein von ihm erzeugter Subagent ist die Tiefe `1`; dieser Subagent kann noch einmal spawnen (Tiefe `2`); Ein Spawn, der einen Depth-`3`-Subagenten erstellen würde, wird **abgelehnt**. Die Standardobergrenze beträgt **2**.

```an-diagram title="Delegations-Tiefenschutz (Standardobergrenze 2)" summary="Jedes Level kann bis zur Obergrenze um eins tiefer spawnen; ein Spawn darüber hinaus wird serverseitig abgelehnt."
{
  "html": "<div class=\"at-depth\"><div class=\"diagram-card ok\"><span class=\"diagram-pill\">depth 0</span><strong>Top-Level-Chat</strong><small class=\"diagram-muted ok\">may spawn &darr;</small></div><div class=\"diagram-card ok\"><span class=\"diagram-pill\">depth 1</span><strong>Sub-Agent</strong><small class=\"diagram-muted ok\">may spawn &darr;</small></div><div class=\"diagram-card warn\"><span class=\"diagram-pill warn\">depth 2</span><strong>Sub-Agent des Sub-Agenten</strong><small class=\"diagram-muted\">at the cap &mdash; may NOT spawn</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">depth 3</span><strong>Refused</strong><small class=\"diagram-muted\">server-side error</small></div></div>",
  "css": ".at-depth{display:flex;flex-direction:column;gap:8px}.at-depth .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.at-depth .rung-1,.at-depth .diagram-card:nth-child(2){margin-inline-start:24px}.at-depth .diagram-card:nth-child(3){margin-inline-start:48px}.at-depth .diagram-card:nth-child(4){margin-inline-start:72px}"
}
```

Die Durchsetzung erfolgt in der Umgebung: Jeder Subagent läuft in einem `AsyncLocalStorage`, der seine eigene Tiefe aufzeichnet. Daher liest jeder von diesem Lauf transitiv erreichte `spawnTask` die Tiefe seines übergeordneten Agenten und weigert sich, sobald die Obergrenze erreicht wird – selbst wenn das `agent-teams`-Tool an einen Subagenten übergeben wurde, der es nicht hätte haben sollen. Die Entscheidung wird als reines, einheitlich testbares `evaluateSubagentDepth(parentDepth)` dargestellt. Ein verweigerter Spawn gibt einen eindeutigen Fehler zurück: _"Delegationstiefenlimit erreicht (max. N); es kann kein weiterer Subagent gespawnt werden."_

### Obergrenze konfigurieren {#depth-guard-config}

Überschreiben Sie die Standardeinstellung zum Zeitpunkt der Bereitstellung mit `AGENT_NATIVE_MAX_SUBAGENT_DEPTH`:

| Wert              | Effekt                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(nicht gesetzt)_ | Standardobergrenze von `2`.                                                                                                                                            |
| `0`               | **Es dürfen keine Unteragenten erzeugt werden** – der Agent der obersten Ebene erledigt die gesamte Arbeit.                                                            |
| `1`…`16`          | So viele Delegationsebenen.                                                                                                                                            |
| ungültig / `>16`  | Ein nicht ganzzahliger / negativer / NaN-Wert fällt auf `2` zurück; Alles über `16` wird an `16` geklemmt, sodass ein Tippfehler niemals den Schutz deaktivieren kann. |

```bash
AGENT_NATIVE_MAX_SUBAGENT_DEPTH=1   # Unteragenten sind zulässig, sie können jedoch keine Unterdelegationen durchführen
```

Wenn ein Subagent die Obergrenze erreicht oder unterschreitet, fügt das Framework eine Zeile in seinen Laufzeitkontext ein, die ihm mitteilt, wie tief er sitzt und ob er weiter delegieren darf, damit das Modell sein Budget angemessen ausgibt.

## Was kommt als nächstes?

- [**Workspace — Custom Agents**](/docs/workspace#custom-agents) – das Profilformat
- [**A2A Protocol**](/docs/a2a-protocol) – wenn der „Subagent“ vollständig in einer anderen App lebt
- [**Actions**](/docs/actions) – die Tools, die ein Subagent aufruft
