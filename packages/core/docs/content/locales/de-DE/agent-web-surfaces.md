---
title: "Public Agent Web"
description: "Machen Sie öffentliche Routen crawlbar, lesbar, zitierbar und optional für Agenten aufrufbar – robots.txt, llms.txt, Markdown Mirrors, JSON-LD und eine öffentliche MCP-Oberfläche."
---

# Public Agent Web

Das öffentliche Agenten-Web erleichtert Agenten das Crawlen, Lesen, Zitieren und Anrufen öffentlicher Agent-Native-Routen. Das Ziel besteht nicht darin, jeden App-Endpunkt öffentlich zu machen. Ziel ist es, eine saubere öffentliche Oberfläche für bereits öffentliche Seiten zu veröffentlichen und gleichzeitig den Zugriff auf private Daten und Tools einer expliziten Kontrolle zu unterziehen.

Die Dokumentationsseite ist die Referenzimplementierung. Heute wird Folgendes ausgeliefert:

- `/robots.txt` mit einer Crawler-Richtlinie, die den Abruf erlaubt, aber das Training standardmäßig nicht zulässt.
- `/sitemap.xml` mit absolut kanonischen URLs und `lastmod`, wenn die Quelldatei es verfügbar macht.
- `/llms.txt` und `/llms-full.txt` für agentenfreundliche Inhaltserkennung.
- Markdown spiegelt wie `/docs/getting-started.md` wider.
- `Accept: text/markdown`-Antworten für öffentliche Dokumentseiten nach einem Produktions-Build.
- JSON-LD für Basisorganisation, Website und Seitenmetadaten.
- Ein Audit CLI (`npx @agent-native/core@latest audit-agent-web`), das alle oben genannten Punkte überprüft.

Durch das Festlegen von `publicMcp: true` wird zusätzlich der optierte actions als öffentlicher MCP-Endpunkt verfügbar gemacht, sodass externe Agenten ihn direkt aufrufen können (siehe [MCP Protocol](/docs/mcp-protocol)).

```an-diagram title="Was für eine öffentliche Route veröffentlicht" summary="Ein öffentlicher Weg fächert sich in agentenfreundliche Darstellungen auf. Das Lesen der Route erfolgt getrennt vom Aufrufen von Tools – der Tool-Zugriff bleibt optional."
{
  "html": "<div class=\"diagram-web\"><div class=\"diagram-box\" data-rough>Öffentliche Route<br><small class=\"diagram-muted\">derived from route access settings</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">robots.txt</span><span class=\"diagram-pill\">sitemap.xml</span><span class=\"diagram-pill\">llms.txt</span><span class=\"diagram-pill\">.md mirror</span><span class=\"diagram-pill\">JSON-LD</span><span class=\"diagram-pill\">text/markdown</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col gate\"><span class=\"diagram-pill warn\">Tools bleiben privat</span><small class=\"diagram-muted\">publicMcp + publicAgent.expose required</small></div></div>",
  "css": ".diagram-web{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-web .diagram-arrow{font-size:22px;line-height:1}.diagram-web .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.diagram-web .gate{display:flex;flex-direction:column;gap:4px;align-items:flex-start}"
}
```

## Konfiguration {#config}

