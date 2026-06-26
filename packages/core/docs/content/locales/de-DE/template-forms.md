---
title: "Formulare"
description: "Agent-nativer Formularersteller – Erstellen, Bearbeiten, Veröffentlichen und Weiterleiten von Formulareinsendungen über natürliche Sprache und einen visuellen Editor."
---

# Formulare

Forms ist ein agentennativer Formularersteller. Beschreiben Sie das gewünschte Formular, verfeinern Sie es im Editor und veröffentlichen Sie ein öffentliches Formular, das Einreichungen in Ihrer eigenen SQL-Datenbank speichert.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>Beta-Anmeldung</strong><span class='wf-pill accent'>published</span><div style='flex:1'></div><button>Teilen</button><button class='primary'>Veröffentlichung aufheben</button></div><div style='display:flex;gap:8px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><span class='wf-pill accent'>Bearbeiten</span><span class='wf-pill'>Ergebnisse 187</span><span class='wf-pill'>Einstellungen</span><span class='wf-pill'>Integrationen</span></div><div style='display:flex;flex-direction:column;gap:12px;padding:30px 78px;overflow:hidden'><h2 style='margin:0'>Beta-Anmeldung</h2><p class='wf-muted' style='margin:0'>Reserviere einen Platz in der kommenden privaten Beta.</p><div class='wf-card'><strong>Vollständiger Name</strong><input value='Ada Lovelace'/></div><div class='wf-card'><strong>Arbeits-E-Mail</strong><input value='you@company.com'/></div><div class='wf-card'><strong>Ihre Rolle</strong><input value='Select...'/></div><div class='wf-card'><strong>Teamgröße</strong><input value='Select...'/></div></div></div>"
}
```

Wenn Sie die App öffnen, sehen Sie Ihre Formulare, den aktuellen Editor und eine Live-Vorschau. Der Agent kann aus einer Eingabeaufforderung heraus ein Formular erstellen, Feldbeschriftungen und Optionen aktualisieren, die Validierung ändern und Übermittlungsziele mit demselben actions verbinden, den UI verwendet.

```an-diagram title="Erstellen, veröffentlichen, sammeln" summary="Der Agent und der visuelle Editor bearbeiten eine SQL-backed-Formulardefinition. Die öffentliche Ausfüllseite ist nicht authentifiziert und Übermittlungen werden serverseitig an Ihre Ziele weitergeleitet."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Agentenprompt<br><small class=\"diagram-muted\">\"add an NPS question\"</small></div><div class=\"diagram-node\">Visueller Editor<br><small class=\"diagram-muted\">Labels, Validierung, Reihenfolge</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-form · update-form</span><small class=\"diagram-muted\">Felder-JSON, Einstellungs-JSON</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">forms table<br><small class=\"diagram-muted\">SQL über Drizzle</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Öffentliche Ausfüllseite<br><small class=\"diagram-muted\">unauthenticated</small></div><div class=\"diagram-box\">responses<br><small class=\"diagram-muted\">+ Slack / Webhook / Sheets</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Was Sie damit machen können

- **Erstellen Sie Formulare im Dialog.** „Erstellen Sie ein Kontaktformular“, „fügen Sie eine NPS-Bewertungsfrage hinzu“, „machen Sie das E-Mail-Feld zu einem Pflichtfeld.“ Der Agent aktualisiert das Formularschema und die Vorschauaktualisierungen aus dem durch SQL gesicherten Zustand.
- **Optische Feinabstimmung.** Bearbeiten Sie Beschriftungen, Platzhalter, erforderlichen Status, Optionen und Feldreihenfolge im Builder UI, wenn Sie eine direkte Steuerung wünschen.
- **Verwenden Sie die mitgelieferten Feldtypen.** Text-, E-Mail-, Nummern-, Langtext-, Auswahl-, Mehrfachauswahl-, Kontrollkästchen-, Radio-, Datums-, Bewertungs- und Skalenfelder werden standardmäßig unterstützt.
- **Antworten sammeln.** Jede Einreichung wird in SQL mit einer Detailansicht pro Antwort und einem Dashboard zum Überprüfen von Einträgen gespeichert.
- **Einreichungen weiterleiten.** Senden Sie Einreichungsnutzlasten mithilfe der integrierten Integrationen an webhooks, Slack, Discord oder Google Sheets.
- **Öffentliche Formulare veröffentlichen.** Geben Sie ein öffentliches Formular URL frei und zeigen Sie nach dem Absenden eine Dankesnachricht an.

