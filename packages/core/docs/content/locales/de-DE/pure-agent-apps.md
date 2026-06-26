---
title: "Pure-Agent-Apps"
description: "Apps, bei denen der Agent das gesamte Produkt darstellt: Die App-Agent-Schleife ist die Eingangstür, und UI wird nur hinzugefügt, wenn Menschen sie benötigen."
---

# Pure-Agent-Apps

Eine reine Agent-App ist das minimale Ende von Agent-Native: Die App-Agent-Schleife ist die
Produkt, kein Dashboard. Sie senden eine Anfrage vom Terminal, Slack, E-Mail, a
geplanter Job, ein anderer Agent oder Chat – „meine ungelesenen E-Mails zusammenfassen“, „veröffentlichen
tägliche Metriken an Slack“ – und der Agent handelt und gibt das Ergebnis zurück, wo immer es ist
gehört. Es ist immer noch eine echte App: actions, Sitzungen, App-Status, Verlauf,
Einstellungen, Anmeldeinformationen und Freigabedatensätze sind alle live in SQL.

```an-diagram title="Die App-Agent-Schleife ist die Eingangstür" summary="Viele Einstiegspunkte erreichen eine Agentenschleife über SQL-backed-Aktionen und -Status; Die Ergebnisse kehren dorthin zurück, woher die Anfrage kam. Die Benutzeroberfläche wird nur dann hinzugefügt, wenn eine Überwachung durch Menschen erforderlich ist."
{
  "html": "<div class=\"diagram-pure\"><div class=\"diagram-col\"><div class=\"diagram-pill\">Terminal</div><div class=\"diagram-pill\">Slack · E-Mail</div><div class=\"diagram-pill\">Geplanter Job</div><div class=\"diagram-pill\">Another agent (A2A)</div><div class=\"diagram-pill\">Chat</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">App-Agent-Schleife</span><small class=\"diagram-muted\">Aktionen · Sitzungen · App-Zustand in SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Ergebnis kehrt zurück<br><small class=\"diagram-muted\">to where it belongs</small></div></div>",
  "css": ".diagram-pure{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-pure .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-pure .diagram-arrow{font-size:22px;line-height:1}.diagram-pure .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

Greifen Sie nach dieser Form, wenn die Arbeit im Hintergrund läuft, die Ausgabe verlässt das
app, die Domäne ist einmalig oder Sie erstellen einen Prototyp. Der Agent benötigt noch einen UI –
kein Dashboard, sondern ein Ort, an dem Menschen es überwachen, konfigurieren und steuern können –
weshalb auch reine Agent-Apps normalerweise die integrierte Chat-Shell bereitstellen.

Dies ist die **kopflose** Produktform. Der vollständige Entscheidungsleitfaden, was im Lieferumfang enthalten ist
Die Box, das Gerüst, der Repo-Zugriff und die Lauffreigabe sind jetzt an einem Ort verfügbar:

→ [**Agent Surfaces — Headless agent**](/docs/agent-surfaces#headless)

## Was kommt als nächstes

- [**Agent Surfaces — Headless**](/docs/agent-surfaces#headless) – der vollständige Headless-Entscheidungsleitfaden und APIs
- [**Getting Started**](/docs/getting-started) – Erstellen Sie zuerst eine Chat-App oder einen Headless-Agenten
- [**Dispatch**](/docs/template-dispatch) – die Arbeitsbereichsvorlage, die ein großartiger Ausgangspunkt für reine Agenten ist
- [**Messaging the agent**](/docs/messaging) – wie Benutzer mit dem Agenten über das Web, Slack, Telegram oder E-Mail kommunizieren
- [**Recurring Jobs**](/docs/recurring-jobs) – geplante Eingabeaufforderungen, die der Agent selbstständig ausführt
- [**Actions**](/docs/actions) – die Tools, die Ihr reiner Agent aufrufen wird
