---
title: "Multi-App-Arbeitsbereiche"
description: "Hosten Sie viele agentennative Apps in einem Monorepo mit gemeinsamer Authentifizierung, RBAC, Anweisungen, skills, Komponenten und Anmeldeinformationen."
---

# Multi-App-Arbeitsbereiche

> **Welches Arbeitsbereichsdokument?** Diese Seite behandelt die **Bereitstellungsform** – ein Monorepo, viele Apps, gemeinsame Authentifizierung und eine einheitliche Bereitstellung. Was ein Arbeitsbereich ist (die Anpassungsebene: `AGENTS.md`, `LEARNINGS.md`, persönliches Gedächtnis, skills, benutzerdefinierte Agenten), siehe [Workspace](/docs/workspace); Informationen zur Governance (wer überprüft, genehmigt und besitzt was) finden Sie unter [Workspace Governance](/docs/workspace-management).

Wenn die Vibe-Codierung eines internen Tools einen Nachmittag in Anspruch nimmt, hören Sie nicht bei einem auf. Am Ende hat ein Team einen CRM, einen Support-Posteingang, ein Dashboard, eine Betriebskonsole – zehn kleine Apps, die jeweils unabhängig voneinander aufgebaut sind. Das ist großartig, bis Sie an allen etwas ändern müssen.

Zu diesem Zeitpunkt hat jede App ihr eigenes `AGENTS.md`, ihr eigenes Authentifizierungs-Plugin, ihre eigene kopierte und eingefügte Layoutkomponente, ihr eigenes fest codiertes Slack-Token und ihre eigene Vorstellung davon, was eine „Organisation“ ist. Eine Änderung der Compliance-Regeln bedeutet zehn PRs. Das Rotieren eines API-Schlüssels bedeutet zehn Neubereitstellungen. Eine Markenaktualisierung bedeutet, dass zehn verschiedene Header nicht mehr synchron sind. Was es einfach gemacht hat, sie zu erstellen, macht es jetzt schwierig, sie zu verwalten.

Mit dem **Multi-App-Arbeitsbereich**-Muster löst Agent-nativ dieses Problem. Sie hosten alle Ihre Apps in einem Monorepo zusammen mit einem privaten `packages/shared`-Paket. Das Framework besitzt die allgemeinen Standardeinstellungen; `packages/shared` gilt nur für Code, Anweisungen, skills, Komponenten oder Plugin-Überschreibungen, die wirklich an Ihren Arbeitsbereich angepasst sind. Jede App ist auf eine Handvoll Bildschirme und actions reduziert, die sie einzigartig machen.

## Was geteilt wird {#what-gets-shared}

Alles, worüber sich jede App in Ihrer Organisation einigen sollte, kann in `packages/shared` leben:

| Geteiltes Ding                      | Wo es lebt                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Auth/SSO-Überschreibung             | `authPlugin` aus `src/server/index.ts` exportieren                                                                  |
| Org/RBAC-Regeln                     | Bessere Authentifizierungsorganisationen, optional umschlossen von `authPlugin`                                     |
| Agent-Chat-Überschreibung           | `agentChatPlugin` aus `src/server/index.ts` exportieren                                                             |
| Anweisungen für Enterprise-Agenten  | `AGENTS.md`                                                                                                         |
| Agent skills                        | `.agents/skills/<skill-name>/SKILL.md`                                                                              |
| Gemeinsamer Agentenaktionen         | `actions/*.ts`                                                                                                      |
| Gemeinsame React-Komponenten        | Export aus `src/client/index.ts`                                                                                    |
| Design-Tokens/Marke                 | Fügen Sie eine freigegebene CSS-Datei hinzu und importieren Sie sie aus jeder App                                   |
| Gemeinsame API-Anmeldeinformationen | Framework-bezogene Anmeldeinformationen bevorzugen; Fügen Sie Helfer nur hinzu, wenn Sie einen Namensraum benötigen |

