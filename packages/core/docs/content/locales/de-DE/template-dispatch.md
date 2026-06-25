---
title: "Versand"
description: "Dispatch ist die Steuerungsebene des Arbeitsbereichs – zentraler Posteingang, App-übergreifende Orchestrierung, Geheimspeicher, Slack/Telegram-Integration und geplante Jobs."
---

# Versand

> **Siehe auch:** Eine konzeptionelle Übersicht darüber, was Dispatch tut und wann Sie es benötigen, finden Sie unter [Dispatch](/docs/dispatch). Diese Seite ist die vorlagenspezifische Referenz.

Dispatch ist die **Arbeitsbereich-Steuerungsebene**. Wo andere Vorlagen Domänen-Apps sind (Mail, Kalender, Analytics, Brain), ist Dispatch die App, die Sie _neben_ ihnen ausführen, um alles zu koordinieren: einen zentralen Posteingang, einen Geheimspeicher, geplante Jobs, Slack/Telegram-Integration und einen Orchestrator-Agenten, der Domänenarbeit über [A2A](/docs/a2a-protocol) an die richtige Spezial-App delegiert.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Dispatch</h1><span class='wf-pill accent'>Overview</span><span class='wf-pill'>Inbox</span><span class='wf-pill'>Secrets</span><span class='wf-pill'>Approvals</span><div style='flex:1'></div><button>Schedules</button></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Was sollen wir als Nächstes tun?</strong><div class='wf-box'>Frag Analytics nach den Anmeldungen dieser Woche und entwirf ein Slack-Update.</div><button class='primary'>Delegate</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:10px'><div class='wf-card'><strong>Mail</strong><br/><small>/mail</small></div><div class='wf-card'><strong>Calendar</strong><br/><small>/calendar</small></div><div class='wf-card'><strong>Analytics</strong><br/><small>/analytics</small></div><div class='wf-card'><strong>Slides</strong><br/><small>/slides</small></div><div class='wf-card'><strong>Forms</strong><br/><small>/forms</small></div><div class='wf-card'><strong>App erstellen</strong><br/><small>+</small></div></div><div class='wf-card' style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px'><div class='wf-box'>Slack-DM needs reply</div><div class='wf-box'>A2A-Aufgabe abgeschlossen</div><div class='wf-box'>Genehmigung erforderlich</div></div></div>"
}
```

Wenn Sie einen [multi-app workspace](/docs/multi-app-workspace) mit vielen Apps betreiben, ist Dispatch der Kleber.

```an-diagram title="Orchestrieren, nicht spezialisieren" summary="Nachrichten von jedem Kanal landen in einem Posteingang; Der Orchestrator selektiert und delegiert die Domänenarbeit über A2A an die richtige Spezial-App – Geheimnisse, Ressourcen und Genehmigungen bleiben im Mittelpunkt."
{
  "html": "<div class=\"diagram-dispatch\"><div class=\"diagram-col\"><div class=\"diagram-node\">Slack · Telegram</div><div class=\"diagram-node\">Email</div><div class=\"diagram-node\">A2A-Anfragen</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">Orchestrator</span><small class=\"diagram-muted\">zentraler Eingang · Triage · Routing</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">Mail-Agent</div><div class=\"diagram-node\">Analytics-Agent</div><div class=\"diagram-node\">Brain · Slides &hellip;</div></div></div><div class=\"diagram-shared\"><span class=\"diagram-pill\">Secret-Tresor</span><span class=\"diagram-pill\">Workspace-Ressourcen</span><span class=\"diagram-pill warn\">Approvals</span><span class=\"diagram-pill\">Geplante Jobs</span></div>",
  "css": ".diagram-dispatch{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-dispatch .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-dispatch .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-dispatch .diagram-arrow{font-size:20px;line-height:1}.diagram-shared{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}"
}
```

## Was es tut {#what-it-does}

- **Zentraler Posteingang.** Slack-DMs, Telegram-Nachrichten, E-Mail-Benachrichtigungen, A2A Anfragen von anderen Agenten – alles landet an einem Ort. Der Dispatch-Agent führt eine Triage durch und erledigt sie entweder selbst oder delegiert sie. Unter [Messaging](/docs/messaging) erfahren Sie, wie Sie Slack, E-Mail und Telegram in Ihren Arbeitsbereich integrieren.
- **Orchestrator, kein Spezialist.** Dispatch versucht _nicht_, die E-Mail-App oder die Analyse-App zu sein. Wenn jemand fragt: „Anmeldungen der letzten Woche zusammenfassen“, ruft Dispatch den Analyseagenten über A2A an und gibt die Antwort zurück. Wenn jemand fragt: „Entwerfen Sie eine Antwort an Alice“, ruft Dispatch den E-Mail-Agenten an.
- **Steuerungsebenen-Shell.** Chats, Projekte, Ausführungen, Workspace-Apps, Agenten und Automatisierungen leben in einer einzigen operativen Shell, mit Status-First-Listen und Drilldowns anstelle von einmaligen Dashboards.
- **Secrets Vault.** Ein zentraler Speicher für API-Schlüssel, OAuth-Tokens und gemeinsame Anmeldeinformationen. Apps im Arbeitsbereich lösen Geheimnisse aus Dispatch auf, anstatt sie in jedem `.env` zu duplizieren. Anfragen + Genehmigungen für vertraulichen Zugriff.
- **Workspace-Ressourcen.** Globale skills, Leitplankenanweisungen, benutzerdefinierte Agentenprofile, Referenzressourcen und HTTP MCP-Server können einmal in Dispatch erstellt werden. Alle App-Ressourcen werden zur Laufzeit von jeder App geerbt, ohne dass ein Kopieren oder ein manueller Synchronisierungsschritt erforderlich ist. Ausgewählte Zuschüsse gelten für App-spezifische Ausnahmen.
- **Wiederverwendbare Integrationen.** Ein Ort zum Verbinden von Anbieterkonten und zum Verfolgen
  Anmeldeinformationsreferenzen und gewähren Sie Apps Zugriff. Dispatch besitzt die Anbieteridentität und
  App-Zuschüsse; Domänen-Apps verfügen weiterhin über app-spezifische Quelloptionen wie die von Brain
  Slack Kanal-Zulassungsliste oder Analytics-Metrik-/Dashboard-Konfiguration.
- **Hub für geplante Jobs.** App-übergreifend [recurring jobs](/docs/recurring-jobs) hier live: „Jeden Wochentag um 7 Uhr die wichtigsten Kennzahlen von gestern aus der Analyse abrufen und morgens eine zusammenfassende E-Mail verfassen.“
- **Dreams.** Dispatch kann aktuelle Agentenläufe, Fehler, Rückmeldungen und Erfolgsmuster überprüfen, um Verbesserungen in Bezug auf Gedächtnis, Fähigkeiten, Arbeit und Anweisungen vorzuschlagen, bevor etwas Dauerhaftes angewendet wird.
- **Genehmigungsfluss.** Zerstörerische oder externe actions (Geld senden, eine ausgehende E-Mail versenden, in großem Umfang an Slack posten) können ein Administrator-OK erfordern, bevor sie ausgelöst werden. Dispatch ist Eigentümer der Warteschlange.

## Wann sollte es verwendet werden? {#when-to-use}

Verwenden Sie Dispatch, wenn:

- Sie haben **zwei oder mehr** agentennative Apps in einem Arbeitsbereich und möchten, dass sie an einem Ort koordiniert werden.
- Sie benötigen **zentralisierte Geheimnisse** mit Gewährung pro App und einem Audit-Trail.
- Sie möchten einen **Messaging-Hub**, der Slack oder Telegram an den richtigen Domain-Agenten weiterleitet.
- Sie möchten **geplante Jobs**, die Daten aus mehreren Apps abrufen.

Überspringen Sie es für ein Einzel-App-Gerüst – verwenden Sie direkt [Chat template](/docs/template-chat) oder eine der Domänenvorlagen.

Live-Demo: [dispatch.agent-native.com](https://dispatch.agent-native.com).

## Was Sie damit machen werden {#what-youll-do}

Tag für Tag ist Dispatch der Ort, an dem Administratoren und Betriebsmitarbeiter offen sind, um den Arbeitsbereich am Laufen zu halten:

- **Verbinden Sie Slack, E-Mail und Telegram**, damit die Leute Ihrem Agenten von jedem Ort aus, an dem sie bereits arbeiten, Nachrichten senden können. Die Verdrahtungsschritte finden Sie unter [Messaging](/docs/messaging).
- **Speichern Sie gemeinsame Geheimnisse einmal.** API-Schlüssel, OAuth-Tokens und Dienstanmeldeinformationen befinden sich im Tresor und die anderen Apps in Ihrem Arbeitsbereich ziehen von dort, anstatt dass jedes Teammitglied mit seinem eigenen `.env` jonglieren muss.
- **Anbieter einmalig verbinden.** Wiederverwendbare Integrationen speichern sichere Kontometadaten
  und Anmeldeinformationsreferenzen und gewähren Sie dann Apps wie Brain, Analytics, Mail oder
  Verteilen Sie den Zugriff, ohne rohe Geheimnisse zu kopieren. App-spezifische Quelle
  Konfiguration bleibt in der App, die den Anbieter verwendet.
- **Einen MCP-Anschluss freilegen.** Hinzufügen
  `https://dispatch.agent-native.com/_agent-native/mcp` in Claude, ChatGPT,
  Codex, Cursor oder ein anderer MCP-Host und wählen Sie dann aus, welche Workspace-Apps verwendet werden sollen
  -Connector kann über die **Agents**-Seite von Dispatch erreicht werden. Verwenden Sie eine direkte App URL
  nur wenn dieser Host auf eine App isoliert werden soll.
