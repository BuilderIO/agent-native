---
title: "Nachrichten"
description: "Sprechen Sie mit Ihrem Agenten über Slack, E-Mail, Telegram oder WhatsApp – derselbe Agent, derselbe Speicher, die gleichen Tools."
---

# Nachrichten

Verbinden Sie Ihren Agenten mit Slack, E-Mail, Telegram oder WhatsApp, damit Sie über die Apps, die Sie bereits verwenden, mit ihm chatten können. Es ist derselbe Agent – derselbe Speicher, die gleichen Tools, die gleichen Threads – nur von mehr Orten aus erreichbar.

> **Verwenden Sie die Dispatch-Vorlage?** All dies ist für Sie unter **Einstellungen → Nachrichten** eingerichtet. Klicken Sie, um jede Plattform zu verbinden – Sie müssen den Rest dieser Seite nicht lesen, es sei denn, Sie passen Ihre eigene Vorlage an oder erstellen sie. Siehe [Dispatch](/docs/dispatch) oder [Dispatch template reference](/docs/template-dispatch).

## Was Sie tun können {#what-you-can-do}

- \*\*Schicken Sie Ihrem Agenten eine E-Mail an eine Adresse wie `agent@yourcompany.com` – er antwortet im Thread, genau wie ein Kollege.
- **Kontaktieren Sie Ihren Agenten** in einem Thread – er liest mit und springt ein, wenn Sie danach fragen.
- **DM dem Agenten auf Slack** oder `@mention` ihm in einem beliebigen Kanal.
- **Schreiben Sie dem Agenten von Ihrem Telefon aus eine Nachricht per Telegram oder WhatsApp**.
- **Gleicher Agent, gleicher Speicher.** Was auch immer Sie auf Slack sagen, wird gespeichert, wenn Sie es später per E-Mail versenden. Der Web-Chat und externe Nachrichten teilen sich den gleichen Thread-Verlauf.
- Einseitige In-App-Benachrichtigungen (Glockensymbol, webhooks) finden Sie unter [Notifications](/docs/notifications).

