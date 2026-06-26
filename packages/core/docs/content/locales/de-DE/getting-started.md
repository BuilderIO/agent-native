---
title: "Erste Schritte"
description: "Erstellen Sie eine Agenten-App, verstehen Sie die Anweisungen skills und actions und beobachten Sie dann, wie der Agent seine erste Aktion aufruft."
---

# Erste Schritte

Agent-Native-Apps geben einem KI-Agenten und Ihrem UI die gleichen actions, Daten und
Zustand. Ein Basisagent besteht aus Anweisungen, die ihn leiten, skills, die ihn lehren
wiederholbares Verhalten und actions, mit dem es echte Arbeit leisten kann.

**Möchten Sie eine vollständige App als Ausgangspunkt?** Klonen Sie eine unserer umfangreichen Vorlagen –
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics) und [many more](/docs/cloneable-saas) –
Jede davon ist eine App mit vollem Funktionsumfang, die Sie anpassen können.

Von Grund auf neu bauen? Die einzige Wahl im Voraus ist, ob Sie einen UI möchten –
alles danach (Anweisungen schreiben, skills hinzufügen, actions definieren, ausführen
der Agent) ist in beiden Fällen gleich.

```an-file-tree title="Ein einfacher Agent-Native-Agent"
{
  "entries": [
    { "path": "AGENTS.md", "note": "Immer aktive Anweisungen: Zweck, Regeln, Ton und Karte dessen, was der Agent tun kann" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "Ein wiederverwendbares Playbook, das der Agent lädt, wenn die Aufgabe passt" },
    { "path": "actions/summarize-week.ts", "note": "Typisierter Code, den Agent, UI, CLI, HTTP, MCP, A2A, Jobs und Webhooks ausführen können" }
  ]
}
```

Dies gilt unabhängig davon, ob Sie mit einem Chat-Oberfläche, einem Headless-Agenten oder einer vollständigen App beginnen.
Der UI verändert die Oberfläche; Anweisungen, skills und actions geben dem Agenten seine
Anleitung und Verhalten.

## 1. Erstellen Sie Ihre App

Sie benötigen [Node.js 22+](https://nodejs.org) und [pnpm](https://pnpm.io).

Führen Sie `create` ohne Flags aus und Sie werden gefragt, wie Sie beginnen möchten (eine vollständige Vorlage).
Chat oder Headless) vor allem anderen:

```bash
npx @agent-native/core@latest create my-app
```

Oder übergeben Sie ein Flag, um die Eingabeaufforderung zu überspringen:

**Möchten Sie ein UI?** Beginnen Sie mit der Chat-Vorlage. Sie erhalten einen Arbeitsagenten plus ein
Anpassbarer Chat-Oberfläche, und jede von Ihnen hinzugefügte Aktion wird automatisch darin angezeigt:

```bash
npx @agent-native/core@latest create my-app --template chat
```

**Nur das Headless-Grundelement?** Headless starten – derselbe actions und Agent
Schleife, keine UI-Shell:

```bash
npx @agent-native/core@latest create my-agent --headless
```

Installieren Sie dann aus dem von Ihnen erstellten Ordner:

```bash
cd my-agent # oder my-app, wenn Sie die Chat-Vorlage gewählt haben
pnpm install
```

Von hier an sind die beiden identisch.

## 2. Fügen Sie eine Aktion hinzu

Eine Aktion ist ein Vorgang, den Ihr Agent – und Ihr UI – aufrufen kann. Beide Gerüste
Versenden Sie mit diesem Beispiel:

```an-annotated-code title="Deine erste Action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Sage Hallo vom lokalen Agenten.\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "Tool-Beschreibung", "note": "Der Agent liest `description`, um zu entscheiden, wann er dies als Tool aufruft." },
    { "lines": "6-8", "label": "Typisierter Vertrag", "note": "Ein zod-`schema` validiert Eingaben von jeder Oberfläche: Agent, UI, HTTP, MCP und A2A." },
    { "lines": "9", "label": "HTTP-Verb", "note": "Schalte diese Action für einen automatisch eingebundenen HTTP-Endpunkt frei." },
    { "lines": "10", "label": "Schreibgeschützt", "note": "`readOnly` markiert die Action als ohne Genehmigung sicher aufrufbar und für Abfragen cachebar." },
    { "lines": "11-13", "label": "Eine Implementierung", "note": "Der `run`-Block ist die einzige Wahrheit, die jede Oberfläche ausführt." }
  ]
}
```

Ersetzen Sie `hello` durch den ersten echten Vorgang in Ihrer Domäne. Sie definieren es einmal;
Jede Oberfläche nimmt es auf.

