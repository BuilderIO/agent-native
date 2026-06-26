---
title: "MCP-Protokoll"
description: "Stellen Sie Ihre agentennative App als Remote-MCP-Server bereit, damit Claude-, ChatGPT-, Claude-Code, Cursor und andere KI-Tools den actions Ihrer App direkt aufrufen können."
---

# MCP-Protokoll

**Diese Seite: die MCP-Serverreferenz auf niedrigerer Ebene.** Wie jede agentennative App ihren actions über MCP verfügbar macht – der automatisch gemountete Endpunkt, Authentifizierungsmodi, die `tools/call`-/`ask-agent`-Oberfläche und benutzerdefiniertes Mounten. Greifen Sie darauf zu, wenn Sie Serverinterna benötigen; Um einen Host anzuschließen, beginnen Sie mit [External Agents](/docs/external-agents).

| Wenn Sie möchten...                                                                                    | Lesen                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Verbinden Sie einen externen Agenten/Host mit Ihrer App                                                | [External Agents](/docs/external-agents) |
| Geben Sie Ihrem Agent mehr Tools (nutzen Sie andere MCP-Server)                                        | [MCP Clients](/docs/mcp-clients)         |
| Erstellen Sie Inline-UIs, die in Claude/ChatGPT rendern                                                | [MCP Apps](/docs/mcp-apps)               |
| MCP-Serverreferenz auf niedrigerer Ebene (Authentifizierung, Tools, benutzerdefinierte Bereitstellung) | **Diese Seite** – MCP-Protokoll          |

Jede agentennative App stellt automatisch einen Remote-MCP-Server (Model Context Protocol) bereit, sodass externe KI-Tools wie Claude, ChatGPT benutzerdefinierte MCP-Apps, Claude Code, Cursor, Codex und VS Code GitHub Copilot den actions Ihrer App direkt erkennen und aufrufen können – kein zusätzlicher Code erforderlich. Wenn Ihr Ziel darin besteht, einen dieser Hosts mit einer gehosteten App zu _verbinden_, deckt [External Agents](/docs/external-agents) den empfohlenen einzelnen Dispatch-Connector, URLs, OAuth, MCP Inline-Apps pro App und Deep Links ab. Diese Seite dokumentiert, was sich darunter befindet.

## Übersicht {#overview}

MCP ist das Standardprotokoll für die Verbindung von KI-Tools mit externen Funktionen. Wenn Sie eine agentennative App bereitstellen, wird automatisch ein MCP-Endpunkt neben dem vorhandenen A2A-Endpunkt bereitgestellt. Jeder MCP-kompatible Client kann eine Verbindung herstellen und die Tools Ihrer App verwenden.

Schlüsselkonzepte:

- **Automatisch gemountet** – jede App erhält `/_agent-native/mcp` kostenlos, keine Einrichtung erforderlich
- **Streamable HTTP** – nutzt den modernen MCP-Transport über den Standard-HTTP (POST + SSE)
- **Dasselbe actions** – genau dieselbe Aktionsregistrierung, die den Agenten-Chat und A2A unterstützt
- **`ask-agent`-Tool** – ein Meta-Tool, das komplexe Aufgaben an die vollständige Agentenschleife delegiert
- **MCP Apps** – actions kann interaktive UI-Ressourcen über die offizielle `io.modelcontextprotocol/ui`-Erweiterung bewerben
- **Standard-Remote-MCP OAuth** – OAuth 2.1-Erkennung, dynamische Client-Registrierung, Autorisierungscode + PKCE, Aktualisierungstoken-Rotation
- **Bearer-Authentifizierungs-Fallback** – verwendet `ACCESS_TOKEN`, `ACCESS_TOKENS` oder Connect-Minted-JWTs für Clients, die OAuth nicht ausführen können

