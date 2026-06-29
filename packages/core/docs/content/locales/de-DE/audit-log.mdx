---
title: "Audit-Protokoll"
description: "Eine dauerhafte, nur anhängbare Aufzeichnung darüber, wer welche App-Daten wann geändert hat und ob Sie oder der Agent es waren – automatisch erfasst, wenn die Aktion ausgeführt wird."
---

# Audit-Protokoll

Jede agentennative App erhält sofort ein Audit-Protokoll: eine dauerhafte, vollständige, zugriffsbezogene, nur anhängbare Aufzeichnung darüber, wer welche App-Daten wann, von wo und – wenn es der Agent war – in welcher Ausführung geändert hat.\*\* Die Erfassung erfolgt automatisch an der Aktionsstelle; Sie schreiben keinen Code dafür.

Da der Agent Daten in Ihrem Namen ändern kann, lautet die Hauptfrage, die ein Audit-Protokoll hier beantwortet, nicht nur „Wer hat diesen Datensatz bearbeitet?“ – sondern **„War das ich oder der Agent und wer hat das verursacht?“** Kein anderes System im Framework kann das beantworten.

## Audit vs. Beobachtbarkeit vs. Nachverfolgung {#which}

Drei Systeme zeichnen aus drei verschiedenen Gründen auf, „was passiert ist“. Wählen Sie die Frage aus, die Sie stellen:

| System                                   | Die Frage, die es beantwortet                                  | Treue                                 | Zielgruppe                                |
| ---------------------------------------- | -------------------------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| **Audit-Protokoll** (diese Seite)        | „Wer hat diesen Datensatz wann geändert und war es der Agent?“ | **Vollständig, langlebig, umfassend** | Benutzer, Administrator, der Agent selbst |
| **[Observability](/docs/observability)** | „Warum hat der Agent das getan und was hat es gekostet?“       | Gesamte Spannentelemetrie             | Entwickler                                |
| **[Tracking](/docs/tracking)**           | „Wie verwenden die Leute das Produkt?“                         | Fire-and-Forget zu externem SaaS      | PM / Wachstum                             |

Ein Prüfprotokoll, das als Stichprobe erstellt oder an einen Analyseanbieter gesendet wird, ist nutzlos – der springende Punkt ist, dass es vollständig, lokal und abfragbar ist. Es handelt sich also um ein eigenes Subsystem, nicht um einen Modus der anderen beiden.

## Was automatisch erfasst wird {#captured}

Wenn eine **mutierende** Aktion ausgeführt wird (alles, was kein schreibgeschütztes `GET` ist), hängt das Framework eine Zeile an `agent_audit_log` an mit:

