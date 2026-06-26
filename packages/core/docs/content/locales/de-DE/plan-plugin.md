---
title: "Plugin und Marktplatz planen"
description: "Installieren Sie den Agent-Native-Plan skills (/visual-plan, /visual-recap) sowie den gehosteten Plan MCP-Connector als Claude-Code oder Codex-Plugin oder mit dem universellen CLI. Wie Updates funktionieren und ob Sie etwas einreichen müssen."
---

# Plugin und Marktplatz planen

Die Agent-Native **Plan**-App wird als ein installierbares Paket geliefert. Eine einzige Installation fügt sowohl den Plan-Slash-Befehl skills hinzu **und** verkabelt den gehosteten Plan-MCP-Connector, sodass der Agent Pläne generieren und der skills sie direkt in der Plan-App veröffentlichen kann.

## Was Sie bekommen {#what-you-get}

Eine Installation bietet Ihnen:

- **Zwei skills** – `/visual-plan` (der kanonische Einstiegspunkt) und `/visual-recap`.
- **Der Plan MCP-Connector** – registriert für die gehostete App unter `https://plan.agent-native.com` (MCP-Endpunkt `https://plan.agent-native.com/_agent-native/mcp`, Servername `plan`).

```an-diagram title="Drei Routen, ein Paket" summary="Die universellen Plugins CLI, Claude Code und Codex installieren alle dieselben zwei Skills sowie den gehosteten Plan-Connector."
{
  "html": "<div class=\"diagram-routes\"><div class=\"diagram-col\"><div class=\"diagram-node\">Universal CLI<br><small class=\"diagram-muted\">skills add visual-plan</small></div><div class=\"diagram-node\">Claude Code-Plugin<br><small class=\"diagram-muted\">/plugin install</small></div><div class=\"diagram-node\">Codex-Plugin<br><small class=\"diagram-muted\">codex plugin add</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">/visual-plan</span><span class=\"diagram-pill accent\">/visual-recap</span><small class=\"diagram-muted\">two skills</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Plan MCP connector<br><small class=\"diagram-muted\">plan.agent-native.com/_agent-native/mcp</small></div></div>",
  "css": ".diagram-routes{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-routes .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-routes .diagram-arrow{font-size:22px;line-height:1}.diagram-routes .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-routes .center .diagram-pill{margin:2px}"
}
```

Standardmäßig veröffentlichen beide skills in der gehosteten Plan-App – sie erstellen einen Plan über
den MCP-Anschluss und überreichen Ihnen einen Link oder einen Inline-Plan zur Überprüfung. Sie entleeren nie
ein Inline-Plan Markdown/ASCII im Chat als Ergebnis. Wenn ein Plan-Tool
gibt `needs auth`, `Unauthorized` oder `Session terminated` zurück, erneut authentifizieren
den Connector, anstatt auf die Inline-Ausgabe zurückzugreifen. Zugriffstoken sind
langlebig (30-Tage-Standard, gleitende 365-Tage-Aktualisierung), daher sollte dies selten vorkommen;
Wenn es passiert, lautet die einfache Lösung:

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex
```

`reconnect` findet und aktualisiert den Connector von URL für das ausgewählte lokale Objekt
Client – keine Neuinstallation erforderlich. Starten Sie einen neuen Codex-Thread, nachdem Sie die Verbindung wiederhergestellt haben.
Tool-Registrierung wird neu geladen. Im Claude-Code lautet das Äquivalent `/mcp` →
**Authentifizieren/Wiederverbinden** oder der gleiche Befehl mit `--client claude-code`.

Die Ausnahme ist der explizite **Datenschutzmodus für lokale Dateien**. Wenn Sie nach keiner DB fragen
schreibt oder setzt `AGENT_NATIVE_PLANS_MODE=local-files`, der skills darf nicht aufrufen
der Plan MCP-Anschluss. Sie schreiben `plans/<slug>/plan.mdx` plus optional
`canvas.mdx`, `prototype.mdx` und `.plan-state.json`, dann lokal in der Vorschau anzeigen mit:

```bash
npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind plan --open
```

Dies startet eine kleine Localhost-Brücke und öffnet den Plan UI für den lokalen
Ordner. (`plan local preview` führt stattdessen eine lokale Plan-Dev-Server-Route aus und
`plan local preview --out preview.html` ist eine ältere Notluke, die ein schreibt
eigenständige statische HTML-Datei. `plan serve` wird als Kurzalias für
`plan local serve`.)

Ein paar wissenswerte Fallstricke im lokalen Dateimodus:

- **Verwenden Sie einen Chromium-Browser.** Safari blockiert die gehostete HTTPS Plan-Seite von
  Lesen der `http://127.0.0.1` Localhost Bridge (Mixed-Content/privat
  Netzwerk), sodass die Seite bei „Plan wird geladen“ hängen bleibt. Auf macOS `--open` bereits
  bevorzugt Chrome/Chromium/Edge/Brave; Wenn Safari trotzdem geöffnet wird, öffnen Sie die gedruckte
  URL in einem Chromium-Browser.