```an-diagram title="Viele Kanäle, ein Agent" summary="Jede Plattform fächert sich in die gleiche Agentenschleife und den gleichen SQL-Thread-Verlauf auf – sodass eine Slack-DM und eine E-Mail dieselbe Konversation fortsetzen."
{
  "html": "<div class=\"msg-fanin\"><div class=\"diagram-col\"><div class=\"diagram-node\">Slack</div><div class=\"diagram-node\">Email</div><div class=\"diagram-node\">Telegram</div><div class=\"diagram-node\">WhatsApp</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Eine Agentenschleife</span><small class=\"diagram-muted\">gleicher Speicher · gleiche Werkzeuge</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Ein SQL-Thread-Verlauf<br><small class=\"diagram-muted\">web chat + external messages share it</small></div></div>",
  "css": ".msg-fanin{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.msg-fanin .diagram-col{display:flex;flex-direction:column;gap:8px}.msg-fanin .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Slack einrichten {#slack}

### Was Sie brauchen

- Ein Slack-Arbeitsbereich, in dem Sie Apps installieren können (Administratorzugriff)
- Etwa 5 Minuten

### Schritte

1. Gehen Sie zu **[api.slack.com/apps](https://api.slack.com/apps)** und klicken Sie auf **Neue App erstellen** → **Von Grund auf neu**. Benennen Sie es (z. B. „Agent“) und wählen Sie Ihren Arbeitsbereich aus.
2. Öffnen Sie in der linken Seitenleiste **OAuth & Berechtigungen**. Fügen Sie unter **Bot-Token-Bereiche** Folgendes hinzu:
   - `chat:write` – ermöglicht dem Agenten das Senden von Nachrichten
   - `app_mentions:read` – lässt den Agenten sehen, wann es @-erwähnt wird (optional)
   - `im:history` – ermöglicht dem Agenten, an ihn gesendete DMs zu lesen
   - `assistant:write` – optional; Lässt Slack den nativen „Denkt...“-Status in Assistententhreads anzeigen
   - `users:read.email` – optional; hilft Vorlagen wie Mail bei der Überprüfung der Slack-Absender-E-Mail auf die Identität der Entwurfswarteschlange
3. Klicken Sie oben auf dieser Seite auf **In Workspace installieren**. Mit Slack erhalten Sie ein **Bot-Benutzer-OAuth-Token**, das mit `xoxb-` beginnt. Kopieren Sie es.
4. Gehen Sie in der Seitenleiste zu **Grundlegende Informationen** und kopieren Sie das **Signierungsgeheimnis**.
5. Öffnen Sie die Einstellungen Ihrer App (oder das Umgebungsvariablenfeld Ihres Hosting-Anbieters) und fügen Sie Folgendes ein:
   - `SLACK_BOT_TOKEN` – das `xoxb-…`-Token
   - `SLACK_SIGNING_SECRET` – das Signaturgeheimnis
   - `SLACK_ALLOWED_TEAM_IDS` – in der Produktion empfohlen; Durch Kommas getrennte Slack-Arbeitsbereichs-/Team-IDs, die Ereignisse senden dürfen
   - `SLACK_ALLOWED_API_APP_IDS` – empfohlen für Multi-Workspace-Apps; Durch Kommas getrennte Slack-App-IDs, die dieses Signaturgeheimnis verwenden dürfen
6. Zurück in Slack öffnen Sie **Event-Abonnements**, schalten es ein und fügen diese Anfrage URL ein:

   ```Text
   https://your-app.example.com/_agent-native/integrations/slack/webhook
   ```

   Dann fügen Sie unter **Bot-Events abonnieren** `message.im` (für DMs) und optional `app_mention` (für Kanalerwähnungen) hinzu. Speichern.

7. Senden Sie Ihrem Bot eine DM in Slack. Es sollte antworten.

### Optional: App entfaltet sich

Mit der Slack-App kann eine App die normale Linkvorschau von Slack durch eine umfangreichere ersetzen
Vorschau. Clips verwendet dies für abspielbare Videovorschauen im Loom-Stil.

Fügen Sie diese zusätzlichen Bot-Bereiche hinzu, wenn Ihre App erweitert werden muss:

- `links:read` – ermöglicht Slack, die App zu benachrichtigen, wenn registrierte Domains gepostet werden
- `links:write` – ermöglicht es der App, die Standardvorschau von Slack zu ersetzen
- `links.embed:write` – ermöglicht der App das Einbetten genehmigter Medien/Player URLs

Dann abonnieren Sie das `link_shared`-Event und registrieren Sie Ihre öffentlichen App-Domains
unter **App Unfurl Domains**. Für nur abspielbare Vorschauen von Clips legen Sie Slack
Ereignisabonnements anfordern URL an:

```text
https://your-clips.example.com/api/slack/unfurl
```

Eine Slack-App verfügt über eine Ereignis-API-Anfrage URL. Wenn die gleiche Slack-App verarbeiten soll
Sowohl Agenten-Chat-Ereignisse als auch Clips entfalten sich, leiten Slack-Ereignisse über einen kleinen Bereich
Dispatcher, der Nachrichtenereignisse an `/_agent-native/integrations/slack/webhook` sendet
und `link_shared`-Ereignisse an den Clips-Unfurl-Handler.

### Tipps

- **Kanalerwähnungen** – der Bot antwortet in Kanälen nur, wenn er @-erwähnt wird, um Störgeräusche zu vermeiden.
- **DMs** – jede DM wird als private Konversation mit dem Agenten behandelt.
- **Gleiche Identität, alle Kanäle** – wenn ein Slack-Benutzer dieselbe E-Mail-Adresse wie ein registrierter Benutzer in Ihrer App hat, behandelt der Agent ihn als dieselbe Person.
- **Produktionszulassungslisten** – Legen Sie `SLACK_ALLOWED_TEAM_IDS` und für freigegebene Slack-Apps `SLACK_ALLOWED_API_APP_IDS` fest, damit ein gültiges Signaturgeheimnis nicht von einem unerwarteten Arbeitsbereich wiederverwendet werden kann.
- **Clips-App entfaltet sich** – installierbare Agent-Native-Clips für Slack verwenden `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` und `/api/slack/oauth/callback`. Jeder verbundene Slack-Arbeitsbereich erhält seinen eigenen verschlüsselten Bot-Token in `app_secrets`; `SLACK_BOT_TOKEN` ist nur ein Legacy-Fallback für einen einzelnen Arbeitsbereich.

## Telegramm einrichten {#telegram}

### Was Sie brauchen

- Die Telegram-App auf Ihrem Telefon
- Etwa 3 Minuten

### Schritte

1. Telegramm öffnen und **[@BotFather](https://t.me/BotFather)** senden.
2. Senden Sie `/newbot` und folgen Sie den Anweisungen, um Ihrem Bot einen Namen zu geben. BotFather antwortet mit einem **HTTP API-Token**. Kopieren Sie es.
3. Legen Sie in den Umgebungsvariablen Ihrer App Folgendes fest:
   - `TELEGRAM_BOT_TOKEN` – das Token von BotFather
4. Registrieren Sie nach der Bereitstellung den Webhook durch `POST`ing bei Ihrer App unter:

   ```Text
   POST https://your-app.example.com/_agent-native/integrations/telegram/setup
   ```

   Dadurch wird Telegram angewiesen, Nachrichten an den Webhook Ihrer App zu senden. Sie müssen dies nur einmal pro Bereitstellung tun.

5. Suchen Sie Ihren Bot in Telegram (suchen Sie nach dem Benutzernamen, den BotFather Ihnen gegeben hat) und senden Sie ihm eine Nachricht.

## E-Mail einrichten {#email}

E-Mail ist die leistungsstärkste Integration – Ihr Agent erhält eine eigene Adresse, antwortet im Thread, kann bei Gesprächen auf CC gesetzt werden und verwendet die E-Mail-Adresse des Absenders als Identität. Kein `/link`-Befehl erforderlich.

### Was Sie brauchen

- Eine Domain, die Sie kontrollieren (oder Sie können eine kostenlose Resend-Subdomain verwenden – siehe unten)
- Ein Konto mit **Resend** oder **SendGrid** zur Verarbeitung eingehender und ausgehender E-Mails
- Etwa 10 Minuten

### Schritte (mit „Erneut senden“ – am einfachsten)

1. Melden Sie sich unter **[resend.com](https://resend.com)** an. Die kostenlose Stufe reicht für den Einstieg aus.
2. Wählen Sie aus, wie die E-Mail-Adresse des Agenten aussehen soll:
   - **Am einfachsten:** Verwenden Sie eine freie `<your-slug>.resend.app`-Adresse – kein DNS erforderlich.
   - **Branded:** Fügen Sie auf der Seite **Domains** von Resend eine benutzerdefinierte Domain (z. B. `yourcompany.com`) hinzu und befolgen Sie die DNS-Schritte.
3. Öffnen Sie unter „Erneut senden“ **Webhooks** → **Endpunkt hinzufügen** und zeigen Sie auf:

   ```Text
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

   Abonnieren Sie das Ereignis **`email.received`**. Durch erneutes Senden erhalten Sie ein Signaturgeheimnis – kopieren Sie es.