- **Aktion** – der Aktionsname (z. B. `delete-recording`).
- **Akteur** – `agent`, `human` oder `system`, plus die E-Mail-Adresse des Schauspielers – wird **auch für Agentenanrufe** ausgefüllt, sodass Sie „der Agent, der für Alice@ handelt, …“ erhalten.
- **Run linkage** – der Agent `threadId` / `turnId`, der den Aufruf (einen Tool-Aufruf) ausgelöst hat, sodass eine Mutation auf den genauen Agentenzug zurückgeführt werden kann.
- **Oberfläche** – `tool` (Agent), `frontend`, `http`, `cli`, `mcp` oder `a2a`.
- **Ergebnis** – `success`, `error` (mit einem Fehlercode) oder `denied` (durch ein menschliches Genehmigungstor blockiert).
- **Eingaben** – die Aufrufargumente mit anmeldeinformationsförmigen Werten [redacted](#privacy).
- **Ziel und Eigentümer** – die Ressource, die durch die Aktion geändert wurde, verwendet für [scope reads](#reading).

Keine Verkabelung erforderlich – die Erfassung wird transparent in `defineAction` eingehängt. Schreibgeschützte actions werden übersprungen, und einige Hochfrequenz-Frameworks actions (App-State-Synchronisierung, Kontext-Röntgen, Navigation) werden standardmäßig übersprungen, um eine Überflutung des Protokolls zu vermeiden.

## Erklären Sie, was eine Aktion geändert hat {#target}

Standardmäßig ist ein Ereignis auf den **Akteur** beschränkt – Sie sehen Ihre eigenen Änderungen und die Änderungen des Agenten in Ihrem Namen. Um eine Änderung an einer _gemeinsamen_ Ressource auch im Trail des **Eigentümers** anzuzeigen und um Ereignisse nach Ressource zu kennzeichnen, deklarieren Sie ein `target`:

```ts
export default defineAction({
  description: "Delete a recording.",
  schema: z.object({ id: z.string() }),
  audit: {
    target: (args, result) => ({
      type: "recording",
      id: args.id,
      // Optional — defaults to the actor. Set when editing someone else's resource.
      ownerEmail: result?.ownerEmail,
      visibility: "org",
    }),
    summary: (args) => `Deleted recording ${args.id}`,
  },
  run: async (args, ctx) => {
    /* ...delete... */
  },
});
```

Alles in `audit` ist optional. Der minimale nützliche Zusatz ist `target: () => ({ type, id })`.

### Tuning-Aufnahme {#tuning}

| Option               | Effekt                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `audit.target`       | Beschriften Sie das Ereignis mit der Ressource und dem Bereich, den es seinem Besitzer vorliest. |
| `audit.summary`      | Eine kurze, für Menschen lesbare Zeile für das Ereignis.                                         |
| `audit.onRead`       | Überprüfen Sie einen vertraulichen **Lesevorgang** (geheimer Zugriff, Massenexport).             |
| `audit.enabled`      | `true` erzwingt die Erfassung; `false` verzichtet auf eine laute Mutation.                       |
| `audit.recordInputs` | `false` überspringt die Erfassung der (bereits redigierten) Argumente.                           |

## Die Spur lesen {#reading}

Zwei gelesene actions stehen dem Agenten **und** dem Frontend in jeder App zur Verfügung, in SQL auf den Anrufer beschränkt – sie geben niemals die Zeilen eines anderen Mandanten zurück:

- **`list-audit-events`** – Filter nach `targetType` / `targetId`, `actorKind` (`agent` | `human` | `system`), `status`, `threadId` / `turnId`, `action`, `sinceMs` und `limit`.
- **`get-audit-event`** – ein Ereignis nach ID, einschließlich seiner redigierten Eingabenutzlast.

Erstellen Sie einen Aktivitäts-Feed oder eine „Wer hat das geändert“-Zeile, indem Sie `list-audit-events` vom UI mit `useActionQuery` aufrufen – schreiben Sie niemals einen Abruf in die Prüftabelle von Hand:

```tsx
import { useActionQuery } from "@agent-native/core/client";

const { data } = useActionQuery("list-audit-events", {
  targetType: "recording",
  targetId: recordingId,
});
// data.events → [{ action, actorKind, actorEmail, turnId, status, summary, createdAt }, …]
```

Der Agent kann dieselbe Aktion aufrufen – fragen Sie ihn: „Was haben Sie an dieser Aufzeichnung geändert?“ und es antwortet von der Spur.

## Datenschutz und Aufbewahrung {#privacy}

- **Redaktion** – bevor Eingaben gespeichert werden, werden anmeldeinformationsförmige Schlüssel und Werte (Tokens, Geheimnisse, Passwörter, Trägerzeichenfolgen) entfernt und übergroße Nutzlasten abgeschnitten. Das Audit-Protokoll wird niemals zu einem sekundären Speicher für Geheimnisse. Halten Sie auch den `summary`-Text frei von sensiblen Daten.
- **Nur anhängen** – es gibt keine Aktualisierungs- oder Löschaktion für Prüfzeilen. Die einzige Löschung ist die Aufbewahrungsbereinigung, die das Protokoll als Prüfpfad vertrauenswürdig macht.
- **Mandantenisolation** – Lesevorgänge sind auf die Identität und Organisation des Aufrufers beschränkt; Ohne Identität stimmt nichts überein.

Über Umgebung konfigurieren:

- `AGENT_NATIVE_AUDIT_RETENTION_DAYS` – wie lange Zeilen aufbewahrt werden (Standard `365`; `0` = für immer behalten).
- `AGENT_NATIVE_AUDIT_ENABLED=false` – globaler Kill-Schalter.

## Was kommt als nächstes?

- [**Actions**](/docs/actions) – die `defineAction`-Naht, an der die Erfassung erfolgt
- [**Human-in-the-Loop Approvals**](/docs/human-approval) – geschlossenes actions, aufgezeichnet als `denied`
- [**Security & Data Scoping**](/docs/security) – Die Prüfung des Eigentumsmodells liest Wiederverwendung
- [**Observability**](/docs/observability) – vom Agenten ausgeführte Telemetrie (das andere „was passiert ist“)
