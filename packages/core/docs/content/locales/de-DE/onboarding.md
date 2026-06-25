---
title: "Onboarding- und API-Schlüssel"
description: "Setup-Checkliste für die Erstkonfiguration – API-Schlüssel, OAuth und Anbieterverbindungen"
---

# Onboarding

Wenn Sie zum ersten Mal eine App öffnen, die auf dem agentennativen Framework basiert, wird ein
**Setup**-Checkliste in der Agent-Seitenleiste. Die Erstausführungskonfiguration bleibt geschlossen
zum Agenten-Chat: Verbinden Sie eine KI-Engine, verweisen Sie die App optional auf „Freigegeben“
Infrastruktur und fügen Sie Anbieter nur dann hinzu, wenn Sie sie benötigen.

```an-diagram title="Die Setup-Checkliste" summary="Es ist lediglich das Anschließen einer KI-Engine erforderlich. Das Panel verfolgt den Abschluss und wird automatisch ausgeblendet, sobald alles Erforderliche erledigt ist."
{
  "html": "<div class=\"ob\"><div class=\"diagram-card\"><span class=\"diagram-pill warn\">required</span><strong>AI-Engine verbinden</strong><small class=\"diagram-muted\">Connect Builder (one click) or paste an LLM key</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Database</strong><small class=\"diagram-muted\">set <code>DATABASE_URL</code></small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Authentication</strong><small class=\"diagram-muted\">OAuth / access token</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>E-Mail-Zustellung</strong><small class=\"diagram-muted\">Resend / SendGrid</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">all required done &rarr; panel auto-hides</div></div>",
  "css": ".ob{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ob .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 14px}.ob .diagram-arrow{font-size:22px}"
}
```

## Für Endbenutzer

### Was Sie sehen werden

- Ein **Setup**-Panel über dem Agenten-Chat mit einer Checkliste wie „Eine KI verbinden
  Engine“, „E-Mail-Versand“ usw.
- Ein Zähler oben (z. B. „1 von 4“) zeigt an, wie viele Schritte bereit sind.
- Der aktuelle Schritt wird erweitert; Abgeschlossene Schritte werden mit einem grünen Häkchen angezeigt und bleiben bestehen
  lesbar, wenn Sie sie öffnen.
- Erforderliche Schritte zeigen eine kleine rote **erforderliche** Pille an. Das Panel bleibt sichtbar
  bis alle erforderlichen Schritte abgeschlossen sind.
- Sobald alles Erforderliche erledigt ist, wird das Panel automatisch ausgeblendet.
- Das gesamte Panel kann mit dem Chevron oben rechts minimiert werden, oder
  komplett ausgeblendet mit **Setup ausblenden** unten.

### So führen Sie die einzelnen Schritte aus

Schritte bieten eine oder mehrere **Methoden** – verschiedene Möglichkeiten, dasselbe zu erfüllen
Anforderung. Der primäre Pfad wird zuerst angezeigt; Sekundärpfade werden kompakt gehalten
hinter einem Picker oder einer Offenlegung, wenn ein Schritt mehrere gleichwertige Anbieter hat.

- **Verbinden Sie einen Dienst (ein Klick)** – z. B. _Verbinden Sie Builder_ für die verwalteten
  KI-Gateway. Klicken Sie auf die Schaltfläche, ein Fenster wird geöffnet, Sie melden sich an, das Fenster wird geschlossen,
  und der Schritt wird als abgeschlossen markiert. Keine Schlüssel zum Kopieren.
- **Fügen Sie einen API-Schlüssel ein oder füllen Sie ein Formular aus** – z. B. Wählen Sie einen LLM-Anbieter, eine Datenbank
  OAuth Anbieter oder E-Mail-Anbieter, fügen Sie die Werte ein und klicken Sie auf **Speichern**.
  Geheime Felder verwenden eine Passworteingabe, sodass der Wert nicht auf dem Bildschirm angezeigt wird. Gespeichert
  Werte gehen in Ihre lokalen `.env` (oder Arbeitsbereichseinstellungen) – siehe
  [Security](/docs/security) für den Ort, an dem sie leben.
- **Link öffnen** – einige Schritte verweisen auf eine Anmeldeseite oder Dokumente. Klicken Sie auf
  **Weiter** und beenden Sie den Ablauf im neuen Tab.
- **Fragen Sie den Agenten** – ein paar Schritte bieten die Option „Dem Agenten die Einrichtung überlassen“.
  Klicken Sie darauf und der Agent greift im Chat auf und führt Sie durch alle Schritte
  Externes Setup (Erstellen von OAuth-Anmeldeinformationen usw.).

### Die integrierten Schritte, die Sie normalerweise sehen

- **Anschließen einer KI-Engine** (erforderlich) – der einzige obligatorische Schritt. Verbinden
  Builder für ein mit einem Klick verwaltetes Gateway, oder öffnen Sie den sekundären Anbieterschlüssel
  Wählen Sie Ihren eigenen LLM-Schlüssel aus und fügen Sie ihn ein.
