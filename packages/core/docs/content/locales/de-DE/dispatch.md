---
title: "Versand"
description: "Die Steuerungsebene des Arbeitsbereichs: Geheimspeicher, Integrations-Hub, App-übergreifender Delegat und zentraler Posteingang für Slack, E-Mail, Telegram, WhatsApp."
---

# Versand

Dispatch ist die zentrale App, die sich vor jeder anderen App in Ihrem Arbeitsbereich befindet und Geheimnisse, Integrationen, Nachrichten und app-übergreifende Delegierung verwaltet. Es handelt sich um die **Kontrollebene des Arbeitsbereichs** – der einzelne Agent, mit dem Ihr Team kommuniziert, die zentralen Anmeldeinformationen live und der einzelne Router, der entscheidet, welche Spezial-App eine bestimmte Anfrage bearbeiten soll.

> **Versenden Sie die Vorlage vs. `@agent-native/dispatch` das Paket.** Diese Seite behandelt das Konzept der Dispatch-App/-Vorlage – was sie tut und warum Sie sie benötigen. Das `@agent-native/dispatch` npm-Paket ist die separat veröffentlichte Laufzeit, die die Serverlogik der Dispatch-Vorlage (Tresor, Integrationen, Ziele, geplante Jobs und app-übergreifende Delegierung) als Drop-In-Paket für Arbeitsbereiche bündelt, die sie erweitern. Informationen zur Gerüst-App selbst (Routen, Bildschirme, Agentenführer) finden Sie im [Dispatch template](/docs/template-dispatch).

Ohne Dispatch implementiert jede App in einem Multi-App-Arbeitsbereich letztendlich die gleichen Installationen neu: ihren eigenen Slack-Bot, ihren eigenen Geheimspeicher, ihre eigenen geplanten Jobs, ihre eigene Kopie der Anweisungen des Arbeitsbereichs. Das Drehen eines API-Schlüssels führt zu zehn Neubereitstellungen. Das Hinzufügen einer neuen Richtlinie erfordert zehn Kopier- und Einfügevorgänge. Dispatch zentralisiert all das in einer App, sodass sich die anderen auf ihre Domain konzentrieren können.

```an-diagram title="Dispatch als Arbeitsbereichssteuerungsebene" summary="Ein Posteingang, ein Tresor, ein MCP-Gateway und gemeinsam genutzte Ressourcen befinden sich vor den Domänen-Apps, die Dispatch als A2A-Peers erreichen."
{
  "html": "<div class=\"dsp-hub\"><div class=\"diagram-node\">Users &amp; external agents<br><small class=\"diagram-muted\">Slack · E-Mail · Telegram · WhatsApp · MCP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel dsp-control\" data-rough><span class=\"diagram-pill accent\">Dispatch &mdash; control plane</span><div class=\"dsp-caps\"><span class=\"diagram-pill\">Zentraler Posteingang</span><span class=\"diagram-pill\">Secret-Tresor</span><span class=\"diagram-pill\">App-übergreifende Delegation</span><span class=\"diagram-pill\">MCP gateway</span><span class=\"diagram-pill\">Workspace-Ressourcen</span></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"dsp-peers\"><div class=\"diagram-box\" data-rough>Mail</div><div class=\"diagram-box\" data-rough>Calendar</div><div class=\"diagram-box\" data-rough>Analytics</div></div><small class=\"diagram-muted\">domain apps &mdash; A2A peers</small></div>",
  "css": ".dsp-hub{display:flex;flex-direction:column;align-items:center;gap:10px}.dsp-hub .dsp-control{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}.dsp-hub .dsp-caps{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}.dsp-hub .dsp-peers{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}"
}
```

## Wenn Sie den Versand wünschen {#when}

Reach for Dispatch, wenn einer dieser Punkte zutrifft:

- Sie führen einen [multi-app workspace](/docs/multi-app-workspace) aus – E-Mail, Kalender, Analysen, Inhalte – und möchten nicht einen Slack-Bot pro App.
- Sie möchten **einen Posteingang für „den Agenten“**, damit Benutzer einem einzelnen Bot eine DM schicken und die richtige Spezial-App die Arbeit hinter den Kulissen übernimmt.
- Sie verfügen über **arbeitsbereichsweite Geheimnisse** (Stripe-Schlüssel, OpenAI-Schlüssel, API-Token von Drittanbietern), die mehrere Apps benötigen, und Sie möchten einen einzigen Tresor, anstatt Werte in jeden `.env` zu kopieren.
- Sie möchten einen **Laufzeitgenehmigungsfluss** vor sensiblen Änderungen (gespeicherte Ziele, Richtlinienänderungen), damit Nicht-Administratoren Anfragen stellen und Administratoren ohne Code-Bereitstellung abmelden können.
- Sie möchten **gemeinsame skills, Anweisungen, Agentenprofile und MCP-Server**, die Apps im Arbeitsbereich erben – einmal ändern, alle erreichen.

Wenn Sie eine einzelne Vorlage eigenständig ausführen, benötigen Sie Dispatch nicht – jede Vorlage kann ihre eigenen Messaging-Integrationen direkt verbinden. Siehe [Messaging](/docs/messaging) für das Standalone-Setup.

## Was Dispatch tut {#what-it-does}

Sieben Funktionen, die alle auf derselben Workspace-Datenbank basieren, die auch die anderen Apps verwenden:

| Fähigkeit                         | Was es Ihnen bietet                                                                                      | Einrichten                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Zentraler Posteingang**         | Slack, E-Mail, Telegram, WhatsApp erreichen alle einen Agenten mit gemeinsamem Speicher + Tools          | **Einstellungen → Nachrichten** ([Messaging](/docs/messaging)) |
| **Geheimer Tresor**               | Speichern Sie jeden Berechtigungsnachweis einmal. rotieren an einer Stelle in jeder App                  | **Vault** + Zugriffsmodus (alle Apps oder manuell)             |
| **App-übergreifende Delegierung** | Leitet eine Anfrage über A2A an die richtige Fach-App weiter und antwortet im Thread                     | Automatisch ([A2A](/docs/a2a-protocol))                        |
| **Einheitliches MCP-Gateway**     | Ein MCP-Connector für externe Agenten erreicht jede gewährte Workspace-App                               | [External Agents](/docs/external-agents)                       |
| **Arbeitsbereichsressourcen**     | Autor skills/instructions/profiles einmal; Apps erben sie zur Laufzeit                                   | **Ressourcen** ([Workspace](/docs/workspace#global-resources)) |
| **Träume**                        | Überprüft vergangene Läufe/Feedback und schlägt dauerhafte Verbesserungen vor, die Sie genehmigen können | Registerkarte „Träume\*\*“                                     |
| **Genehmigungsablauf**            | Gate-sensitive Laufzeitänderungen hinter der Inline-Administratorüberprüfung                             | **Versandgenehmigungsrichtlinie**                              |

Jedes wird unten detailliert beschrieben.

### Zentraler Posteingang

Slack, E-Mail, Telegram und WhatsApp fließen alle in die Agentenschleife von Dispatch ein. Verbinden Sie jede Plattform einmal unter **Einstellungen → Nachrichten** und jeder Kanal erreicht denselben Agenten mit demselben Speicher und denselben Tools. Eine Slack-DM und eine E-Mail an `agent@yourcompany.com` enden als zwei Oberflächen in einem Gesprächsverlauf und nicht als zwei getrennte Bots. Siehe [Messaging](/docs/messaging) für die Anmeldeinformationen und Webhooks URLs.

### Geheimer Tresor

Speichern Sie die Anmeldeinformationen einmal im Tresor von Dispatch. Standardmäßig ist der Tresorzugriff **alle Apps**: Jeder gespeicherte Schlüssel ist für jede Workspace-App verfügbar, und `sync-vault-to-app` verschiebt den gesamten Tresor an die Ziel-App. Arbeitsbereiche, die eine strengere Trennung benötigen, können den Tresor in den **manuellen** Modus umschalten, in dem vor der Synchronisierung explizite Genehmigungen pro App erforderlich sind. Nicht-Administratoren können ein Geheimnis für eine App **anfordern**; Administratoren **genehmigen**, wodurch das Geheimnis und in manuellen Workflows die Gewährung erstellt wird. Alle Lese-, Gewährungs-, Synchronisierungs- und Rotationsvorgänge werden in einem Prüfprotokoll erfasst. Dies macht das Drehen der OpenAI-Taste zu einem Ein-Klick-Vorgang über zehn Apps statt zehn PRs.

### App-übergreifende Delegierung

Dispatch erkennt die anderen Apps in Ihrem Arbeitsbereich automatisch als A2A-Peers – keine manuelle Registrierung, keine Konfiguration pro App. Wenn ein Benutzer in Slack nach „Anmeldungen der letzten Woche zusammenfassen“ fragt, erkennt Dispatch dies als Analyseanfrage und ruft die Analyse-App über [A2A](/docs/a2a-protocol) auf. Wenn sie fragen „Entwerfen Sie eine Antwort an Alice“, wird die Nachricht an die Mail-App weitergeleitet. Dispatch veröffentlicht die endgültige Antwort zurück im ursprünglichen Thread. Die Verhaltensregel lebt in den Anweisungen des Disponenten: Domänenarbeit gehört zur Domänen-App. Dispatch ist der Orchestrator, nicht der Spezialist.

### Einheitliches MCP-Gateway

Dispatch kann der einzelne MCP-Connector für externe Agenten sein: Fügen Sie `https://dispatch.agent-native.com/_agent-native/mcp` einmal in Claude, ChatGPT, Codex oder Cursor hinzu, und eine Autorisierung erreicht jede gewährte Workspace-App anstelle eines Connectors pro App. Den vollständigen Verbindungsablauf, App-Zuschüsse, OAuth und Inline-MCP-App-Vorschauen finden Sie unter [External Agents](/docs/external-agents).

```an-api
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "Einheitlicher MCP-Gateway-Endpunkt",
  "description": "The single MCP connector URL external agents add (e.g. `https://dispatch.agent-native.com/_agent-native/mcp`). One authorization here reaches every **granted** workspace app instead of wiring one connector per app. App grants, OAuth, and inline MCP App previews are covered in [External Agents](/docs/external-agents).",
  "auth": "Standard remote MCP OAuth, handled by the framework. The granted-app set scopes which workspace apps the connector can reach.",
  "responses": [
    { "status": "200", "description": "MCP JSON-RPC response — tools, resources, and MCP App UI resources aggregated across granted workspace apps." }
  ]
}
```

### Arbeitsbereichsressourcen

Skills, Leitplankenanweisungen, Agentenprofile und Referenzressourcen können einmal in Dispatch erstellt und vom Rest des Arbeitsbereichs übernommen werden. Ressourcen mit dem Geltungsbereich **Alle Apps** sind global: Dispatch speichert sie einmal im Arbeitsbereichsbereich und jeder App-Agent liest sie zur Laufzeit. Sie werden nicht in jede App kopiert und es gibt keinen manuellen Synchronisierungsschritt zwischen Arbeitsbereich und Ressourcen. Von der App freigegebene Ressourcen und persönliche Ressourcen können die Standardeinstellungen des Arbeitsbereichs lokal überschreiben oder einschränken.

Siehe [Workspace — Global resources](/docs/workspace#global-resources) für die kanonische Pfadtabelle, das Starterpaket und das Override-Modell.

MCP-Serverressourcen verwenden JSON und sind absichtlich nur HTTP. Speichern Sie Token in
Versenden Sie Vault, gewähren oder synchronisieren Sie diese Schlüssel mit den Ziel-Apps und verweisen Sie darauf
aus Headern mit `${keys.NAME}`, sodass die Rohanmeldeinformationen niemals im
Ressourcenkörper.

Auf der Seite **Ressourcen** wird das empfohlene Starterpaket hervorgehoben, sodass Administratoren schnell erkennen können, welche Dateien vorhanden sind, fehlende Starterdateien wiederherstellen, ohne vorhandene zu überschreiben, und deren Inhalte bearbeiten können. Erweitern Sie eine beliebige Ressource, um eine Vorschau ihres effektiven Laufzeitstapels für eine ausgewählte App/einen ausgewählten Benutzer anzuzeigen. Jede App-Karte verfügt außerdem über eine **Kontextansicht**, die genau zeigt, was diese App empfängt.

### Träume

Dispatch Dreams überprüft frühere Agentenläufe, Feedback, Bewertungen und wiederholte Fehler, um dauerhafte Verbesserungen vorzuschlagen. Ein Traumbericht ist eine Überprüfungsoberfläche, kein stilles Umschreiben: Er kann persönliche Speicheraktualisierungen, die Bereinigung veralteter Speicher, gemeinsame `LEARNINGS.md`-Änderungen, Arbeitsbereichsanweisungen/Fähigkeiten/Wissen/Agentenressourcen oder wiederkehrende Jobs vorschlagen, und jeder Vorschlag verweist auf die Ausführungen, die ihn rechtfertigen. Gemeinsame Anweisungen und teamweite Ressourcen müssen vor ihrer Anwendung überprüft werden, insbesondere wenn die Beweise aus eingehenden Slack-, E-Mail-, Telegram-, WhatsApp- oder Webinhalten stammen.

Bevor Dreams einen Schreibvorgang vorschlägt, vergleicht Dreams die Beweise mit dem persönlichen Speicherindex, vorhandenen `memory/*.md`-Notizen und freigegebenen `LEARNINGS.md`. Wenn eine Lektion bereits erfasst ist, wird im Bericht vermerkt, dass sie übersprungen wurde. Wenn eine zugehörige persönliche Erinnerung veraltet erscheint, zielt der Vorschlag auf diese vorhandene Notiz ab, anstatt ein Duplikat zu erstellen.

Beginnen Sie mit der Registerkarte **Träume** in Dispatch. Führen Sie zunächst einen manuellen Durchgang durch, öffnen Sie ein Vorschlagsüberprüfungsblatt, um das aktuelle Ziel mit dem vorgeschlagenen Inhalt und den Quellennachweisen zu vergleichen, und übernehmen Sie dann nur die Änderungen, die Sie behalten möchten. Sobald die Berichte durchgängig nützlich sind, kann Dispatch einen wiederkehrenden Traumjob erstellen, der weiterhin Vorschläge erstellt, ohne dass gemeinsame Änderungen oder Änderungen auf Anweisungsebene automatisch angewendet werden.

### Genehmigungsablauf

Dispatch kann sensible Laufzeitänderungen hinter der Überprüfung durch den Administrator verbergen. Heute umfasst dies **gespeicherte Ziele** (die Slack-Kanäle und E-Mail-Adressen, an die der Agent proaktiv senden kann), geteilte/Team-**Traumvorschläge**, das Erstellen/Aktualisieren/Löschen von All-App-**Arbeitsbereichsressourcen** und die **Versandgenehmigungsrichtlinie** selbst. Wenn die Richtlinie aktiviert ist, wird die Änderung in die Warteschlange gestellt und der Agent zeigt direkt im Chat eine Inline-Genehmigungsvorschau an – Administratoren genehmigen oder lehnen ab, ohne die Konversation zu verlassen.

## Wie eine Slack-Nachricht durch Dispatch fließt {#flow}

Gehen Sie ein Beispiel Ende-zu-Ende durch. Ein Benutzer schickt dem Bot eine DM: _"Zusammenfassen der Anmeldungen der letzten Woche."_

1. **Slack → Webhook.** Slack `POST`s bis `/_agent-native/integrations/slack/webhook` in der Dispatch-App. Der Handler überprüft die Signatur und **fügt eine Zeile in `integration_pending_tasks` ein**, löst dann einen selbstgesteuerten `POST` auf seinem eigenen Prozessor aus und gibt `200` sofort zurück, sodass Slack keinen erneuten Versuch unternimmt.
2. **Neue Prozessorausführung.** Der Prozessorendpunkt wird in einer brandneuen Funktionsausführung mit seinem eigenen vollständigen Timeout ausgeführt. Es beansprucht die Aufgabe atomar und startet die Agentenschleife.
3. **Der Dispatcher-Agent entscheidet.** Der Agent liest die Nachricht, erkennt „Anmeldungen“ als Analyseabsicht und ruft `call-agent` für [A2A endpoint](/docs/a2a-protocol) der Analyse-App auf. Dort läuft die eigentliche SQL-Arbeit.
4. **Antwort im Thread gepostet.** Der Analyseagent gibt ein Ergebnis zurück. Dispatch formatiert es und sendet es zurück in denselben Slack-Thread, in den der Benutzer geschrieben hat, und verwendet dabei die verknüpfte Identität, falls vorhanden (der Agent handelt also mit den Berechtigungen des Anforderers, nicht mit denen des Arbeitsbereichsbesitzers).
5. **Wiederherstellung, wenn etwas ausfällt.** Wenn der Prozessor mitten im Flug abstürzt – A2A-Timeout, Downstream-Agent-Fehler, Funktionseinfrierung – durchsucht ein Wiederholungsjob alle 60 Sekunden festsitzende Aufgaben und startet den Prozessor erneut. Bis zu drei Versuche, bevor die Aufgabe mit `failed` markiert wird.

```an-diagram title="Eine Slack-Nachricht über Dispatch" summary="Slack wird in SQL eingereiht, eine neue Ausführung entleert es, der Dispatch-Agent delegiert die Domänenarbeit über A2A und die Antwort landet wieder im ursprünglichen Thread. Ein 60-sekündiger Wiederholungsjob stellt alles wieder her, was während des Flugs abstürzt."
{
  "html": "<div class=\"dsp-flow\"><div class=\"dsp-row\"><div class=\"diagram-node\">Slack-DM<br><small class=\"diagram-muted\">\"summarize last week's signups\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/slack/webhook</strong><br><small class=\"diagram-muted\">prüfen + ausstehenden Task INSERTen</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">200</div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough><strong>fresh processor</strong><br><small class=\"diagram-muted\">Task übernehmen · Agent-Schleife starten</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch-Agent entscheidet</span><small class=\"diagram-muted\">analytics intent &rarr; call-agent</small></div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough>Analytics-App<br><small class=\"diagram-muted\">A2A-Peer · führt SQL-Arbeit aus</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">reply posted in thread</div></div><div class=\"diagram-panel dsp-retry\" data-rough><span class=\"diagram-pill warn\">recovery</span> <span class=\"diagram-muted\">if the processor crashes &mdash; A2A timeout, downstream error, freeze &mdash; the 60s retry job re-fires it (&le;3 attempts) so the Slack reply still arrives</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</span></div></div>",
  "css": ".dsp-flow{display:flex;flex-direction:column;gap:12px}.dsp-flow .dsp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dsp-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.dsp-flow .dsp-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

Der gleiche Ablauf gilt für E-Mail, Telegram und WhatsApp – nur der Adapter ändert sich.

## Zuverlässigkeitsgeschichte {#reliability}

Die gesamte Pipeline ist so konzipiert, dass sie auf jedem serverlosen Host (Netlify, Vercel, Cloudflare Workers) funktioniert, ohne auf plattformspezifische APIs für die Hintergrundausführung angewiesen zu sein.

- **Webhook → SQL-Warteschlange → Fresh-Execution-Prozessor.** Die Agentenschleife wird niemals innerhalb des Webhook-Handlers ausgeführt. Die einzige Aufgabe des Handlers besteht darin, 200 zu überprüfen, in die Warteschlange zu stellen und zurückzugeben. Eine separate neue Ausführung entleert die Warteschlange, sodass eine langsame Agentenausführung niemals den eingehenden Webhook blockieren oder dazu führen kann, dass die Plattform es erneut versucht.
- **A2A Fortsetzungsabfrage.** Wenn Dispatch an eine andere App delegiert, fragt es die Downstream-Aufgabe mit einem begrenzten Timeout ab. Wenn der Downstream-Agent zu lange braucht oder abstürzt, zeichnet Dispatch die Fortsetzung auf und der Wiederholungsjob übernimmt sie – die Slack-Antwort des Benutzers kommt trotzdem an.
- **Automatisch signiertes, appübergreifendes A2A.** Gehostete Multi-App-Arbeitsbereiche generieren zum Zeitpunkt der Bereitstellung automatisch A2A-Anmeldeinformationen pro App, sodass Apps im selben Arbeitsbereich einander aufrufen können, ohne dass Sie jemals ein JWT-Geheimnis einfügen müssen. Die Agent-Discovery-Ebene von Dispatch liest diese Creds aus der Workspace-Datenbank, sodass neu hinzugefügte Apps automatisch als aufrufbare Peers angezeigt werden.

## Einrichtung {#setup}

Drei kurze Schritte:

1. **Bauen Sie ein Gerüst für einen Arbeitsbereich auf, der Dispatch enthält.** Führen Sie `npx @agent-native/core@latest create my-company-platform` aus und wählen Sie `dispatch` neben den gewünschten Domänenvorlagen aus. Dispatch befindet sich bei `apps/dispatch` und die restlichen Apps befinden sich daneben. Siehe [Multi-App Workspace](/docs/multi-app-workspace).
2. **Messaging verbinden.** Öffnen Sie **Einstellungen → Messaging** in Dispatch und klicken Sie auf Verbinden für Slack, E-Mail, Telegram oder WhatsApp. Die Formularfelder stimmen mit den Umgebungsvariablen im Dokument [Messaging](/docs/messaging) überein – siehe dort, was die einzelnen Plattformen benötigen.
3. **Andere Apps hinzufügen.** Führen Sie `npx @agent-native/core@latest add-app` vom Arbeitsbereichsstammverzeichnis für jede Domänen-App aus. Sie erscheinen automatisch als A2A-Peers in `list-workspace-apps` von Dispatch – keine manuelle Registrierung, keine Bearbeitung der Agentenkarte. Dispatch beginnt mit der Delegierung an sie, sobald ihre Agentenkarten erreichbar sind.

Fügen Sie dann Anmeldeinformationen zum Tresor hinzu und erstellen Sie (optional) globale Arbeitsbereichsressourcen unter **Ressourcen**. Tresorschlüssel können je nach Zugriffsmodus weiterhin synchronisiert oder gewährt werden; Alle App-Arbeitsbereichsressourcen werden automatisch geerbt. Wenn Sie eine Geheimisolierung pro App benötigen, stellen Sie die Tresorzugriffseinstellung auf „Manuell“ um, bevor Sie einzelne Apps gewähren.

## Siehe auch {#see-also}

- [Dispatch template](/docs/template-dispatch) – die eigentliche Gerüst-App mit vollständigem Aktionskatalog und Agentenleitfaden
- [Messaging](/docs/messaging) – Verbindung von Slack, E-Mail, Telegram, WhatsApp
- [A2A Protocol](/docs/a2a-protocol) – wie die app-übergreifende Delegierung unter der Haube funktioniert
- [Multi-App Workspace](/docs/multi-app-workspace) – die Bereitstellungsform, für die Dispatch erstellt wurde
- [Workspace Governance](/docs/workspace-management) – git/GitHub-Governance, die mit der Laufzeit-Governance von Dispatch gekoppelt ist
