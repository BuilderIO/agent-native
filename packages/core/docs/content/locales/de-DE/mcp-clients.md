---
title: "MCP-Clients"
description: "Verbinden Sie Ihre agentennative App mit lokalen MCP-Servern (Claude-in-Chrome, Dateisystem, Dramatiker usw.), damit der Agent seine Tools erhält."
---

# MCP-Clients

**Diese Seite: Geben Sie Ihrem Agenten mehr Tools.** Richten Sie eine agentennative App auf MCP-Server – lokal oder remote –, damit deren Tools im Agenten-Chat angezeigt werden. Dies ist die _Client_-Richtung, das Spiegelbild von [MCP Protocol](/docs/mcp-protocol) (was Ihre App zu einem MCP _Server_ macht).

| Wenn Sie möchten...                                                                                    | Lesen                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Verbinden Sie einen externen Agenten/Host mit Ihrer App                                                | [External Agents](/docs/external-agents) |
| Geben Sie Ihrem Agent mehr Tools (nutzen Sie andere MCP-Server)                                        | **Diese Seite** – MCP-Clients            |
| Erstellen Sie Inline-UIs, die in Claude/ChatGPT rendern                                                | [MCP Apps](/docs/mcp-apps)               |
| MCP-Serverreferenz auf niedrigerer Ebene (Authentifizierung, Tools, benutzerdefinierte Bereitstellung) | [MCP Protocol](/docs/mcp-protocol)       |

Mit einer Konfigurationsdatei erhält jede agentennative App in Ihrem Arbeitsbereich Zugriff auf Tools, die von MCP-Servern auf Ihrem Computer bereitgestellt werden: `claude-in-chrome` für die Browserautomatisierung, `@modelcontextprotocol/server-filesystem` zum Lesen von Dateien, `@playwright/mcp` für Browsertests und alles andere, das MCP spricht.