- **Automatisierungen verwalten.** Die Ansicht „Automatisierungen“ zeigt den aktivierten Status und die letzte Ausführung an.
  nächster Lauf und letzter Fehler aus den zugrunde liegenden `jobs/*.md`-Zeitplänen und Lets
  Sie aktivieren oder deaktivieren einen Job, ohne Dateien manuell bearbeiten zu müssen.
- **Halten Sie den Unternehmenskontext global.** Fügen Sie Personas, Positionierung, Nachrichten, Unternehmensfakten, Markenrichtlinien und Leitplanken einmal in Dispatch Resources ein und zeigen Sie dann eine Vorschau des effektiven Arbeitsbereichs -> App/Organisation -> persönlichen Stapels für jede App/jeden Benutzer an oder überprüfen Sie den Stapel aus der Kontextansicht einer App-Karte.
- **Richten Sie wiederkehrende Jobs ein.** „Fragen Sie jeden Montag um 7 Uhr den Analyseagenten nach den Anmeldungen der letzten Woche und senden Sie mir eine Zusammenfassung per E-Mail.“ Siehe [Recurring Jobs](/docs/recurring-jobs).
- **Traumvorschläge überprüfen.** Dispatch Dreams prüft frühere Agentenläufe und erstellt quellengestützte Vorschläge dafür, was sich der Arbeitsbereich merken sollte, welche veralteten Notizen bereinigt werden sollten und welche wiederholten Lektionen zu skills oder Jobs werden sollten.
- **Genehmigen Sie ausgehende actions, bevor sie ausgelöst werden.** Das Senden von Geld, das Versenden von Massen-E-Mails an Kunden oder das Posten in einem öffentlichen Slack-Kanal kann hinter einem Administrator-OK geschützt werden.
- **Sehen Sie, wer Zugriff auf was hat.** Gewährungen pro App, Anforderungswarteschlange und ein Prüfprotokoll darüber, wer wann welches Geheimnis verwendet hat.
- **Nachrichten an den richtigen Spezialisten weiterleiten.** Eine Slack-DM über Analysen geht an den Analyseagenten; Eine über E-Mail geht an den Postagenten – Versandauswahl.

