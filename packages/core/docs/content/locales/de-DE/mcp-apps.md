---
title: "MCP Apps"
description: "Erstellen und betten Sie interaktive MCP-Apps UIs in Claude, ChatGPT und anderen kompatiblen Hosts ein – unter Verwendung echter App-Routen, der Embed Bridge und der Host Bridge API."
---

# MCP Apps

**Diese Seite: Inline-UIs in Claude/ChatGPT.** Erstellen von MCP-App-Ressourcen und der Einbettungsbrücke, die eine echte App-Route im Chat eines kompatiblen Hosts rendert. Diese Seite ist auch die einzige Startseite für die **Client-Support-Matrix** ([below](#client-support)).

| Wenn Sie möchten...                                                                                    | Lesen                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Verbinden Sie einen externen Agenten/Host mit Ihrer App                                                | [External Agents](/docs/external-agents) |
| Geben Sie Ihrem Agent mehr Tools (nutzen Sie andere MCP-Server)                                        | [MCP Clients](/docs/mcp-clients)         |
| Erstellen Sie Inline-UIs, die in Claude/ChatGPT rendern                                                | **Diese Seite** – MCP Apps               |
| MCP-Serverreferenz auf niedrigerer Ebene (Authentifizierung, Tools, benutzerdefinierte Bereitstellung) | [MCP Protocol](/docs/mcp-protocol)       |

MCP Apps sind die offizielle `io.modelcontextprotocol/ui`-Erweiterung, mit der kompatible Hosts – Claude, Claude Desktop, ChatGPT, VS Code GitHub Copilot, Goose, Postman, MCPJam und Cursor – interaktive UIs inline im Chat rendern können. In agentennativen Apps ist jede MCP-App eine **echte React-Route** und kein separates einfaches HTML-Widget.

Im eigenen Chat einer Agent-Native-App bevorzugen Sie [native chat renderers](/docs/native-chat-ui) für Erstanbieter-Widgets wie Tabellen, Diagramme, eingegebene Ergebnisse und Genehmigungsangebote. Verwenden Sie MCP-Apps für externe/hostübergreifende Inline-UI in Claude, ChatGPT, Copilot, Cursor und anderen kompatiblen Hosts mit der Aktion `link` als universellem Deep-Link-Fallback.

## Erstellung: optionale MCP Apps UI {#mcp-apps}

Für Hosts, die die MCP Apps-Erweiterung unterstützen, kann eine Aktion auch eine Inline-UI-Ressource mit `mcpApp` ankündigen. Hierbei handelt es sich um eine progressive Verbesserung für Abläufe, bei denen der externe Agent dem Benutzer eine interaktive Oberfläche statt nur Text zur Verfügung stellen soll – zum Beispiel die Überprüfung eines E-Mail-Entwurfs, die Bearbeitung einer Kalendereinladung oder die Auswahl zwischen generierten Dashboard-Varianten.

Verwenden Sie die echte React-App mit `embedRoute()` oder `embedApp()`, wann immer der Benutzer UI benötigt. Das mentale Modell ist einfach: Das `link`-Ziel der Aktion ist auch das MCP-App-Einbettungsziel. Stellen Sie den Vorgang als normale Aktion/Tool bereit, geben Sie einen fokussierten Deep Link mit `link` zurück und fügen Sie `mcpApp.resource = embedApp(...)` hinzu, damit fähige Hosts dieselbe Route inline laden, anstatt einen neuen Tab zu öffnen. Wenn beide auf derselben Route erstellt werden sollen, bevorzugen Sie `embedRoute({ title, openLabel, path })`: Es handelt sich um den Convenience-Wrapper, der passende `link`- und `mcpApp`-Felder aus einem Aufruf zurückgibt, während `embedApp(...)` die untergeordnete Ressource ist, die Sie `mcpApp.resource` direkt zuweisen.

Das bedeutet, dass vollständige App-Einbettungen alles tun können, was die Route nach dem Öffnen tun kann: einen E-Mail-Entwurf überprüfen oder bearbeiten, einen gefilterten Posteingang/eine gefilterte Suche anzeigen, ein Kalenderereignis oder einen Ereignisentwurf öffnen, eine Erweiterungsseite laden, ein vollständiges Analyse-Dashboard oder eine gespeicherte Analyse überprüfen, eine Präsentation im Folieneditor fortsetzen oder ein Designprojekt/-editor öffnen. Ziehen Sie URL/Deep-Link-Parameter und die vorhandene `/_agent-native/open`-Navigations-/App-Statusbrücke der Erfindung eines zweiten Statusprotokolls für MCP-Apps vor.

In seltenen Fällen ist das richtige Ziel eine fokussierte App-Route, die eine gemeinsam genutzte React-Komponente anstelle der gesamten App-Shell rendert. Die `/chart`-Route von Analytics ist das Vorbild: Sie nimmt eine kompakte `SqlPanel`-Nutzlast im URL und rendert dieselbe Diagrammkomponente, die das Dashboard verwendet. Dies ist immer noch eine App-Einbettung, keine einfache HTML MCP-App. Stellen Sie es über eine normale Aktion / `open_app({ path, embed: true })` bereit oder rufen Sie es auf, halten Sie URL deterministisch und lassen Sie `embedApp()` diese Route inline rendern.

Schreiben Sie keine einmaligen einfachen HTML MCP-Apps für das Produkt UI von Hand. Wenn die Aktion eine benutzerdefinierte Oberfläche benötigt, fügen Sie zuerst eine echte App-Route/-Komponente hinzu oder verwenden Sie sie erneut und betten Sie diese Route ein.

```an-diagram title="MCP App-Einbettungs-Roundtrip" summary="Das Linkziel der Aktion ist auch das Einbettungsziel. Fähige Hosts laden dieselbe signierte App-Route inline; Alle anderen greifen auf den Deep Link zurück."
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-card\" data-rough><strong>Action</strong><small class=\"diagram-muted\">`link` target = MCP App embed target</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>embedApp()</strong><span class=\"diagram-pill accent\">create_embed_session</span><small class=\"diagram-muted\">mints short-lived embed session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>/_agent-native/embed/start</strong><small class=\"diagram-muted\">tauscht einmaliges SQL-Ticket aus</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>Signed app route</strong><span class=\"diagram-pill ok\">echte React-Route</span><small class=\"diagram-muted\">short-lived browser session</small></div><div class=\"diagram-fallback\"><span class=\"diagram-pill warn\">keine MCP-Apps-Unterstützung</span><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>&quot;Open in … &rarr;&quot; deep link</div></div></div>",
"css": ".diagram-embed{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-embed .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:140px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .diagram-fallback{display:flex;flex-direction:column;align-items:center;gap:6px;margin-inline-start:8px}"
}

```

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...description, schema, run, link...
  mcpApp: {
    resource: embedApp({
      title: "Review draft",
      description: "Open the generated draft in the real Mail compose UI.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
    }),
  },
});
```

```an-annotated-code title="Die mcpApp-Ressourcenkonfiguration"
{
  "filename": "actions/review-draft.ts",
  "language": "ts",
  "code": "import { embedApp } from \"@agent-native/core\";\n\nexport default defineAction({\n  // ...description, schema, run, link...\n  mcpApp: {\n    resource: embedApp({\n      title: \"Review draft\",\n      description: \"Open the generated draft in the real Mail compose UI.\",\n      iframeTitle: \"Agent-Native Mail\",\n      openLabel: \"Open in Mail\",\n    }),\n  },\n});",
  "annotations": [
    { "lines": "6", "label": "Progressive Verbesserung", "note": "`mcpApp.resource` kündigt eine Inline-Benutzeroberfläche für Hosts an, die die Apps-Erweiterung MCP unterstützen. Behalten Sie auch den `link`-Builder der Aktion bei – nur CLI-Hosts und ältere Hosts ignorieren die UI-Metadaten und benötigen weiterhin den Deep Link." },
    { "lines": "7", "label": "Embed = the link target", "note": "`embedApp()` uses the action's `link` as its launch target: it calls `create_embed_session`, exchanges a one-time SQL ticket at `/_agent-native/embed/start`, and navigates the MCP App frame to the same signed app route." },
    { "lines": "11", "label": "Universelles Fallback-Label", "note": "`openLabel` is the visible `\"Open in … →\"` text used as the deep-link escape hatch when a host does not render the inline iframe." }
  ]
}
```

Der MCP-Server kündigt die Erweiterung `io.modelcontextprotocol/ui` an, fügt `_meta.ui.resourceUri` plus `_meta["ui/resourceUri"]` zu `tools/list` hinzu und gibt außerdem ChatGPT Apps SDK-Kompatibilitätsmetadaten aus (`openai/outputTemplate`, Widget CSP/description/accessibility). Es macht HTML über `resources/list`, `resources/templates/list` und `resources/read` unter Verwendung von MIME `text/html;profile=mcp-app` verfügbar. Der stdio-Proxy leitet diese Ressourcenhandler von der Live-App weiter, sodass Desktop- und CLI-Clients dieselben Ressourcen sehen wie HTTP-Clients.

Behalten Sie den vorhandenen `link`-Builder bei, auch wenn Sie `mcpApp` hinzufügen. Nur CLI-Clients, ältere Hosts und alle Hosts, die MCP-Apps nicht rendern, ignorieren die UI-Metadaten und benötigen weiterhin den `"Open in … →"`-Link. `embedApp()` verwendet diesen Link als Startziel, ruft den Nur-App-Helper `create_embed_session` auf, tauscht ein einmaliges SQL-Ticket bei `/_agent-native/embed/start` aus und navigiert den MCP-App-Frame mit einer kurzlebigen Browsersitzung und einem Bearer-Fallback für Abrufe desselben Ursprungs zur Zielroute. `open_app({ app, path, embed: true })` ist die allgemeine Notausstiegsmöglichkeit für Routen wie vollständige Dashboards, gefilterte Posteingänge, Kalenderentwurfsansichten, Analysen und Erweiterungsseiten und sollte großzügig verwendet werden, wenn die vollständige App die übersichtlichste Überprüfungs-/Bearbeitungsoberfläche darstellt.

`embedApp()` schließt den MCP-Anforderungsursprung in die Ressource CSP ein, sodass der Launcher die signierte Erstanbieter-App-Route abrufen und bei expliziter Anforderung ein Frame erstellen kann. Dispatch fügt seiner `open_app`-Ressource die genauen Ursprünge für die gewährten Apps hinzu, sodass ein einzelner Dispatch-Connector Mail, Kalender, Folien und den Rest einbinden kann, ohne jeden HTTPS-Ursprung zuzulassen. Übergeben Sie nur zusätzliche Frame- oder Ressourcendomänen für eine benutzerdefinierte MCP-App, die tatsächlich einen Drittanbieter-Player einbettet oder Drittanbieter-Assets lädt.

Innerhalb dieser `embedApp()`-Routen ist `sendToAgentChat()` einbettungsfähig. Automatisch übermittelte Eingabeaufforderungen werden als `ui/update-model-context` plus `ui/message` an den MCP-Host weitergeleitet, sodass eine Schaltfläche in der eingebetteten App die Claude/ChatGPT-Konversation absichtlich vom ausgewählten App-Status aus fortsetzen kann. Verborgener Kontext wird als Modellkontext gesendet; Der sichtbare Benutzerzug bleibt nur die Eingabeaufforderung der App, wodurch eine gruselige Zustimmung des Hosts zu internen Dateipfaden für den App-Status vermieden wird. `submit: false` bleibt lokales Vorabfüll-/Überprüfungsverhalten.

## Erstklassige MCP App Bridge {#mcp-app-bridge}

MCP App-Einbettungen sind Routeneinbettungen, keine separaten Miniprodukte. `embedApp()` startet vom `link`-Ziel der Aktion, erstellt eine kurzlebige Einbettungssitzung und startet die signierte App-Route. Standard-MCP-Apps-Hosts können im MCP-App-Frame selbst navigieren, wenn der Host die Route direkt hydrieren kann.

```an-diagram title="Zwei Host-Bridge-Pfade, eine ausgeschilderte Route" summary="Claude verpflanzt die hydratisierte Route und verwendet den direkten ui/_bridge; ChatGPT erhält einen kontrollierten Iframe über window.openai und leitet Host-Aktionen über postMessage weiter. Beide verweisen auf dieselbe signierte App-Route."
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><strong>Claude web</strong><span class=\"diagram-pill accent\">single-frame transplant</span><small class=\"diagram-muted\">hydratisiert signiertes App-HTML in Claudes iframe, dann direkte `ui/_`-Host-Bridge</small></div><div class=\"diagram-card\" data-rough><strong>ChatGPT web</strong><span class=\"diagram-pill accent\">controlled route iframe</span><small class=\"diagram-muted\">`window.openai`host APIs ·`agentNative.mcpHost.*` postMessage relay</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Same signed app route<br><small class=\"diagram-muted\">normale Route + React-Komponenten</small></div></div>",
"css": ".diagram-bridge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-bridge .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-bridge .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;max-width:300px}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}.diagram-bridge .diagram-box{padding:16px 18px;text-align:center}"
}