## Erste Schritte

Live-Demo: [forms.agent-native.com](https://forms.agent-native.com).

1. **Erstellen Sie ein Formular aus einer Eingabeaufforderung.** Fragen Sie nach dem gewünschten Formular, einschließlich
   Zielgruppe und was nach der Einreichung passieren soll.
2. **Im Editor verfeinern.** Beschriftungen, Validierung, Auswahlmöglichkeiten und Reihenfolge anpassen in
   der visuelle Builder, wenn die direkte Bearbeitung schneller ist.
3. **Veröffentlichen und teilen.** Verwenden Sie das öffentliche Formular URL für Befragte und schauen Sie dann zu
   Ergebnisse werden in der Ansicht „Antworten“ angezeigt.
4. **Ziele verbinden.** Neue Einsendungen an Slack, Discord, Google weiterleiten
   Sheets, webhooks oder Ihr eigener Erweiterungspunkt.

### Nützliche Eingabeaufforderungen

- „Erstellen Sie ein Beta-Anmeldeformular mit Rolle, Teamgröße und vorrangigem Anwendungsfall.“
- „Fügen Sie eine erforderliche NPS-Frage und eine Freitext-Nachfrage hinzu.“
- „Posten Sie jede neue Antwort im Produkt-Slack-Kanal.“
- „Fassen Sie die Einsendungen dieser Woche zusammen und gruppieren Sie sie nach Kundensegment.“
- „Machen Sie dieses Formular kürzer, ohne die Felder zu verlieren, die wir für die Weiterleitung benötigen.“

## Für Entwickler

Der Rest dieses Dokuments richtet sich an alle, die die Forms-Vorlage verzweigen oder erweitern.

### Schnellstart

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

Für einen Arbeitsbereich mit Forms neben anderen Apps:

```bash
npx @agent-native/core@latest create my-platform
```

Wählen Sie bei der Einrichtung des Arbeitsbereichs Formulare und andere gewünschte Vorlagen aus.

### Hauptfunktionen {#key-features}

**JSON Formulardefinitionen.** Felder befinden sich in einer `fields` JSON Spalte, sodass der Agent für jeden Feldtyp chirurgische Änderungen ohne Schemaänderungen vornehmen kann.

**Öffentliche Ausfüllseiten.** Befragte können nicht authentifizierte Formulare einreichen, während private Einstellungen entfernt werden, bevor Daten den Browser erreichen.

**Serverseitige Ziele.** Slack, Discord, Google Sheets und Webhook-Integrationen leben in den Formulareinstellungen und werden nach der Übermittlung ausgeführt.

### Datenmodell

Alle Daten leben in SQL über Drizzle ORM. Schema: `templates/forms/server/db/schema.ts`. Formulare enthalten den Standard `ownableColumns` und eine passende Framework-Freigabentabelle, sodass sie in das Freigabemodell pro Benutzer/pro Organisation passen.

| Tabelle       | Was es enthält                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `forms`       | Eine Formulardefinition – `title`, `description`, eindeutiges `slug`, `fields` (JSON-Array von `FormField`), `settings` (JSON `FormSettings`), `status` (`draft` / `published` / `closed`) und ein vorläufig gelöschter `deleted_at` |
| `responses`   | Eine Einreichung pro Zeile – `form_id`, `data` (JSON `{ fieldId: value }`), `submitted_at`, optional `ip` und `submitter_email`                                                                                                      |
| `form_shares` | Framework teilt Tabellenzuordnungsprinzipale (Benutzer oder Organisationen) zu Rollen (Betrachter, Bearbeiter, Administrator) pro Formular                                                                                           |

Die Formen `fields` und `settings` JSON sind in `templates/forms/shared/types.ts` (`FormField`, `FormSettings`) definiert. Besitzerprivate Einstellungen wie Integrations-Webhooks URLs und zulässige Ursprünge werden entfernt, bevor Daten über `toPublicFormSettings` die öffentliche Füllseite erreichen.

```an-schema title="Forms Datenmodell" summary="Drei Tische. Felder und Integrationen sind JSON-Spalten in Formularen, sodass es sich bei den Bearbeitungen des Agenten eher um chirurgische Korrekturen als um tabellenübergreifende Zeilenänderungen handelt."
{
  "entities": [
    {
      "id": "forms",
      "name": "forms",
      "note": "A form definition (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "slug", "type": "string", "note": "unique; public URL" },
        { "name": "fields", "type": "json", "note": "FormField[] – alle Feldtypen" },
        { "name": "settings", "type": "json", "note": "FormSettings – Integrationen usw." },
        { "name": "status", "type": "enum", "note": "Entwurf | veröffentlicht | geschlossen" },
        { "name": "deleted_at", "type": "datetime", "nullable": true, "note": "soft delete" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "responses",
      "name": "responses",
      "note": "Eine Einreichung pro Zeile",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "data", "type": "json", "note": "{ fieldId: value }" },
        { "name": "submitted_at", "type": "datetime" },
        { "name": "ip", "type": "string", "nullable": true },
        { "name": "submitter_email", "type": "string", "nullable": true }
      ]
    },
    {
      "id": "form_shares",
      "name": "form_shares",
      "note": "Framework-Anteilstabelle – Prinzipale zu Rollen pro Formular",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "Zuschauer | Herausgeber | Administrator" }
      ]
    }
  ],
  "relations": [
    { "from": "forms", "to": "responses", "kind": "1-n", "label": "has responses" },
    { "from": "forms", "to": "form_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

### Schlüssel actions

Jeder Vorgang ist eine TypeScript-Datei in `templates/forms/actions/`, die automatisch unter `POST /_agent-native/actions/:name` gemountet wird:

- `create-form` – ein neues Formular erstellen (Titel, Beschreibung, Felder, Einstellungen)
- `update-form` – Felder, Einstellungen oder Status aktualisieren
- `get-form` – ein Formular nach ID oder Slug abrufen
- `list-forms` – barrierefreie Formulare auflisten
- `delete-form` – vorläufiges Löschen (setzt `deleted_at`)
- `restore-form` – ein vorläufig gelöschtes Formular wiederherstellen
- `list-responses` – Einreichungen für ein Formular mit optionalen Filtern auflisten
- `export-responses` – Antworten als CSV oder JSON exportieren

### Anpassen

Fragen Sie zuerst den Agenten nach dem Versandverhalten:

- „Fügen Sie ein erforderliches Funkfeld für die bevorzugte Kontaktmethode hinzu.“
- „Jede neue Einreichung an Slack posten.“ Verbinden Sie zuerst Slack über [Messaging](/docs/messaging).
- „Fügen Sie ein Webhook-Ziel für unser CRM hinzu.“
- „Erstellen Sie ein Kundenfeedback-Formular mit einer Skala von 1 bis 10 und einem langen Nachfasstext.“
- „Machen Sie einige Formulare öffentlich und andere nur für die Anmeldung.“

Wenn Sie neue Funktionen wie Datei-Uploads, Signaturen oder benutzerdefinierte Feld-Widgets benötigen, behandeln Sie diese als Vorlagenerweiterungen: Fügen Sie die SQL-Form, die Editor-Steuerelemente actions, UI, die Unterstützung für öffentliche Renderer und Agentenanweisungen zusammen hinzu. Das aktuelle Build-Muster finden Sie unter [Creating Templates](/docs/creating-templates).

## Was kommt als nächstes?

- [**Templates**](/docs/cloneable-saas) – das Modell zum Klonen und Besitzen
- [**Actions**](/docs/actions) – das Aktionssystem, das den Builder antreibt
- [**Messaging**](/docs/messaging) – Slack und andere Übermittlungsziele