- **Datenbank** (optional) – legen Sie `DATABASE_URL` fest, wenn Sie eine bestimmte verwenden möchten
  SQL Datenbankverbindungszeichenfolge.
- **Authentifizierung** (optional) – integrierte E-Mail-/Passwortkonten funktionieren per
  Standard. Fügen Sie OAuth oder die Zugriffstoken-Anmeldung nur hinzu, wenn Sie diese Pfade benötigen.
- **E-Mail-Zustellung** (optional) – nützlich vor der Bereitstellung für das Zurücksetzen von Passwörtern
  Teameinladungen und Freigabebenachrichtigungen. Nutzen Sie den Anbieter, den Sie bereits nutzen;
  Lokale Entwicklung kann ohne ausgeführt werden.

Vorlagen können darüber hinaus eigene Schritte hinzufügen – z. B. Eine CRM-Vorlage könnte
Fügen Sie „Gmail verbinden“ hinzu. Eine Dokumentvorlage fügt möglicherweise „Standardarbeitsbereich auswählen“ hinzu. Siehe
[Authentication](/docs/authentication) für Details zur Anmeldeeinrichtung.

### Zurück zur Checkliste

Wenn Sie auf **Setup ausblenden** klicken, wird das Panel für diese Browsersitzung ausgeblendet.
Erforderliche Schritte, die noch nicht abgeschlossen sind, werden beim nächsten Laden erneut angezeigt. Einmal
Alles Erforderliche ist erledigt, das Bedienfeld wird endgültig automatisch ausgeblendet – es gibt nichts
noch zu erledigen.

## Für Entwickler

Wenn Sie eine Vorlage erstellen, registrieren Sie Onboarding-Schritte, damit sie in angezeigt werden
die Checkliste für die Seitenleiste des Benutzers. Das Framework übernimmt das Rendern und die Fertigstellung
Nachverfolgung und Entlassung – Sie erklären einfach, was der Schritt ist und wie er abläuft
zufrieden.

Das System wird **automatisch gemountet**. Vorlagen müssen nichts verkabelt werden, um
die vier integrierten Schritte (LLM, Datenbank, Authentifizierung, E-Mail). Zum Hinzufügen von App-spezifischen
Schritte (Gmail, Slack, Notion usw.), `registerOnboardingStep()` von einem aufrufen
Server-Plugin.

### Automatisch bereitgestellte Routen

Alle Routen live unter `/_agent-native/onboarding/`:

| Route                                               | Zweck                                               |
| --------------------------------------------------- | --------------------------------------------------- |
| `GET /_agent-native/onboarding/steps`               | Schritte mit Abschlussstatus auflisten              |
| `POST /_agent-native/onboarding/steps/:id/complete` | Schritt als abgeschlossen markieren (überschreiben) |
| `POST /_agent-native/onboarding/dismiss`            | Onboarding-Banner schließen                         |
| `POST /_agent-native/onboarding/reopen`             | Eindeutige Entlassung (Panel erneut zeigen)         |
| `GET /_agent-native/onboarding/dismissed`           | Entlassung + AllComplete-Flag lesen                 |

```an-api title="Listen Sie die Onboarding-Schritte auf"
{
  "method": "GET",
  "path": "/_agent-native/onboarding/steps",
  "summary": "Listen Sie alle registrierten Schritte mit ihrem Abschlussstatus auf",
  "description": "Drives the sidebar checklist — returns each step's id, title, methods, required flag, and whether `isComplete` currently passes.",
  "responses": [
    { "status": "200", "description": "Array of steps with completion status for the current user/app." }
  ]
}
```

### Einen Schritt aus einer Vorlage hinzufügen

