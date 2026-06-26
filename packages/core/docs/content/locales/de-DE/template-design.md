---
title: "Design"
description: "Ein agentennatives HTML-Prototyping-Studio – generieren, verfeinern, zeigen Sie eine Vorschau an und exportieren Sie interaktive Alpine/Tailwind-Designs mit einem Agenten."
---

# Design

Design ist ein agentennatives Prototyping-Studio. Anstelle einer geschichteten Zeichenfläche generiert der Agent vollständige, eigenständige Alpine/Tailwind HTML-Prototypen, rendert sie in einem Iframe und ermöglicht Ihnen die Verfeinerung des Ergebnisses mit Eingabeaufforderungen und Optimierungssteuerelementen.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Produkt-Launch-Seite</h1><span class='wf-pill accent'>Desktop</span><span class='wf-pill'>Tablet</span><span class='wf-pill'>Mobile</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Export code</button></div><div class='wf-card' style='flex:1;display:grid;grid-template-rows:auto 1fr auto;gap:12px'><div style='display:flex;gap:8px'><span class='wf-pill accent'>Hero</span><span class='wf-pill'>Pricing</span><span class='wf-pill'>FAQ</span></div><div class='wf-box' style='display:flex;align-items:center;justify-content:center;min-height:230px'><strong>Generierter HTML-Prototyp</strong></div><div class='wf-card' style='display:flex;align-items:center;gap:10px'><span class='wf-muted'>Mach den Hero dichter und den CTA klarer.</span><div style='flex:1'></div><button class='primary'>Revision anwenden</button></div></div></div>"
}
```

Wenn Sie die App öffnen, befindet sich der generierte Prototyp im Mittelpunkt des Arbeitsbereichs, mit Vorschaumodi, Eingabeaufforderungen für Überarbeitungen und Exportsteuerelementen in unmittelbarer Nähe. Alles, was der Agent produziert, ist echtes HTML, das Sie verfeinern, exportieren oder weitergeben können.

```an-diagram title="Ein Artefakt, keine Übersetzung" summary="Der Agent generiert eigenständige Alpine/Tailwind HTML; Der Iframe, die bearbeitbare Quelle und jeder Export lesen alle dieselben Dateien. Ein verknüpftes Designsystem führt jedem Durchgang Token zu."
{
  "html": "<div class=\"diagram-design\"><div class=\"diagram-col\"><div class=\"diagram-node\">Prompt<br><small class=\"diagram-muted\">describe screen / page</small></div><div class=\"diagram-pill\">Designsystem</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">Agent generieren</span><small class=\"diagram-muted\">eigenständige HTML- / JSX-Dateien</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>iframe preview<br><small class=\"diagram-muted\">Regler anpassen · Cmd+I verfeinern</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">Export</span><small class=\"diagram-muted\">HTML · ZIP · PDF · Übergabe</small></div></div>",
  "css": ".diagram-design{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-design .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-design .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-design .diagram-arrow{font-size:20px;line-height:1}.diagram-design .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Wann soll es ausgewählt werden?

- **Sie möchten ein ausgefeiltes Landingpage-Konzept, eine Produktausrichtung oder eine Markenerkundung**, die das Tool als echtes HTML zurücklassen können – und nicht als mehrschichtige Zeichenfläche.
- **Sie möchten einen funktionierenden interaktiven Prototyp** mit Alpine interactions- und Tailwind-Stil anstelle statischer Modelle.
- **Sie möchten Wegbeschreibungen schnell vergleichen**, ein paar Varianten generieren, die stärkste auswählen und weiter verfeinern.
- **Sie möchten, dass die Designausgabe Ihnen gehört** – exportieren Sie HTML, ZIP oder PDF oder übergeben Sie den Prototyp einem Codierungstool.

## Was Sie damit machen können

- **Generieren Sie vollständige Prototypen.** Beschreiben Sie den Bildschirm oder die Seite, die Sie benötigen, und der Agent erstellt ein funktionierendes HTML-Dokument mit Tailwind-Stil und Alpine interactions.
- **Varianten vergleichen.** Beginnen Sie mit mehreren Richtungen, wählen Sie die stärkste aus und verfeinern Sie sie dann weiter.
- **Optimieren Sie visuell.** Verwenden Sie die integrierten Optimierungssteuerelemente für häufige Änderungen oder bitten Sie den Agenten um Aktualisierungen von Text, Layout, Farbe, Abstand und Interaktion.
- **Wenden Sie Designsysteme an.** Speichern Sie Designsystemeinstellungen und verwenden Sie sie wieder, damit die generierte Arbeit näher an Ihrer Marke bleibt.
- **Referenzen importieren.** Vorhandenes HTML oder Referenzmaterial als Kontext für einen neuen Designdurchlauf einbinden.
- **Echte Dateien exportieren.** HTML, ZIP oder PDF aus dem generierten Prototyp exportieren.

## Erste Schritte

Live-Demo: [design.agent-native.com](https://design.agent-native.com).

1. **Beschreiben Sie das Artefakt.** Fragen Sie nach dem Bildschirm, Ablauf, der Zielseite oder dem visuellen Element
   Gewünschte Richtung. Berücksichtigen Sie Zielgruppe, Ton und Produktbeschränkungen.
2. **Anweisungen vergleichen.** Generieren Sie einige Varianten, wählen Sie die stärkste aus und
   Verfeinern Sie weiter, anstatt von vorne zu beginnen.
3. **Optimieren Sie die Details.** Verwenden Sie Optimierungssteuerelemente für häufige visuelle Änderungen oder fragen Sie nach.
   der Agent für Layout-, Kopier-, Reaktions- und Interaktionsänderungen.
4. **Exportieren, wenn es nützlich ist.** Laden Sie HTML, ZIP oder PDF einmal als Prototyp herunter
   ist bereit zur Weitergabe an ein anderes Werkzeug oder einen Teamkollegen.

### Nützliche Eingabeaufforderungen

- „Erstellen Sie drei Landingpage-Anweisungen für ein technisches Analyseprodukt.“
- „Machen Sie dieses Dashboard kompakter und für ein Betriebsteam einfacher zu durchsuchen.“
- „Wenden Sie unser gespeichertes Designsystem an und vereinfachen Sie das mobile Layout.“
- „Exportieren Sie diesen Prototyp als ZIP, sobald die endgültige Variante ausgewählt ist.“
- „Verwandeln Sie dieses HTML in eine stärkere Preisseite, ohne die Markenfarben zu ändern.“

## Für Entwickler

Der Rest dieses Dokuments richtet sich an alle, die die Design-Vorlage verzweigen oder erweitern.

### Schnellstart

```bash
npx @agent-native/core@latest create my-design --standalone --template design
cd my-design
pnpm install
pnpm dev
```

### Datenmodell

Alle Daten befinden sich in SQL über Drizzle ORM. Schema: `templates/design/server/db/schema.ts`. Designs und Designsysteme verfügen über den Standard `ownableColumns` und eine passende Framework-Freigabentabelle, sodass sie in das Freigabemodell pro Benutzer/pro Organisation passen.

| Tabelle                                  | Was es enthält                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `designs`                                | Ein Designprojekt – `title`, `description`, `project_type` (`prototype` / `other`), der `data` JSON Blob und ein optionaler `design_system_id`-Link |
| `design_files`                           | Einzelne Dateien, die zu einem Design gehören (`filename`, `content`, `file_type`, standardmäßig `html`)                                            |
| `design_versions`                        | Zeitpunkt-`snapshot`s eines Designs mit einem optionalen `label` für Verlauf und Rollback                                                           |
| `design_systems`                         | Wiederverwendbare Markentokens – `data` (Farben/Typografie/Abstände), `assets`, `custom_instructions` und eine `is_default`-Flagge                  |
| `design_shares` / `design_system_shares` | Framework teilt Tabellen, die Prinzipale (Benutzer oder Organisationen) Rollen (Betrachter, Bearbeiter, Administrator) zuordnen                     |

```an-schema title="Entwerfen Sie ein Datenmodell" summary="Ein Design ist Eigentümer seiner Dateien und versionierten Snapshots und verknüpft optional ein wiederverwendbares Designsystem. Sowohl Designs als auch Systeme sind besitzbar und verfügen jeweils über eine Tabelle mit Framework-Freigaben."
{
  "entities": [
    { "id": "designs", "name": "designs", "note": "A design project (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "title", "type": "text" },
      { "name": "description", "type": "text", "nullable": true },
      { "name": "project_type", "type": "text", "note": "prototype / other" },
      { "name": "data", "type": "json", "note": "starts as {}" },
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id", "nullable": true }
    ] },
    { "id": "files", "name": "design_files", "note": "Dateien in einem Design", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "filename", "type": "text" },
      { "name": "content", "type": "text" },
      { "name": "file_type", "type": "text", "note": "defaults to html" }
    ] },
    { "id": "versions", "name": "design_versions", "note": "Verlauf / Rollback", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "snapshot", "type": "json" },
      { "name": "label", "type": "text", "nullable": true }
    ] },
    { "id": "systems", "name": "design_systems", "note": "Reusable brand tokens (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "data", "type": "json", "note": "colors / typography / spacing" },
      { "name": "assets", "type": "json", "nullable": true },
      { "name": "custom_instructions", "type": "text", "nullable": true },
      { "name": "is_default", "type": "boolean" }
    ] },
    { "id": "design_shares", "name": "design_shares", "note": "Tabelle mit Framework-Freigaben", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] },
    { "id": "system_shares", "name": "design_system_shares", "note": "Tabelle mit Framework-Freigaben", "fields": [
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] }
  ],
  "relations": [
    { "from": "designs", "to": "files", "kind": "1-n" },
    { "from": "designs", "to": "versions", "kind": "1-n" },
    { "from": "systems", "to": "designs", "kind": "1-n", "label": "applied to" },
    { "from": "designs", "to": "design_shares", "kind": "1-n" },
    { "from": "systems", "to": "system_shares", "kind": "1-n" }
  ]
}
```

Ein Designprojekt ist eine Hülle, bis es Inhalt hat: `create-design` erstellt eine leere Zeile (`data: "{}"`), dann schreibt `generate-design` die eigentlichen eigenständigen HTML/JSX-Dateien. Das generierte Artefakt, die bearbeitbare Quelle und jeder Export stammen alle aus demselben HTML, sodass kein separates „AI-Mockup“-Format übersetzt werden muss. Ein verknüpftes Designsystem stellt Token und `custom_instructions` bereit, die der Agent bei jedem Generationsdurchlauf berücksichtigt.

Routen im UI live unter `templates/design/app/routes/`: `_index.tsx` (Liste), `design.$id.tsx` (Herausgeber), `present.$id.tsx` (Präsentation), `design-systems.tsx` und `design-systems_.setup.tsx`, `templates.tsx`, `examples.tsx` sowie `settings.tsx` und `team.tsx`.

### Schlüssel actions

Jeder vom Agenten aufrufbare Vorgang ist eine TypeScript-Datei in `templates/design/actions/`, die automatisch bei `POST /_agent-native/actions/:name` gemountet wird und vom CLI als `pnpm action <name>` ausgeführt werden kann. Die Gruppierungen:

- **Designs** – `create-design` (leere Shell), `generate-design` (generierten HTML/JSX-Inhalt schreiben), `update-design`, `get-design`, `list-designs`, `duplicate-design`, `delete-design` und `apply-tweaks` zum Beibehalten von Live-Tweak-Knopf-Werten (Akzentfarbe, Dichte, usw.).
- **Dateien** – `create-file`, `update-file`, `list-files`, `delete-file` für die Dateien in einem Designprojekt.
- **Designsysteme** – `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `delete-design-system`, `set-default-design-system` und `analyze-brand-assets` zum Sammeln von Markendaten vor der Analyse.
- **Importieren** – `import-code`, `import-figma`, `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF/XLSX) und `import-design-project`, um ein Designsystem aus einem vorhandenen Projekt zu entfernen.
- **Export & Übergabe** – `export-html`, `export-pdf`, `export-svg`, `export-zip` und `export-coding-handoff`, um ein Design in eine Codierungstool-Übergabe umzuwandeln.
- **Kontext und Navigation** – `view-screen` (aktuelles Design, offene Datei, Ansicht, ausstehende Frage oder Variantenraster), `get-design-snapshot` (aktueller Status, von dem aus ein externer Agent fortfahren kann) und `navigate`.

### Zusammenarbeit mit dem Agenten

Der Agent weiß immer, was Sie offen haben. Das aktuelle Design, die geöffnete Datei, die aktive Ansicht und alle ausstehenden Fragen oder Variantenraster werden von `view-screen` zurückgegeben und in jede Nachricht eingefügt, sodass Sie sagen können: „Machen Sie dies dichter“ oder „Exportieren Sie diese Variante“, ohne das Design zu benennen.

Da es sich bei einem Design lediglich um eigenständige HTML/JSX-Dateien handelt, bearbeitet der Agent dieselbe Quelle, die der Iframe rendert, und jeder Export stammt aus – es gibt kein separates „AI-Mockup“-Format zum Übersetzen. Ein verknüpftes Designsystem liefert Token und `custom_instructions`, die der Agent bei jedem Generationsdurchlauf ehrt. Wählen Sie in der Vorschau Text oder einen Bereich aus und drücken Sie Befehl+I, um den Agenten genau auf diesen Teil zu konzentrieren.

### Anpassen

Design ist eine vollständige, klonbare Vorlage. Einige praktische Erweiterungsideen:

- „Fügen Sie mit unseren Tokens und Beispielkomponenten ein wiederverwendbares E-Commerce-Designsystem hinzu.“
- „Fügen Sie einen Exportschritt hinzu, der ZIP in unser internes Überprüfungssystem hochlädt.“
- „Lassen Sie mich die vorhandene Zielseite HTML einfügen und den Agenten um drei stärkere Versionen bitten.“
- „Fügen Sie eine gespeicherte Eingabeaufforderungsbibliothek für Produktseiten-, Dashboard- und Onboarding-Bildschirm-Briefings hinzu.“
- „Fügen Sie eine benutzerdefinierte PDF-Exportvoreinstellung zur Überprüfung durch Stakeholder hinzu.“

Der Agent bearbeitet Routen, Komponenten, actions- und SQL-gestützte Modelle nach Bedarf. Siehe [Templates](/docs/cloneable-saas) für den vollständigen Klon-, Anpassungs- und Bereitstellungsablauf und [Getting Started](/docs/getting-started), wenn dies Ihre erste agentennative Vorlage ist.

## Was kommt als nächstes?

- [**Templates**](/docs/cloneable-saas) – das Modell zum Klonen und Besitzen
- [**Context Awareness**](/docs/context-awareness) – wie der Agent weiß, was der Benutzer sieht
- [**Creating Templates**](/docs/creating-templates) – aktuelle Build-Muster für agentennative Vorlagen