- **Der bereitgestellte URL wird in `plans/<slug>/.plan-url`** geschrieben (Überschreiben mit
  `--url-file`). Ein Hintergrund- oder Headless-Agent kann diese Datei stattdessen lesen
  Scraping des lang laufenden `serve`-Stdouts. Behandeln Sie es als lokale Tokendatei und
  Festschreiben Sie es nicht.
- **Überprüfen Sie kopflos**, wenn kein Browser verfügbar ist:
  `npx @agent-native/core@latest plan local verify --dir plans/<slug>` startet den
  Bridge, prüft den Preflight des privaten Netzwerks und die JSON-Nutzlast, druckt
  Diagnose und beendet bei Fehler einen Wert ungleich Null – kein menschliches Auge erforderlich.
- **Führen Sie zuerst `plan local check` aus.** Dadurch wird MDX anhand des Plans validiert.
  Blockschema des Renderers (einschließlich erforderlicher Felder wie `checklist`-Element
  `id`/`label` und `question-form` Frage `id`/`title`/`mode`), also verfassen
  Fehler tauchen vor der Browserübergabe auf und nicht als hängengebliebener Lader.

Für Ordner im aktuellen Repo umfasst die direkte lokale Route `?path=...` so
Die lokale Plan-App kann Browser-Änderungen im Repo-Ordner speichern. Der Plan
App verwendet `apps.plan.roots[0].path` in `agent-native.json` als Standardort
Um beworbene lokale Pläne zu speichern, greifen Sie auf `plans/` zurück.

Dadurch werden Planinhalte aus der Agent-Native-Plandatenbank ferngehalten. Gehostete Freigabe,
Kommentare, Screenshots und der Planverlauf sind erst verfügbar, wenn Sie dies ausdrücklich tun
später veröffentlichen.

```an-diagram title="Gehosteter vs. lokaler Dateimodus" summary="Standardmäßig werden Fertigkeiten über den Connector veröffentlicht. Der lokale Dateimodus schreibt stattdessen MDX auf die Festplatte und zeigt eine Vorschau über eine Localhost-Bridge an."
{
  "html": "<div class=\"diagram-modes\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Standard · gehostet</span><strong>In die Plan-App veröffentlichen</strong><small class=\"diagram-muted\">MCP connector &rarr; hosted DB &rarr; share links, comments, history, screenshots</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">Datenschutz für lokale Dateien</span><strong>MDX auf die Festplatte schreiben</strong><small class=\"diagram-muted\">plan.mdx + canvas.mdx + prototype.mdx &rarr; localhost bridge &rarr; hosted Plan UI reads local source. No DB-Schreibvorgangs until <code>publish-visual-plan</code>.</small></div></div>",
  "css": ".diagram-modes{display:flex;gap:14px;flex-wrap:wrap}.diagram-modes .diagram-card{flex:1 1 260px;display:flex;flex-direction:column;gap:6px;padding:16px 18px}"
}
```

