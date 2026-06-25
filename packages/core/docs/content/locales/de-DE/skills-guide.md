---
title: "Skills-Anleitung"
description: "So funktioniert skills in Agent-nativ: Framework skills, Domäne skills und Erstellen eines benutzerdefinierten skills."
---

# Skills-Anleitung

Skills sind Markdown-Dateien, die dem Agenten umfassende Kenntnisse über bestimmte Muster und Arbeitsabläufe vermitteln.

## Was sind skills {#what-are-skills}

Skills live unter `.agents/skills/<name>/SKILL.md` und enthalten detaillierte Anleitungen für den Agenten. Jeder Skill konzentriert sich auf ein Anliegen – wie man Daten speichert, wie man den Status synchronisiert, wie man Arbeit an den Agenten-Chat delegiert.

Die Frontmatter `name` und `description` jedes Skills werden immer in den skills-Block der Systemeingabeaufforderung eingefügt, damit der Agent weiß, welche skills vorhanden sind. Der vollständige Fertigkeitskörper wird bei Bedarf geladen, wenn der Agent entscheidet, dass eine Fertigkeit für die Aufgabe relevant ist (er wird auch über `docs-search` angezeigt). Aus diesem Grund ist es wichtig, Beschreibungen kurz und auslöserspezifisch zu halten: Die Beschreibung ist das Einzige, was der Agent liest, bevor er entscheidet, ob er den Rest lädt.

```an-diagram title="Progressive Offenlegung" summary="Nur der Name + die Beschreibung jeder Fähigkeit sind immer im Kontext. Der gesamte Körper wird bedarfsgerecht belastet, wenn die Aufgabe passt."
{
  "html": "<div class=\"sk-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Immer im Systemprompt</span><div class=\"sk-list\"><span class=\"diagram-pill\">storing-data &mdash; <small class=\"diagram-muted\">add data models&hellip;</small></span><span class=\"diagram-pill\">real-time-sync &mdash; <small class=\"diagram-muted\">wire polling&hellip;</small></span><span class=\"diagram-pill\">create-skill &mdash; <small class=\"diagram-muted\">add a skill&hellip;</small></span></div><small class=\"diagram-muted\">just name + description (cheap)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><small class=\"diagram-muted\">task matches a description</small><span class=\"diagram-pill accent\">load on demand</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Full <code>SKILL.md</code> body<br><small class=\"diagram-muted\">Regeln, Code, Dos und Don’ts</small></div></div>",
  "css": ".sk-flow{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.sk-flow .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;min-width:240px}.sk-flow .sk-list{display:flex;flex-direction:column;gap:6px}.sk-flow .center{display:flex;flex-direction:column;align-items:center;gap:6px}.sk-flow .diagram-arrow{font-size:22px}"
}
```

## Framework skills {#framework-skills}

Dies sind die skills, die mit der **Standardvorlage** gebündelt sind. Der genaue Satz, der in einer bestimmten App verfügbar ist, hängt von der Vorlage ab, aus der Sie das Gerüst erstellt haben. Überprüfen Sie im `.agents/skills/`-Verzeichnis dieser Vorlage, was tatsächlich enthalten ist.

| Fähigkeit              | Wann zu verwenden                                                           |
| ---------------------- | --------------------------------------------------------------------------- |
| `storing-data`         | Datenmodelle hinzufügen, Konfiguration oder Status lesen/schreiben          |
| `real-time-sync`       | Verdrahtungsabfragesynchronisierung, Debugging UI wird nicht aktualisiert   |
| `delegate-to-agent`    | KI-Arbeit von UI oder actions an den Agenten delegieren                     |
| `actions`              | Agentenaktionen wird erstellt oder ausgeführt                               |
| `self-modifying-code`  | App-Quelle, Komponenten oder Stile bearbeiten                               |
| `create-skill`         | Neues skills für den Agenten hinzufügen                                     |
| `capture-learnings`    | Korrekturen und Muster aufzeichnen                                          |
| `frontend-design`      | Erstellen oder Gestalten beliebiger Web-Elemente, Komponenten oder Seiten   |
| `adding-a-feature`     | Die Checkliste für vier Bereiche: UI, actions, skills, App-Status           |
| `internationalization` | Aktualisieren lokalisierter UI-Kopie, Sprachkataloge und RTL-sicherer Stile |
| `shadcn-ui`            | Verwendung von shadcn/ui-Grundelementen und -Komponenten                    |
| `security`             | Authentifizierung, Zugriffskontrolle und Geheimverwaltung                   |
| `real-time-collab`     | Gemeinsame Bearbeitung durch mehrere Benutzer                               |
| `agent-engines`        | Austauschen oder Konfigurieren der zugrunde liegenden Agent-Engine          |
| `notifications`        | In-App- und Push-Benachrichtigungsmuster                                    |
| `progress`             | Verfolgen und Anzeigen des Fortschritts von Hintergrundaufgaben             |
| `inline-embeds`        | Einbetten von Apps oder Iframes in den Agenten-Chat                         |