Sie können auch [connect remote (HTTP) MCP servers at runtime](#remote-via-ui) – einzelne Benutzer oder ganze Organisationen – ohne Bearbeiten einer Konfigurationsdatei.

Jede Quelle wird in einen Laufzeit-**MCP-Manager** aufgelöst, und jedes erlernte Tool landet in der Tool-Registrierung des Agenten unter einem kollisionssicheren `mcp__<server-id>__<tool>`-Präfix – gezielt durchsuchbar über `tool-search`.

```an-diagram title="Kundenanweisung: viele Quellen, eine Tool-Registrierung" summary="Konfigurationsdateien, Umgebung und Laufzeit-Benutzeroberfläche werden alle im MCP-Manager zusammengeführt; Seine Tools werden neben den Aktionen Ihrer App als Präfix angezeigt und sind durchsuchbar. Dies ist der Spiegel der Serverrichtung."
{
  "html": "<div class=\"mcp-merge\"><div class=\"diagram-col sources\"><div class=\"diagram-box\" data-rough>Workspace <code>mcp.config.json</code><br><small class=\"diagram-muted\">app-übergreifend geteilt</small></div><div class=\"diagram-box\" data-rough>App-Root <code>mcp.config.json</code><br><small class=\"diagram-muted\">Override pro App</small></div><div class=\"diagram-box\" data-rough><code>MCP_SERVERS</code> env<br><small class=\"diagram-muted\">CI / Produktion</small></div><div class=\"diagram-box\" data-rough>Remote über Einstellungs-UI<br><small class=\"diagram-muted\">personal &amp; org scope</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">MCP-Manager</span><small class=\"diagram-muted\">merge &middot; hot-reload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col out\"><div class=\"diagram-node\">Agentenwerkzeug registry<br><small class=\"diagram-muted\"><code>mcp__&lt;server-id&gt;__&lt;tool&gt;</code></small></div><div class=\"diagram-node\"><code>tool-search</code><br><small class=\"diagram-muted\">nach Absicht entdecken</small></div></div></div>",
  "css": ".mcp-merge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-merge .diagram-col{display:flex;flex-direction:column;gap:8px}.mcp-merge .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-merge .diagram-arrow{font-size:22px;line-height:1}.mcp-merge code{font-size:.85em}"
}
```

> Die entgegengesetzte Richtung – _Ihre_ App zu einem MCP-Server zu machen, den andere Hosts nutzen – findet in [MCP Protocol](/docs/mcp-protocol) und [External Agents](/docs/external-agents) statt.

## Integrierte Browser- und Computernutzungsfunktionen {#built-in-capabilities}

Agent-native umfasst lokale Entwicklungsschalter für gängige stdio MCP-Server.
Sie sind standardmäßig deaktiviert und können nur pro Benutzer oder pro Organisation aktiviert werden
wenn die App lokal ausgeführt wird. Produktions- und gehostete serverlose Laufzeiten werden übersprungen
diese integrierten Funktionen, auch wenn alte Einstellungszeilen vorhanden sind, und die Arbeitsbereichsressourcen
Baum zeigt sie nicht als Standard-`mcp-servers/*.json`-Ressourcen an.

| Fähigkeit          | Server-ID         | Befehl                                                                  |
| ------------------ | ----------------- | ----------------------------------------------------------------------- |
| Chrome DevTools    | `chrome-devtools` | `npx -y chrome-devtools-mcp@latest --autoConnect --no-usage-statistics` |
| Dramatiker-Browser | `playwright`      | `npx -y @playwright/mcp@latest`                                         |
| Computernutzung    | `computer-use`    | `npx -y computer-use-mcp@latest`                                        |

In einem Bereich kann jeweils nur eine Browserfunktion aktiviert sein. Durch die Aktivierung von Chrome DevTools wird Playwright für denselben Benutzer oder dieselbe Organisation deaktiviert, und durch die Aktivierung von Playwright werden Chrome DevTools deaktiviert.

Computernutzung ist nur für macOS möglich. Auf anderen Plattformen wird es als nicht verfügbar aufgeführt und übersprungen, selbst wenn es in einer alten Einstellungszeile enthalten ist.

Chrome DevTools verwendet standardmäßig `--autoConnect`. Dies hängt mit einer berechtigten laufenden Chrome-Instanz zusammen. Es wird kein isoliertes Browserprofil erstellt und Sie melden sich nicht beim regulären Profil des Benutzers an. Es erfordert Chrome 144+ mit aktiviertem Remote-Debugging. Eine manuelle `browser-url`-Konfiguration kann später hinzugefügt werden, wenn eine Bereitstellung einen bestimmten Debug-Endpunkt benötigt.

Eingebaute Elemente bleiben in der `settings`-Tabelle des Frameworks unter `u:<email>:mcp-builtin-capabilities` für persönliche Umschaltungen und `o:<orgId>:mcp-builtin-capabilities` für Team-Umschaltungen erhalten. Wenn sie aktiviert sind, werden sie mit demselben bereichsbezogenen Sichtbarkeitsformat wie Remote-Server in den Runtime-MCP-Manager integriert, beispielsweise `mcp__user_<emailhash>_playwright__*` oder `mcp__org_<orgId>_chrome-devtools__*`.

### Benutzerbezogene Einrichtungshinweise

Verwenden Sie eine prägnante, explizite Setup-Kopie für die sensiblen integrierten Funktionen:

- **Chrome DevTools** wird an ein laufendes Chrome-Debugging-Ziel angehängt. Teilen Sie es den Benutzern mit
  Es ist für Browsertests und die Überprüfung der Anmeldung gedacht und
  Möglicherweise muss das Chrome-Remote-Debugging aktiviert werden, bevor Tools angezeigt werden.
- **Playwright** startet einen isolierten Browser. Empfehlen Sie es für deterministisch
  Qualitätssicherung, wenn das Live-Chrome-Profil des Nutzers nicht erforderlich ist.
- **Computernutzung** kann lokale Apps betreiben. Lassen Sie es standardmäßig ausgeschaltet, erklären Sie das
  Aufforderungen zur Bildschirmaufzeichnung und Barrierefreiheit unter macOS und fragen Sie vor der Aufnahme nach
  sensible actions wie Käufe, finanzielle Änderungen oder Kontoänderungen.

### Integrierte Endpunkte

| Methode | Route                        | Zweck                                                                                           |
| ------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/builtin` | Integrierte Funktionen, aktivierte Bereiche, zusammengeführte IDs und Live-Status auflisten.    |
| POST    | `/_agent-native/mcp/builtin` | Aktualisieren Sie einen Bereich. Körper: `{ scope, enabledIds }` oder `{ scope, id, enabled }`. |

## Hinzufügen eines lokalen MCP-Servers {#adding-a-server}

Erstellen Sie `mcp.config.json` in Ihrem Workspace-Root (oder in einem einzelnen App-Root – Workspace-Root gewinnt, wenn beide vorhanden sind):

```jsonc
{
  "$schema": "https://agent-native.com/schema/mcp.config.json",
  "servers": {
    "claude-in-chrome": {
      "command": "claude-in-chrome-mcp",
      "args": [],
      "env": { "LOG_LEVEL": "info" },
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@latest",
        "/Users/me/projects",
      ],
    },
  },
}
```

Die Form ist klein: eine nach Server-ID verschlüsselte `servers`-Karte, wobei jeder Eintrag entweder ein Standard-Launcher (`command` + `args` + optional `env`) oder ein entfernter `{ "type": "http", "url", "headers" }`-Eintrag ist.

```an-annotated-code title="mcp.config.json, kommentiert"
{
  "filename": "mcp.config.json",
  "language": "jsonc",
  "code": "{\n  \"$schema\": \"https://agent-native.com/schema/mcp.config.json\",\n  \"servers\": {\n    \"claude-in-chrome\": {\n      \"command\": \"claude-in-chrome-mcp\",\n      \"args\": [],\n      \"env\": { \"LOG_LEVEL\": \"info\" }\n    },\n    \"filesystem\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem@latest\", \"/Users/me/projects\"]\n    }\n  }\n}",
  "annotations": [
    { "lines": "3", "label": "Server-ID", "note": "Der Schlüssel wird zum Tool-Präfix: Die Tools dieses Servers werden in der Registrierung des Agenten als `mcp__claude-in-chrome__*` angezeigt, sodass sie nicht mit den Aktionen Ihrer Vorlage kollidieren können." },
    { "lines": "4-6", "label": "stdio launcher", "note": "`command` + `args` erzeugen eine lokale Binärdatei. Stdio-Server sind für die **lokale Entwicklung** gedacht – sie sind in Edge-Laufzeiten ein No-Op." },
    { "lines": "6", "label": "Prozessumgebung", "note": "Optional `env` is passed to the spawned process. Keep secrets out of committed config; prefer `MCP_SERVERS` or the settings UI for tokens." }
  ]
}
```

Beim nächsten App-Start sehen Sie:

```
[mcp-client] loaded config from /path/to/mcp.config.json (3 server(s))
[mcp-client] connected to claude-in-chrome: 12 tools
[mcp-client] connected to playwright: 9 tools
[mcp-client] connected to filesystem: 4 tools
```

Die Tools werden in der Tool-Registrierung des Agenten mit dem Präfix `mcp__<server-id>__<tool-name>` registriert, sodass sie nicht mit dem actions Ihrer Vorlage kollidieren können. Sie sind auch in `tool-search` enthalten, sodass Agenten neu verbundene MCP-Funktionen absichtlich erkennen können, anstatt im Voraus den genauen Präfixnamen zu benötigen.

## Priorität konfigurieren {#precedence}

MCP-Konfiguration wird in dieser Reihenfolge aufgelöst, erste Übereinstimmung gewinnt:

1. **Workspace-Root `mcp.config.json`** – erkannt über `agent-native.workspaceCore` in `package.json`. Wird in allen Apps im Arbeitsbereich geteilt.
2. **App-Root `mcp.config.json`** – Überschreibung pro App, wenn Sie nicht möchten, dass in jeder App ein MCP-Server verfügbar ist.
3. **`MCP_SERVERS` env var** – JSON-Zeichenfolge mit der gleichen Form, für CI/Produktion, wo eine Datei keinen Sinn ergibt.

## Produktionsbereitstellungen: `MCP_SERVERS` {#mcp-servers-env}

Für Produktionsbereitstellungen bevorzugen Sie Remote-HTTP MCP-Server und legen Sie die vollständige Konfiguration fest
Form (oder die innere Serverzuordnung) als Umgebungsvariable:

```bash
MCP_SERVERS='{"servers":{"zapier":{"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer paste-token-value-here"}}}}'
```

`MCP_SERVERS` wird als JSON geparst, sodass `${...}`-Platzhalter nicht erweitert werden
innerhalb der Zeichenfolge. Wenn Sie das Token in einem anderen Secret speichern, erweitern Sie es vorher
Schreiben des endgültigen JSON-Werts.

Stdio MCP-Server erzeugen lokale Binärdateien und sind für die lokale Entwicklung gedacht.
MCP-Tools werden nur in Knotenlaufzeiten aktiviert – Cloudflare Workers und anderen Edge-Geräten
Ziele überspringen MCP stillschweigend und fahren fort, während der Rest der App funktioniert
normalerweise.

## Automatische Erkennung: `claude-in-chrome` {#autodetect}

Wenn Sie **keinen** `mcp.config.json` haben und sich die Binärdatei `claude-in-chrome-mcp` auf `PATH` (oder am bekannten Installationsort `~/.claude-in-chrome/bin/claude-in-chrome-mcp`) befindet, registriert Agent-Native sie automatisch als Standard-MCP-Server. Stellen Sie `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1` so ein, dass es deaktiviert wird.

Das bedeutet, dass Benutzer, die die Claude-in-Chrome-Erweiterung installiert haben, die Browsersteuerung für jede von ihnen geöffnete agentennative App ohne Konfigurationsänderungen erhalten.

## Remote-MCP-Server über die Einstellungen UI {#remote-via-ui}

MCP-Server (Model Context Protocol) geben Ihrem Agenten neue Fähigkeiten – wie die Verbindung zu Zapier, Cloudflare, Composio oder den internen Tools Ihres Unternehmens. Sobald die Verbindung hergestellt ist, kann der Agent diese Tools genauso verwenden wie die integrierten.

### So verbinden Sie einen Remote-MCP-Server

1. **Servername** – eine kurze Bezeichnung für Ihre eigene Referenz (z. B. „zapier“, „slack-tools“).
2. **URL** – der HTTPS-Endpunkt, den Ihnen der MCP-Serveranbieter gegeben hat (z. B. `https://mcp.zapier.com/s/abc123/mcp`). Dies finden Sie normalerweise im Dashboard oder in den Integrationsdokumenten des Anbieters.
3. **Beschreibung** (optional) – eine Notiz darüber, was dieser Server tut.
4. **Header** – Authentifizierungsdaten, die der Server benötigt, eine pro Zeile. Die meisten Server benötigen einen `Authorization`-Header. Beispiel: `Authorization: Bearer sk-your-key-here`. In den Dokumenten des Anbieters erfahren Sie, was Sie hier eingeben müssen.

