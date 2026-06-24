---
title: "Frames"
description: "Der lokale Entwicklungsrahmen, das eingebettete Agent-Panel und der Cloud-Rahmen – die Art und Weise, wie ein KI-Agent neben Ihrer App ausgeführt wird."
---

# Frames

Jede agentennative App wird mit einem KI-Agenten neben der App UI ausgeführt. Ein **Frame** ist
der Wrapper, der beides hostet: Er zeigt Ihre App und gibt dem Agenten einen Platz dafür
Chatten, ausführen und (im Entwickler) Code bearbeiten. Es gibt drei Frames, die sich eine Laufzeit teilen:

- **Eingebettetes Agent-Panel** – ist in jeder App von `@agent-native/core` enthalten.
  Dies ist die Seitenleiste, die Ihre App in der Entwicklung und in der Produktion selbst rendert.
- **Local Dev Frame** – ein Thin Wrapper, der Ihre laufende App in einen Iframe lädt
  und fügt das gleiche Agentenpanel sowie daneben ein integriertes CLI-Terminal hinzu. Gebraucht
  für die lokale Entwicklung von Vorlagen in diesem Repo.
- **Builder.io Cloud Frame** – ein verwalteter, gehosteter Frame mit Zusammenarbeit,
  visuelle Bearbeitung und parallele Agentenausführungen.

Ihr App-Code ist identisch, unabhängig davon, welcher Frame ihn hostet. Der Agent spricht
zu Ihrer App in jedem Fall über denselben actions und Anwendungsstatus.

```an-diagram title="Drei Frames, eine Laufzeit" summary="Ihre App und das Agent-Panel sind in jedem Frame gleich; nur die Hülle um sie herum ändert sich."
{
  "html": "<div class=\"diagram-frames\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">Embedded panel</span><small class=\"diagram-muted\">ships in every app · dev + prod</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Local dev frame</span><small class=\"diagram-muted\">app in an iframe + panel + CLI terminal</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Builder.io cloud frame</span><small class=\"diagram-muted\">hosted: collaboration · visual edit · parallel runs</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>Same runtime<br><small class=\"diagram-muted\">your app · actions · application state</small></div></div>",
  "css": ".diagram-frames{display:flex;flex-direction:column;gap:10px;align-items:stretch}.diagram-frames .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-frames .diagram-arrow{font-size:22px;line-height:1;align-self:center}"
}
```

## Eingebettetes Agentenfeld {#embedded-agent}

Das eingebettete Panel ist die Agent-Seitenleiste, die Ihre App rendert. Im Lieferumfang ist
`@agent-native/core` – es muss kein separates Paket installiert werden – und ist dasselbe
Komponente in Entwicklung und Produktion.

- Exportiert als `AgentPanel` von `@agent-native/core/client`, mit einem
  Nur-Produktionsvariante `ProductionAgentPanel`.
- Stellt die vollständige Chat-/CLI-/Workspace-Oberfläche bereit, sodass die Agenteneingabe aktiviert bleibt
  der gemeinsam genutzte Composer-Stack, der überall sonst im Framework verwendet wird.
- Liest `application_state.navigation` in jeder Runde, sodass es bereits weiß, welches
  Sehen Sie sich an, in welcher Position Sie sich befinden und was ausgewählt ist – Sie müssen „dies“ nicht noch einmal erklären.

### App vs. Code-Tool-Modi {#tool-modes}

Das Panel läuft in einem von zwei Werkzeugmodi:

- **App-Modus** – der Agent verfügt nur über die eigenen Tools Ihrer App: die actions Ihnen
  definiert mit `defineAction`, plus Navigation und Kontext. Kein Dateisystem oder
  Shell-Zugriff. Das bekommen Endbenutzer.
- **Codemodus** – fügt die gemeinsam genutzten Codierungstools hinzu (`bash`, `read`, `edit`, `write`)
  und Datenbankzugriff zusätzlich zu den App-Tools, damit der Agent die App ändern kann
  eigene Quelle. Codeanfragen werden blockiert: wenn eine Nachricht Code erfordert
  (`type: "code"`) und kein codefähiger Rahmen angeschlossen ist, zeigt das Panel ein
  Dialog, der erklärt, dass Codeänderungen Agent Native Desktop oder Builder erfordern;
  Wenn ein Frame verbunden ist, wird die Anfrage an ihn und einen Code-Agenten weitergeleitet
  -Anzeige wird angezeigt, während es funktioniert (`useSendToAgentChat`). Für das Kanonische
  Coding-Tool-Liste und gemeinsame UI-Verträge, siehe
  [Agent-Native Code UI](/docs/code-agents-ui).

```an-diagram title="Code-Anfrage-Gating" summary="Eine codetypisierte Nachricht benötigt einen codefähigen Rahmen. Wenn einer verbunden ist, wird die Anfrage dorthin weitergeleitet. Ohne eins erklärt das Panel, dass Codeänderungen Desktop oder Builder erfordern."
{
  "html": "<div class=\"diagram-gate\"><div class=\"diagram-node\" data-rough>message<br><small class=\"diagram-muted\">type: \\\"code\\\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>code-capable frame connected?</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">yes &rarr; route to frame, show code-agent indicator</div><div class=\"diagram-pill warn\">no &rarr; dialog: needs Desktop or Builder</div></div></div>",
  "css": ".diagram-gate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-gate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-gate .diagram-arrow{font-size:22px;line-height:1}.diagram-gate .center{text-align:center}"
}
```