Verwenden Sie `AGENTS.md` als Anleitung, die in jeder Runde gelten sollte. Verwenden Sie eine Fertigkeit, wenn
Agent benötigt einen wiederverwendbaren Workflow oder eine wiederverwendbare Domänenprozedur. Verwenden Sie eine Aktion, wenn
Der Agent benötigt eine typisierte, testbare Möglichkeit, Daten zu lesen, Daten zu schreiben, einen API aufzurufen oder
Führen Sie eine Genehmigung durch.

## 3. Führen Sie es aus

Aktion direkt aufrufen:

```bash
pnpm action hello --name Steve
```

Oder bitten Sie den Agenten, für Sie anzurufen:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

Wenn Sie mit der Chat-Vorlage begonnen haben, führen Sie die App aus und verwenden Sie denselben Agenten in
Browser – er kann bereits jede von Ihnen definierte Aktion aufrufen:

```bash
pnpm dev
```

Diese eine Aktion ist jetzt über den Chat-Oberfläche, CLI, HTTP, MCP, A2A, erreichbar.
geplante Jobs und webhooks. Einmal festlegen, von überall aus anrufen.

```an-diagram title="Eine Aktion, jede Oberfläche" summary="Eine einzelne defineAction-Datei wird ohne zusätzliche Verkabelung an jeden Verbraucher verteilt."
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">Chat-Oberfläche</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">Geplante Jobs</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Status ist integriert

Kopflos bedeutet nicht staatenlos. Actions, Sitzungen, Anwendungsstatus, Threads,
Ausführungsverlauf und Anmeldeinformationen sind alle in SQL gespeichert. Lokal ist das SQLite bei
`data/app.db`; In der Produktion legen Sie `DATABASE_URL` fest. Siehe
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**Headless ist immer noch eine echte App.** Die App-Agent-Schleife speichert Sitzungen, Threads, Ausführungen, Einstellungen und Anmeldeinformationen in SQL – es handelt sich nicht um eine zustandslose Eingabeaufforderung. Sie können später eine Benutzeroberfläche hinzufügen, ohne Ihre Aktionen oder Ihren Status zu ändern."
}
```

## UI anpassen

Wenn Sie mit der Chat-Vorlage begonnen haben, können Sie UI bearbeiten. Der Chat selbst
ist eine kleine Route, die auf der `<AgentChatSurface>`-Komponente basiert:

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** – die Chat-Seite. Ändern Sie die Vorschläge, leer
  Zustand und Layout.
- **`app/root.tsx`** – die App-Shell. Fügen Sie Ihre eigenen Routen und Bildschirme rund um das
  Agent.
- Legen Sie den Agenten mit `<AgentSidebar>` in einen beliebigen Bildschirm und bearbeiten Sie ihn von einem aus
  mit `sendToAgentChat()` oder führen Sie eine Aktion direkt mit
  `useActionMutation()`.

Siehe [Drop-in Agent](/docs/drop-in-agent) für den vollständigen Komponentensatz und
[Native Chat-Oberfläche](/docs/native-chat-ui) zum Rendern von Aktionsergebnissen als Tabellen
Diagramme und getippte Karten anstelle von reinem Text.

**Kopflos gestartet und später ein UI wollen?** Die Chat-Vorlage _ist_ die UI-Auffahrt –
seine `app/`-Schicht (React Router + Vite) ist genau das, was das Headless-Gerüst ist
lässt weg. Der sauberste Schritt besteht darin, vom Chat aus zu starten (oder ein neues Gerüst zu erstellen)
Vorlage; Ihr `actions/`-, Agent- und SQL-Status wird unverändert übernommen. Siehe
[Agent Surfaces](/docs/agent-surfaces) für jede Fläche dazwischen.

## Projektstruktur

```text
my-app/
  actions/         # Vom Agenten aufrufbare Actions
  app/             # React-Frontend (nur UI-Templates; entfällt bei headless)
  server/          # Nitro-API-Server (Routen, Plugins)
  AGENTS.md        # Ständig geltende Agentenanweisungen
  .agents/         # Skills, die der Agent bei Bedarf laden kann
  data/app.db      # Lokaler SQLite-Status, wenn DATABASE_URL nicht gesetzt ist
```

## Wohin gehen Sie als nächstes?

- **[Key Concepts](/docs/key-concepts)** – die Kernarchitektur: SQL, actions,
  Synchronisierung und Kontextbewusstsein.
- **[Actions](/docs/actions)** – die vollständige Aktion API: Schemata, HTTP, Authentifizierung und
  Genehmigung.
- **[Agent Surfaces](/docs/agent-surfaces)** – Headless, Chat, eingebetteter Sidecar,
  und vollständige App.
- **[Drop-in Agent](/docs/drop-in-agent)** – Fügen Sie den Agenten-Chat zu jeder React-App hinzu.
- **[Deployment](/docs/deployment)** – platzieren Sie Ihre App auf Ihrer eigenen Domain.
- **[FAQ](/docs/faq)** – Fragen zur Einrichtung und zum Produkt.