Klicken Sie auf **Test**, um die Verbindung vor dem Speichern zu überprüfen. Wenn dies erfolgreich ist, wird die Anzahl der verfügbaren Tools angezeigt. Klicken Sie auf **Verbinden**, um es hinzuzufügen.

### Persönlicher vs. Organisationsbereich

Zwei Bereiche werden unterstützt:

- **Persönlich** – nur der angemeldete Benutzer erhält die Tools. Wird als Benutzerbereichseinstellung gespeichert.
- **Team** – jeder in der aktiven Organisation erhält die Tools. Besitzer und Administratoren können hinzufügen; Mitglieder sehen die Liste schreibgeschützt. Wird als Organisationsbereichseinstellung gespeichert.

Fügt Hot-Reload zum laufenden MCP-Manager hinzu und entfernt es – kein Neustart des Prozesses und kein Neustart des Servers. Die neuen `mcp__<scope>-<name>__*`-Tools werden dem Agenten in der nächsten Nachricht angezeigt und können über `tool-search` durchsucht werden.

HTTPS URLs werden überall akzeptiert; einfaches `http://` ist während der Entwicklung nur für `localhost` zulässig. Die optionale Authentifizierung erfolgt als Bearer-Token, das bei jeder Anfrage über `Authorization: Bearer …` gesendet wird.