`context-awareness` und `a2a-protocol` sind skills auf Framework-Ebene, die im `.agents/skills/`-Verzeichnis im Repo-Stammverzeichnis verfügbar sind. Sehen Sie sich die `.agents/skills/` jeder Vorlage an, um zu erfahren, was sie übernimmt.

## Domäne skills {#domain-skills}

Vorlagen enthalten skills, das für ihre Domäne spezifisch ist. Diese befinden sich im selben `.agents/skills/`-Verzeichnis, decken jedoch vorlagenspezifische Muster ab. Die vollständige Liste finden Sie im `.agents/skills/`-Verzeichnis jeder Vorlage. eine repräsentative Stichprobe:

- **Mail-Vorlage** – `email-drafts`, `draft-queue`
- **Formularvorlage** – `form-building`, `form-publishing`, `form-responses`
- **Analytics-Vorlage** – `adhoc-analysis`, `bigquery`, `cross-source-analysis`, `dashboard-management`, `data-querying`, `provider-api`, `gong`, `hubspot`, `prometheus`
- **Folienvorlage** – `create-deck`, `deck-management`, `design-systems`, `slide-editing`, `slide-images`

Domäne skills folgt demselben Format wie das Framework skills. Sie kodieren Muster, die für die Vorlage spezifisch sind und denen der Agent folgen muss.

## App-gestütztes skills {#app-backed-skills}

App-gestütztes skills-Paket einer agentennativen App als Skill-Marktplatz-Artefakt. Das Paket kann Agentenanweisungen, exportierte skills-, MCP-Connector-Metadaten, gehostete/lokale Startanweisungen und UI-Oberflächen wie MCP-Apps enthalten.