„Code-Modus“ ist der Umschalter der Agent-Fähigkeit – anders als der Umgebungsentwicklungsmodus
(`NODE_ENV` / Vite). Der Client-Hook ist `useCodeMode()`. (Siehe
[Compatibility notes](#compatibility) für die abwärtskompatiblen Aliase.)

Im lokalen Entwicklungsrahmen schaltet das Einstellungszahnrad zwischen diesen Modi um. Wechseln
Aus dem Codemodus wird die eigene Seitenleiste des Frames ausgeblendet und der In-App-Agent der App angezeigt
Seitenleiste stattdessen im Iframe, damit Sie genau das in der Vorschau sehen können, was Endbenutzer sehen.

## Integriertes Terminal und CLI-Switching {#cli-terminal}

In der Entwicklung enthält das Panel auch ein eingebettetes Terminal (`AgentTerminal`
von `@agent-native/core/client`), unterstützt von einem PTY-Server. Sie können ein echtes
Kodieren Sie CLI direkt neben der App und wechseln Sie zwischen ihnen; Das Terminal startet neu
mit dem ausgewählten CLI.

Die unterstützten CLIs stammen aus der zentralen CLI-Registrierung
(`packages/core/src/terminal/cli-registry.ts`). Nur diese Befehle sind zulässig
to spawn – der PTY-Server validiert den angeforderten Befehl anhand der Registrierung
Zulassungsliste zur Verhinderung der Injektion:

| CLI           | Befehl     | Paket installieren          |
| ------------- | ---------- | --------------------------- |
| Claude-Code   | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io    | `builder`  | (integriert)                |
| Codex         | `codex`    | `@openai/codex`             |
| Zwillinge CLI | `gemini`   | `@google/gemini-cli`        |
| OpenCode      | `opencode` | `opencode-ai`               |

Wenn das ausgewählte CLI nicht auf `PATH` gefunden wird, greift das Terminal auf dessen Ausführung zurück
bis `npx --yes <install-package>@latest` (wo ein Installationspaket vorhanden ist). Die
Standardbefehl ist `claude`. Wechseln Sie CLIs jederzeit in den Agent-Panel-Einstellungen
Zeit.

## Builder.io Wolkenrahmen {#cloud-frame}

[Builder.io](https://www.builder.io) stellt einen verwalteten Frame bereit, der das hostet
gleiche App und dasselbe Agentenpanel in der Cloud:

- Zusammenarbeit in Echtzeit – mehrere Benutzer können gleichzeitig zuschauen und interagieren.
- Visuelle Bearbeitung, Rollen und Berechtigungen.
- Parallele Agentenausführung für schnellere Iteration.
- Gut für den Teamgebrauch, bei dem sich jeder eine gehostete Umgebung teilt.

Codeanfragen vom eingebetteten Panel werden auf die gleiche Weise an den Builder-Frame weitergeleitet
Sie leiten an den lokalen Dev-Frame weiter, daher ist das obige Verhalten von dev-vs-prod wie folgt
über beide hinweg konsistent.

## Laufzeit APIs {#runtime-apis}

Diese werden mit `@agent-native/core` geliefert und dienen Ihrer App zur Kommunikation mit dem
Agent, unabhängig davon, welcher Frame ihn hostet:

1. **Nachricht senden** – `sendToAgentChat()` sendet eine Nachricht an den Agenten. Die
   `useSendToAgentChat()`-Hook umschließt es mit dem beschriebenen Code-Request-Gating
   oben und gibt ein `codeRequiredDialog`-Element zum Rendern zurück. Siehe
   [Drop-in Agent](/docs/drop-in-agent) für volle Nutzung und Optionen.
2. **Generierungsstatus** – `useAgentChatGenerating()` verfolgt, wann der Agent ist
   wird ausgeführt, sodass UI den Fortschritt anzeigen kann, ohne den Agenten direkt abzufragen.
3. **Polling-Synchronisierung** – Durch die datenbankgestützte Synchronisierung bleiben UI-Caches aktuell, wenn der Agent ausgeführt wird
   Ändert den Daten- oder Anwendungsstatus.
4. **Aktionssystem** – `pnpm action <name>` sendet an dasselbe Callable
   actions Der Agent ruft als Tools auf, sodass Sie alles tun können, was der Agent tun kann
   Skript.

## Wird ausgeführt {#running}

Das eingebettete Agenten-Panel ist Teil jeder App – erstellen Sie eine Vorlage als Gerüst und fertig
bereits da:

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

Der lokale Entwicklungsrahmen (das private `@agent-native/frame`-Paket im Framework-Repository) ist ein internes Toolpaket, das nicht auf npm veröffentlicht wird. Es lädt den Entwicklungsserver der aktiven App in einen Iframe, stellt das eingebettete Panel daneben bereit und wählt die App über den Abfrageparameter `app` aus. Das integrierte CLI-Terminal erfordert den Agent Native-Desktop, der den lokalen Code und den PTY-Zugriff bereitstellt, den das Terminal benötigt; Ohne diese Option zeigt das Panel die Chat-Oberfläche an und fordert Sie auf, Desktop zu öffnen, um CLI zu verwenden.

## Kompatibilitätshinweise {#compatibility}

Das Konzept des „Code-Modus“ wurde früher „Dev-Modus“ genannt, daher einige Rückkompatibilitäten
Namen bleiben bestehen. Sie können diese ignorieren, es sei denn, Sie behalten eine ältere Integration bei
Code:

- Die zugrunde liegende `AGENT_MODE`-Umgebungsvariable, die `/_agent-native/agent-chat/mode`
  Endpunkt (dessen Nutzlastschlüssel immer noch `devMode` ist) und der `agent-chat.mode`
  Einstellungsschlüssel bleiben unverändert.
- `useDevMode()` bleibt ein veralteter Alias für `useCodeMode()`.