```

Claude Web verwendet einen Single-Frame-Transplantationspfad: Das Ressourcendokument ruft die signierte App HTML ab und hydratisiert sie im MCP-App-Iframe von Claude, da Claude App-eigene untergeordnete Iframes oder externe Frame-Navigation nicht zuverlässig zulässt. Das ChatGPT-Web erhält einen kontrollierten Routen-Iframe, da die Apps-Brücke uns stabile `window.openai`-Host-APIs und eine begrenzte Höhenkontrolle bietet. Alle Pfade verweisen auf dieselbe signierte App-Route und rendern die normale Route und die React-Komponenten. Entwerfen Sie eingebettete Routen, sodass ein Neuladen mit demselben signierten URL dieselbe Ansicht wiederherstellt.

Für die gleiche App `open_app({ embed: true })` prägt das Framework das Embed-Start-Ticket während des ursprünglichen Tool-Aufrufs und speichert den signierten Start URL in versteckten Tool-Metadaten. Benutzerdefinierter actions kann `embedStartUrl` für denselben schnellen Pfad zurückgeben; Die MCP-Schicht entfernt das Ticket tragende URL aus dem modellsichtbaren `structuredContent` und den normalen Open-Link-Metadaten. Wenn kein Einbettungsstart URL vorhanden ist, greift die Ressource auf den Nur-App-Helper `create_embed_session` zurück. Dadurch bleiben Produktionshosts, die iframe-initiierte Toolaufrufe einschränken, auf der direkten Route, ohne dass einmalige App-Sitzungs-URLs in das Transkript gelangen. Wenn ein Benutzer einen alten Chat erneut öffnet, nachdem ein einmaliges Startticket abgelaufen ist, gibt die Startroute eine kleine Aktualisierungsseite zurück und postet `agentNative.embedSessionExpired` im Wrapper; `embedApp()` beseitigt den veralteten Start URL und prägt ein neues Ticket über `create_embed_session`, wenn noch die ursprüngliche App-Route vorhanden ist.

ChatGPT erhält einen dedizierten Kompatibilitätspfad über `window.openai`: Das Startdokument liest `toolInput`, `toolOutput` und `toolResponseMetadata` direkt und ruft dann `create_embed_session` über `window.openai.callTool(...)` auf. Standard-MCP-Apps-Hosts verwenden die `ui/*` JSON-RPC-Brücke. Direkt hydrierte Routen können `ui/update-model-context`, `ui/message`, `ui/open-link` und `ui/request-display-mode` über die Host-Bridge-Helfer aufrufen. Die transplantierte Route von Claude verwendet nach der Hydratation dieselbe direkte `ui/*`-Wirtsbrücke. Wenn der ChatGPT- oder explizite Diagnose-Iframe-Pfad verwendet wird, leitet der Wrapper denselben Host actions über `agentNative.mcpHost.*`-PostMessage-Anfragen weiter. Halten Sie die Ergebnisform für beide Pfade identisch: Geben Sie einen fokussierten `link` und einen prägnanten strukturierten Inhalt zurück.

Stellen Sie den Standard-`_meta.ui.domain` nicht auf eine App URL ein. MCP Apps behandelt dieses Feld als hostspezifisch: Claude validiert Sandbox-Domänen im `{hash}.claudemcpcontent.com`-Stil, während ChatGPT seine eigenen `openai/widgetDomain`-Metadaten verwendet. Lassen Sie `ui.domain` weg, es sei denn, Sie geben absichtlich einen hostspezifischen Wert aus; Der Host wählt einen Standard-Sandbox-Ursprung.

Erweiterungsseiten behalten ihre Sandbox in MCP-Chat-Einbettungen, ohne einen zweiten Routen-Iframe zu navigieren. Bei normaler App-Nutzung wird `/_agent-native/extensions/:id/render` als untergeordneter Sandbox-Iframe gerendert. Im MCP-Chat-Bridge-Modus rendert das Framework dasselbe Erweiterungsdokument wie das Sandbox-`srcDoc` innerhalb des Routen-Iframes und vermeidet so Ausfälle des Hosts `frame-ancestors`/`X-Frame-Options`, während `sandbox="allow-scripts allow-forms"` erhalten bleibt.

Die Ressourcen-Shell besitzt die äußere Hostgröße. `embedApp({ height })` ist standardmäßig auf `560px` eingestellt, klemmt die Schale auf `320-900px` und reserviert `44px` für die kleine Symbolleiste, sodass das Routenansichtsfenster `height - 44px` ist. Halten Sie eingebettete App-Routen intern scrollbar und lassen Sie den Launcher die begrenzte intrinsische Höhe und nicht die gesamte Dokumenthöhe melden; Andernfalls kann die automatische Größenänderung des Hosts eine normale App-Seite in ein sehr großes Chat-Artefakt verwandeln. Eine geänderte Shell wirkt sich nur auf neue MCP-App-Ressourcen und neue Tool-Aufrufe aus. Alte ChatGPT/Claude-Konversationsrahmen können das vorherige Ressourcenverhalten beibehalten. Überprüfen Sie daher die Größe mit einem neuen Inline-Rendering, bevor Sie über eine Korrektur entscheiden.

### Einbettungsmodi {#embed-modes}

Claude verwendet standardmäßig den Single-Frame-Transplantationspfad. Sie können es auch auf anderen Hosts mit `embedMode: "transplant"` oder `frame: "transplant"` erzwingen, wenn Sie das Ladeverhalten von Hostmodulen debuggen. Sie können den verschachtelten Diagnose-Iframe mit `embedMode: "iframe"`, `renderMode: "iframe"`, `nested: true` oder `frame: "iframe"` erzwingen. Wenn der Iframe blockiert ist, ersetzt `embedApp()` ihn durch einen Open-App-Fallback: Der Benutzer kann es inline erneut versuchen, eine frisch erstellte Einbettungssitzung über den Host öffnen oder die sichtbare Route URL verwenden. Halten Sie das `link`-Ziel der Aktion für sich genommen nützlich, da es immer noch die universelle Notluke ist.

Wenn Sie Claude über ngrok testen, verwenden Sie einen Produktions-Build (`npx @agent-native/core@latest build`, dann `npx @agent-native/core@latest start`) oder eine bereitgestellte Vorschau/Produktion URL. Der Single-Frame-Transplantationspfad von Claude funktioniert mit Produktions-Asset-Chunks; Rohe Vite-Entwicklungsmodule wie `/app/root.tsx` können durch App-Authentifizierung geschützt werden und dynamische Importe vom Claude-Ressourcesursprung scheitern lassen.

## Hostbrücke API {#host-bridge}

Die Host-Bridge ist bewusst klein:

| Modus                  | Nachrichtentyp                        | Verwenden Sie es für                                            |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------- |
| direkte Host-Route     | `ui/update-model-context`             | Versteckter Kontext für das Hostmodell                          |
| direkte Host-Route     | `ui/message`                          | Veröffentlichen Sie eine sichtbare Benutzerübergabe an den Host |
| direkte Host-Route     | `ui/open-link`                        | Öffnen Sie eine externe oder App URL über den Host              |
| direkte Host-Route     | `ui/request-display-mode`             | Anfrage `inline`, `fullscreen` oder `pip`                       |
| Claude-Transplantation | `ui/*`                                | Gleiche direkte Wirtsbrücke nach der Hydratation                |
| ChatGPT / Iframe-Route | `agentNative.mcpHostContext`          | Theme, Gebietsschema, Hostplattform, Dimensionen                |
| ChatGPT / Iframe-Route | `agentNative.embeddedAppReady`        | Bestätigen Sie, dass der Routen-Iframe geladen wurde            |
| ChatGPT / Iframe-Route | `agentNative.mcpHost.*` / `.response` | Wrapper-Relay für Host-Anfragen                                 |

Eingebettete Routen können `updateMcpAppModelContext()`, `openMcpAppHostLink()`, `requestMcpAppDisplayMode()`, `getMcpAppHostContext()` und `useMcpAppHostContext()` von `@agent-native/core/client` verwenden. `sendToAgentChat()` verwendet denselben Pfad wie vollständige App-Einbettungen für automatisch übermittelte Eingabeaufforderungen.

Anzeigemodus ist Best-Effort. Der In-App-`McpAppRenderer` meldet derzeit einen Inline-Webhost-Kontext und einen Nur-Inline-Anzeigemodus; Externe Hosts berücksichtigen möglicherweise größere Anzeigeanforderungen, ignorieren sie oder antworten mit einem Fehler im nicht unterstützten Modus. Halten Sie die Inline-Route immer nutzbar.

## Client-Unterstützung und Caching {#client-support}

Die aktuelle offizielle Kundenliste von MCP Apps umfasst Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT und Cursor; Die Host-Unterstützung variiert immer noch je nach Plan, Release-Kanal und Client-Version. Überprüfen Sie daher [MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix). Benutzerdefinierte ChatGPT-Apps von MCP sind über den Entwicklermodus für Business- und Enterprise/Edu-Arbeitsbereiche im ChatGPT-Web verfügbar. siehe OpenAIs [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta)-Hinweise.

Claude Code, Codex und andere CLI/Code-Editor-Clients erhalten weiterhin dieselben Ressourcen und Metadaten, wenn sie MCP-Apps unterstützen, behandeln sie jedoch als Link-Out-Hosts, es sei denn, Sie haben das Inline-Iframe-Rendering in genau dieser Oberfläche überprüft. Der Deep Link bleibt der zuverlässige Fallback, wenn ein Host beschließt, einen Iframe nicht zu rendern. In der Praxis sollte jede agentennative App mit beidem erstellt werden: MCP Apps für die Inline-Überprüfung/-Bearbeitung in fähigen Hosts und `link` für universelles Roundtripping zurück zur vollständigen App.

Claude und ChatGPT können Tool- und Ressourcenmetadaten für einen vorhandenen benutzerdefinierten Connector zwischenspeichern. Nachdem Sie die Metadaten der MCP-App geändert haben, überprüfen Sie dies mit einem neuen Tool-Aufruf. Wenn der Host immer noch den alten Deskriptor verwendet, schließen Sie den Claude-Anschluss erneut an oder scannen/überprüfen Sie den ChatGPT-Anschluss erneut, damit der Katalog aktualisiert wird. Wenn Claude nach einer Bereitstellung eine Warnung darüber protokolliert, dass `_meta.ui.csp` oder `_meta.ui.permissions` im Tool-Deskriptor vorhanden sind, verwendet dieser Connector veraltete Metadaten: Löschen Sie den Claude-Connector, verbinden Sie ihn erneut und starten Sie einen neuen Chat.

## Testen {#testing}

Testen Sie MCP-Apps mit den leichten Geräten rund um `embedApp()` und `McpAppRenderer`; Sie decken CSP, Hostkontext, App-Start und Bridge-Nachrichtenverhalten ab, ohne dass ein echter externer Host erforderlich ist. Lösen Sie bei der Validierung des ChatGPT- oder Claude-Webs nach Shell-Änderungen einen neuen Tool-Aufruf aus und messen Sie den sichtbaren Iframe. Zuvor gerenderte Frames in derselben Konversation zeigen möglicherweise immer noch die zwischengespeicherte Höhe oder das Startverhalten.

## Verwandt {#related}

- [External Agents](/docs/external-agents) – Verbindung von Claude, ChatGPT, Codex und Cursor mit gehosteten Apps; MCP Apps-Kompatibilitätsmatrix; Katalogebenen; Deep-Links.
- [MCP Protocol](/docs/mcp-protocol) – der automatisch gemountete MCP-Server, Authentifizierung, Tools und `ask-agent`.
- [Actions](/docs/actions) – `defineAction`, der `link`-Builder, `publicAgent`.

```

```