Agent Native Desktop verfügt über einen separaten Synchronisierungspfad für lokale Dateien für gehostete Pläne: den
Desktop-App kann einen gehosteten Plan in lokale MDX-Dateien spiegeln und Änderungen wieder importieren
ohne die Plan-App zu klonen oder ein CLI auszuführen. Dieser Workflow behält das gehostete
Plandatenbank als Quelle der Wahrheit; Verwenden Sie beim Ziel den Datenschutzmodus für lokale Dateien
Es gibt keine Plan-DB-Schreibvorgänge.

> Das Plugin (`agent-native-visual-plans`) trägt die App-ID `visual-plans`, weshalb der Claude-Code-Plugin-Name und der Codex-Plugin-Name beide `agent-native-visual-plans` lauten. Der Anzeigename der Plan-App lautet „Agent-Native Plan“.

## Routen installieren {#install}

Es gibt drei Möglichkeiten. Die **universelle CLI-Route** ist diejenige, die wir standardmäßig empfehlen, da sie skills installiert **und** Sie in einem Ablauf zwischen dem gehosteten, lokalen Datei- oder selbstgehosteten Modus wählen können. Die Plugin-Routen sind für Hosts mit einem erstklassigen Plugin-/Marktplatzsystem und verwenden standardmäßig gehostete Pläne.

### Universelle Skill-Route (jeder MCP-Host) {#universal}

Funktioniert für jeden Host – Claude Code, Codex, Cursor, Cline, Goose, benutzerdefinierte MCP-Apps von ChatGPT, Claude Cowork und alles andere, was mit MCP kompatibel ist. Der Agent-Native CLI installiert beide skills, registriert den gehosteten Plan MCP-Connector **und führt im selben Schritt die Authentifizierung für die ausgewählten lokalen Clients aus**, sodass Ihr erster Tool-Aufruf nicht auf eine OAuth-Wand stößt:

```bash
npx @agent-native/core@latest skills add visual-plan
```

Dadurch werden `visual-plan` und der begleitende `visual-recap`-Skill installiert, dann wird der `plan`-Connector registriert und dann wird die Authentifizierung ausgeführt (OAuth-Eingabeaufforderung für gehostete/kontogestützte Freigabe). Nützliche Flags:

- `--client codex|claude-code|claude-code-cli|cowork|all` – welche lokalen Agenten die MCP-Konfiguration schreiben sollen (Standard `all`).
- `--no-connect` – Registrieren Sie den Connector ohne Authentifizierung. Führen Sie `npx @agent-native/core@latest connect https://plan.agent-native.com --client all` später aus oder wählen Sie ein schmaleres `--client`.
- `--mode hosted|local-files|self-hosted` – wählen Sie gehostete Freigabe, ausschließlich lokale MDX-Dateien oder Ihre eigene Plan-App.
- `--mcp-url <url>` – Richten Sie den Connector auf einen benutzerdefinierten Ursprung (einen Ngrok-Tunnel, einen lokalen Entwicklungsserver oder eine selbst gehostete Bereitstellung) statt auf den gehosteten Standard.
- `--with-github-action` – schreiben Sie auch die PR Visual Recap GitHub-Aktion (siehe [PR Visual Recap](/docs/pr-visual-recap)).