```an-diagram title="Ihre App als MCP-Server" summary="Externe Hosts verbinden sich über Streamable HTTP. Jede Aktion ist ein Werkzeug; ask-agent delegiert an die vollständige Agentenschleife."
{
  "html": "<div class=\"diagram-mcp\"><div class=\"diagram-col\"><div class=\"diagram-node\">Claude</div><div class=\"diagram-node\">ChatGPT</div><div class=\"diagram-node\">Cursor · Codex</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill accent\">POST /_agent-native/mcp</span><small class=\"diagram-muted\">Streamable HTTP</small><small class=\"diagram-muted\">initialize &rarr; tools/list &rarr; tools/call</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>each action<br><small class=\"diagram-muted\">= one tool</small></div><div class=\"diagram-box\" data-rough>ask-agent<br><small class=\"diagram-muted\">&rarr; full agent loop</small></div></div></div>",
  "css": ".diagram-mcp{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-mcp .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-mcp .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-mcp .diagram-arrow{font-size:20px;line-height:1}"
}
```

## MCP vs. A2A {#mcp-vs-a2a}

Beide Protokolle werden automatisch gemountet. Verwenden Sie, was zu Ihrem Anwendungsfall passt:

|                     | MCP                                                                      | A2A                                             |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **Am besten für**   | Externe Tools rufen Ihre App auf                                         | Agent-zu-Agent-Kommunikation                    |
| **Protokoll**       | MCP Streambar HTTP                                                       | JSON-RPC 2.0                                    |
| **Toolerkennung**   | `tools/list`                                                             | Agentenkarte bei `/.well-known/agent-card.json` |
| **Endpunkt**        | `/_agent-native/mcp`                                                     | `/_agent-native/a2a`                            |
| **Unterstützt von** | Claude, ChatGPT, Claude Code, Cursor, Codex, Cowork und andere MCP-Hosts | Andere agentennative Apps                       |
| **Ausführung**      | Direkte Werkzeugaufrufe (kein zusätzliches LLM)                          | Vollständige Agentenschleife (LLM-Begründung)   |

Sie können auch das Tool `ask-agent` MCP verwenden, um das Beste aus beiden Welten zu erhalten – rufen Sie es über den Claude-Code auf und lassen Sie den Agenten Ihrer App komplexe Aufgaben durchdenken.

## Manuelle MCP-Clientkonfiguration {#manual-config}

Für das empfohlene Ein-Befehl-Setup verwenden Sie [External Agents](/docs/external-agents). Wenn Sie die MCP-Konfiguration für einen OAuth-fähigen Client handschriftlich schreiben, fügen Sie Ihre App als Remote-MCP-Server ohne statische Header hinzu:

```bash
claude mcp add --transport http mail https://mail.example.com/_agent-native/mcp
```

Oder schreiben Sie den Eintrag handschriftlich in `.mcp.json` (Projektumfang) oder `~/.claude.json` (Benutzerumfang):

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.example.com/_agent-native/mcp",
    },
  },
}
```

Führen Sie dann `/mcp` im Claude-Code aus und wählen Sie **Authentifizieren**. Für Clients, die kein Remote-MCP OAuth ausführen können, verwenden Sie die Seite „Verbinden“ oder einen statischen Bearer-Token-Eintrag mit `headers.Authorization`. Nach der Authentifizierung können Sie die Tools Ihrer App ganz natürlich nutzen:

```
> draft an email to John about the Q3 report