Unter der Haube werden diese Server in der `settings`-Tabelle des Frameworks unter dem Schlüssel `u:<email>:mcp-servers-remote` (Persönlich) oder `o:<orgId>:mcp-servers-remote` (Team) gespeichert und beim Start mit `mcp.config.json` zusammengeführt.

### HTTP-Endpunkte

| Methode | Route                                                 | Zweck                                                                                                         |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/servers`                          | Listen Sie die persönlichen Server und Organisationsserver des aktuellen Benutzers mit Live-Status auf.       |
| POST    | `/_agent-native/mcp/servers`                          | Fügen Sie einen Server hinzu. Körper: `{ scope, name, url, headers?, description? }`.                         |
| DELETE  | `/_agent-native/mcp/servers/:id?scope=user\|org`      | Entfernen Sie einen Server und konfigurieren Sie den Manager neu.                                             |
| POST    | `/_agent-native/mcp/servers/:id/test?scope=user\|org` | Führen Sie die Verbindungs- und Listentools des vorhandenen Servers trocken aus.                              |
| POST    | `/_agent-native/mcp/servers/test`                     | Führen Sie einen Probelauf eines beliebigen URL durch, bevor Sie es beibehalten. Körper: `{ url, headers? }`. |

Stdio-Server sind außerhalb der Node-Laufzeiten immer noch ein No-Op-Server, aber entfernte HTTP MCP-Server funktionieren in jeder Umgebung mit `fetch` – einschließlich Desktop-Produktions-Builds.

## Gemeinsame MCP-Server über einen Hub {#hub}

Wenn in Ihrem Arbeitsbereich mehrere agentennative Apps ausgeführt werden (z. B. Versand + E-Mail + Clips), können Sie **eine** App als Hub konfigurieren und die anderen ihre MCP-Server im Organisationsbereich automatisch abrufen lassen. Kein Kopieren und Einfügen pro App von URLs und Inhabertokens. Siehe [Multi-App Workspace](/docs/multi-app-workspace) für den kanonischen Ansatz unter Verwendung der MCP-Ressourcen des Dispatch-Arbeitsbereichs.

Dispatch ist der herkömmliche Hub – er koordiniert bereits alle Apps.

```an-diagram title="Hub-Modell: Eine App bedient MCP-Server im Organisationsbereich" summary="Dispatch enthält die MCP-Server im Organisationsbereich; Verbraucher-Apps rufen sie ab und führen sie als mcp__hub_<orgId>_<name>__* zusammen. Es werden nur Zeilen für den Organisationsbereich freigegeben – persönliche Anmeldeinformationen bleiben erhalten."
{
  "html": "<div class=\"mcp-hub\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch hub</span><small class=\"diagram-muted\">MCP-Server mit Organisationsscope</small><small class=\"diagram-muted\"><code>GET /mcp/hub/servers</code></small></div><div class=\"diagram-col arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div></div><div class=\"diagram-col consumers\"><div class=\"diagram-box\" data-rough>Mail<br><small class=\"diagram-muted\"><code>mcp__hub_&lt;orgId&gt;_&lt;name&gt;__*</code></small></div><div class=\"diagram-box\" data-rough>Clips<br><small class=\"diagram-muted\">Pull + Merge alle ~60 s</small></div></div></div><p class=\"diagram-muted note\">Bearer-gated by <code>AGENT_NATIVE_MCP_HUB_TOKEN</code>. Personal (user-scope) servers are never re-exposed.</p>",
  "css": ".mcp-hub{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-hub .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-hub .diagram-col{display:flex;flex-direction:column;gap:10px}.mcp-hub .arrows .diagram-arrow{font-size:22px;line-height:1}.mcp-hub .note{margin:8px 0 0;font-size:.85em}.mcp-hub code{font-size:.85em}"
}
```

Für neue Arbeitsbereich-Setups bevorzugen Sie **Verteilen Sie Arbeitsbereich-MCP-Ressourcen**, wenn Sie
Sie möchten dasselbe Gewährungsmodell für alle Apps und ausgewählte Apps, das auch im Arbeitsbereich skills verwendet wird.
Anweisungen und Referenzressourcen. Fügen Sie eine Arbeitsbereichsressource hinzu mit:

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${keys.MCP_SERVER_TOKEN}"
  },
  "description": "Shared MCP-Werkzeugs for workspace apps"
}
```