Jede einzelne App wird zu _nur einer Reihe von Bildschirmen_ – Routen, Dashboards, Ansichten, domänenspezifische actions. Die Framework-Standardeinstellungen decken den Rest ab, bis Sie eine echte Arbeitsbereichsanpassung hinzufügen.

Die gleiche Grenze gilt, wenn Ihre App eine andere Erstanbieter-App verwenden möchte. Ein neues Arbeitsbereichs-Dashboard, das E-Mail, Kalender, Analysen und Unternehmensspeicherkontext benötigt, sollte die vorhandenen Mail-, Kalender-, Analyse- und Brain-Apps als verbundene Nachbarn über Links oder A2A verwenden. Es sollte diese Vorlagen nicht klonen, keine Wrapper-App erstellen, die sie verschachtelt, oder untergeordnete Apps in sich selbst aufbauen, nur um Zugriff auf ihre Daten oder Agenten zu erhalten. Forken oder erstellen Sie eine Kopie nur, wenn Sie diese App ausdrücklich anpassen möchten.

## Erste Schritte {#getting-started}

Arbeitsbereich ist die Standardform eines agentennativen Projekts. Gerüst eins mit:

```bash
npx @agent-native/core@latest create my-company-platform
```

CLI zeigt eine Mehrfachauswahlauswahl für jede Erstanbietervorlage. Wählen Sie so viele aus, wie Sie möchten – zum Beispiel Mail + Kalender + Formulare – und alle werden in denselben Arbeitsbereich integriert und teilen Authentifizierungs- und Datenbankstandards.

Sie erhalten ein pnpm-Monorepo mit dem privaten freigegebenen Paket, ein Root-`package.json`, das die Arbeitsbereichserkennung verkabelt, ein freigegebenes `.env` und ein Unterverzeichnis pro von Ihnen ausgewählter App:

```an-file-tree title="Ein generierter Workspace"
{
  "entries": [
    { "path": "package.json", "note": "Deklariert agent-native.workspaceCore" },
    { "path": "pnpm-workspace.yaml", "note": "packages: [\"packages/*\", \"apps/*\"]" },
    { "path": ".env.example", "note": "Gemeinsame ANTHROPIC_API_KEY, A2A_SECRET, DATABASE_URL, ..." },
    { "path": "packages/shared/", "note": "@my-company-platform/shared" },
    { "path": "packages/shared/src/server/", "note": "Plugin-Overrides nur bei Bedarf" },
    { "path": "packages/shared/src/client/", "note": "Gemeinsamer React-Code nur bei Bedarf" },
    { "path": "packages/shared/AGENTS.md", "note": "Workspace-weite Anweisungen" },
    { "path": "apps/mail/" },
    { "path": "apps/calendar/" },
    { "path": "apps/forms/" }
  ]
}
```

Dann booten Sie es:

```bash
cd my-company-platform
cp .env.example .env             # Füllen Sie ANTHROPIC_API_KEY, BETTER_AUTH_SECRET, ... aus.
pnpm install
pnpm dev                         # opens Dispatch; other apps start on first visit
```

Jede App weiß bereits, wie sie sich anmeldet, dieselbe Datenbank freigibt und den Arbeitsbereich `AGENTS.md` lädt. Sie haben nichts davon verkabelt – das Framework hat das freigegebene Paket automatisch über das Feld `agent-native.workspaceCore` im Stammverzeichnis `package.json` erkannt:

```json
{
  "name": "my-company-platform",
  "agent-native": {
    "workspaceCore": "@my-company-platform/shared"
  }
}
```

## Eine weitere App hinzufügen {#adding-a-new-app}

Von überall im Arbeitsbereich:

```bash
npx @agent-native/core@latest add-app
```

Der CLI zeigt erneut die Vorlagenauswahl mit herausgefilterten Apps an, die Sie bereits installiert haben. Wählen Sie eine oder mehrere aus und sie werden unter `apps/` eingerüstet. Nicht interaktive Variante:

```bash
npx @agent-native/core@latest add-app crm --template content
```

