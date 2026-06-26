---
title: "Actions"
description: "defineAction – die einzelne Definition, die zu einem Agententool, typisierten Frontend-Hooks, Framework-Transport, einem MCP-Tool und einem CLI-Befehl wird."
---

# Actions

Actions sind die einzige Quelle der Wahrheit für alles, was Ihre App tut. Definieren Sie eine Aktion einmal mit `defineAction()`, legen Sie sie in `actions/` ab und sie ist sofort verfügbar als:

- **Ein Agenten-Tool** – der Agent sieht es mit einem von Zod abgeleiteten JSON-Schema und kann es im Chat aufrufen.
- **Typsichere React-Hooks** – `useActionQuery("name")` und `useActionMutation("name")` im Frontend, Typen aus dem Schema abgeleitet.
- **Imperative Client-Aufrufe** – `callAction("name", params)`, wenn ein Hook nicht passt.
- **Framework-Transport** – wird automatisch vom Framework hinter diesen Hooks bereitgestellt und ist für externe HTTP-Clients verfügbar.
- **Ein MCP-Tool** – verfügbar für benutzerdefinierte MCP-Apps von Claude, ChatGPT, Claude Desktop/Code, Cursor, Codex und alle anderen MCP-Clients.
- **Ein A2A-Tool** – wird von anderen agentennativen Apps über A2A aufgerufen.
- **Ein CLI-Befehl** – `pnpm action <name>` für Skripterstellung und Entwicklungsschleifen.

