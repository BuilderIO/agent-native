---
title: "Human-in-the-Loop-Genehmigungen"
description: "Halten Sie den Agenten an, bevor eine Aktion mit hoher Konsequenz ausgeführt wird – das NeedsApproval-Gate von defineAction gibt ein Approval_required-Ereignis aus, der Mensch genehmigt und erst dann wird das Tool ausgeführt."
---

# Human-in-the-Loop-Genehmigungen

Die meisten actions sollten einfach laufen. Einige davon – das Senden einer E-Mail, das Aufladen einer Karte, das Löschen eines Kontos – sind nach außen gerichtet und schwer rückgängig zu machen, und Sie möchten nicht, dass der Agent sie selbstständig erledigt. Für diese verfügt `defineAction` über ein optionales **Genehmigungstor**: Wenn der Agent versucht, die Aktion aufzurufen, pausiert die Schleife, zeigt dem Menschen ein Genehmigen/Verweigern-Angebot an und führt die Aktion _erst_ aus, nachdem der Mensch diesen spezifischen Aufruf genehmigt hat.

> [!WARNING]
> Halten Sie Genehmigungen selten. Jede geschlossene Aktion stellt einen harten Stopp in der Agentenschleife dar – sie unterbricht den Ablauf und erfordert einen menschlichen Rundlauf. Verwenden Sie `needsApproval` nur für wirklich schwerwiegende, schwer rückgängig zu machende, nach außen gerichtete Vorgänge. Wenn Sie feststellen, dass Sie Gating-Lesevorgänge oder routinemäßige Schreibvorgänge ausführen, liegen Sie falsch. Die Standardeinstellung ist **aus** und sollte bei fast jeder Aktion ausgeschaltet bleiben.

## Das `needsApproval`-Tor {#needs-approval}

Legen Sie `needsApproval` auf einen `defineAction`. Es akzeptiert einen booleschen Wert oder ein Prädikat:

```an-annotated-code title="Gating the one consequential action"
{
  "filename": "actions/send-email.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Send an email via Gmail.\",\n  schema: z.object({\n    to: z.string(),\n    subject: z.string(),\n    body: z.string(),\n  }),\n  // Sending is outward-facing and hard to undo, so the agent can never send\n  // without a human approving the specific call. Drafting/queueing is\n  // unaffected — only the real send is gated.\n  needsApproval: true,\n  run: async (args) => {\n    /* ...actually send... */\n  },\n});",
  "annotations": [
    { "lines": "10", "label": "The whole gate", "note": "One flag. With it truthy and the call unapproved, the loop stops before `run` — the model never reaches the side effect on its own." },
    { "lines": "11-13", "label": "run() is untouched", "note": "The handler stays the same. Approval is enforced by the loop around it, not by anything inside `run`." }
  ]
}
```

- **`needsApproval: true`** – immer Genehmigung erforderlich.
- **`needsApproval: (args, ctx) => boolean | Promise<boolean>`** – Genehmigung nur erforderlich, wenn das Prädikat „true“ zurückgibt. Tor bedingt, z.B. nur für externe Empfänger oder nur über einem Dollar-Schwellenwert:

  ```ts
  needsApproval: (args) => !args.to.endsWith("@your-company.com"),
  ```

  Halten Sie das Prädikat rein und schnell. **Es schlägt im geschlossenen Zustand fehl**: Wenn das Prädikat auslöst, behandelt das Framework dies als „Genehmigung erforderlich“, anstatt stillschweigend eine Aktion mit hoher Konsequenz auszuführen.

Wenn `needsApproval` weggelassen wird, bleibt das Verhalten Byte für Byte unverändert – es fallen keine zusätzlichen Kosten für den gemeinsamen Pfad an.

Dies funktioniert genauso für actions im Legacy-`parameters`-Stil und schemabasiertes actions sowie für den In-App-Agenten, Subagenten, A2A- und MCP-Aufrufer (jede Agentenoberfläche leitet durch dieselbe Schleife).

## Wie die Schleife pausiert {#loop}

Wenn der Agent eine Gated-Aktion aufruft und dieser spezielle Aufruf **noch** nicht genehmigt wurde, führt die Schleife `run()` **nicht** aus. Stattdessen:

1. Löst das Tor. Für ein Prädikat wird `needsApproval(input, ctx)` aufgerufen; Ein Wurf wird als „muss genehmigt werden“ behandelt (fehlgeschlagen geschlossen).
2. Gibt ein `tool_start`-Ereignis aus (damit der UI den Anruf anzeigt), gefolgt von einem **`approval_required`**-Ereignis, und stoppt dann die Runde. Der Nebeneffekt der Aktion tritt nie ein.