Speichern Sie es unter `mcp-servers/<name>.json` mit der Art `mcp-server`. Alle Apps
Ressourcen werden von jeder Workspace-App geladen; Ausgewählte Ressourcen werden nur in
Apps mit einer aktiven Dispatch-Bewilligung. Geheime Platzhalter werden von der App aufgelöst
Geheimer Speicher, also legen Sie rohe Inhaber-Tokens in Dispatch Vault ab und referenzieren Sie sie
mit `${keys.NAME}`, anstatt sie im Ressourcenkörper zu speichern.

Apps aktualisieren ihre zusammengeführte MCP-Konfiguration etwa einmal pro Minute, also eine zentrale Ressource
Änderungen, Gewährungsänderungen und Entfernungen werden ohne Bereitstellung wirksam. Festlegen
`AGENT_NATIVE_MCP_CONFIG_REFRESH_MS=0`, um diese Hintergrundaktualisierung zu deaktivieren, oder
Stellen Sie ihn auf einen Wert von mindestens `5000` Millisekunden ein, um das Intervall zu optimieren.

Der ältere Hub-Modus unten bleibt nützlich für die grobe „Freigabe aller Organisationsbereiche MCP
server from Dispatch“-Setups und für Bereitstellungen, die bereits MCP
stellt UI als Quelle der Wahrheit ein.