Interaktive Installationen bieten auch die PR Visual Recap Action, wenn kein Workflow vorhanden ist
vorhanden. Sagen Sie „Ja“, um es während der Skill-Einrichtung hinzuzufügen, oder führen Sie den obigen Befehl später aus
mit `--with-github-action`. Nachdem der Workflow geschrieben wurde, führen Sie Folgendes aus:

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup` konfiguriert nach Möglichkeit die GitHub-Aktionsgeheimnisse und -Variablen.
und `recap doctor` überprüft den Workflow, das lokale Veröffentlichungstoken und das GitHub-Repository
-Zugriff und erforderliche Actions-Konfiguration. Starten Sie nach Abschluss der Installation neu oder
Laden Sie den Agent-Client neu, damit das neue skills und die neuen Tools geladen werden, und führen Sie ihn dann aus
`/visual-plan`.

> Hinweis: Der nackte `npx skills@latest add BuilderIO/agent-native --skill visual-plan` (Vercel/open Skills CLI) installiert **nur Anweisungen** – der MCP-Anschluss wird nicht registriert. Verwenden Sie den oben genannten Agent-Native CLI, wenn auch der Stecker verkabelt sein soll.

### Claude-Code (Plugin) {#claude-code}

Das öffentliche `BuilderIO/agent-native`-Repo ist selbst ein Claude-Code-Plugin-Marktplatz, Sie fügen es also direkt hinzu – kein Build-Schritt. Im Claude-Code:

```text
/plugin marketplace add BuilderIO/agent-native
/plugin install agent-native-visual-plans@agent-native-apps
/reload-plugins
/mcp        # authenticate the Plan connector (one OAuth approval)
```

`/plugin install` fügt sowohl den Plan skills als auch eine **nur für URL** verfügbare MCP-Konfiguration hinzu (keine Geheimnisse im Paket); `/mcp` → **Authentifizieren** schließt den OAuth-Handshake ab. Verwenden Sie stattdessen die universelle CLI-Route, wenn Sie lokale Dateien oder den selbstgehosteten Modus wünschen.

> Der Marktplatzkatalog heißt `agent-native-apps` und das Plan-Plugin heißt `agent-native-visual-plans`, daher ist das Installationsziel immer `agent-native-visual-plans@agent-native-apps`.

### Codex (Plugin) {#codex}

Dasselbe Repo ist ein Codex-Plugin-Marktplatz. Fügen Sie es hinzu, installieren Sie das Plugin und authentifizieren Sie dann den Connector:

```bash
codex plugin marketplace add BuilderIO/agent-native
codex plugin add agent-native-visual-plans@agent-native-apps
codex mcp login plan   # OAuth im Browser
```

Nach der Installation **starten Sie einen neuen Codex-Thread**, damit die Tools skills und MCP in die Sitzung geladen werden. Das Plugin enthält einen Nur-URL-Anschluss (`[mcp_servers.plan]` → `https://plan.agent-native.com/_agent-native/mcp`); `codex mcp login plan` führt den OAuth-Flow aus. Die obige universelle CLI-Route funktioniert auch für Codex (`npx @agent-native/core@latest skills add visual-plan --client codex`), wenn Sie einen Befehl bevorzugen, der zusammen installiert und authentifiziert, oder wenn Sie lokale Dateien oder den selbstgehosteten Modus wünschen.

> **Ältere Installationen:** Wenn Ihre Konfiguration immer noch einen `agent-native-plans`-Eintrag enthält, der auf denselben URL zeigt, konsolidiert die Ausführung von `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex` für Codex oder denselben Befehl mit Ihrem Ziel-`--client` diesen zum kanonischen `plan`-Namen.

## Updates {#updates}

Das Plugin leitet die automatische Aktualisierung weiter – Sie müssen den Marktplatz nicht neu packen oder hinzufügen, wenn sich Ihre Fähigkeiten routinemäßig ändern:

- **Claude-Code** – der Marktplatzeintrag legt `autoUpdate: true` fest und das Plugin verwendet die Commit-SHA-Versionierung, sodass Claude-Code beim Start neue Versionen aus dem Repo abruft; Führen Sie `/reload-plugins` aus, um es zu aktivieren. Jeder Push an den Standardzweig des Repos erreicht installierte Benutzer automatisch.
- **Codex** – das Plugin `version` bettet einen Inhalts-Hash des gebündelten skills- und MCP-Endpunkts (z. B. `1.0.0+codex.<hash>`) ein, sodass jede Skill- oder Endpunktänderung eine neue Version ergibt. Das Startup-Auto-Upgrade von Codex installiert konfigurierte Git-Marktplätze selbstständig neu; **eröffne einfach einen neuen Thread**, um die Änderung zu übernehmen. Für routinemäßige Aktualisierungen ist kein manuelles `codex plugin marketplace upgrade` erforderlich.
- **Universelle CLI-Route** – Führen Sie `npx @agent-native/core@latest skills status visual-plan` aus, um kopierte Skill-Ordner zu überprüfen, oder `npx @agent-native/core@latest skills update visual-plan`, um sie an Ort und Stelle zu aktualisieren. Das erneute Ausführen von `skills add visual-plan` funktioniert weiterhin, wenn Sie auch den Connector neu registrieren/authentifizieren möchten. `@latest` ruft immer das aktuelle skills aus dem veröffentlichten `@agent-native/core`-Paket ab.