Jede Vorlage eines Erstanbieters funktioniert als Arbeitsbereichs-App – CLI führt eine kleine **workspacify**-Transformation auf der Vorlage aus, die das freigegebene Paket als Dep hinzufügt und `workspace:*`-Referenzen auflöst. Es muss kein paralleles „Workspace-App“-Gerüst gepflegt werden.

```bash
pnpm install                     # at the workspace root
pnpm dev
```

Das ist es. Die neue App verfügt über dieselben Anmelde- und Arbeitsbereichsanweisungen wie jede andere App. Fügen Sie gemeinsame Marken, actions oder Anmeldeinformationen nur dann hinzu, wenn der Arbeitsbereich sie tatsächlich benötigt.

## Was Sie wo überschreiben {#layering}

Agent-native Apps innerhalb eines Arbeitsbereichs lösen übergreifendes Verhalten an drei Stellen in dieser Reihenfolge:

1. **App local** – Dateien innerhalb von `apps/<name>/` (höchste Priorität)
2. **Freigegebener Arbeitsbereich** – Dateien innerhalb von `packages/shared/` (der gemeinsam genutzten Mittelschicht)
3. **Framework-Standard** – `@agent-native/core` (niedrigste)

Die Zusammenführung erfolgt nach Dateinamen. Wenn eine App eine lokale Datei bereitstellt, die auch im Upstream vorhanden ist, gewinnt die lokale Datei. Ist dies nicht der Fall, gilt die gemeinsam genutzte Version des Arbeitsbereichs. Wenn shared auch keines bereitstellt, tritt die Framework-Standardeinstellung in Kraft. Dies gilt für die Plugins skills, actions und `AGENTS.md`.

```an-diagram title="Drei Ebenen, nach Dateinamen zusammengeführt" summary="Jede App löst Plugins, Skills, Aktionen und AGENTS.md zuerst aus App-Local, dann aus dem freigegebenen Paket und dann aus dem Framework-Standard auf."
{
  "html": "<div class=\"layer\"><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">1 &middot; App local</span><small class=\"diagram-muted\"><code>apps/&lt;name&gt;/</code> &mdash; highest priority</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; Workspace shared</span><small class=\"diagram-muted\"><code>packages/shared/</code> &mdash; the mid-layer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">3 &middot; Framework default</span><small class=\"diagram-muted\"><code>@agent-native/core</code> &mdash; lowest</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box ok\">first match wins</div></div>",
  "css": ".layer{display:flex;flex-direction:column;align-items:center;gap:6px}.layer .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 16px;width:320px}.layer .diagram-arrow{font-size:18px;line-height:1}.layer .diagram-box{margin-top:2px}"
}
```

Wenn eine App etwas anderes benötigt, legen Sie eine lokale Datei ab:

| Ding zum Überschreiben         | Datei, die in der App erstellt werden soll                             |
| ------------------------------ | ---------------------------------------------------------------------- |
| Auth-Plugin                    | `apps/<name>/server/plugins/auth.ts`                                   |
| Agent-Chat-Plugin              | `apps/<name>/server/plugins/agent-chat.ts`                             |
| Eine bestimmte Fähigkeit       | `apps/<name>/.agents/skills/<skill-name>/SKILL.md`                     |
| Eine bestimmte Aktion          | `apps/<name>/actions/<action-name>.ts`                                 |
| Zusätzliche Agentenanweisungen | `apps/<name>/AGENTS.md` (wird mit Arbeitsbereich eins zusammengeführt) |

Keine Verkabelung, keine Konfiguration. Erstellen Sie die Datei und sie übernimmt.

## Gemeinsames Verhalten bearbeiten {#editing-shared-behavior}

Alles, was Sie bereichsübergreifend anpassen, lebt in `packages/shared/`. Exportieren Sie ein `authPlugin` von `src/server/index.ts` und jede App übernimmt es beim nächsten Neuladen des Entwicklers. Fügen Sie unter `.agents/skills/` einen Skill hinzu, und der Agent jeder App sieht ihn. Fügen Sie `actions/` eine Aktion hinzu, und der Agent jeder App kann sie aufrufen.