> **Vollständige Details unten:** Die Mechanismen des App-gestützten skills (Manifestformat, CLI-Befehle, Marktplatzadapter, automatisches Update-Hashing) werden in [App-backed skills — full details](#app-backed-skills-full) behandelt.

## Benutzerdefiniertes skills erstellen {#creating-skills}

Erstellen Sie einen Skill, wenn:

- Es gibt ein Muster, dem der Agent wiederholt folgen sollte
- Ein Arbeitsablauf benötigt eine Schritt-für-Schritt-Anleitung
- Sie möchten Dateien aus einer Vorlage erstellen

Erstellen Sie keinen Skill, wenn:

- Die Anleitung ist bereits in einem anderen Skill vorhanden – erweitern Sie sie stattdessen
- Die Anleitung ist einmalig – legen Sie sie stattdessen in `AGENTS.md` oder im Arbeitsspeicher ab

## Skill-Format {#skill-format}

Jeder Skill ist eine Markdown-Datei mit YAML-Frontmatter:

```an-annotated-code title="Anatomie eines SKILL.md"
{
  "filename": ".agents/skills/project-imports/SKILL.md",
  "language": "markdown",
  "code": "---\nname: project-imports\ndescription: >-\n  How to import projects from the legacy CSV export. Use when the user uploads\n  a project CSV or asks to migrate projects from the old system.\n---\n\n# Project Imports\n\n## Rule\n\nAlways validate the CSV header row before writing any rows. Reject unknown\ncolumns rather than silently dropping them.\n\n## How\n\n1. Call `get-import-schema` to fetch the expected columns.\n2. Parse the first CSV row and diff against the schema.\n3. If any required columns are missing, return an error — do not proceed.\n4. Stream remaining rows through `create-project-item` in batches of 50.\n\n## Don't\n\n- Don't hold all rows in memory — stream them.\n- Don't create duplicate projects; check for an existing name first.\n\n## Related Skills\n\n- **storing-data** — SQL schema and write patterns for new rows\n- **sharing** — exposing a project to other users after import",
  "annotations": [
    { "lines": "2", "label": "Entdeckungsschlüssel", "note": "The `name` matches the folder; it is how the skill is invoked as `/project-imports`." },
    { "lines": "3-5", "label": "Der Auslöser", "note": "Dieses `description` ist der **einzige** Text, der immer im Kontext steht. Geben Sie genau an, wann die Fertigkeit angewendet wird." },
    { "lines": "9-14", "label": "Regeln zuerst", "note": "Beginnen Sie mit der harten Regel und dem Warum; der Agent liest den Body erst, wenn die Aufgabe passt." },
    { "lines": "27-30", "label": "Quervernetzung", "note": "Zeigen Sie auf verwandte Fähigkeiten, damit der Agent sie verketten kann, anstatt die Anleitung erneut abzuleiten." }
  ]
}
```

Die Frontmatter `name` und `description` werden vom Toolsystem des Agenten zur Fähigkeitserkennung verwendet. In der Beschreibung sollte angegeben werden, wann der Skill ausgelöst wird – geben Sie die Situationen genau an.

Speichern Sie die Datei unter `.agents/skills/my-skill/SKILL.md`. Der Verzeichnisname sollte mit dem `name` in frontmatter übereinstimmen.

> **Siehe auch:** [Writing Agent Instructions](/docs/writing-agent-instructions) für Informationen zum Formulieren von Fertigkeitsbeschreibungen, zur Anwendung progressiver Offenlegung und zum Halten von `AGENTS.md` schlank. Auf beiden Seiten wird der `project-imports`-Skill als laufendes Beispiel verwendet.

## Fähigkeitsbereich: Laufzeit vs. Entwicklung {#skill-scope}

Ein optionales `scope`-Frontmatter-Feld steuert, für welchen Agenten ein Skill bestimmt ist:

| `scope`   | Vom Laufzeitagenten geladen? | Verwenden für                                                                                            |
| --------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `both`    | Ja (Standard)                | Skills nützlich für den In-App-Agenten. Dies ist die Standardeinstellung, wenn `scope` weggelassen wird. |
| `runtime` | Ja                           | Skills nur für den In-App-Laufzeitagenten gedacht.                                                       |
| `dev`     | Nein                         | Skills ist nur für den Kodierungsagenten des Menschen gedacht (z. B. Claude-Code).                       |

```markdown
---
name: release-checklist
description: >-
  Steps for cutting a release. Use when preparing or publishing a new version.
scope: dev
---
```

Wenn `scope` fehlt (oder auf einen nicht erkannten Wert eingestellt ist), wird standardmäßig `both` verwendet, sodass jeder vorhandene Skill zur Laufzeit weiterhin geladen wird – dieses Feld ist vollständig abwärtskompatibel. Ein `scope: dev`-Skill ist für den Laufzeitagenten überall unsichtbar: Er ist vom in die Systemeingabeaufforderung eingefügten skills-Block und von den `docs-search`-Ergebnissen ausgeschlossen.

### Stellen Sie Ihrem Codierungsagenten eine Nur-Entwickler-Fähigkeit zur Verfügung {#dev-only-skills}

Die agentennative Laufzeit liest skills von `.agents/skills/`. Der Claude-Code liest skills unabhängig von `.claude/skills/`. So machen Sie einen Skill für Ihren Codierungsagenten verfügbar, aber vor dem Laufzeitagenten verborgen:

- Markieren Sie es als `scope: dev` in `.agents/skills/<name>/SKILL.md`, damit der Laufzeitagent es nie lädt, und/oder
- Platzieren oder spiegeln Sie den Skill unter `.claude/skills/<name>/SKILL.md`, sodass der Claude-Code ihn aufnimmt.

Dies ersetzt den alten Trick, sich darauf zu verlassen, dass Claude-Code nur `.claude/skills` liest – `scope: dev` macht die Aufteilung zwischen Entwickler und Laufzeit zu einer erstklassigen, expliziten Wahl.

```an-diagram title="Welcher Agent lädt welchen Skill?" summary="Der Bereich entscheidet, ob der In-App-Laufzeitagent einen Skill sieht. Dev-Skills sind nur für Ihren Codierungsagenten sichtbar."
{
"html": "<div class=\"sc-grid\"><div class=\"diagram-card\"><span class=\"diagram-pill\">.agents/skills/</span><div class=\"sc-row\"><span class=\"diagram-pill ok\">scope: both</span><small class=\"diagram-muted\">default</small></div><div class=\"sc-row\"><span class=\"diagram-pill ok\">scope: runtime</span></div><div class=\"sc-row\"><span class=\"diagram-pill warn\">scope: dev</span></div></div><div class=\"sc-targets\"><div class=\"diagram-box\">Runtime agent<br><small class=\"diagram-muted\">reads <code>both</code> + <code>runtime</code></small></div><div class=\"diagram-box\">Coding-Agent<br><small class=\"diagram-muted\">Claude Code reads <code>.claude/skills/</code> + <code>dev</code></small></div></div></div>",
"css": ".sc-grid{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}.sc-grid .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.sc-grid .sc-row{display:flex;align-items:center;gap:8px}.sc-grid .sc-targets{display:flex;flex-direction:column;gap:10px}"
}

```

> **Siehe auch:** [Writing Agent Instructions](/docs/writing-agent-instructions) für die Formulierung von Fertigkeitsbeschreibungen, die Anwendung progressiver Offenlegung und die schlanke Gestaltung von `AGENTS.md`.

## Skills vs. AGENTS.md {#skills-vs-agents-md}

> **AGENTS.md** – Die Übersicht. Listet alle Skripte auf, beschreibt das Datenmodell und erklärt die App-Architektur. Der Agent liest dies zuerst, um die App zu verstehen.
>
> **Skills** – Tiefe Tauchgänge. Jede Fertigkeit konzentriert sich auf ein Muster mit detaillierten Regeln, Codebeispielen und Do/Don't-Listen. Der Agent liest diese, wenn er einem bestimmten Muster folgen muss.

`AGENTS.md` teilt dem Agenten mit, _was_ die App tut. Skills sagt dem Agenten, _wie_ er bestimmte Dinge richtig machen soll. Beide werden benötigt – `AGENTS.md` zur Orientierung, skills zur Ausführung.

## Skills vs. Speicher {#skills-vs-memory}

> **Skills** – Verfasste, wiederverwendbare Anleitungen. Auf jeden Benutzer anwenden, bei Bedarf aufgerufen, wenn die Aufgabe übereinstimmt.
>
> **Speicher (`LEARNINGS.md` / `memory/MEMORY.md`)** – Gemeinsames Projektlernen und persönlicher strukturierter Speicher, der bei jeder Gelegenheit geladen wird.

Wenn das Wissen für _jeden_ gilt, der in der App arbeitet („CTEs immer gegenüber Unterabfragen bevorzugen“), handelt es sich um eine Fertigkeit oder ein gemeinsames `LEARNINGS.md`. Wenn es um _diesen bestimmten Benutzer_ geht („Steve mag prägnante Antworten“), gehört es in `memory/MEMORY.md`. Die vollständige Behandlung finden Sie unter [Workspace Memory](/docs/workspace#memory).

---

# Erweitert

## App-gestütztes skills – vollständige Details {#app-backed-skills-full}

App-gestütztes skills-Paket einer agentennativen App als Skill-Marktplatz-Artefakt.
Das Paket kann Agentenanweisungen, exportierte skills- und MCP-Konnektoren enthalten
Metadaten, gehostete/lokale Startanweisungen und UI-Oberflächen wie MCP-Apps.

Jeder app-gestützte Skill beginnt mit `agent-native.app-skill.json` im App-Stammverzeichnis:

```json
{
  "schemaVersion": 1,
  "id": "assets",
  "hosted": {
    "url": "https://assets.agent-native.com",
    "mcpUrl": "https://assets.agent-native.com/_agent-native/mcp"
  },
  "mcp": { "serverName": "agent-native-assets" },
  "skills": [
    {
      "path": ".agents/skills/asset-generation",
      "visibility": "both",
      "exportAs": "assets"
    }
  ]
}
```

Skill-Sichtbarkeit steuert, was versendet wird:

| Sichtbarkeit | Bedeutung                                                                        |
| ------------ | -------------------------------------------------------------------------------- |
| `internal`   | Wird vom eigenen Agenten der App verwendet und nicht auf Marktplätze exportiert. |
| `exported`   | Auf Marktplätze exportiert, aber von der App intern nicht benötigt.              |
| `both`       | Intern verwendet und exportiert.                                                 |

Hosted ist der Standardinstallationspfad. Der lokale Start dient explizit der Anpassung,
Offline-Arbeit oder datenschutzrelevante Nutzung.

```bash
# Glücklicher Weg: exportierte Anweisungen plus gehosteter MCP-Connector.
npx @agent-native/core@latest skills add visual-plan
npx @agent-native/core@latest skills add assets

# Repo-first Content docs/blog/MDX Bearbeitung.
npx @agent-native/core@latest skills add content --mode local-files --scope project

# Vercel/open-Fähigkeiten CLI: Nur exportierte Anweisungen, keine MCP-Konfiguration.
npx skills@latest add BuilderIO/agent-native --skill assets

# Registrieren Sie einen gehosteten MCP-Connector für lokale Agent-Clients.
npx @agent-native/core@latest app-skill ensure --manifest templates/assets/agent-native.app-skill.json

# Materialisieren Sie eine bearbeitbare lokale Quelle und führen Sie sie aus.
npx @agent-native/core@latest app-skill launch --manifest templates/assets/agent-native.app-skill.json --local --into ./assets-local

# Marktplatz-Adapter erstellen: Codex Plugin, Claude marketplace, Vercel Fähigkeiten,
# plain/Claude-Fähigkeiten und MCP-Konfigurationen.
npx @agent-native/core@latest app-skill pack --manifest templates/assets/agent-native.app-skill.json --out ./dist/assets-skill

# Installieren Sie ein lokal exportiertes Bundle mit den Vercel/open-Fähigkeiten CLI.
npx skills@latest add ./dist/assets-skill --skill assets -a codex -y

# Fügen Sie den generierten Claude Code-Marktplatz hinzu und installieren Sie dann dessen Assets-Plugin.
claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace
claude plugin install agent-native-assets@agent-native-apps
```

Halten Sie Geheimnisse aus den Skill-Dateien fern. Das Manifest sollte einen reinen URL-Connector
Metadaten; Die Einrichtung von OAuth/Geräten erfolgt auf dem MCP-Host oder über den normalen
Einstellungsablauf.

Der Vercel Labs `skills`-Adapter ist ein tragbares `skills/<name>/SKILL.md`-Paket
für `npx skills@latest add ...`, aber der rohe `skills` CLI installiert nur Anweisungen.
Es führt keine Repo-definierten Postinstallationsskripte aus und registriert keine MCP-Konnektoren.
Behalten Sie Agent Native CLI als Standarddokumentpfad für lokale Agenten bei, da dies der Fall ist
registriert auch den MCP-Anschluss. `BuilderIO/agent-native` ist ein echter GitHub
Repository-Quelle für Vercel/open Skills CLI; `skills.sh` ist eine Entdeckung und
Bestenlistenverzeichnis, kein Paket-Namespace im npm-Stil.

Der Marktplatzadapter Claude Code schreibt
`adapters/claude-marketplace/.claude-plugin/marketplace.json` plus ein verschachteltes
Plugin-Verzeichnis mit `skills/<name>/SKILL.md` und `.mcp.json`. In Claude
Code, Marktplatz hinzufügen, `agent-native-assets@agent-native-apps` installieren
Laden Sie die Plugins neu und authentifizieren Sie dann den Nur-URL-Connector MCP von `/mcp`.

Generierte Plugin-Manifeste sind für die automatische Aktualisierung eingerichtet: der Claude-Code
Marktplatzeintragssätze `autoUpdate: true` (mit Commit-SHA-Versionierung) und
Das Codex-Plugin `version` bettet einen Inhalts-Hash der gebündelten skills und MCP ein
Endpunkt, sodass installierte Plugins Skill-Änderungen übernehmen, ohne sie neu zu packen. Die
Die Plan-App wird auf diese Weise als sofort hinzufügbarer Marktplatz im Repo-Stammverzeichnis veröffentlicht –
siehe [Plan plugin & marketplace](/docs/plan-plugin) für die End-to-End-Installation
und Ablauf der automatischen Aktualisierung.

Für Benutzer, die kopiertes skills über das universelle CLI statt über ein
Plugin-Marktplatz, verwenden Sie die CLI Freshness-Befehle:

```bash
npx @agent-native/core@latest skills status visual-plan
npx @agent-native/core@latest skills update visual-plan
```

`skills update` scannt bekannte Codex/Claude-Projekt- und Benutzer-Skill-Ordner und vergleicht
Hash des kopierten Ordners auf den neuesten gebündelten Skill und schreibt veraltete Ordner neu in
Ort. Neu kopierte Agent Native skills enthalten einen `agent-native-skill.json`
Marker, damit zukünftige Statusausgaben die Quelle und den Hash identifizieren können.

Generierte Agent Native-Apps und Arbeitsbereiche enthalten auch vom Framework bereitgestellte
skills unter `.agents/skills` (oder `packages/shared/.agents/skills` in einem
Arbeitsbereich). Aktualisieren Sie die eingerüsteten skills vom aktuellen/neuesten CLI mit:

```bash
npm run skills:update
# oder, ohne sich auf das lokale Paketskript zu verlassen:
npx @agent-native/core@latest skills update scaffold --project
```

`AGENTS.md` und `.agents/skills` bleiben kanonisch. Der Update-Befehl repariert auch
Claude-Kompatibilitätslinks (`CLAUDE.md` und `.claude/skills`), damit Claude-Code angezeigt wird
die gleichen Anweisungen, ohne eine zweite Kopie zu behalten.