Der Connector zeigt auf eine **gehostete** App, sodass die actions- und Live-Tool-Oberfläche der Plan-App immer die bereitgestellte Version widerspiegelt, unabhängig davon, wann Sie sie installiert haben; Nur die gebündelten Skill-Anweisungen folgen den oben genannten Aktualisierungsmechanismen.

> **Betreuer:** Das Marktplatzpaket (`.claude-plugin/`, `.agents/plugins/`) wird aus dem kanonischen Plan skills von `pnpm sync:plan-marketplace` generiert und in CI von `pnpm guard:plan-marketplace` überprüft, sodass der veröffentlichte Marktplatz immer mit dem kanonischen skills übereinstimmt. Bearbeiten Sie den Skill, führen Sie `pnpm sync:plan-marketplace` aus und führen Sie einen Commit durch.

## Müssen Sie etwas einreichen? {#submission}

**Zum Verteilen oder Installieren ist keine Einreichung oder Überprüfung erforderlich.** `BuilderIO/agent-native` ist ein selbst gehosteter, öffentlicher Git-Marktplatz, sodass Benutzer ihn direkt mit den oben genannten Befehlen auf **sowohl Claude-Code als auch Codex** hinzufügen – ohne Antrag oder Genehmigung. Die universelle CLI-Route benötigt überhaupt keinen Marktplatz.

Optionale Auffindbarkeit, wenn Sie einen öffentlichen Eintrag wünschen:

- **Claude Code** verfügt über einen Community-Marktplatz, den Sie _optional_ zur Auflistung einreichen können (Einreichung plus automatische Überprüfung). Die Auflistung des offiziellen, von Anthropic kuratierten Marktplatzes liegt im Ermessen von Anthropic – es gibt keine offene Selbstbedienungsanwendung. Beides ist nicht erforderlich, um die oben genannten Installationsbefehle zu verwenden.
- **Codex** verfügt über einen von OpenAI kuratierten Plugin-Katalog (eine geschlossene Zulassungsliste, die als Partnerschaft und nicht als Selbstbedienungs-Einreichung bezogen wird). Selbst gehostete Git-Marktplätze und die CLI-Route erfordern keine Einreichung, um zu funktionieren.

Kurz gesagt: Liefern Sie es als selbst gehosteten/öffentlichen Git-Marktplatz und Benutzer installieren es direkt; Senden Sie es nur dann an einen kuratierten Katalog, wenn Sie möchten, dass es zur Entdeckung aufgeführt wird.

## Plugin vs. Skill {#plugin-vs-skill}

Ein **Skill** ist eine einzelne `SKILL.md`-Anweisungsdatei, die der Agent liest, wenn eine Aufgabe übereinstimmt. Ein **Plugin** (Claude Code Marketplace Plugin oder Codex Plugin) ist ein Paket, das ein oder mehrere skills **plus** einen MCP Connector und Metadaten bündelt, sodass ein Host alles in einem Schritt installieren kann.

Unter der Haube werden alle drei Routen aus derselben Quelle vom `npx @agent-native/core@latest app-skill` CLI erzeugt: `app-skill pack` erstellt die Marktplatz-/Plugin-Adapter, und `skills add` ist der benutzerfreundliche One-Step-Installer, der auch den MCP-Connector registriert und authentifiziert. Siehe [Skills Guide](/docs/skills-guide) für das App-Skill-Manifestformat und [External Agents](/docs/external-agents) für die Verbindung eines beliebigen MCP-Hosts und des `npx @agent-native/core@latest connect`-Flows.

## Was kommt als nächstes? {#whats-next}

- [**Visual Plans**](/docs/template-plan) – was die skills tun und wie man sie verwendet
- [**PR Visual Recap**](/docs/pr-visual-recap) – `/visual-recap` automatisch bei jeder Pull-Anfrage ausführen
- [**Skills Guide**](/docs/skills-guide) – App-gestütztes skills und das Manifestformat
- [**External Agents**](/docs/external-agents) – verbinden Sie alle MCP-Hosts und Round-Trip-Artefakte