### 1. Aktivieren Sie Hub-Serve in der Hub-App (Dispatch)

Legen Sie eine Umgebungsvariable in der Dispatch-Bereitstellung fest:

```bash
AGENT_NATIVE_MCP_HUB_TOKEN=<a-long-random-secret>
```

Dispatch mountet jetzt `GET /_agent-native/mcp/hub/servers`, das jeden in seiner `settings`-Tabelle gespeicherten MCP-Server im Organisationsbereich zurückgibt, mit vollständigen URL + Headern, authentifiziert durch das Token.

### 2. Zeigen Sie konsumierende Apps auf den Hub

Auf jeden Verbraucher eingestellt (Mail, Clips, was auch immer):

```bash
AGENT_NATIVE_MCP_HUB_URL=https://dispatch.acme.com
AGENT_NATIVE_MCP_HUB_TOKEN=<the-same-secret>
```

Beim Start ruft jeder Verbraucher die Serverliste des Hubs ab und führt sie in seinem eigenen MCP-Manager zusammen. Die Tools werden dem Agenten als `mcp__hub_<orgId>_<name>__*` angezeigt – getrennt vom lokalen `mcp__org_…` des Verbrauchers, sodass es zu keiner Kollision kommt.

### 3. Was geteilt wird

Nur **org-scope** Server werden gemeinsam genutzt. (Persönliche) Server im Benutzerbereich bleiben bei dem Benutzer, der sie hinzugefügt hat – der Hub gibt persönliche Anmeldeinformationen nie wieder über Apps hinweg offen.

Hub-Antworten enthalten die vollständigen Authentifizierungsheader (Bearer-Token usw.). Der Transport ist HTTPS, der Endpunkt erfordert das gemeinsame Geheimnis und gibt nur Zeilen im Organisationsbereich zurück – behandeln Sie das Hub-URL + Token wie einen Datenbankanmeldedaten.

### 4. Hot Reload vs. Neustart