Claude Code calls: draft-email(to: "john@example.com", subject: "Q3 Report", body: "...")
```

## Verbindung von anderen MCP-Clients herstellen {#other-clients}

Jeder MCP-Client, der den Streamable HTTP-Transport unterstützt, kann eine Verbindung herstellen. Der Endpunkt ist:

```
POST https://your-app.example.com/_agent-native/mcp
```

Der Server unterstützt den Standard-MCP-Handshake: `initialize` → `initialized` → `tools/list` → `tools/call`.

```an-api title="MCP Endpunkt" summary="Der automatisch gemountete Streamable HTTP-Endpunkt, den jede agentennative App verfügbar macht."
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "MCP Streambarer HTTP Endpunkt",
  "description": "Auto-mounted on every app. Speaks the standard MCP handshake (`initialize` → `initialized` → `tools/list` → `tools/call`) plus `resources/list`, `resources/templates/list`, and `resources/read` when an action declares `mcpApp`. Each action maps to one tool; `ask-agent` delegates to the full agent loop.",
  "auth": "Standard remote MCP OAuth (Bearer access token), connect-minted JWT, or static ACCESS_TOKEN/ACCESS_TOKENS",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer access token. Required except for loopback local-dev probes." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "MCP method, e.g. initialize, tools/list, tools/call." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"tools/call\",\n  \"params\": {\n    \"name\": \"ask-agent\",\n    \"arguments\": { \"message\": \"Summarize Q3 signups by source\" }\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "MCP result (POST + SSE)." },
    { "status": "401", "description": "Unauthenticated — responds with a WWW-Authenticate header pointing at OAuth discovery." }
  ]
}
```

Wenn eine Aktion `mcpApp` deklariert, kündigt der Server auch die offizielle MCP-Apps-Erweiterung (`io.modelcontextprotocol/ui`) an und unterstützt `resources/list`, `resources/templates/list` und `resources/read` für die App-Ressource. Hosts, die MCP-Apps rendern, können UI inline anzeigen; Hosts, die dies nicht tun, können das Tool trotzdem aufrufen und den Deep-Link-Fallback verwenden. Produkt-UIs sollten `embedApp()` verwenden, damit die Inline-Oberfläche die echte React-App-Route oder eine fokussierte Route ist, die eine gemeinsam genutzte React-Komponente wie ein Analytics-Diagramm rendert, und nicht eine separate einfache HTML-Implementierung. Der Server gibt sowohl standardmäßige MCP Apps-Metadaten als auch ChatGPT Apps SDK-Kompatibilitätsmetadaten aus, sodass App-fähige Hosts dieselbe `ui://`-Ressource finden können. Die aktuelle offizielle Erweiterungsmatrix umfasst Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT und Cursor; Die Hostunterstützung variiert je nach Version und Plan. Verwenden Sie daher [External Agents MCP Apps notes](/docs/external-agents#mcp-apps-compatibility) für die benutzerorientierte Anleitung.

### MCP App-Einbettungsbrücke {#mcp-app-embed-bridge}

`embedApp()` ist der URL-erste MCP-App-Helfer auf niedriger Ebene: Er startet eine signierte App
Inline-Route durch Transplantation (Claude), Controlled-Frame (ChatGPT) oder direkt
Navigation, vermittelt Host actions über die `ui/*` JSON-RPC-Brücke (und die
`agentNative.mcpHost.*` postMessage Relay für den kontrollierten Frame-Pfad) und
begrenzt die Höhe der Ressourcenhülle, sodass eine vollständige App-Route nicht als gerendert wird
Übergroßes Chat-Artefakt.