Fügen Sie `agentWeb` unter der vorhandenen Workspace-App-Konfiguration hinzu (im `package.json` Ihrer App unter dem Schlüssel `agent-native` – oder entsprechend `workspace.agentWeb`, `agentWeb` oder `root.agentWeb`). Die öffentliche Routenliste wird weiterhin von den Routenzugriffseinstellungen der App abgeleitet; `agentWeb` steuert, wie diese öffentliche Oberfläche den Agenten dargestellt wird.

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin/*"],
      "agentWeb": {
        "discoverable": true,
        "markdownTwins": true,
        "llmsTxt": true,
        "jsonLd": true,
        "publicAgentCard": true,
        "publicMcp": false,
        "crawlerPolicy": "discoverable-no-training",
        "crawlers": {
          "training": "disallow",
          "search": "allow",
          "userTriggered": "allow",
          "codingAgents": "allow",
          "autonomousAgents": "allow"
        }
      }
    }
  }
}
```

Lassen Sie bei den meisten Apps die Standardeinstellungen unverändert. Wenn eine App über eine öffentliche Route verfügt, ist `discoverable` standardmäßig aktiviert. Die Standard-Crawler-Richtlinie ist „erkennbar, nicht trainierbar“: Suche, vom Benutzer ausgelöster Abruf, Codierungsagenten und autonome Browsing-Agenten sind zulässig; Trainings-Crawler sind nicht zulässig.

## Quelle der Wahrheit weiterleiten {#route-source}

Agent Web Discovery folgt dem Routenzugriffsmodell:

- Öffentliche Apps machen jede Route außer `protectedPaths` verfügbar.
- Interne Apps machen nur `publicPaths` verfügbar.
- Öffentliche Freigabe- und Formularseiten können von Agenten gelesen werden.
- Übermittelte private Daten, authentifizierte Dashboards und Benutzer-/Organisationsstatus werden niemals berücksichtigt, nur weil eine Seite in der Nähe öffentlich ist.

Dadurch bleiben gemischte Apps natürlich. Eine Formular-App kann eine öffentliche Formularseite verfügbar machen und Übermittlungen privat halten. Eine Content-App kann veröffentlichte Beiträge offenlegen und den Herausgeber privat halten. Eine Dokumentenseite kann alles außer Verwaltungstools offenlegen.

## Öffentliche Seiten sind keine öffentlichen Tools {#public-tools}

Der Zugriff auf öffentliche Seiten und der Zugriff auf öffentliche Tools sind getrennt. Eine öffentliche Route bedeutet nur, dass Agenten diese Route als HTML, Markdown, Sitemap-Einträge, LMS-Einträge und strukturierte Daten lesen können.

```an-callout
{
  "tone": "warning",
  "body": "**A public page is not a public tool.** Making a route crawlable never exposes an action. Tool access requires an explicit `publicAgent.expose` opt-in on the action *and* `publicMcp: true` on the app."
}
```

Um eine Aktion über ein öffentliches Agentenprotokoll verfügbar zu machen, muss die Aktion Folgendes aktivieren:

```an-annotated-code title="Auswahl einer sicheren Aktion auf der öffentlichen Oberfläche"
{
  "filename": "actions/search-docs.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Search published docs\",\n  readOnly: true,\n  publicAgent: {\n    expose: true,\n    readOnly: true,\n    requiresAuth: false,\n    isConsequential: false,\n    title: \"Search published docs\",\n  },\n  run: async (args) => {\n    // ...\n  },\n});",
  "annotations": [
    { "lines": "4", "label": "Explizites Opt-in", "note": "Without `publicAgent.expose === true`, the action never appears on any public agent surface — no matter how public its routes are." },
    { "lines": "5-7", "label": "Beschreiben Sie sich selbst als Sicherheit", "note": "Markieren Sie es als schreibgeschützt, geben Sie an, ob eine Authentifizierung erforderlich ist, und kennzeichnen Sie, ob es folgenreich ist. Öffentliche MCP schließen Folgehandlungen gemäß /write aus, es sei denn, die Richtlinien erlauben dies ausdrücklich." }
  ]
}
```

`agentWeb.publicMcp` bleibt standardmäßig `false`. Wenn öffentliches MCP aktiviert ist, sollte der Server nur actions mit `publicAgent.expose === true` verfügbar machen und weiterhin Folge- oder Schreib-actions ausschließen, es sei denn, die Aktion und die Authentifizierungsrichtlinie erlauben dies ausdrücklich.

## Dateien zur Erstellungszeit {#build-time}

Framework-Dienstprogramme in `@agent-native/core/agent-web` generieren die gemeinsamen Dateien aus einer Seitenliste:

```ts
import {
  buildAgentWebStaticFiles,
  normalizeAgentWebConfig,
} from "@agent-native/core/agent-web";

const config = normalizeAgentWebConfig(
  { crawlerPolicy: "discoverable-no-training" },
  { hasPublicRoutes: true },
);

const files = buildAgentWebStaticFiles({
  siteName: "My Agent-Native App",
  siteUrl: "https://example.com",
  description: "Public docs for my app.",
  config,
  pages: [
    {
      path: "/docs",
      title: "Docs",
      description: "Start here.",
      markdown: "# Dokumente\n\nStart hier.\n",
      markdownPath: "/docs/getting-started.md",
      lastmod: new Date(),
    },
  ],
});
```

Vite-Apps können `createAgentWebVitePlugin` von `@agent-native/core/vite` verwenden, um diese Dateien während Produktionsbuilds in `public`, `dist`, `dist/client`, `dist/server/public` oder `build/client` zu schreiben.

## Eine Website prüfen {#audit}

Verwenden Sie die CLI-Prüfung für einen bereitgestellten Standort oder einen lokalen Produktionsserver:

```bash
npx @agent-native/core@latest audit-agent-web --url https://www.agent-native.com
```

Die Prüfung prüft auf:

- SSR-sichtbares HTML.
- Kanonische URLs.
- JSON-LD.
- `robots.txt`-Richtlinie und absolute Sitemap URL.
- Absolute Sitemap-Einträge.
- `/llms.txt` und `/llms-full.txt`.
- Markdown Spiegel.
- `Accept: text/markdown`.
- Keine versehentlichen 401/403-Blockierungen für allgemeine Agentenabruf-Benutzeragenten.

Die Prüfung endet mit einem Wert ungleich Null, wenn eine erforderliche öffentliche Oberfläche fehlt.

## Was kommt als nächstes?

- [**Actions**](/docs/actions) – So aktivieren Sie actions für das öffentliche Agentenprotokoll
- [**MCP Protocol**](/docs/mcp-protocol) – die MCP-Oberfläche, die `publicMcp: true` aktiviert
- [**Deployment**](/docs/deployment) – wohin diese statischen Dateien während Builds geschrieben werden