Da es sich bei dem freigegebenen Paket um eine `workspace:*`-Abhängigkeit handelt, verknüpft pnpm es symbolisch mit dem `node_modules/` jeder App. Sie erstellen oder veröffentlichen es nie – die Apps bündeln alles, was sie zum Zeitpunkt der Erstellung benötigen.

## Globale Laufzeitressourcen {#runtime-global-resources}

Verwenden Sie `packages/shared` für Standardeinstellungen auf Codeebene, die mit dem Repo geliefert werden sollen: Plugins, gemeinsam genutzter actions, gemeinsam genutzter React-Code, Dateisystem `AGENTS.md` und Dateisystem skills. Verwenden Sie Dispatch-Arbeitsbereichsressourcen für zur Laufzeit bearbeitbaren globalen Kontext, den Administratoren ohne Codeänderung verwalten möchten.

Dispatch-Ressourcen sind auf **Alle Apps** (jede App erbt sie zur Laufzeit, kein Kopier- oder Synchronisierungsschritt) oder auf **Ausgewählte Apps** (je App für app-spezifischen Kontext gewährt) beschränkt. Unter [Workspace](/docs/workspace#global-resources) finden Sie die vollständige Ressourcenmodelltabelle, Pfadkonventionen und das empfohlene Starterpaket.

## Authentifizierung und RBAC {#auth-and-rbac}

Jede agentennative App wird bereits mit [Better Auth](/docs/authentication) und dem integrierten Organisationssystem des Frameworks ausgeliefert. In einem Arbeitsbereich erhalten Sie das kostenlos in jeder App, unterstützt durch dieselbe Datenbank. Das vollständige Mandantenfähigkeitsmodell – Organisationen, Rollen, Datenisolation – finden Sie unter [Multi-Tenancy](/docs/multi-tenancy).

Für unternehmensspezifische Regeln (Domains auf Zulassungsliste, Durchsetzung von SSO, zusätzliche Rollenprüfungen) exportieren Sie einen `authPlugin` aus `packages/shared/src/server/index.ts`. Jede App im Arbeitsbereich erzwingt jetzt diese Regeln.

Aktive Organisation fließt automatisch: `session.orgId` → `AGENT_ORG_ID` → SQL Zeilenbereich, sodass mit `org_id` getaggte Daten für andere Organisationen, selbst für den Agenten, unsichtbar sind. Das vollständige Modell finden Sie unter [Security & Data Scoping](/docs/security).

## Freigegebene MCP-Server {#shared-mcp}

Die empfohlenen Optionen für die gemeinsame Nutzung von MCP-Servern über Workspace-Apps hinweg, in der Reihenfolge ihrer Präferenz:

1. **MCP-Ressourcen des Arbeitsbereichs verteilen** – Fügen Sie `mcp-servers/<name>.json`-Ressourcen in Dispatch im Bereich **Alle Apps** hinzu. Jede App im Arbeitsbereich erbt den MCP-Server zur Laufzeit, ohne dass Dateien bearbeitet oder erneut bereitgestellt werden müssen. Gewähren Sie ausgewählten Apps nur, wenn der Server app-spezifisch ist. Tokens befinden sich im Dispatch-Tresor; Referenzieren Sie sie aus der Ressource JSON mit `${keys.NAME}`.

2. **Root `mcp.config.json`** – Legen Sie eine Datei im Stammverzeichnis des Arbeitsbereichs ab und jede App im Arbeitsbereich stellt eine Verbindung zu denselben MCP-Servern her. Einzelne Apps können mit ihrem eigenen `mcp.config.json` (App-Root-Siege) überschrieben werden. Verwenden Sie dies für lokale MCP-Server/Dateisystemserver (`@modelcontextprotocol/server-filesystem`, `claude-in-chrome`, Playwright), die keine Vault-Anmeldeinformationen pro Benutzer benötigen.

3. **Einstellungen UI (persönlicher/org. Bereich)** – für Remote-Server HTTP MCP können Benutzer sie über die Einstellungen UI im persönlichen oder Teambereich (org.) hinzufügen – keine Dateibearbeitung, Hot-Reload in den laufenden Agenten.

Informationen zum Konfigurationsschema, zu den Prioritätsregeln und zur Hub-Einrichtung finden Sie unter [MCP Clients](/docs/mcp-clients).

## Gemeinsame Umgebungsvariablen {#shared-env}

Das Arbeitsbereichsstammverzeichnis `.env` wird automatisch in jede App geladen. Legen Sie gemeinsam genutzte Schlüssel einmal im Stammverzeichnis ab – `ANTHROPIC_API_KEY`, `A2A_SECRET`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `BUILDER_PRIVATE_KEY` usw. – und jede App übernimmt sie. Überschreibungen pro App erfolgen in `apps/<name>/.env` und gewinnen bei Konflikten.

Für Laufzeit-App-Anmeldeinformationen bevorzugen Sie den Dispatch-Tresor gegenüber der manuellen Bearbeitung von `.env`-Dateien. Der Tresor ist standardmäßig auf den Zugriff aller Apps eingestellt, sodass jeder gespeicherte Tresorschlüssel für jede Workspace-App verfügbar ist und mit `sync-vault-to-app` übertragen werden kann. Schalten Sie den Tresor nur dann in den manuellen Modus, wenn Apps explizite Gewährung pro Schlüssel benötigen.

```text
my-company-platform/
├── .env                           # shared: ANTHROPIC_API_KEY=... , A2A_SECRET=... , ...
└── apps/
    └── mail/
        └── .env                   # optional overrides just for mail
```

Einige Onboarding-Abläufe sind standardmäßig arbeitsbereichsorientiert:

- **Builder `/cli-auth`**: Wenn Sie in einer beliebigen App auf „Builder verbinden“ klicken, werden `BUILDER_PRIVATE_KEY` und Freunde in das **Arbeitsbereichsstammverzeichnis** `.env` geschrieben, sodass jede App sofort Browserzugriff erhält.
- **Env-vars-Einstellungsroute** (`POST /_agent-native/env-vars`): Wenn innerhalb eines Arbeitsbereichs, wird standardmäßig das Arbeitsbereichsstammverzeichnis `.env` geschrieben. Übergeben Sie `scope: "app"` im Textkörper, um eine App zu überschreiben.

## Gemeinsame Anmeldeinformationen {#shared-credentials}

Apps im selben Arbeitsbereich verweisen standardmäßig auf denselben `DATABASE_URL`, sodass die Speicherung von Framework-Anmeldeinformationen Anmeldeinformationen für jede App ohne Konfiguration pro App verfügbar machen kann. Verwenden Sie `@agent-native/core/credentials` direkt oder fügen Sie einen Thin Helper in `packages/shared` hinzu, wenn Ihr Arbeitsbereich eine strengere Namenskonvention erfordert.

## Geteilte Design-Tokens {#design-tokens}

Das Framework ist auf Tailwind v4. Fügen Sie eine freigegebene CSS-Datei nur dann zu `packages/shared` hinzu, wenn der Arbeitsbereich über echte Marken-Tokens zum Teilen verfügt, und importieren Sie sie dann aus dem `app/global.css` jeder App:

```css
@import "tailwindcss";
@import "@my-company-platform/shared/styles/tokens.css";
@source "./**/*.{ts,tsx}";

:root {
  --background: 0 0% 100%; /* ...brand tokens... */
}
.dark {
  --background: 220 6% 6%; /* ... */
}
```

Markenfarben, Typografie, Abstandsskalen und alle gemeinsam genutzten Komponentenklassen können in dieser einen CSS-Datei gespeichert werden. Aktualisieren Sie es in `packages/shared` und jede App wird beim nächsten Build umbenannt.

## Bereitstellung {#deployment}

Sie haben zwei Möglichkeiten: **einheitliche Bereitstellung** (Standard für Arbeitsbereiche) oder unabhängige Bereitstellung pro App.

### Einheitliche Bereitstellung (empfohlen)

Ein Befehl erstellt jede App im Arbeitsbereich und verschickt sie hinter einem einzigen Ursprung, einem Pfad pro App:

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Jede App wird mit `APP_BASE_PATH=/<name>` und `VITE_APP_BASE_PATH=/<name>` erstellt und über die ausgewählte Nitro-Voreinstellung ausgegeben. Cloudflare Pages ist die Standardvoreinstellung und verwendet einen Dispatcher-Worker bei `dist/_worker.js` plus `_routes.json`. Netlify wird mit `npx @agent-native/core@latest deploy --preset netlify` unterstützt; Es gibt App-Funktionen unter `.netlify/functions-internal/<app>-server` aus und generiert Weiterleitungen, die statische Assets nicht erzwingen, sodass CDN Dateien zuerst bereitstellt. Vercel wird mit `npx @agent-native/core@latest deploy --preset vercel` unterstützt; Es schreibt ein Root-`.vercel/output`-Bundle mit Vercels Build Output API.

```an-diagram title="Einheitliche Bereitstellung: ein Ursprung, ein Pfad pro App" summary="Jede App wird hinter einem einzigen Ursprung ausgeliefert, sodass Anmeldesitzungen und App-übergreifendes A2A kostenlos sind."
{
  "html": "<div class=\"deploy\"><div class=\"diagram-box accent\">your-agents.com<br><small class=\"diagram-muted\">one DNS record &middot; one cert &middot; one CDN</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"deploy-apps\"><div class=\"diagram-box\">/mail/*</div><div class=\"diagram-box\">/calendar/*</div><div class=\"diagram-box\">/forms/*</div></div><div class=\"diagram-pill ok\">shared login cookie on the apex &bull; same-origin A2A, no CORS</div></div>",
  "css": ".deploy{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.deploy .deploy-apps{display:flex;flex-direction:column;gap:8px}.deploy .diagram-arrow{font-size:24px}.deploy .diagram-pill{flex-basis:100%}"
}
```

Am **gleichen Ursprung** zu sein, ist der wahre Vorteil:

- **Gemeinsame Anmeldesitzung.** Better Auth setzt sein Cookie auf der Apex-Domäne, sodass Sie bei der Anmeldung bei einer beliebigen App bei jeder App angemeldet werden. Kein domänenübergreifender SSO-Tanz.
- **App-übergreifendes A2A ohne Konfiguration.** `@mail`-Tagging `@calendar` wird zu einem Abruf mit demselben Ursprung – kein CORS, kein JWT-Signieren zwischen Geschwistern. Extern A2A verwendet immer noch JWT wie heute.
- **Ein DNS-Eintrag, ein Zertifikat, ein CDN-Cache.**

Veröffentlichen Sie die `dist/`-Ausgabe:

```bash
wrangler pages deploy dist
```

Für Netlify:

```bash
npx @agent-native/core@latest deploy --preset netlify --build-only
```

Legen Sie für Vercel Git-Bereitstellungen den Build-Befehl auf Folgendes fest:

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

### Öffentliche App-Routen

Workspace-Apps sind standardmäßig intern. Legen Sie für eine öffentliche Website mit Admin-Seiten, auf denen Sie sich nur anmelden können, eine öffentliche Zielgruppe fest und schützen Sie das Admin-Präfix im `package.json`:

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

Belassen Sie bei überwiegend internen Apps mit wenigen öffentlichen Seiten die Zielgruppe intern und listen Sie die Seitenpräfixe auf:

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

Diese Einstellungen wirken sich nur auf die schreibgeschützte Seitennavigation aus. Framework-Tools, Agent-Chat, A2A, Tresorzugriff und beliebige APIs bleiben authentifiziert, es sei denn, die App deklariert öffentliche Präfixe explizit mit `createAuthPlugin({ publicPaths: [...] })`.

### Unabhängige Bereitstellung pro App

Bevorzugen Sie jede App in einer eigenen Domain (`mail.company.com`, `calendar.company.com`)? Jede App im Arbeitsbereich ist immer noch ein unabhängiges Deployable – `cd apps/mail && npx @agent-native/core@latest build` verhält sich genau wie ein eigenständiges Gerüst. Der App-übergreifende A2A durchläuft dann den standardmäßigen JWT-signierten Pfad mit einem gemeinsam genutzten `A2A_SECRET`. Der domänenübergreifende SSO zwischen separat bereitgestellten Apps wird von der Identitätsföderation mit Dispatch als Hub abgewickelt – siehe [Cross-App SSO](/docs/cross-app-sso); Durch die einheitliche Single-Origin-Bereitstellung ist dies nicht erforderlich.

### Gemeinsame Datenbank, gemeinsame Anmeldeinformationen

Was auch immer Sie auswählen, verweisen Sie jede App auf den gleichen `DATABASE_URL` für einen App-übergreifenden Status: ein Satz Benutzerkonten, ein Satz Organisationen, ein Satz gemeinsamer Einstellungen. Wenn jede App über eine eigene Datenbank verfügt, funktioniert das Arbeitsbereichsmuster weiterhin – Sie verlieren nur die Geschichte des gemeinsamen Status.

Das freigegebene Paket selbst wird niemals eigenständig bereitgestellt. Es handelt sich um eine `workspace:*`-Abhängigkeit, die mit dem `node_modules/` jeder App symbolisch mit pnpm verknüpft ist, sodass jede App zur Erstellungszeit transparent alles bündelt, was sie benötigt.

## Außerhalb des Gültigkeitsbereichs (vorerst) {#out-of-scope}

Das Arbeitsbereichsmuster ist absichtlich eng. Ein paar Dinge werden bewusst noch nicht behandelt:

- **Verschlüsselter Tresor für Anmeldeinformationen.** Bevorzugen Sie den Dispatch-Tresor für Anmeldeinformationen für Laufzeit-Apps (siehe [Shared environment variables](#shared-env)). Der Nicht-Vault-Fallback-Pfad – gemeinsam genutzte Anmeldeinformationen, die direkt in die `settings`-Tabelle des Frameworks geschrieben werden – speichert sie heute als Klartext. Wechseln Sie daher verantwortungsbewusst, wenn Sie sich darauf verlassen.
- **Freigegebenen Code im privaten npm veröffentlichen.** Das freigegebene Paket ist nur `workspace:*`; Die gemeinsame Nutzung mehrerer Repositorys über eine private Registry ist möglich, aber kein Gerüst.
- **Meinungsorientierte Komponentenbibliothek.** `packages/shared` ist der Ort, an dem _Sie_ gemeinsam genutzte Komponenten ablegen. Das Framework zwingt weder shadcn/ui noch ein anderes System in diesen Steckplatz.

## Siehe auch {#see-also}

- [Workspace](/docs/workspace) – die Anpassungsebene (`AGENTS.md`, `LEARNINGS.md`, persönlicher Speicher, skills, benutzerdefinierte Agenten), die jede App im Arbeitsbereich gemeinsam nutzt.
- [Workspace Governance](/docs/workspace-management) – Verzweigung, CODEOWNERS, PR-Überprüfung über viele Apps in einem Repo.
- [Multi-Tenancy](/docs/multi-tenancy) – Organisationen, Rollen und Datenisolation pro Organisation.
- [Cross-App SSO](/docs/cross-app-sso) – Identitätsföderation für Bereitstellungen in separaten Domänen.
- [Dispatch](/docs/dispatch) – die Laufzeitsteuerungsebene, die sich normalerweise in einem Multi-App-Arbeitsbereich als Geheimspeicher, Integrationskatalog und Genehmigungs-Hub befindet.