Siehe [MCP Apps](/docs/mcp-apps#mcp-app-bridge) für die vollständigen Embed-Bridge-Details – Transplant vs. Controlled-Frame, die `ui/*`- und PostMessage-Tabellen, `create_embed_session`/`embedStartUrl`, CSP und Domänenregeln, Einbettung der Erweiterung `srcDoc`, Höhenklemmung und den Host-Bridge-Client API.

## Tools {#tools}

Jeder Anrufer erhält einen **standardmäßig kompakten Katalog** (in der Vorlage deklarierte App actions plus die App-übergreifenden integrierten Anwendungen), wobei die vollständige Aktionsoberfläche nur bei expliziter Opt-in-Anfrage bereitgestellt wird und `tool-search` immer verfügbar ist, um den Rest zu erreichen. Die vollständige Erklärung finden Sie unter [External Agents → Catalog tiers](/docs/external-agents#catalog-tiers).

Jede Aktion ist direkt einem MCP-Tool zugeordnet:

| Aktionseigenschaft | MCP-Tool-Eigenschaft |
| ------------------ | -------------------- |
| `tool.description` | `description`        |
| `tool.parameters`  | `inputSchema`        |
| Aktionsname        | Werkzeugname         |

Wenn `mcpApp` vorhanden ist, enthält der Toolseintrag auch `_meta.ui.resourceUri`, `_meta["ui/resourceUri"]` und `_meta["openai/outputTemplate"]`, und die entsprechende `ui://`-Ressource wird als `text/html;profile=mcp-app` zurückgegeben.

### Das `ask-agent`-Tool {#ask-agent}

Zusätzlich zu den einzelnen Aktionstools enthält jeder MCP-Server ein `ask-agent`-Metatool. Dadurch wird eine Nachricht in natürlicher Sprache an den KI-Agenten der App gesendet und die Antwort zurückgegeben.

Verwenden Sie `ask-agent` für komplexe Aufgaben, die von der Argumentation und dem Kontext des Agenten profitieren:

```json
{
  "name": "ask-agent",
  "arguments": {
    "message": "Draft a follow-up email to the Q3 planning thread with John, summarizing the action items we discussed"
  }
}
```

Der Agent führt die gleiche Schleife aus wie der interaktive Chat – er kann mehrere Tools aufrufen, über den Kontext nachdenken und eine durchdachte Antwort produzieren.

## Authentifizierung {#authentication}

Der MCP-Endpunkt unterstützt den Standard-Remote-MCP OAuth sowie den vorhandenen Bearer-Token-Fallback:

| Modus                              | Wie es funktioniert                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard MCP OAuth                 | Der Client erkennt die Authentifizierung von `WWW-Authenticate`, registriert sich, führt PKCE aus und sendet `Authorization: Bearer <access-token>` |
| Connect-Minted JWT                 | `npx @agent-native/core@latest connect` / Die Connect-Seite prägt ein widerrufliches JWT pro Benutzer                                               |
| `ACCESS_TOKEN`                     | Statisches Inhabertoken – Client sendet `Authorization: Bearer <token>`                                                                             |
| `ACCESS_TOKENS`                    | Komma-getrennte Liste gültiger statischer Trägertoken                                                                                               |
| `A2A_SECRET`                       | JWT-basierte Authentifizierung – Token werden kryptografisch überprüft                                                                              |
| _(keine festgelegt, nur Loopback)_ | Keine Authentifizierung für lokale Entwicklungstests erforderlich                                                                                   |

Konfigurieren Sie für OAuth-fähige MCP-Hosts den Remote-Server URL ohne statische Header:

```bash
claude mcp add --transport http agent-native https://dispatch.agent-native.com/_agent-native/mcp
```

Die erste nicht authentifizierte MCP-Anfrage erhält:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://dispatch.agent-native.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write mcp:apps"
```

Erkennungsendpunkte:

| Endpunkt                                  | Zweck                                                  |
| ----------------------------------------- | ------------------------------------------------------ |
| `/.well-known/oauth-protected-resource`   | RFC 9728 Metadaten geschützter Ressourcen              |
| `/.well-known/oauth-authorization-server` | OAuth Autorisierungsserver-Metadaten                   |
| `/_agent-native/mcp/oauth/register`       | Dynamische öffentliche Kundenregistrierung             |
| `/_agent-native/mcp/oauth/authorize`      | Browserautorisierung + Einwilligung                    |
| `/_agent-native/mcp/oauth/token`          | Autorisierungscode- und Aktualisierungstoken-Gewährung |

```an-diagram title="OAuth Erkennungsablauf" summary="Ein 401 leitet die Erkennung, Registrierung und einen PKCE-Autorisierung → Token-Austausch ein. Der Bearer-Token ist an die Zielgruppe gebunden und hat einen Gültigkeitsbereich."
{
  "html": "<div class=\"diagram-oauth\"><div class=\"diagram-box\" data-rough>first request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill warn\">401 · WWW-Authenticate</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">/.well-known/oauth-protected-resource</span><span class=\"diagram-pill\">/.well-known/oauth-authorization-server</span><small class=\"diagram-muted\">discover</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">register</div><div class=\"diagram-pill\">authorize (PKCE)</div><div class=\"diagram-pill\">token</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Bearer access token<br><small class=\"diagram-muted\">audience-gebunden · mcp:read / write / apps</small></div></div>",
  "css": ".diagram-oauth{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-oauth .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-oauth .diagram-col{display:flex;flex-direction:column;gap:6px}.diagram-oauth .diagram-arrow{font-size:20px;line-height:1}"
}
```

Zugriffstoken sind signierte JWTs, deren Zielgruppe genau die MCP-Ressource URL ist. Der Server akzeptiert nur für ihn selbst ausgestellte Token und wendet Bereiche an, bevor er Tools auflistet/aufruft:

| Geltungsbereich | Erlaubt                                       |
| --------------- | --------------------------------------------- |
| `mcp:read`      | schreibgeschützt actions                      |
| `mcp:write`     | Mutierung von actions und `ask-agent`         |
| `mcp:apps`      | MCP Apps-Ressourcen (`ui://` HTML-Ressourcen) |

Aktualisierungstoken werden nur als Hashes gespeichert und bei jeder Aktualisierung rotiert. `npx @agent-native/core@latest connect` schreibt standardmäßig diesen nur für URL gültigen OAuth-Eintrag für Claude-Code-Clients. Behalten Sie die Connect-Seite, `npx @agent-native/core@latest connect --token <token>` und die statische Bearer-Konfiguration für lokales Standard-Proxying, ältere Clients und Notfall-/Debug-Flows bei.

## Benutzerdefiniertes MCP-Setup {#custom-setup}

Der MCP-Server wird vom Agent-Chat-Plugin automatisch gemountet. Für die meisten Apps ist keine Konfiguration erforderlich. Wenn Sie benutzerdefiniertes Verhalten benötigen, können Sie es manuell in einem Server-Plugin bereitstellen:

```ts
// server/plugins/mcp.ts
import { mountMCP } from "@agent-native/core/mcp";
import { autoDiscoverActions } from "@agent-native/core/server";

export default defineNitroPlugin(async (nitro) => {
  const actions = await autoDiscoverActions(import.meta.url);

  mountMCP(nitro, {
    name: "My App",
    description: "Custom MCP server",
    actions,
    // Optional: provide ask-agent handler
    askAgent: async (message) => {
      // Your custom agent logic
      return "Response";
    },
    // Optional: override the route prefix (default "/_agent-native")
    // routePrefix: "/_agent-native",
  });
});
```

## Beispiel: Analyse aus dem Claude-Code {#example}

Sie haben eine bereitgestellte Analyse-App unter `analytics.example.com`. Von Claude Code:

```bash
claude mcp add --transport http analytics https://analytics.example.com/_agent-native/mcp
```

Oder fügen Sie es manuell in `.mcp.json` hinzu:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.example.com/_agent-native/mcp",
    },
  },
}
```

Jetzt im Claude-Code:

```
> How many signups did we get last week?

Claude Code calls: run-query(sql: "SELECT count(*) FROM signups WHERE created_at > now() - interval '7 days'")
→ "1,247 signups last week"
```

Für komplexere Analysen:

```
> Ask the analytics agent to prepare a full breakdown of Q3 signups by source, with trends

Claude Code calls: ask-agent(message: "Prepare a full breakdown of Q3 signups by source, with trends")
→ The analytics agent runs multiple queries, reasons about the data, and returns a formatted report
```