Lokales UI fügt in jeder App Hot-Reload über `McpClientManager.reconfigure()` hinzu – kein Neustart. Hub-basierte Server werden durch dieselbe periodische Hintergrundaktualisierung (ca. 60 s, über `AGENT_NATIVE_MCP_CONFIG_REFRESH_MS` einstellbar oder deaktivierbar) erfasst, die der Workspace-Ressourcenpfad verwendet, sodass in Dispatch vorgenommene Änderungen innerhalb von etwa einer Minute ohne Neustart an alle Verbraucher-Apps weitergegeben werden. Darüber hinaus löst jede lokale Mutation in einer Verbraucher-App sofort eine Neukonfiguration für diese App aus.

### Endpunktübersicht

| Methode | Route                            | Zweck                                                                                                                                                                 |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/hub/servers` | Bereitstellung aller Server im Organisationsbereich mit vollständigen Berechtigungen (bearer-gated, nur gemountet, wenn `AGENT_NATIVE_MCP_HUB_TOKEN` festgelegt ist). |
| GET     | `/_agent-native/mcp/hub/status`  | Gibt `{ serving, consuming, hubUrl }` für die Einstellungskarte UI zurück.                                                                                            |

## Statusroute {#status-route}

Jede App stellt `GET /_agent-native/mcp/status` für Tools und Onboarding bereit:

```an-api
{
  "method": "GET",
  "path": "/_agent-native/mcp/status",
  "summary": "MCP Kundenstatus für Tooling und Onboarding",
  "description": "Reports which configured servers connected, the total live tool count, the merged prefixed tool list, and any per-server connection errors. Use it to build \"detected — your agent can now drive X\" hints or to debug connection problems.",
  "responses": [
    {
      "status": "200",
      "description": "Configured vs connected servers, tool inventory, and per-server errors.",
      "example": "{\n  \"configuredServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"connectedServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"totalTools\": 21,\n  \"tools\": [\n    {\n      \"source\": \"claude-in-chrome\",\n      \"name\": \"mcp__claude-in-chrome__navigate\",\n      \"description\": \"Navigate the browser to a URL\"\n    }\n  ],\n  \"errors\": {}\n}"
    }
  ]
}
```

```json
{
  "configuredServers": ["claude-in-chrome", "playwright"],
  "connectedServers": ["claude-in-chrome", "playwright"],
  "totalTools": 21,
  "tools": [
    {
      "source": "claude-in-chrome",
      "name": "mcp__claude-in-chrome__navigate",
      "description": "Navigate the browser to a URL"
    }
  ],
  "errors": {}
}
```

Verwenden Sie dies, um Onboarding-Hinweise „claude-in-chrome erkannt – Ihr Agent kann jetzt Chrome steuern“ zu erstellen oder MCP-Verbindungsprobleme zu beheben.

## Fehlermodi {#failures}

Einzelne MCP-Serverausfälle führen nie zum Ausfall des Agenten:

- Ein falsch konfigurierter `command` → der Server wird übersprungen, sein Fehler erscheint in `/mcp/status` unter `errors.<server-id>` und alle anderen Server funktionieren weiterhin.
- MCP SDK fehlt in `node_modules` → alle MCP-Funktionen werden mit einer Warnung übersprungen; Der Agenten-Chat funktioniert weiterhin ohne MCP-Tools.
- Laufen in einer Edge-Laufzeit → MCP-Client ist ein No-Op.

Agent-native startet immer; Eine defekte MCP-Konfiguration bedeutet nur weniger Werkzeuge.

## Sicherheit {#security}

MCP-Tools werden auf Ihrem Computer mit den Berechtigungen ausgeführt, über die der erzeugte Prozess verfügt. Behandeln Sie `mcp.config.json` wie jede andere Liste ausführbarer Dateien, die Sie dem Agenten überlassen möchten. Tools von MCP-Servern erscheinen in der Tool-Use-Schleife des Agenten genau wie die eigenen actions Ihrer Vorlage. Stellen Sie daher sicher, dass Sie jedem von Ihnen konfigurierten Server vertrauen.