Eine Definition, sieben Verbraucher. Dies ist Sprosse 3 des [ladder](/docs/what-is-agent-native#the-ladder).
Wenn Sie entscheiden, ob Sie einen Vorgang kopflos, im Chat oder in einem
eingebetteter Sidecar oder als vollständiger App-Bildschirm, siehe [Agent Surfaces](/docs/agent-surfaces).

```an-diagram title="Eine Definition, sieben Verbraucher" summary="Ein einzelner defineAction() verteilt sich auf jede Oberfläche – Agent, UI, HTTP, MCP, A2A und CLI – mit einem validierten Schema und einem run()-Körper."
{
  "html": "<div class=\"diagram-fanout\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">defineAction()</span><small class=\"diagram-muted\">schema + run(), einmal definiert</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><div class=\"diagram-node\">Agentenwerkzeug<br><small class=\"diagram-muted\">JSON Schema im Kontext</small></div><div class=\"diagram-node\">React-Hooks<br><small class=\"diagram-muted\">useActionQuery/Mutation</small></div><div class=\"diagram-node\">callAction()<br><small class=\"diagram-muted\">imperativer Client</small></div><div class=\"diagram-node\">HTTP<br><small class=\"diagram-muted\">/_agent-native/actions/:name</small></div><div class=\"diagram-node\">MCP-Werkzeug<br><small class=\"diagram-muted\">externe Hosts</small></div><div class=\"diagram-node\">A2A-Tool<br><small class=\"diagram-muted\">andere agent-native Apps</small></div><div class=\"diagram-node\">CLI<br><small class=\"diagram-muted\">pnpm action &lt;name&gt;</small></div></div></div>",
  "css": ".diagram-fanout{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fanout .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-fanout .diagram-arrow{font-size:22px;line-height:1}.diagram-fanout .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

Wenn sowohl der UI als auch der Agent etwas tun müssen, greifen Sie zu einer Aktion – nicht zu einer benutzerdefinierten Aktion
Route. Wenn ein routenförmiges Protokoll der richtige Aufruf ist, lesen Sie [Bevorzugen Sie Actions
Für App Operations](/docs/server#actions-first).

## Beginnen Sie mit einer Aktion {#hello-action}

Die Primitive-First-Auffahrt ist eine Aktion, keine Vorlage. In einem kopflosen
Gerüst wie `agent-native create my-agent --headless`, das kann das sein
ganze erste App:

```ts
// actions/hello.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Sage Hallo vom lokalen Agenten.",
  schema: z.object({
    name: z.string().default("world"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
});
```

Führen Sie es aus demselben Ordner aus:

```bash
pnpm action hello '{"name":"Steve"}'
```

Der CLI akzeptiert ein JSON-Objekt als Aktionseingabe, das mit der Struktur übereinstimmt
Tool-Aufrufe, die Agenten bereits tätigen. Einfache Flags funktionieren weiterhin für schnelle manuelle Ausführungen:

```bash
pnpm action hello --name Steve
```

Führen Sie dann die App-Agent-Schleife für den Ordner aus:

```bash
pnpm agent "Call hello for Steve and explain the result"
```

Das ist die gleiche App-Agent-Schleife wie Ihre geplanten Jobs, Chat-Oberfläche, externer MCP
Tools und zukünftige Bildschirme werden verwendet. Chat- und Domänenvorlagen dienen zum Hinzufügen von UI
um actions, keine erforderliche Voraussetzung für die Aktion selbst.

## Eine Aktion definieren {#defining}

```an-annotated-code title="Anatomie einer Handlung"
{
  "filename": "actions/reply-to-email.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Reply to an email thread in the user's voice.\",\n  schema: z.object({\n    emailId: z.string().describe(\"The id of the email to reply to.\"),\n    body: z.string().describe(\"The reply body, in markdown.\"),\n  }),\n  run: async ({ emailId, body }) => {\n    await db.insert(replies).values({ emailId, body });\n    return { ok: true, emailId };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "Tool-Oberflaeche", "note": "`description` liest der Agent, um zu entscheiden, wann er diese Action aufruft. Die `.describe()`-Aufrufe pro Feld fliessen ebenfalls ins JSON Schema." },
    { "lines": "6-9", "label": "Typisierter Vertrag", "note": "Ein schema validiert Eingaben von **jeder** Oberfläche und wird für das Modell in JSON Schema umgewandelt. Ungültige Eingaben erreichen `run` nie." },
    { "lines": "10-13", "label": "Eine Implementierung", "note": "Der `run`-Body ist die einzige Quelle der Wahrheit: UI-Button und Agent-Tool fuehren genau das aus." }
  ]
}
```

Das ist es. Das Framework erkennt automatisch jede Datei in `actions/` und mountet sie beim Start.

### Schemaoptionen {#schemas}

`schema` akzeptiert jede [Standard Schema](https://standardschema.dev)-kompatible Bibliothek:

- **Zod** (v4) – am häufigsten, beste Typinferenz, automatische Konvertierung in das JSON-Schema.
- **Valibot** – minimale Bundle-Größe, falls das wichtig ist.
- **ArkType** – wenn Ihnen die Syntax gefällt.

Das Schema wird in das JSON-Schema für die Claude API-Tooldefinition konvertiert und zur Laufzeit verwendet, um Eingaben zu validieren, bevor `run()` ausgelöst wird. Ungültige Eingaben erreichen Ihren Handler nie.

### Überprüfung des Rückgabewerts {#output-schema}

`schema` validiert _Eingaben_. Um auch zu validieren, was eine Aktion **zurückgibt**, übergeben Sie ein `outputSchema` (jedes mit dem Standardschema kompatible Schema – Zod, Valibot, ArkType, gleiche Oberfläche wie `schema`). Das Framework validiert das Ergebnis _nach_ der Auflösung von `run()` und erstellt es mit Eingabevalidierung: Eingabe validiert vor `run`, Ausgabe validiert danach.

```ts
export default defineAction({
  description: "Summarize a thread.",
  schema: z.object({ threadId: z.string() }),
  outputSchema: z.object({
    summary: z.string(),
    messageCount: z.number(),
  }),
  outputErrorStrategy: "warn", // default
  run: async ({ threadId }) => {
    /* ...returns { summary, messageCount } ... */
  },
});
```

`outputErrorStrategy` steuert, was bei einer Nichtübereinstimmung passiert:

| Strategie    | Verhalten bei Nichtübereinstimmung                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `"warn"`     | **Default.** `console.warn` die Probleme und gibt das **ursprüngliche** Ergebnis unverändert zurück. Bruchsicher. |
| `"strict"`   | Wirf einen eindeutigen Fehler, damit eine fehlerhafte Aktion lautstark zum Vorschein kommt.                       |
| `"fallback"` | Gibt den bereitgestellten `outputFallback`-Wert anstelle des ungültigen Ergebnisses zurück.                       |

Bei Erfolg wird der **validierte** Wert zurückgegeben, sodass alle im `outputSchema` definierten Zwänge oder Standardeinstellungen wirksam werden (Spiegelung des Eingabepfads). Wenn kein `outputSchema` angegeben wird, bleibt das Verhalten Byte für Byte unverändert – es gibt keinen Umbruch. Dies ist von der strukturierten Ausgabe von Mastra/Flue entlehnt und auf der Aktionsebene abhängigkeitsfrei gehalten.

### HTTP-Konfiguration {#http}

Standardmäßig wird jede Aktion als `POST /_agent-native/actions/<name>` angezeigt. Überschreiben Sie mit der Option `http`:

```ts
export default defineAction({
  description: "Get details for a lead.",
  schema: z.object({ leadId: z.string() }),
  http: { method: "GET" },
  run: async ({ leadId }) => {
    return await db.select().from(leads).where(eq(leads.id, leadId));
  },
});
```

Für eine `GET`-Aktion wird `leadId` als Abfrageparameter übergeben: `/_agent-native/actions/get-lead?leadId=abc`.

```an-api title="Automatisch gemounteter Action-Endpunkt" method="GET" path="/_agent-native/actions/get-lead"
{
  "method": "GET",
  "path": "/_agent-native/actions/get-lead",
  "summary": "Jede Action wird hier automatisch gemountet - der Dateiname ist der Action-Name.",
  "description": "Standard ist POST; `http: { method: \"GET\" }` macht daraus GET. React-Hooks und `callAction` rufen diesen Pfad immer per Namen auf, unabhaengig von jedem `http.path` Override.",
  "auth": "Session-Cookie; Frontend-Aufrufe tragen `X-Agent-Native-Frontend: 1`",
  "params": [
    { "name": "leadId", "in": "query", "type": "string", "required": true, "description": "GET-Argumente kommen als Query-Parameter an; POST-Argumente im JSON-Body." }
  ],
  "responses": [
    { "status": "200", "description": "Der Rueckgabewert der Action als JSON." },
    { "status": "400", "description": "Die Eingabe ist vor dem Start von run() an der Schema-Validierung gescheitert." }
  ]
}
```

- **`http: { method: "GET" | "POST" | "PUT" | "DELETE" }`** – Standard `POST`. `GET` actions werden automatisch als `readOnly` markiert, sodass erfolgreiche Anrufe keine UI-Umfrageaktualisierung auslösen.
- **`http: { path: "..." }`** – überschreibt den gemounteten URL unter `/_agent-native/actions/`. Standardmäßig wird der Dateiname verwendet. **Pfadüberschreibungen ändern den URL nur für direkte HTTP-Aufrufer** – `useActionQuery`, `useActionMutation` und `callAction` rufen unabhängig von dieser Überschreibung immer `/_agent-native/actions/<name>` auf, sodass das Überschreiben des Pfads diese Hooks zu 404 macht. Verwenden Sie Pfadüberschreibungen nur für externe HTTP-Aufrufer. Beachten Sie auch, dass `:param`-Routensegmente im Override-Pfad **nicht** in `run()`-Argumente geparst werden – nur Abfragezeichenfolgenparameter und JSON-Textfelder.
- **`http: false`** – Deaktivieren Sie den HTTP-Endpunkt vollständig. Nur Agent + CLI.
- **`readOnly: true`** – Überspringen Sie die Polling-Aktualisierung explizit, auch für POST actions, die nicht mutieren.
- **`parallelSafe: true`** – ermöglicht die gleichzeitige Ausführung einer Mutationsaktion mit anderen Werkzeugaufrufen für die gleiche Drehung. Legen Sie dies nur fest, wenn die Aktion intern nebenläufigkeitssicher und reihenfolgeunabhängig ist. mutierende actions-Serialisierung standardmäßig.

### Halten Sie die Aktionsfläche klein {#small-surface}

Jede Aktion, die der Agent sehen kann, ist ein Werkzeug im Kontextfenster des Modells, und eine lange, überlappende Werkzeugliste beeinträchtigt die Qualität der Werkzeugauswahl des Modells. Gestalten Sie die Aktionsoberfläche wie ein von Ihnen verwaltetes API, nicht eine Aktion pro UI-Angebot:

- Bevorzugen Sie **einen CRUD-Stil `update`**, der einen Patch optionaler Felder anstelle von N actions pro Feld (`update-name`, `update-order`, `update-color`, …) benötigt. Der Anrufer sendet nur das, was sich geändert hat.
- Bevor Sie eine neue Leseaktion pro Abfrage/Filter hinzufügen, greifen Sie zu einem generischen Fluchtweg: dem [provider API trio](/docs/template-dispatch) (`provider-api-catalog` / `provider-api-docs` / `provider-api-request`) für Anbieterdaten oder dem Entwicklertool `db-query` für App-Daten.
- Markieren Sie UI-only oder programmatische actions [`agentTool: false`](#agent-tool), damit sie Frontend/HTTP-aufrufbar bleiben, ohne einen Platz in der Toolliste des Modells zu belegen.
- Löschen oder verbergen Sie actions, die UI nicht mehr verwendet, anstatt sie dem Modell zugänglich zu machen.

Ein Beratungshelfer auf Repo-Ebene, `node scripts/audit-template-actions.mjs [template ...]` (alias `pnpm actions:audit`), scannt statisch den `actions/` einer Vorlage und markiert wahrscheinlich UI-tote actions und redundante feldbezogene Cluster. Es handelt sich nur um eine Empfehlung (wird immer bei 0 beendet, CI schlägt nie fehl) und verwendet konservative Heuristiken. Überprüfen Sie daher die Vorschläge, anstatt sie als Fehler zu behandeln.

### Belichtungsflags {#exposure-flags}

Vier Flags steuern, _wer_ eine Aktion aufrufen kann. Alle sind standardmäßig auf den zulässigen Wert eingestellt, sodass Sie nur einen festlegen, um eine bestimmte Oberfläche zu straffen. Diese Tabelle ist die übersichtliche Zusammenfassung; Die Unterabschnitte fügen jeweils das eine Detail hinzu, das jeder benötigt.

| Flagge          | Standard     | Einschränkender Wert → wer noch anrufen kann                                            | Typische Verwendung                                                                           |
| --------------- | ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `agentTool`     | `true`       | `false` → Nur UI, HTTP, CLI – **vom Modell ausgeblendet**, MCP und A2A                  | UI-nur / programmatisches actions, das keinen Tool-Slot verschwenden sollte                   |
| `toolCallable`  | `true`       | `false` → alles **außer** der Sandbox-Erweiterung Iframe Bridge (403)                   | Benachbarte Vorgänge autorisieren (Konto löschen, Organisationsmitgliedschaft/-rollen ändern) |
| `publicAgent`   | aus (privat) | `{ expose: true }` → fügt die Aktion **öffentlichen** MCP/A2A/OpenAPI-Oberflächen hinzu | Sichere Lese-/Ingest-Tools, die ohne Authentifizierung erreichbar sind                        |
| `needsApproval` | `false`      | `true` → der Agent **pausiert**; Ein Mensch muss den konkreten Anruf genehmigen         | Folgenebenwirkungen (E-Mail senden, Karte aufladen, löschen)                                  |

Diese sind unabhängig: `agentTool` steuert die Modellansicht, `toolCallable` steuert nur den Erweiterungs-Iframe, `publicAgent` fügt eine öffentliche Opt-in-Oberfläche hinzu (öffentliche Webrouten bedeuten niemals die Offenlegung öffentlicher Tools) und `needsApproval` steuert die Ausführung, nachdem der Aufruf erfolgt ist – siehe [Human-in-the-loop approval](#needs-approval) unten.

#### `agentTool` – vor dem Modell verstecken {#agent-tool}

Standardmäßig ist jede Aktion ein aufrufbares Agententool. Stellen Sie `agentTool: false` so ein, dass es hinter der Authentifizierungs- und Aktionsoberfläche des Frameworks bleibt, während Sie es aus jeder Agent-Tool-Liste entfernen – es bleibt von UI (`useActionMutation` / `callAction`), CLI und `/_agent-native/actions/<name>` aufrufbar:

```ts
export default defineAction({
  description: "Persist the user's sidebar width.",
  agentTool: false, // UI-only — not a tool in the model's context window
  schema: z.object({ widthPx: z.number() }),
  http: { method: "PUT" },
  run: async ({ widthPx }) => {
    /* ... */
  },
});
```

Reichen Sie danach, wenn Sie eine reine UI-Aktion oder eine rein programmatische Aktion hinzufügen oder wenn der UI eine Aktion nicht mehr verwendet, die Sie sonst dem Modell überlassen würden.

#### `toolCallable` – blockiert den Erweiterungs-Iframe {#tool-callable}

Erweiterungen ([Alpine.js mini-apps in sandboxed iframes](/docs/extensions)) rufen actions über `appAction(name, params)` auf und werden mit den Berechtigungen, Geheimnissen und dem SQL-Bereich des _Viewers_ ausgeführt. Für Operationen mit großem Explosionsradius ist das standardmäßig zu viel Vertrauen. Stellen Sie `toolCallable: false` so ein, dass die Erweiterungsbrücke 403 zurückgibt, während die Aktion weiterhin von UI, Agent, CLI, MCP und A2A aufrufbar bleibt:

```ts
export default defineAction({
  description: "Delete the current user's account.",
  toolCallable: false, // never callable from an extension iframe
  schema: z.object({ confirm: z.literal("yes") }),
  run: async () => {
    /* ... */
  },
});
```

Verwenden Sie es für actions, die Konten/Organisationen löschen oder übertragen, den Authentifizierungsstatus ändern, die Organisationsmitgliedschaft ändern oder Freigabezugriff gewähren. Die im Framework integrierten Elemente `share-resource`, `unshare-resource` und `set-resource-visibility` sind bereits deaktiviert. Die Durchsetzung erfolgt durch einen nicht poofbaren Host-Set-Header bei Iframe-Aufrufen. reguläre UI/agent/CLI/MCP/A2A-Aufrufe sind nicht betroffen – Einzelheiten finden Sie unter [Security](/docs/security).

### Kontext ausführen (zweites Argument) {#run-context}

`run` empfängt ein optionales zweites Argument, `ctx`, das die aufgelöste Anforderungsidentität und die Oberfläche enthält, die die Aktion aufgerufen hat. Lesen Sie es, anstatt `getRequestUserEmail()` / `getRequestOrgId()` manuell aufzurufen, und übergeben Sie das gesamte `ctx` an die Nachverfolgung:

```ts
export default defineAction({
  description: "Log an audit entry for the current request.",
  schema: z.object({ event: z.string() }),
  run: async (args, ctx) => {
    // ctx is undefined-safe: a 1-arg `run(args)` is still valid.
    const actor = ctx?.userEmail ?? "system";
    if (ctx?.caller === "frontend") {
      // tighter rules for browser-initiated calls, looser for "tool"/"cli"
    }
    await db.insert(audit).values({
      actor,
      orgId: ctx?.orgId ?? null,
      source: ctx?.caller ?? "unknown",
      event: args.event,
    });
    return { ok: true };
  },
});
```

`ActionRunContext`-Felder:

| Feld          | Typ                     | Notizen                                                                                                                                                                                  |
| ------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userEmail`   | `string \| undefined`   | Resolved request user. **Never defaulted to a dev identity** — `undefined` when the request has no authenticated user. Apply your own fallback if you need one.                          |
| `orgId`       | `string \| null`        | Aufgelöste Organisations-ID oder `null`, wenn die Anfrage keine Organisation hat.                                                                                                        |
| `caller`      | `ActionCaller`          | Wie die Aktion aufgerufen wurde (siehe unten).                                                                                                                                           |
| `send`        | `(event) => void`       | Optional. Senden Sie ein SSE-Ereignis an den Client. Nur innerhalb der Agent-Tool-Schleife vorhanden (`caller: "tool"`); `undefined` anderswo.                                           |
| `attachments` | `AgentChatAttachment[]` | Dateien, Bilder und eingefügte Textblöcke, die mit der aktuellen Agentenrunde übermittelt wurden. Wird nur ausgefüllt, wenn `caller: "tool"`; `undefined` auf allen anderen Oberflächen. |

`caller` ist die Vereinigung `"tool" | "http" | "frontend" | "cli" | "mcp" | "a2a"`:

| `caller`     | Festlegen, wann…                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"tool"`     | Die In-App-Agentenschleife, ein Subagent/Agenten-Team oder eine A2A-Anfrage (A2A steuert dieselbe Agentenschleife, daher lauten die Toolaufrufe `"tool"`). |
| `"frontend"` | Ein Browseraufruf über `useActionMutation` / `useActionQuery` / `callAction` (getaggt mit dem `X-Agent-Native-Frontend: 1`-Header).                        |
| `"http"`     | Ein reines programmatisches `POST` / `GET` bis `/_agent-native/actions/<name>` ohne den Frontend-Marker.                                                   |
| `"cli"`      | `pnpm action <name>` (der CLI-Läufer).                                                                                                                     |
| `"mcp"`      | Ein externer Agent über den MCP `tools/call`-Endpunkt.                                                                                                     |
| `"a2a"`      | Reserviert für einen zukünftigen direkten A2A-Aktionsversand. Heute durchläuft A2A die Agentenschleife, daher lauten diese Aufrufe `"tool"`.               |

`run` bleibt abwärtskompatibel: Bestehende 1-Argument-Handler und Handler, die nur `{ send }` zerstören, funktionieren unverändert weiter.

### Zugriffskontrolle in actions {#access-control}

Benutzereigene Tabellen müssen Lesevorgänge über `accessFilter` und Schreibvorgänge über `assertAccess` umfassen – dieselben Helfer, die das Freigabesystem des Frameworks verwendet. Hier ist ein vollständiges, einfügebereites Beispiel:

```ts
// actions/create-lead.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import * as schema from "../server/db/schema.js";

export default defineAction({
  description: "Create a lead in the CRM.",
  schema: z.object({ name: z.string(), company: z.string() }),
  run: async ({ name, company }, ctx) => {
    const db = getDb();
    await db.insert(schema.leads).values({
      id: crypto.randomUUID(),
      name,
      company,
      ownerEmail: ctx?.userEmail ?? "system",
    });
    return { ok: true };
  },
});
```

Zum Auflisten und Lesen von actions verwenden Sie `accessFilter`, um die Abfrage auf den aktuellen Benutzer und die aktuelle Organisation zu beschränken. Für actions, die eine bestimmte Zeile aktualisieren oder löschen, verwenden Sie `assertAccess`, um vor dem Schreiben zu bestätigen, dass der Aufrufer zugelassen ist. Den vollständigen Helfer API finden Sie unter [Security](/docs/security#access-guards) und [Sharing](/docs/sharing).

### Human-in-the-Loop-Genehmigung {#needs-approval}

Einige actions sind zu folgenreich, um den Agenten autonom laufen zu lassen – das Senden einer E-Mail, das Aufladen einer Karte, das Löschen eines Kontos. Stellen Sie für diese Fälle `needsApproval` so ein, dass die Schleife angehalten wird und ein Mensch den spezifischen Aufruf genehmigen muss, bevor `run()` ausgeführt wird:

```ts
export default defineAction({
  description: "Send an email via Gmail.",
  schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  needsApproval: true, // pause; a human must approve this specific send
  run: async (args) => {
    /* ...actually send... */
  },
});
```

`needsApproval` akzeptiert auch ein Prädikat `(args, ctx) => boolean | Promise<boolean>` zum bedingten Gaten (z. B. nur externe Empfänger, nur oberhalb eines Schwellenwerts); es **schlägt nicht geschlossen**, sodass ein Wurf als „Genehmigung erforderlich“ gilt. Wenn das Tor wahr und nicht genehmigt ist, stoppt die Schleife die Runde und der Nebeneffekt wird erst ausgelöst, wenn ein Mensch im Chat-Oberfläche zustimmt.

> [!WARNING]
> Halten Sie Genehmigungen selten. Jede Gated-Aktion stellt einen harten Stopp in der Agentenschleife dar. Die Standardeinstellung ist **off** und sollte bei fast jeder Aktion ausgeschaltet sein. Siehe [Human-in-the-Loop Approvals](/docs/human-approval) für das Prädikat API, das `approval_required`-Ereignis und den vollständigen Ablauf.

### Audit-Protokollierung {#audit}

Jede mutierende Aktion wird **automatisch geprüft** – das Framework zeichnet auf, wer sie wann, von welcher Oberfläche und (als es der Agent war) welcher Thread/welche Runde ausgeführt hat, mit geschwärzten Eingaben. Schreibgeschützt (`GET`) actions werden übersprungen. Sie schreiben hierfür keinen Code; es passiert an der `defineAction`-Naht.

Fügen Sie einen `audit`-Block nur zur _tune_-Erfassung hinzu – am nützlichsten, um die Ressource zu deklarieren, die die Aktion geändert hat, damit die Änderung im Pfad des Besitzers dieser Ressource angezeigt wird:

```ts
export default defineAction({
  description: "Delete a recording.",
  schema: z.object({ id: z.string() }),
  audit: {
    target: (args, result) => ({ type: "recording", id: args.id }),
    summary: (args) => `Deleted recording ${args.id}`,
  },
  run: async (args, ctx) => {
    /* ...delete... */
  },
});
```

Andere Knöpfe: `audit: { onRead: true }` prüft einen sensiblen Lesevorgang (geheimer Zugriff, Massenexport); `audit: { enabled: false }` entscheidet sich für ein lautes Schreiben; `audit: { recordInputs: false }` überspringt die Erfassung von Argumenten. Lesen Sie den Trail mit dem eingebauten `list-audit-events` / `get-audit-event` actions zurück. Ausführliche Informationen finden Sie in [Audit Log](/docs/audit-log).

## Aufruf vom UI aus {#ui}

Zwei Haken, beide in `@agent-native/core/client`. Typen werden aus Ihren `defineAction`-Schemas abgeleitet – keine manuellen Typdeklarationen.

### `useActionMutation` {#use-action-mutation}

Für actions, die den Status ändern:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button
  disabled={isPending}
  onClick={() => mutate({ emailId, body: "Thanks!" })}
>
  Send Reply
</Button>;
```

Bei Erfolg gibt das Framework ein Änderungsereignis mit `source: "action"` aus, sodass `useActionQuery`-Konsumenten und aktive Abfragebeobachter automatisch erneut abrufen. Siehe [Live Sync](/docs/key-concepts#polling-sync).

### `useActionQuery` {#use-action-query}

Für schreibgeschütztes GET actions:

```ts
import { useActionQuery } from "@agent-native/core/client";

const { data, isLoading } = useActionQuery("get-lead", { leadId });
```

Die Abfrage wird unter `["action", "get-lead", { leadId }]` zwischengespeichert und bei jeder abgeschlossenen Mutationsaktion automatisch ungültig gemacht.

## Nativen Chat rendern UI {#native-chat-ui}

Actions kann strukturierte Widget-Daten zurückgeben, die der In-App-Chat rendert
nativ. Dies ist der Erstanbieter-Chatpfad für wiederverwendbare Tabellen, Diagramme und Einrichtung
Zusammenfassungen und Erkenntniskarten; Verwenden Sie [MCP Apps](/docs/mcp-apps) für Inline-UI in
externe MCP-Hosts.

```ts
import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER } from "@agent-native/core/action-ui";
import {
  createDataInsightsWidgetResult,
  dataInsightsWidgetResultSchema,
} from "@agent-native/core/data-widgets";

export default defineAction({
  description: "Summarize response trends.",
  readOnly: true,
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: { renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER },
  run: async () =>
    createDataInsightsWidgetResult({
      title: "Response trends",
      chartSeries: {
        type: "line",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [
          { day: "Mon", responses: 12 },
          { day: "Tue", responses: 18 },
        ],
      },
      table: {
        columns: [
          { key: "day", label: "Day" },
          { key: "responses", label: "Responses", align: "right" },
        ],
        rows: [
          { day: "Mon", responses: 12 },
          { day: "Tue", responses: 18 },
        ],
      },
    }),
});
```

Die integrierten Diskriminanten sind `"data-table"`, `"data-chart"` und
`"data-insights"`, mit serversicheren Buildern und Schemas in
`@agent-native/core/data-widgets`. Siehe [Native Chat-Oberfläche](/docs/native-chat-ui)
für den vollständigen Ergebnisvertrag und die BYO-Laufzeitanleitung, oder
[Agent Surfaces](/docs/agent-surfaces) dafür, wie die gleiche Aktion beibehalten werden kann
kopflos, im Chat rendern oder in einen Vollbildmodus verwandeln.

## Aufruf vom CLI aus {#cli}

Jede Aktion ist über `pnpm action` ausführbar:

```bash
pnpm action reply-to-email '{"emailId":"thread-123","body":"Thanks!"}'
```

JSON-Eingabe ist die bevorzugte Form für Agenten und komplexe Objekte. Flags sind
für einfache manuelle Ausführungen und bestehende immer noch in die gleiche Schemaform geparst
Skripte. Nützlich für Agent-Dev-Schleifen, Skripte und Cron.

## Aufruf von einem anderen Agenten (A2A) {#a2a}

Wenn Ihre App ein [A2A](/docs/a2a-protocol)-Peer ist, erkennen andere agentennative Apps Ihren actions automatisch und können ihn beim Namen nennen. Same-Origin-Bereitstellungen überspringen die JWT-Signierung; Cross-Origin verwendet ein gemeinsames `A2A_SECRET`.

## Es über MCP verfügbar machen {#mcp}

Wenn MCP aktiviert ist, wird Ihr actions auf dem MCP-Server des Frameworks unter `/_agent-native/mcp` angezeigt. Jeder Anrufer erhält standardmäßig einen kompakten Katalog – App-orientierte integrierte Apps sowie die in der Vorlage deklarierte App actions – und `tool-search` ist immer vorhanden, sodass jedes andere Tool bei Bedarf erreichbar bleibt. Die vollständige Aktionsoberfläche wird nur bei explizitem Opt-in bereitgestellt (`--full-catalog`-Token oder `AGENT_NATIVE_MCP_FULL_CATALOG=1`), und `publicAgent.expose` wählt ein sicheres Lese-/Aufnahmetool für die öffentliche Oberfläche aus. Siehe [MCP Protocol](/docs/mcp-protocol) für Katalogstufen, Authentifizierung und die `mcpApp`-Ressourcendetails.

Für UI-fähige MCP-Hosts kann eine Aktion eine optionale MCP-Apps-Ressource über das `mcpApp`-Feld (plus ein passendes `link`) deklarieren, sodass fähige Hosts das Ergebnis inline rendern. Wenn `link` und `mcpApp` auf die gleiche Route zeigen sollen, erstellt `embedRoute()` beide aus einem reinen Pfad-Builder:

```ts
import { embedRoute } from "@agent-native/core";

export default defineAction({
  description: "Create an email draft for review.",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => ({ body }),
  ...embedRoute({
    title: "Review draft",
    openLabel: "Open in Mail",
    path: ({ result }) => ({
      label: "Open draft in Mail",
      url: "/_agent-native/open?app=mail&view=inbox",
    }),
  }),
});
```

Behalten Sie `link` als Fallback für CLI- und Nicht-UI-MCP-Clients bei; Es ist auch das Startziel der Einbettung. Die Embed Bridge – die signierte Embed-Start-Sitzung, Transplantation vs. Controlled-Frame-Rendering, die `ui/*` Host Bridge, CSP und Height Clamping – ist Eigentum von [External Agents](/docs/external-agents#mcp-app-bridge).

## Standard actions {#standard-actions}

Jede Vorlage sollte diese beiden für [context awareness](/docs/context-awareness) enthalten:

### Ansichtsbildschirm {#view-screen}

Liest den aktuellen Navigationsstatus, ruft Kontextdaten ab und gibt einen Schnappschuss dessen zurück, was der Benutzer sieht. Der Agent ruft dies auf, wenn er einen neuen Blick auf den Bildschirm benötigt.

```ts
// actions/view-screen.ts
import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Read the current screen state for context.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const navigation = await readAppState("navigation");
    const screen: Record<string, unknown> = { navigation };

    if (navigation?.view === "inbox") {
      screen.emailList = await listEmailsForLabel(navigation.label);
    }

    return screen;
  },
});
```

### navigieren {#navigate}

Schreibt einen einmaligen Navigationsbefehl in den Anwendungsstatus. Der UI liest ihn, navigiert und löscht den Eintrag.

```ts
// actions/navigate.ts
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the user to a view.",
  schema: z.object({
    view: z.string(),
    threadId: z.string().optional(),
  }),
  run: async (args) => {
    await writeAppState("navigate", args);
    return { ok: true };
  },
});
```

## Legacy CLI-Stil actions {#legacy-cli-actions}

Das Framework unterstützt weiterhin ältere `export default async function(args)` actions, die nicht in `defineAction` verpackt sind – nützlich für einmalige Entwicklungsskripte, die keine Agent/HTTP-Offenlegung benötigen. Dies sind nur CLI; Sie erscheinen nicht als Agent-Tools, mounten keine HTTP-Endpunkte und erhalten keine typsicheren Frontend-Hooks.

```ts
// actions/debug-dump.ts — CLI-only
import { parseArgs } from "@agent-native/core";

export default async function main(args: string[]) {
  const { table } = parseArgs(args);
  // one-off script you wouldn't want the agent to call
}
```

Neuer Code sollte `defineAction()` bevorzugen. Greifen Sie nur dann zu diesem Muster, wenn Sie absichtlich nicht möchten, dass die Aktion Agenten oder UI ausgesetzt wird.

### `parseArgs(args)` {#parseargs}

Helfer für actions im Legacy-Stil. Analysiert CLI-Argumente im `--key value`- oder `--key=value`-Format:

```ts
import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }
```

## Hilfsfunktionen {#utility-functions}

| Funktion                | Retouren  | Beschreibung                                                             |
| ----------------------- | --------- | ------------------------------------------------------------------------ |
| `loadEnv(path?)`        | `void`    | `.env` aus dem Projektstamm (oder einem benutzerdefinierten Pfad) laden. |
| `camelCaseArgs(args)`   | `Record`  | Kebab-Case-Schlüssel in CamelCase konvertieren.                          |
| `isValidPath(p)`        | `boolean` | Validieren Sie einen relativen Pfad (kein Durchlauf, kein absoluter).    |
| `isValidProjectPath(p)` | `boolean` | Validieren Sie einen Projekt-Slug (z. B. `my-project`).                  |
| `ensureDir(dir)`        | `void`    | `mkdir -p`-Helfer.                                                       |
| `fail(message)`         | `never`   | Drucken auf stderr und `exit(1)`.                                        |

## Was kommt als nächstes?

- [**Audit Log**](/docs/audit-log) – die automatische Wer-was-Änderung-Nachverfolgung bei jeder Aktion
- [**Human-in-the-Loop Approvals**](/docs/human-approval) – das `needsApproval`-Tor im Detail
- [**Drop-in Agent**](/docs/drop-in-agent) – `useActionMutation` / `useActionQuery` in React
- [**Context Awareness**](/docs/context-awareness) – das `view-screen` + `navigate`-Muster im Detail
- [**A2A Protocol**](/docs/a2a-protocol) – wie andere Agenten Ihren actions entdecken und anrufen
- [**MCP Protocol**](/docs/mcp-protocol) – Belichtung von actions über MCP