```an-annotated-code title="Registrieren eines benutzerdefinierten Onboarding-Schritts"
{
  "filename": "server/plugins/my-onboarding.ts",
  "language": "ts",
  "code": "import { defineNitroPlugin } from \"@agent-native/core/server\";\nimport { registerOnboardingStep } from \"@agent-native/core/onboarding\";\nimport { listOAuthAccounts } from \"@agent-native/core/oauth-tokens\";\n\nexport default defineNitroPlugin(() => {\n  registerOnboardingStep({\n    id: \"gmail\",\n    order: 100,\n    title: \"Connect Gmail\",\n    description: \"Grant read/send access so the agent can work with email.\",\n    methods: [\n      {\n        id: \"oauth\",\n        kind: \"link\",\n        primary: true,\n        label: \"Sign in with Google\",\n        payload: { url: \"/_agent-native/google/auth-url?scope=mail\", external: false },\n      },\n      {\n        id: \"delegate\",\n        kind: \"agent-task\",\n        label: \"Let the agent set it up\",\n        badge: \"beta\",\n        payload: { prompt: \"Walk me through connecting Gmail. Set env vars as needed.\" },\n      },\n    ],\n    isComplete: async () => {\n      const accounts = await listOAuthAccounts(\"google\");\n      return accounts.length > 0;\n    },\n  });\n});",
  "annotations": [
    { "lines": "5", "label": "Automatisch montiert", "note": "Registrieren Sie sich über ein Nitro-Plugin – das Framework übernimmt das Rendern, die Abschlussverfolgung und die Entlassung." },
    { "lines": "7", "label": "Stabile ID", "note": "Die erneute Registrierung bei demselben `id` nach dem Laden der Standardeinstellungen überschreibt einen integrierten Schritt." },
    { "lines": "12-19", "label": "Primäre Methode", "note": "`primary: true` marks the big CTA. `kind: \"link\"` sends the user into the OAuth flow." },
    { "lines": "20-26", "label": "Delegierter Pfad", "note": "`kind: \"agent-task\"` hands the setup to the agent chat with a prompt." },
    { "lines": "28-31", "label": "Abschlussprüfung", "note": "`isComplete` läuft serverseitig. OAuth-Tokens leben im `oauth_tokens`-Store – überprüfen Sie es, nicht `process.env.GMAIL_REFRESH_TOKEN`." }
  ]
}
```

### Arbeitsbereichsverbindungen beim Onboarding prüfen

Beim Erstellen von Vorlagen, die mit externen Diensten (wie Slack, Google Workspace, GitHub oder HubSpot) interagieren, sollten Sie prüfen, ob der Arbeitsbereich bereits eine Verbindung hergestellt und diesem Anbieter eine Verbindung zu Ihrer Anwendung gewährt hat. Dies verhindert, dass Benutzer Anmeldeinformationen (wie API-Schlüssel oder Aktualisierungstoken) in ihren lokalen Umgebungsvariablen duplizieren müssen, wenn eine zentrale, verwaltete Verbindung besteht.

Sie können die Verbindungsbereitschaft in Ihrem `isComplete`-Callback mithilfe des Verbindungskatalogs APIs überprüfen:

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

// Inside registerOnboardingStep:
isComplete: async () => {
  // Check if a managed workspace connection exists and is ready
  const catalog = await listWorkspaceConnectionProviderCatalogForApp({
    appId: "mail",
    templateUse: "mail",
    provider: "gmail",
  });
  const connection = catalog.providers[0];

  if (
    connection?.readiness.status === "ready" &&
    connection.workspaceConnection.grantState === "granted"
  ) {
    return true;
  }

  // Fall back to local environment variable check
  return !!process.env.GMAIL_REFRESH_TOKEN;
};
```

Eine vollständige Liste der Verbindungsanbieter-Katalogmethoden finden Sie in der [Workspace Connections](/docs/workspace-connections)-Dokumentation.

### Methodenarten

| Freundlich         | Nutzlast                                              | Verwenden für                                                        |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `link`             | `{ url, external? }`                                  | Benutzer zu einem OAuth-Flow oder einer Dokumentenseite weiterleiten |
| `form`             | `{ fields, writeScope? }`                             | Env-Variablen sammeln (Schlüssel, Geheimnisse, URLs)                 |
| `builder-cli-auth` | `{ scope: "llm" \| "browser" \| "image-generation" }` | Connect Builder (unlocks shared infra)                               |
| `agent-task`       | `{ prompt }`                                          | Senden Sie eine Aufforderung an den Agenten-Chat zur Bearbeitung     |

Das `primary: true`-Flag markiert eine Methode als das große CTA für ihren Schritt.
Verwenden Sie `badge: "soon"` plus `disabled: true`, wenn ein Setup-Pfad sichtbar sein soll
bevor es verfügbar ist.

### Eingebaute Schritte

| ID         | Erforderlich | Beschreibung                                             |
| ---------- | ------------ | -------------------------------------------------------- |
| `llm`      | Ja           | Builder-Verbindung oder ein Provider-LLM-Schlüssel       |
| `database` | nein         | Standarddatenbank oder eine beliebige SQL `DATABASE_URL` |
| `auth`     | nein         | Eingebaute Konten, optional OAuth oder Zugriffstoken     |
| `email`    | nein         | Erneut senden oder SendGrid für Transaktions-E-Mails     |

Any of these can be overridden by re-registering with the same `id` after the
Standardlast.

### Client-Nutzung

Das Panel befindet sich bereits im `<AgentPanel>`. So erstellen Sie ein benutzerdefiniertes Layout:

```tsx
import {
  OnboardingPanel,
  OnboardingBanner,
  useOnboarding,
} from "@agent-native/core/client/onboarding";

function MySidebar() {
  const { allComplete, dismissed, currentStepId } = useOnboarding();
  if (allComplete || dismissed) return <Chat />;
  return (
    <>
      <OnboardingPanel />
      <Chat />
    </>
  );
}
```

Hintergrundinformationen dazu, wo Schrittwerte gespeichert werden und wie Geheimnisse gehandhabt werden,
siehe [Security](/docs/security). Für Endbenutzer-Messaging-Touchpoints (Einladungen,
Passwort-Resets), die vom Schritt **E-Mail-Zustellung** abhängen, siehe
[Messaging](/docs/messaging).