Das `approval_required`-Event beinhaltet alles, was der Kunde braucht, um ein Angebot zu machen:

| Feld          | Typ      | Notizen                                                                                     |
| ------------- | -------- | ------------------------------------------------------------------------------------------- |
| `tool`        | `string` | Der Aktionsname, den der Agent aufzurufen versuchte.                                        |
| `input`       | Objekt   | Die Argumente, die der Agent übergeben hat.                                                 |
| `approvalKey` | `string` | **Stabiler Schlüssel**, der der Client zurückgibt, um _diesen genauen Anruf_ zu genehmigen. |
| `toolCallId`  | `string` | Die modellseitige Tool-Aufruf-ID, sofern verfügbar.                                         |

`approvalKey` wird deterministisch aus dem Werkzeugnamen und seiner Eingabe abgeleitet, sodass derselbe logische Aufruf immer denselben Schlüssel erzeugt. Das Modell sieht oder legt es nie fest – es handelt sich lediglich um einen Handschlag zwischen dem Framework und dem Approve-Angebot des Menschen.

Das angehaltene Werkzeug gibt ein Ergebnis zurück, das dem Modell mitteilt, dass die Drehung angehalten wurde und es nicht erneut versucht werden soll, sodass sich das Modell nicht dreht.

## Wie der Mensch zustimmt {#approve}

Auf `approval_required` rendert der Chat UI ein **Genehmigen/Verweigern**-Angebot für den angehaltenen Tool-Aufruf. Dies wird in `AssistantChat` automatisch verkabelt – Sie erstellen es nicht pro Vorlage.

- **Approve** gibt den Turn erneut aus (eine gewöhnliche Fortsetzungsnachricht) und trägt den Schlüssel des Anrufs in `approvedToolCalls: [approvalKey]`. Bei der erneuten Ausgabe erkennt das Tor den Schlüssel im genehmigten Satz und lässt diesen bestimmten Anruf normal laufen.
- **Deny** lehnt das Angebot lokal ab; Es wird nichts erneut ausgegeben, daher wird die Aktion nie ausgeführt.

`approvedToolCalls` ist ein Feld in der Chat-Anfrage (`AgentChatRequest.approvedToolCalls`). Schlüssel, die darin nicht vorhanden sind, bleiben pausiert – die Genehmigung eines Anrufs bedeutet niemals, dass andere Anrufe ohne weiteres genehmigt werden. Da der Schlüssel inhaltsadressiert ist, autorisiert eine Genehmigung diesen Aufruf mit diesen Argumenten. Wenn das Modell später einen anderen Versand vorschlägt, handelt es sich um einen neuen Schlüssel und eine neue Genehmigung.

## End-to-End {#flow}

```an-diagram title="The approval interrupt" summary="A gated call pauses the turn before run() fires. Approval re-issues the turn carrying the call's key; only then does the side effect happen."
{
  "html": "<div class=\"diagram-approve\"><div class=\"diagram-box\" data-rough>Agent calls send-email</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel warn\" data-rough><strong>Gate truthy, call not yet approved</strong><small class=\"diagram-muted\">loop emits tool_start + approval_required { tool, input, approvalKey }</small><span class=\"diagram-pill warn\">turn pauses &mdash; run() did NOT execute</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>Human clicks Approve in chat<br><small class=\"diagram-muted\">client re-issues the turn with approvedToolCalls: [approvalKey]</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel ok\" data-rough><span class=\"diagram-pill ok\">Gate sees the key &rarr; run() executes &rarr; email sends</span></div></div>",
  "css": ".diagram-approve{display:flex;flex-direction:column;align-items:center;gap:8px}.diagram-approve .diagram-panel{display:flex;flex-direction:column;gap:6px;align-items:center;padding:12px 16px;text-align:center}.diagram-approve .diagram-arrow{font-size:22px;line-height:1}"
}
```

Die kanonische (und absichtlich seltene) Verwendung dieses Gates im Framework ist die Aktion `send-email` der Mail-Vorlage, die `needsApproval: true` so festlegt, dass der Agent frei verfassen und in die Warteschlange stellen kann, aber niemals tatsächlich eine Nachricht senden kann, ohne dass ein Mensch den spezifischen Versand genehmigt.

## Verwandt

- [**Actions**](/docs/actions#needs-approval) – die vollständige `defineAction`-Oberfläche, einschließlich `outputSchema` zur Validierung von Rückgabewerten.
- [**Security**](/docs/security) – wann man nach einem Genehmigungstor greifen sollte oder wann man eine Aktion vor dem Modell verbergen sollte.
- [**Mail template**](/docs/template-mail) – `send-email` ist das Referenzbeispiel.