4. Legen Sie in den Umgebungsvariablen Ihrer App Folgendes fest:
   - `EMAIL_AGENT_ADDRESS` – die Adresse, unter der der Agent E-Mails empfängt (z. B. `agent@yourcompany.com`)
   - `RESEND_API_KEY` – Ihr Schlüssel zum erneuten Senden von API
   - `EMAIL_INBOUND_WEBHOOK_SECRET` – das Signaturgeheimnis von Resend (empfohlen; wird zur Signaturüberprüfung verwendet)

5. Senden Sie eine E-Mail an die Adresse des Agenten. Es wird im selben Thread geantwortet.

### Schritte (mit SendGrid)

1. Melden Sie sich unter **[sendgrid.com](https://sendgrid.com)** an.
2. Fügen Sie den MX-Eintrag für Ihre Domain hinzu, damit eingehende E-Mails an SendGrid fließen:
   ```Text
   MX yourcompany.com → mx.sendgrid.net (Priorität 10)
   ```
3. Öffnen Sie **Einstellungen → Eingehende Analyse**, klicken Sie auf **Host & URL hinzufügen** und legen Sie das Ziel fest auf:

   ```Text
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

4. Umgebungsvariablen festlegen:
   - `EMAIL_AGENT_ADDRESS` – die Adresse, unter der der Agent erhält
   - `SENDGRID_API_KEY` – Ihr SendGrid API-Schlüssel
   - `EMAIL_INBOUND_WEBHOOK_SECRET` – optionales Svix-Signaturgeheimnis, wenn Sie signiertes webhooks konfiguriert haben

5. Senden Sie eine E-Mail an die Adresse des Agenten.

### Tipps

- **CC den Agenten**, um ihn in einen Thread zu bringen. Wenn der Agent auf CC gesetzt wird, antwortet er allen, sodass der gesamte Thread die Antwort sieht.
- **Threading funktioniert einfach** – der Agent verwendet standardmäßige `Message-ID`-/`In-Reply-To`-/`References`-Header, sodass Antworten in jedem E-Mail-Client im richtigen Thread bleiben.
- **Identität ist die E-Mail-Adresse des Absenders.** Wenn `alice@acme.com` dem Agenten eine E-Mail sendet, ist das ihre Identität – kein Link oder Anmeldevorgang.
- **Rich-Antworten** – Markdown in der Antwort des Agenten wird in der E-Mail als HTML gerendert.
- **Zulässige Domänen** – beschränken Sie, wer dem Agenten E-Mails senden kann, indem Sie `allowedDomains` in der Konfiguration der Integration festlegen; Nachrichten von anderen Domänen werden verworfen.
- **Ratenlimit** – 20 eingehende Nachrichten pro Stunde und Absender.

## WhatsApp einrichten {#whatsapp}

### Was Sie brauchen

- Ein Meta-Entwicklerkonto (Facebook)
- Eine Telefonnummer, die Sie dem Bot zuweisen können
- Ungefähr 15 Minuten (Metas Setup umfasst die meisten Schritte)

### Schritte

1. Gehen Sie zu **[Meta Developer Portal](https://developers.facebook.com/)**, klicken Sie auf **App erstellen** und wählen Sie den Typ **Unternehmen** aus.
2. Fügen Sie das **WhatsApp**-Produkt zu Ihrer App hinzu und konfigurieren Sie eine Telefonnummer, die als Absender verwendet werden soll.
3. Greifen Sie auf der WhatsApp-Setup-Seite nach:
   - **Zugriffstoken** (das temporäre Token eignet sich gut zum Testen; generieren Sie ein permanentes Token, bevor Sie es in Betrieb nehmen)
   - **Telefonnummern-ID**
4. Wählen Sie eine beliebige zufällige Zeichenfolge aus, die als Verifizierungstoken verwendet werden soll. Geben Sie unten an zwei Stellen denselben Wert ein.
5. Legen Sie in den Umgebungsvariablen Ihrer App Folgendes fest:
   - `WHATSAPP_ACCESS_TOKEN` – Ihr Zugriffstoken
   - `WHATSAPP_PHONE_NUMBER_ID` – die Telefonnummer-ID
   - `WHATSAPP_VERIFY_TOKEN` – die zufällige Zeichenfolge, die Sie ausgewählt haben
6. Zurück in der WhatsApp-Konfiguration von Meta öffnen Sie den Webhook-Bereich und legen Folgendes fest:

   ```Text
   Rückruf URL: https://your-app.example.com/_agent-native/integrations/whatsapp/webhook
   Token überprüfen: die gleiche Zufallszeichenfolge, die Sie als WHATSAPP_VERIFY_TOKEN festgelegt haben
   ```

   Abonnieren Sie das Feld `messages`.

7. Senden Sie eine WhatsApp-Nachricht an die Telefonnummer des Bots.

## Verwenden Sie Dispatch als zentralen Posteingang Ihres Agenten {#dispatch}

Wenn Sie mehrere agentennative Apps (Mail, Kalender, Analysen usw.) ausführen, besteht das empfohlene Muster darin, Messaging auf **[Dispatch](/docs/dispatch)** einzurichten (siehe auch [template reference](/docs/template-dispatch)) und die Arbeit über [A2A](/docs/a2a-protocol) an Ihre Domänen-Apps weiterleiten zu lassen.

Warum das schön ist:

- **Ein Agent, ein Posteingang.** Alle Ihre Kanäle (Slack, E-Mail, Telegram, WhatsApp) fließen in Dispatch ein. Sie richten Integrationen nur einmal ein.
- **Dispatch-Delegierte.** Fragen Sie „Anmeldungen der letzten Woche zusammenfassen“ – Dispatch ruft den Analyseagenten an. Fragen Sie „Antwort an Alice verfassen“ – Dispatch ruft den E-Mail-Agenten an.
- **Klicks, nicht config.** Die Dispatch-Seite **Einstellungen → Nachrichten** verfügt über Verbindungsschaltflächen für jede Plattform mit integrierten env-var-Feldern.

Wenn Sie keinen Orchestrator benötigen, kann jede einzelne Vorlage Messaging direkt mithilfe der Umgebungsvariablen auf dieser Seite verknüpfen.

---

## Für Entwickler {#for-developers}

Alles unten ist die technische Referenz. Wenn Sie die oben genannten Einrichtungsschritte abgeschlossen haben, können Sie hier aufhören, es sei denn, Sie passen das Integrations-Plugin an oder erstellen Ihren eigenen Adapter.

### Wie es funktioniert {#how-it-works}

Die eingehende Plattform webhooks verwendet ein plattformübergreifendes SQL-Warteschlangenmuster, sodass sie auf jedem serverlosen Host (Netlify, Vercel, Cloudflare Workers, Fly, Render, Node) funktioniert, ohne auf plattformspezifische APIs für die Hintergrundausführung angewiesen zu sein.

1. Die Plattform `POST`s bis `/_agent-native/integrations/<platform>/webhook`. Der Handler überprüft die Signatur, analysiert die Nutzlast in einen `IncomingMessage` und **fügt mit `status='pending'` eine Zeile in `integration_pending_tasks` ein**.
2. Der Handler feuert einen Fire-and-Forget-`POST /_agent-native/integrations/process-task` ab und gibt sofort `200` zurück, deutlich innerhalb von Slacks 3-Sekunden-SLA.
3. Der Prozessorendpunkt wird in einer **frischen Funktionsausführung** mit seinem eigenen vollen Timeout-Budget ausgeführt. Es beansprucht die Aufgabe atomar (`pending` → `processing` über `claimPendingTask`), führt die Agentenschleife aus, sendet die Antwort über den Adapter und markiert die Aufgabe `completed`.
4. Ein wiederkehrender Wiederholungsjob (`startPendingTasksRetryJob`, alle 60 Sek.) entfernt Aufgaben, die in `pending` >90 Sek. oder `processing` >5 Min. feststecken, und startet den Prozessor erneut. Auf 3 Versuche begrenzt, dann mit `failed` markiert.

```an-diagram title="Lebenszyklus des eingehenden Webhooks" summary="Der Webhook überprüft nur 200, stellt ihn in die Warteschlange und gibt ihn zurück. Eine neue Funktionsausführung entleert die Warteschlange und führt die Agentenschleife aus, mit einem 60-sekündigen Wiederholungsjob als Sicherheitsnetz."
{
  "html": "<div class=\"msg-flow\"><div class=\"msg-row\"><div class=\"diagram-node\">Platform<br><small class=\"diagram-muted\">Slack · E-Mail · usw.</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/webhook</strong><br><small class=\"diagram-muted\">verify signature + parse</small><br><span class=\"diagram-pill\">INSERT ausstehende Aufgabe</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">return 200</div></div><div class=\"msg-fire\"><span class=\"diagram-muted\">fire-and-forget</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</span></div><div class=\"msg-row\"><div class=\"diagram-box\" data-rough><strong>/process-task</strong><br><small class=\"diagram-muted\">frische Ausführung · eigenes Timeout</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">claim</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">agent loop</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">adapter.sendResponse</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">completed</div></div><div class=\"diagram-panel msg-retry\" data-rough><span class=\"diagram-pill warn\">every 60s</span> <span class=\"diagram-muted\">retry job sweeps stuck tasks (pending &gt;90s · processing &gt;5min) and re-fires /process-task &mdash; capped at 3 attempts, then <strong>failed</strong></span></div></div>",
  "css": ".msg-flow{display:flex;flex-direction:column;gap:12px}.msg-flow .msg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.msg-flow .msg-fire{display:flex;align-items:center;gap:8px;padding-inline-start:12px}.msg-flow .msg-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

Eingehende und ausgehende Konversationen laufen im selben SQL-Thread, sodass Sie eine Slack-DM aus dem Web UI fortsetzen können oder umgekehrt.

```an-api
{
  "method": "POST",
  "path": "/_agent-native/integrations/slack/webhook",
  "summary": "Slack Ereignisse API eingehender Webhook",
  "description": "Receives Slack events (DMs and channel `app_mention`s). Verifies the request signature, parses the payload into an `IncomingMessage`, inserts a `pending` row into `integration_pending_tasks`, fires the fresh-execution processor, and returns **200 immediately** — well inside Slack's 3-second SLA. The same route shape exists per platform under `/_agent-native/integrations/<platform>/webhook`.",
  "auth": "HMAC-SHA256 of the raw body using `SLACK_SIGNING_SECRET`, checked against the `X-Slack-Signature` header. In production also gated by `SLACK_ALLOWED_TEAM_IDS` / `SLACK_ALLOWED_API_APP_IDS`.",
  "params": [
    { "name": "X-Slack-Signature", "in": "header", "type": "string", "required": true, "description": "Slack request signature, verified before any processing." },
    { "name": "X-Slack-Request-Timestamp", "in": "header", "type": "string", "required": true, "description": "Timestamp used in the signature base string." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"type\": \"event_callback\",\n  \"team_id\": \"T0123\",\n  \"api_app_id\": \"A0123\",\n  \"event\": {\n    \"type\": \"message\",\n    \"channel_type\": \"im\",\n    \"user\": \"U0123\",\n    \"text\": \"summarize last week's signups\"\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "Acknowledged immediately. The agent loop runs in the separate /process-task execution. The first time a Request URL is saved, Slack POSTs a `url_verification` challenge and the adapter replies with the `challenge` value automatically.", "example": "{ \"ok\": true }" },
    { "status": "401", "description": "Signature verification failed, or the team/app id is not in the production allowlist." }
  ]
}
```

#### Warum dieses Muster (und nicht die plattformeigenen Verknüpfungen) {#why-this-pattern}

Serverlose Funktionen frieren ein, sobald die Antwort gesendet wird. Alles, was noch läuft – einschließlich eines Fire-and-Forget-Promise, eines verzögerten LLM-Aufrufs oder eines laufenden Tools – wird während der Ausführung beendet. Die einzige Möglichkeit, eine Agentenschleife am Leben zu erhalten, besteht darin, eine **neue** Funktionsausführung dafür zu starten, was der selbstauslösende `/process-task` POST tut.

Verwendet NOT eine dieser Alternativen:

- **Netlify-Hintergrundfunktionen** – Nur Netlify, erfordert ein `-background.ts`-Dateinamenssuffix, funktioniert auf jedem anderen Host.
- **Cloudflare `event.waitUntil()`** – Nur CF-Worker, nicht portierbar.
- **Vercel `after()` / Fluid** – Nur Vercel, hinter bestimmten Laufzeiten geschützt.
- **Nackte Fire-and-Forget-Versprechen nach `return`** – stillschweigend beendet, wenn die Funktion einfriert; Kein Fehler in den Protokollen, der Benutzer erhält einfach nie eine Antwort.

Die Kombination aus SQL-Warteschlange + Self-Webhook + Wiederholungsauftrag ist das Einzige, das auf jedem unterstützten Host identisch funktioniert. Der Wiederholungsjob ist das Sicherheitsnetz – gehen Sie niemals davon aus, dass der anfängliche Versand geleert wurde, bevor die Funktion einfror.

### Das Integrations-Plugin {#plugin}

Das Plugin wird automatisch gemountet, wenn keine benutzerdefinierte Version vorhanden ist. Erstellen Sie zum Anpassen Folgendes:

```ts
// server/plugins/integrations.ts
import { createIntegrationsPlugin } from "@agent-native/core/server";
import { scriptRegistry } from "../../agent.config";

export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
});
```

Welche Plattformen aktiv sind, hängt davon ab, welche Umgebungsvariablen festgelegt sind. Das Plugin registriert Webhook-Routen für jede einzelne unter `/_agent-native/integrations/`.

### Webhook URLs {#webhook-urls}

```text
/_agent-native/integrations/slack/webhook
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook
/_agent-native/integrations/email/webhook
```

Telegram stellt außerdem einen einmaligen Setup-Endpunkt bereit:

```text
POST /_agent-native/integrations/telegram/setup
```

### Umgebungsvariablen {#env-vars}

| Plattform | Erforderlich                                                                   | Optional                                              |
| --------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Slack     | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`                                      | `SLACK_ALLOWED_TEAM_IDS`, `SLACK_ALLOWED_API_APP_IDS` |
| Telegramm | `TELEGRAM_BOT_TOKEN`                                                           | —                                                     |
| E-Mail    | `EMAIL_AGENT_ADDRESS`, plus eines von `RESEND_API_KEY` oder `SENDGRID_API_KEY` | `EMAIL_INBOUND_WEBHOOK_SECRET`                        |
| WhatsApp  | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`   | —                                                     |

Alle Anmeldeinformationen befinden sich in Umgebungsvariablen – niemals in der Datenbank, niemals im Quellcode. Verwenden Sie die Seitenleisteneinstellungen UI oder das Env-Panel Ihres Hosting-Anbieters.

### Threading und Identität {#threading-and-identity}

Jede externe Konversation wird einem persistenten Thread in der agentennativen Datenbank zugeordnet:

- **Slack-DM** → ein Thread pro Slack-Benutzer.
- **Slack Kanal @mention** → ein Thread pro Kanal.
- **Telegram-Chat** → ein Thread pro Telegram-Chat.
- **WhatsApp-Konversation** → ein Thread pro WhatsApp-Nummer.
- **E-Mail** → Threading abgeleitet von `Message-ID`-/`In-Reply-To`-/`References`-Headern.

Externe Threads erscheinen im Web UI neben aus dem Web stammenden Threads, gekennzeichnet mit ihrer Quellplattform. Identitätsauflösung: Wenn ein Slack/E-Mail-Benutzer mit einem registrierten Benutzer übereinstimmt (normalerweise per E-Mail), wird er mit diesem Konto verknüpft.

### Sicherheit {#security}

Jeder eingehende Webhook wird vor der Verarbeitung einer Signaturprüfung unterzogen:

- **Slack** – HMAC-SHA256 des Körpers unter Verwendung von `SLACK_SIGNING_SECRET`, geprüft gegen den `X-Slack-Signature`-Header. Wenn Sie zum ersten Mal eine Anfrage URL im Bedienfeld „Ereignisabonnements“ von Slack speichern, postet Slack eine `url_verification`-Herausforderung dazu; Der Adapter des Frameworks erkennt dies und antwortet automatisch mit dem `challenge`-Wert, sodass der URL in Slack ohne zusätzliche Arbeit Ihrerseits auf Grün wechselt.
- **Telegram** – geheimes Token, das bei der Registrierung des Webhooks festgelegt wird.
- **WhatsApp** – Metas Verifizierungsherausforderung (mit `WHATSAPP_VERIFY_TOKEN`) plus Payload-Signatur.
- **Email** – Signaturüberprüfung im Svix-Stil, wenn `EMAIL_INBOUND_WEBHOOK_SECRET` festgelegt ist (Resend und SendGrid verwenden beide dieses Format). Wenn das Geheimnis nicht festgelegt ist, wird der Webhook akzeptiert, es wird jedoch eine Warnung protokolliert.

Der E-Mail-Adapter erzwingt außerdem Folgendes:

- **Zulässige Domänen** – optionales `allowedDomains`-Array in der `integration_configs`-Zeile der Integration; Absender außerhalb der Liste werden gelöscht.
- **Ratenlimit** – SQL-Queue-Backed-Ratenlimit von 20 eingehenden Nachrichten pro Absender und Stunde.

### Proaktive Versendungen {#proactive-sends}

Der Agent kann auf eigene Initiative Nachrichten senden (Benachrichtigungen, Erinnerungen, geplante Zusammenfassungen), indem er die Aktion `send-platform-message` mit einem `platform`-Feld `"slack"`, `"telegram"`, `"whatsapp"` oder `"email"` aufruft. Die Aktion befindet sich im Dispatch-Paket unter `packages/dispatch/src/actions/send-platform-message.ts` und Sie können sie für jede Vorlage kopieren/anpassen.

### Benutzerdefinierte Adapter {#custom-adapters}

Um eine neue Messaging-Plattform hinzuzufügen, implementieren Sie die `PlatformAdapter`-Schnittstelle:

```ts
import type { H3Event } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
} from "@agent-native/core/server";
import type { EnvKeyConfig } from "@agent-native/core/server";

const myAdapter: PlatformAdapter = {
  platform: "discord",
  label: "Discord",

  // Env keys this adapter needs (rendered in the settings UI)
  getRequiredEnvKeys(): EnvKeyConfig[] {
    return [
      { key: "DISCORD_BOT_TOKEN", label: "Discord Bot Token", required: true },
    ];
  },

  // Handle platform-specific verification challenges (e.g. Slack's
  // url_verification). Return { handled: true, response } to short-circuit.
  async handleVerification(event: H3Event) {
    return { handled: false };
  },

  // Validate the webhook request signature
  async verifyWebhook(event: H3Event): Promise<boolean> {
    // Validate signature headers; return true if authentic
    return true;
  },

  // Parse the webhook payload into a normalized IncomingMessage.
  // Return null to silently ignore the event (bot messages, edits, etc.).
  async parseIncomingMessage(event: H3Event): Promise<IncomingMessage | null> {
    return {
      platform: "discord",
      externalThreadId: "channel-or-thread-id",
      text: "the user's message",
      senderId: "discord-user-id",
      platformContext: { channelId: "channel-id" },
      timestamp: Date.now(),
    };
  },

  // Format plain agent text into a platform-appropriate OutgoingMessage.
  // opts.threadDeepLinkUrl, when provided, is a URL back to the originating
  // thread in the dispatch UI — render it as a button (Slack) or inline link.
  formatAgentResponse(
    text: string,
    opts?: { threadDeepLinkUrl?: string },
  ): OutgoingMessage {
    return { text, platformContext: {} };
  },

  // Post the agent's response back to the platform
  async sendResponse(
    message: OutgoingMessage,
    context: IncomingMessage,
  ): Promise<void> {
    // Call the platform's API, using context.platformContext for routing
  },

  // Return current connection/configuration status for the settings UI.
  // baseUrl is the app's public URL, used for status checks that need it.
  async getStatus(baseUrl?: string) {
    return {
      platform: "discord",
      label: "Discord",
      enabled: true,
      configured: !!process.env.DISCORD_BOT_TOKEN,
    };
  },
};
```

Registrieren Sie es in Ihrem Integrations-Plugin:

```ts
export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  adapters: [myAdapter],
});
```

Referenzimplementierungen live in `packages/core/src/integrations/adapters/` (`slack.ts`, `telegram.ts`, `whatsapp.ts`, `email.ts`) – der E-Mail-Adapter ist das umfassendste Beispiel, einschließlich Signaturüberprüfung, Threading, Ratenbegrenzung und HTML-Rendering.

### Zuverlässigkeit durch Dispatch + A2A-Fortsetzungen {#reliability}

Wenn [Dispatch](/docs/dispatch) eine Anfrage über [A2A](/docs/a2a-protocol#continuations) an eine andere App delegiert, garantiert der Continuation-Recovery-Ablauf, dass der Benutzer eine Slack/E-Mail-Antwort erhält, selbst wenn der Downstream-Agent mitten in der Ausführung abstürzt. Die ursprüngliche Webhook-Aufgabe bleibt in `processing`, bis die Fortsetzung entweder aufgelöst wird oder der Wiederholungsdurchlauf sie als hängengeblieben markiert; So oder so erhält der Plattform-Thread eine abschließende Antwort und verstummt nicht.

Das bedeutet, dass ein Multi-App-Arbeitsbereich, der von Dispatch unterstützt wird, robuster ist als eine einzelne Vorlage, die direkt mit Messaging verbunden ist – Fehler in einer nachgelagerten App degradieren zu einer eleganten Fehlermeldung statt zu einer verworfenen Antwort. Die vollständige Geschichte zur Liefergarantie finden Sie unter [A2A continuations](/docs/a2a-protocol#continuations).

### Häufige Fallstricke {#pitfalls}

- **Lesen Sie den Anforderungstext nicht doppelt.** Der Textstrom von h3 v2 ist einmal verbrauchen: Wenn Sie `readBody(event)` aufrufen, nachdem das Framework `event.node.req.body` bereits analysiert hat (oder umgekehrt), hängt die Anforderung beim zweiten Lesen auf unbestimmte Zeit. Dies tritt am häufigsten bei Resend und SendGrid auf – beide streamen die eingehende Nutzlast und der hängende Lesevorgang wird nie aufgelöst, die Plattform läuft ab und der Webhook wird erneut versucht, bis er deduziert wird. Wenn Sie den Webhook-Handler des Frameworks in Ihre eigene Middleware einbinden, übergeben Sie das bereits analysierte `IncomingMessage` über die Option `incoming`, anstatt den Handler erneut analysieren zu lassen.
- **Führen Sie keine Agentenschleifen innerhalb des Webhook-Handlers aus.** Der Handler muss in die Warteschlange gestellt und zurückgegeben werden – die Agentenschleife wird in der neuen Ausführung des Prozessors ausgeführt. Durch die Inline-Einbindung wird garantiert, dass ein serverloses Einfrieren den Lauf beendet. Darüber hinaus erzwingen öffentlich zugängliche Gateway-Integrationen (wie Netlify oder Vercel) strenge HTTP-Timeout-Limits (z. B. das 10-Sekunden-Anforderungslimit von Netlify). Da die Ausführung von Agenten und Tools oft länger als dieses Zeitfenster dauert, führt der Versuch, die Schleife synchron innerhalb der Webhook-Anfrage auszuführen, dazu, dass das Gateway die Verbindung beendet, was zu einem Abbruch der Ausführung und verworfenen Antworten führt. Das HMAC-signierte Self-Webhook-Warteschlangenmuster `/process-task` ist die einzige Möglichkeit, Gateway-Grenzwerte einzuhalten und gleichzeitig die vollständige Agentenschleife sicher auszuführen.
- **Verlassen Sie sich bei Kaltstarts nicht auf den Dedup-Speicher.** Der Dedup-Schlüssel befindet sich im eindeutigen Index SQL `(platform, external_event_key)` und nicht in einer In-Process-Map. Wenn Sie die Warteschlange ersetzen, behalten Sie die Deduplizierung auf SQL-Ebene bei, da sonst doppelte Slack-Wiederholungsversuche doppelte Agentenausführungen auslösen.
- **Halten Sie den Self-Webhook URL erreichbar.** Der Prozessor URL besteht aus `APP_URL` / `URL` / `DEPLOY_URL` / `BETTER_AUTH_URL` und greift auf die Header der eingehenden Anforderungen zurück. Legen Sie bei Vorschau-Bereitstellungen mit umgeschriebenen Hostnamen explizit einen dieser Hostnamen fest, da sonst der Versand einen 404-Fehler anzeigt.

### Siehe auch {#see-also}

- [Dispatch](/docs/dispatch) – Konzeptübersicht für die Verwendung eines zentralen Posteingangs über Apps hinweg
- [Dispatch template reference](/docs/template-dispatch) – empfohlener zentraler Posteingang für Multi-App-Arbeitsbereiche
- [A2A Protocol](/docs/a2a-protocol) – wie Dispatch-Delegierte mit anderen Agenten arbeiten, einschließlich Fortsetzungswiederherstellung
- [Agent Mentions](/docs/agent-mentions) – `@`-erwähnende Agenten im Web-Chat