## Architektur auf einen Blick {#architecture}

_Wie es unter der Haube funktioniert (für Entwickler)._

- **Orchestrator-Agent.** Der Chat ist als Router eingerichtet: Er liest `AGENTS.md`, `LEARNINGS.md` und leitet an spezialisierte Unteragenten oder entfernte A2A-Agenten weiter.
- **Remote-Agent-Registrierung.** A2A-Agent-Manifeste sind Workspace-Runtime-Einträge (kein eingecheckter Vorlagenquellordner): In einem Multi-App-Arbeitsbereich werden gleichgeordnete Apps unter `apps/` automatisch als A2A-Peers erkannt – eine manuelle Registrierung ist nicht erforderlich. Dispatch ruft sie mit der Aktion `call-agent` auf.
- **Vault-Schema.** Drizzle-Tabellen für Geheimnisse, Gewährungen, Anforderungen, Genehmigungen und Prüfprotokolle. Diese befinden sich im `@agent-native/dispatch`-Paket (`packages/dispatch/src/db/schema.ts`) und werden über `templates/dispatch/server/db/index.ts` erneut in die Vorlage exportiert – es gibt kein template-lokales `server/db/schema.ts`. Die Dispatch-Laufzeit wird im Paket und nicht in der Vorlagenquelle geliefert (im Einklang mit dem Hinweis unten, dass `@agent-native/dispatch` Eigentümer der Shell, der Seitenleiste und der integrierten Seiten ist).
- **Slack / Telegram-Plugins.** Server-Plugins, die webhooks registrieren und eingehende Nachrichten an den Orchestrator-Agenten weiterleiten.
- **Workspace MCP-Ressourcen.** Fügen Sie HTTP MCP-Serverdefinitionen unter `mcp-servers/*.json` in „Ressourcen“ hinzu und beschränken Sie sie dann auf „Alle Apps“ oder „Ausgewählte App-Zuweisungen“, genau wie „skills“ und „Kontext“.

```an-schema title="Secrets-Tresorschema" summary="Secrets are stored once; grants give a named app access; requests + reviews gate sensitive access; the audit log records who used which secret when. Defined in @agent-native/dispatch (packages/dispatch/src/db/schema.ts)."
{
  "entities": [
    { "id": "secrets", "name": "vault_secrets", "note": "Gespeicherte Anmeldedatenwerte", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "owner_email", "type": "text" },
      { "name": "org_id", "type": "text", "nullable": true },
      { "name": "name", "type": "text" },
      { "name": "credential_key", "type": "text" },
      { "name": "value", "type": "text", "note": "secret value" },
      { "name": "provider", "type": "text", "nullable": true }
    ] },
    { "id": "grants", "name": "vault_grants", "note": "Zugriffsgewährung pro App", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "secret_id", "type": "text", "fk": "vault_secrets.id" },
      { "name": "app_id", "type": "text" },
      { "name": "granted_by", "type": "text" },
      { "name": "status", "type": "text" }
    ] },
    { "id": "requests", "name": "vault_requests", "note": "Zugriffsanfrage + Überprüfung", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "credential_key", "type": "text" },
      { "name": "app_id", "type": "text" },
      { "name": "reason", "type": "text", "nullable": true },
      { "name": "status", "type": "text" },
      { "name": "reviewed_by", "type": "text", "nullable": true }
    ] },
    { "id": "audit", "name": "vault_audit_log", "note": "Wer hat welches Geheimnis wann genutzt?", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "secret_id", "type": "text", "fk": "vault_secrets.id", "nullable": true },
      { "name": "app_id", "type": "text", "nullable": true },
      { "name": "action", "type": "text" },
      { "name": "actor", "type": "text" }
    ] }
  ],
  "relations": [
    { "from": "secrets", "to": "grants", "kind": "1-n", "label": "granted via" },
    { "from": "secrets", "to": "audit", "kind": "1-n", "label": "use recorded by" }
  ]
}
```

- **MCP-Hub-Modus.** Dispatch kann weiterhin als [MCP hub](/docs/mcp-clients#hub) des Arbeitsbereichs fungieren, sodass jede andere App im Arbeitsbereich dieselbe MCP-Serverliste im Organisationsbereich abruft. Unabhängig davon ist der `/_agent-native/mcp`-Endpunkt von Dispatch der empfohlene externe MCP-Anschluss für Claude, ChatGPT und andere Hosts, die mehrere Workspace-Apps erreichen sollen.

## Träume {#dreams}

Träume sind die Überprüfungsschleife von Dispatch für das Agentengedächtnis. Ein Dream Pass untersucht vorhandene Agentenläufe, Thread-Debug-Daten, Feedback, Auswertungen und wiederholte Toolfehler und schreibt dann einen Bericht mit vorgeschlagenen Änderungen. Die Vorschläge können auf persönliches Gedächtnis, freigegebenes `LEARNINGS.md`, Arbeitsbereichsanweisungen, Arbeitsbereich skills, Arbeitsbereichswissen, Arbeitsbereichsagenten oder wiederkehrende Jobs abzielen, aber gemeinsame Änderungen und Änderungen auf Arbeitsbereichsebene bleiben überprüfbar und werden nicht stillschweigend angewendet.

Traumvorschläge werden vor dem Speichern mit dem persönlichen Speicherindex, vorhandenen `memory/*.md`-Dateien und freigegebenen `LEARNINGS.md` überprüft. Doppelte Lektionen werden im Bericht übersprungen, während möglicherweise veraltete persönliche Erinnerungen an Ort und Stelle aktualisiert werden, anstatt parallele Notizen zu erstellen. Innerhalb eines Berichts dedupliziert Dreams außerdem wiederholte Beweise nach Thread, Signaltyp und normalisiertem Zitat, entzieht eingefügten Kontext der Benutzerkorrekturerkennung und fasst rohe Bewertungs-/Toolzeilen in für Menschen lesbaren Aufzählungszeichen zusammen, bevor sie im Vorschlagstext erscheinen. Wenn ein Pass Signale findet, aber absichtlich keine Vorschläge erstellt, enthält der Bericht Leitplankenhinweise, in denen erläutert wird, welche Beweise unterdrückt wurden.

Wenn die Dispatch-Genehmigungsrichtlinie aktiviert ist, wird beim Anwenden eines gemeinsamen oder teamweiten Traumvorschlags eine ausstehende Genehmigungsanfrage erstellt, anstatt sofort zu schreiben. Durch das Erstellen, Aktualisieren oder Löschen einer All-App-Workspace-Ressource wird ebenfalls eine Genehmigungsanfrage in die Warteschlange gestellt. Persönliche Erinnerungsvorschläge und nur ausgewählte Ressourcenbearbeitungen können weiterhin direkt nach der Überprüfung angewendet werden.

Verwenden Sie Dreams, wenn Sie Fragen beantworten möchten wie „Was haben Agenten diese Woche immer wieder falsch gemacht?“, „Woran sollten wir uns erinnern?“ oder „Welche wiederholte Lektion verdient eine Fertigkeit?“ Eingehende Slack-, E-Mail-, Telegram-, WhatsApp- und aus dem Internet abgeleitete Beweise werden als nicht vertrauenswürdige Eingaben behandelt. Daher müssen Vorschläge aus diesen Quellen überprüft und überprüft werden, bevor sie sich auf den gemeinsamen Speicher auswirken. Vorschläge für Arbeitsbereichsanweisungen erfordern dauerhafte Beweise, die sich über mindestens zwei Threads oder zwei Quell-Apps erstrecken; Nur-Bewertungsstörungen, Probleme bei der Kontoeinrichtung, Kontingentbeschränkungen und UI-Textkorrekturen für einzelne Apps bleiben in allgemeinen Anweisungen außen vor.

### Dream-Eingabevalidierungsgrenzen

Da Beweise aus externen, nicht vertrauenswürdigen Quellen gesammelt werden (z. B. Chat-Transkripte, webhooks und Integrationen von Drittanbietern), erzwingt der Dream-Prozessor strenge Eingabevalidierungsgrenzen, um Prompt-Injection- und Payload-Size-Angriffe zu verhindern:

- **Byte-Größenbeschränkungen:** Einzelne Thread-Nutzlasten sind auf maximal 10 KB Textinhalt pro Nachricht begrenzt, und Kandidatenscans werden abgeschnitten, wenn sie insgesamt 100 KB überschreiten, um eine Kontexterschöpfung zu verhindern.
- **Bereinigung:** Alle Texteingaben werden bereinigt, um Steuerzeichen, binäre Nutzdaten und nicht druckbare Unicode-Bereiche zu entfernen.
- **Schemavalidierung:** Eingehende Debugdaten und Thread-Verlauf werden anhand strenger Zod-Schemas analysiert, bevor sie in LLM-Eingabeaufforderungen kompiliert werden. Jede Kandidatenstruktur, die die Schemavalidierung nicht besteht, wird sofort aus dem Verarbeitungsstapel verworfen.
- **Escaping:** Alle vom Benutzer bereitgestellten Textblöcke werden dynamisch maskiert, wenn sie in die Eingabeaufforderungsvorlagen formatiert werden, um Eingabeaufforderungsinjektionen zu verhindern (z. B. den Versuch, die Dream-Schleife zu kapern, um beliebige Anweisungen zu schreiben).

Öffnen Sie im Dispatch UI **Dreams**, um einen manuellen Durchgang durchzuführen, Kandidatenthreads zu überprüfen, den Bericht zu prüfen und das Überprüfungsblatt jedes Vorschlags zu öffnen, bevor Sie ihn anwenden oder ablehnen. Verwenden Sie **Einstellungen**, um den wiederkehrenden Cron-Zeitplan, den Quellbereich, die Zeitüberschreitungs-/Gleichzeitigkeitsgrenzen, die Kandidatengrenze und den Mindestkandidatenschwellenwert zu bearbeiten. Verwenden Sie **Zeitplan sicherstellen** nach dem Speichern, wenn der wiederkehrende `jobs/dispatch-dream.md`-Auftrag aus diesen Einstellungen materialisiert werden soll. Das Überprüfungsblatt zeigt das Genehmigungsverhalten, den aktuellen Zielinhalt, den vorgeschlagenen Inhalt und die Quellennachweise. Agenten verwenden denselben Workflow über actions:

- `list-dream-candidates` findet aktuelle Threads mit begründeten Signalen wie explizite Benutzerkorrekturen, fehlgeschlagene Ausführungen, Toolfehler, Feedback, Bewertungsfehler und erfolgreiche Checkpoint-Workflows. Übergeben Sie `sourceId: "all"` oder `sourceIds`, um mehrere Thread-Debug-Quellen zu scannen. `sourceTimeoutMs`, `sourceConcurrency`, `sourceStartStaggerMs`, `threadConcurrency` und `threadTimeoutMs` sorgen für partielle und begrenzte Produktionsscans, und die Antwort umfasst den Zustand pro Quelle.
- `create-dream-report` erstellt den Bericht und ausstehende Vorschläge. Multi-Source-Berichte enthalten einen Abschnitt „Source Health“, sodass Teilscans während der Überprüfung sichtbar sind. Wiederholte Korrekturen und wiederkehrende Fehler können zu Vorschlägen für Arbeitsbereichsressourcen wie `workspace-instruction` werden. Wiederholte erfolgreiche Checkpoint-Workflows können zu `workspace-skill`-Vorschlägen werden.
- `get-dream-settings` und `set-dream-settings` lesen und aktualisieren den wiederkehrenden Traumplan, den Quellbereich, die Zeitüberschreitungs-/Parallelitätskontrollen, das Limit und den Mindestkandidatenschwellenwert.
- `get-dream`-, `preview-dream-proposal`-, `apply-dream-proposal`- und `reject-dream-proposal`-Handle-Überprüfung.
- `ensure-dream-job` erstellt den sicheren wiederkehrenden Traumjob, sobald manuelle Berichte nützlich sind.

Der lokale Aktionsläufer der Dispatch-Vorlage macht auch den gepackten Dispatch actions verfügbar, sodass Sie in der Entwicklung denselben Workflow von `apps/dispatch` aus ausführen können:

```bash
pnpm action get-dream-settings
pnpm action set-dream-settings --enabled true --schedule "0 9 * * 1" --allSources true --limit 8
pnpm action create-dream-report --allSources true --sourceTimeoutMs 30000 --limit 8
```

## Gerüst {#scaffolding}

```bash
npx @agent-native/core@latest create my-platform
# Wählen Sie „Dispatch“ in der Mehrfachauswahlauswahl sowie die gewünschten Domain-Apps aus
```

Wenn Sie die Vorlage lieber direkt benennen möchten, anstatt die Auswahl zu verwenden:

```bash
npx @agent-native/core@latest create my-platform --template dispatch
# add more apps in the same workspace as you go
```

Dispatch ist normalerweise zusammen mit den von ihm koordinierten Apps in einen Arbeitsbereich integriert. Für einen Arbeitsbereich werden die gemeinsame Authentifizierung, Datenbank und Marke von Dispatch vom Arbeitsbereichskern geerbt – siehe [Multi-App Workspace](/docs/multi-app-workspace).

Es gibt keinen sinnvollen `--standalone`-Versand: Eine Kontrollebene, die nichts zu koordinieren hat, ist nur ein leerer Posteingang. Integrieren Sie es in einen Arbeitsbereich mit mindestens einer Domänen-App, damit es über Agents verfügt, an die es über A2A weiterleiten kann. (Das Flag funktioniert weiterhin und erzeugt eine ausführbare App, aber der Orchestrator hat keine Spezialisten, an die er delegieren kann, bis Sie Geschwister-Apps hinzufügen.)

## Erster lokaler Lauf {#first-local-run}

Aus dem Arbeitsbereichsstamm:

```bash
pnpm install
pnpm dev
```

Öffnen Sie den vom Entwicklungsserver gedruckten Dispatch URL. Die lokale Entwicklung verwendet denselben Better Auth-Anmeldeablauf wie die Produktion. Erstellen Sie ein lokales Konto mit E-Mail + Passwort; Die E-Mail-Verifizierung wird in der Entwicklung übersprungen und das Passwort wird nur in Ihrer lokalen App-Datenbank gespeichert. Im Standardgerüst wird keine Authentifizierungsumgehung unterstützt, da der Agent, die Arbeitsbereichsressourcen, der Tresor und das Freigabemodell alle auf einer echten Benutzersitzung basieren.

Sie können nach der Anmeldung durch den Dispatch UI klicken. Um den Chat-Verfassenr zu verwenden oder Agentenaufgaben auszuführen, verbinden Sie zunächst einen LLM-Anbieter:

1. Öffnen Sie **Einstellungen**.
2. In **LLM** verbinden Sie entweder Builder.io oder fügen Sie Ihren eigenen Anbieterschlüssel hinzu, z. B. `ANTHROPIC_API_KEY`.
3. Kehren Sie zur **Übersicht** zurück und probieren Sie den Verfassenr aus.

## Anpassen {#customize}

Dispatch ist eine vollständige Vorlage wie jede andere – siehe [Templates](/docs/cloneable-saas). Bitten Sie den Agenten, „eine neue Integration für Datadog hinzuzufügen“ oder „Slack-DMs von Kanal

Für arbeitsplatzspezifische Verwaltungsbildschirme fügen Sie lokale React Router-Seiten und hinzu
registrieren Sie sie in `app/dispatch-extensions.tsx`. Der generierte Arbeitsbereich besitzt
nur die zusätzliche Registerkarte und Route; `@agent-native/dispatch` bleibt Eigentümer der Shell
Seitenleiste, integrierte Seiten und zukünftige Paketaktualisierungen.

## Was kommt als nächstes?

- [**Messaging**](/docs/messaging) – verbindet Slack, E-Mail und Telegram, sodass Sie von überall aus mit Ihrem Agenten sprechen können
- [**Multi-App Workspace**](/docs/multi-app-workspace) – Dispatch neben mehreren Apps ausführen
- [**A2A Protocol**](/docs/a2a-protocol) – wie Dispatch an spezialisierte Agenten delegiert
- [**MCP Clients — Hub Mode**](/docs/mcp-clients#hub) – gemeinsame Nutzung von MCP-Servern im gesamten Arbeitsbereich
- [**Recurring Jobs**](/docs/recurring-jobs) – geplante Aufgaben-Dispatch-Ausführungen
