---
title: "Vermögenswerte"
description: "Ein agentennativer Digital Asset Manager und agentenübergreifender Generierungsdienst für markenkonsistente Medien."
---

# Vermögenswerte

Assets ist ein agentennativer Arbeitsbereich zum Erstellen und Verwalten markenkonsistenter Medien. Es organisiert Uploads und generierte Ergebnisse in Bibliotheken und Ordnern, ermöglicht Teams das Sammeln von Beispielen für Blog-Helden, Diagramme, Zielseiten, Produktaufnahmen, Videos und Logos und leitet die Generierung dann über den Agenten-Chat weiter, sodass jedes Asset überprüft und verfeinert werden kann.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Launch-Marke</h1><span class='wf-pill accent'>Blog-Heroes</span><span class='wf-pill'>Produktbilder</span><span class='wf-pill'>Logos</span><div style='flex:1'></div><button>Upload</button><button class='primary'>Generate</button></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Markenmedien erstellen</strong><div class='wf-box'>Drei Homepage-Hero-Optionen mit genehmigtem Logo und Produktreferenzen.</div><div style='display:flex;gap:8px;flex-wrap:wrap'><span class='wf-pill accent'>4 references</span><span class='wf-pill'>16:9</span><span class='wf-pill'>Web-Export</span></div></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px;flex:1'><div class='wf-card' style='display:flex;align-items:end;min-height:130px'><span class='wf-pill accent'>Hero-Bereich A</span></div><div class='wf-card' style='display:flex;align-items:end;min-height:130px'><span class='wf-pill'>Referenzsatz</span></div><div class='wf-card' style='display:flex;align-items:end;min-height:130px'><span class='wf-pill'>Logo-sicher</span></div></div><div class='wf-card' style='display:grid;grid-template-columns:repeat(4,1fr);gap:8px'><div class='wf-box'>Use</div><div class='wf-box'>Refine</div><div class='wf-box'>Compare</div><div class='wf-box'>Export</div></div></div>"
}
```

Wenn Sie die App öffnen, bleiben die ausgewählte Bibliothek, die Eingabeaufforderung, die Referenzen und die generierten Kandidaten in einem Arbeitsbereich. Der Agent kann jedes Asset über denselben actions durchsuchen, suchen, generieren, verfeinern und exportieren, den auch der UI verwendet.

```an-diagram title="Generieren, überprüfen, wiederverwenden" summary="Referenzen und Eingabeaufforderungen speisen eine Sitzung zum Generieren und Auswählen. Ausgewählte Assets landen in einer Bibliothek und fließen über den Picker oder A2A an andere Apps."
{
  "html": "<div class=\"diagram-assets\"><div class=\"diagram-col\"><div class=\"diagram-node\">References<br><small class=\"diagram-muted\">Logos, Produktbilder, Stil</small></div><div class=\"diagram-node\">Prompt<br><small class=\"diagram-muted\">Chat- oder Generate-Steuerung</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">Generierungssitzung</span><small class=\"diagram-muted\">image &amp; video candidates · audit log</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill ok\">Library</span><small class=\"diagram-muted\">ausgewählte, markenkonforme Assets</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">Picker<br><small class=\"diagram-muted\">iframe / MCP-App</small></div><div class=\"diagram-node\">A2A<br><small class=\"diagram-muted\">Folien · Design · Inhalte</small></div></div></div>",
  "css": ".diagram-assets{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-assets .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-assets .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-assets .diagram-arrow{font-size:20px;line-height:1}"
}
```

## Wann soll es ausgewählt werden?

- **Ihr Team benötigt eine wiederverwendbare visuelle Anleitung**, keine einmaligen generischen Medienaufforderungen – sammeln Sie genehmigte Logos, Produktfotos und Stilbeispiele, damit Generationen bei der Marke bleiben.
- **Sie möchten, dass die generierten Medien überprüft und verfeinert werden**, mit einem vollständigen Prüfprotokoll der Eingabeaufforderungen, Modelle, Referenzen und Herkunft für jeden Lauf.
- **Andere Apps benötigen eine Asset-Auswahl oder einen Asset-Generator** – Folien, Design, Inhalte, ein Blog-Editor oder ein Website-Builder können die Auswahl einbetten oder Assets über A2A aufrufen.
- **Sie möchten, dass Markenmedien von Ihrem Coding-Agenten verfügbar sind** – Codex, Claude Code, Claude oder ChatGPT können Assets generieren und auswählen, ohne den Chat zu verlassen.

## Erste Schritte

Live-Demo: [assets.agent-native.com](https://assets.agent-native.com).

1. **Erstellen Sie eine Bibliothek.** Fügen Sie die Marke, Kampagne, das Produkt oder den Content-Stream Ihrer Wahl hinzu
   verwalten möchten.
2. **Referenzen hochladen.** Fügen Sie genehmigte Logos, Produktfotos, Stilbeispiele usw. hinzu.
   vorhandene Videos, damit der Agent über konkretes Material verfügt, mit dem er arbeiten kann.
3. **Generieren Sie aus einem Chat oder einer Bibliothek.** Fragen Sie nach einem Heldenbild, Diagramm oder Produkt
   Aufnahme oder Videovariante. Assets speichert die Eingabeaufforderung, Referenzen, Modell, Status usw.
   und Abstammung zur Überprüfung.
4. **Verwenden Sie das Asset an anderer Stelle.** Kopieren Sie den Export, betten Sie die Auswahl in einen anderen ein
   App oder lassen Sie einen anderen Agenten Assets über A2A anrufen.

## Nützliche Eingabeaufforderungen

- „Generieren Sie drei Blog-Hero-Optionen mithilfe der Acme-Produktreferenzen.“
- „Erstellen Sie ein quadratisches soziales Image im Stil einer Launch-Kampagne.“
- „Finden Sie alle genehmigten Assets für die Onboarding-Neugestaltung.“
- „Verwandeln Sie dieses hochgeladene Diagramm in ein klareres Produkterklärungsbild.“
- „Erstellen Sie ein Video-Storyboard und speichern Sie den besten Framesatz in dieser Bibliothek.“

## Was Sie damit machen können

- **Erstellen Sie Asset-Bibliotheken.** Gruppieren Sie Referenzbilder, Videos, kanonische Logos, Stilhinweise, Paletten, Ordner und generierte Ausgaben nach Marke, Kampagne, Produkt oder Kategorie.
- **Generieren über Chat.** Die Home Verfassenr- und Bibliotheks-Generate-Steuerelemente senden die Eingabeaufforderung mit `sendToAgentChat()` an den Agenten, sodass Benutzer Varianten prüfen, Feedback geben und iterieren können.
- **Generieren Sie Bilder und Videos.** Die von Builder verwaltete Bildgenerierung ist verfügbar, wenn sie aktiviert ist, und Gemini unterstützt die Videogenerierung sowie den manuellen Bild-Fallback.
- **Referenzen hochladen und beschreiben.** Fügen Sie Bilder oder Videos aus der Bibliothek UI oder der Schaltfläche zum Anhängen des Prompt Verfassenr hinzu und suchen Sie dann nach Titel, Beschreibung, Alternativtext, Prompt, Modell, Medientyp, Status, Rolle, Ordner oder Sammlung.
- **Führen Sie ein Generierungs-Audit-Protokoll.** Bei jedem Lauf werden Eingabeaufforderungen, Modell, Seitenverhältnis, Referenzen, Quell-Asset, Herkunft, generierte Assets, Status, Fehler und Zeitstempel für eine spätere Entwurfsüberprüfung aufgezeichnet.
- **Behalten Sie die Genauigkeit des Logos bei.** Der Agent kann einen Platzhalterbereich generieren und der Server fügt das hochgeladene kanonische Logo zum endgültigen Bild zusammen, anstatt sich beim Neuzeichnen auf das Bildmodell zu verlassen.
- **Als Picker einbetten.** Andere Apps können `/picker` iframen und auf das `chooseAsset`-Ereignis von `@agent-native/embedding` warten, wodurch Assets in einen Asset-Picker/Generator für Blog-Editoren, Website-Builder, Foliendecks und benutzerdefinierte Apps umgewandelt werden. Der Picker gibt auch den Legacy-Alias `chooseImage` für vorhandene Nur-Image-Hosts aus.
- **Als app-gestützten Skill installieren.** Das `agent-native.app-skill.json`-Manifest exportiert einen Assets-Skill plus MCP-Connector-Metadaten, damit Marktplätze die App, ihre Anweisungen und ihre Auswahl gemeinsam installieren können.
- **Andere Agenten bedienen.** Folien, Design, Inhalt, E-Mail und Versand können Assets über A2A aufrufen, um Bibliotheken aufzulisten, Stapel zu generieren, Videos zu erstellen, ein Asset zu verfeinern, Exporte abzurufen und Inline-Vorschauen zu rendern, wo das Einbetten zulässig ist.

## Verwenden Sie es von Ihrem Codierungsagenten

Generieren und wählen Sie Markenmedien aus, ohne Codex, Claude Code, Claude oder ChatGPT zu verlassen.

1. **Einmal installieren.** Dadurch werden die Skill-Anweisungen hinzugefügt und der gehostete MCP-Connector zusammen registriert:

   ```bash
   npx @agent-native/core@latest skills Assets hinzufügen # Alias: Image-Generierung
   ```

   Standard-Client ist `codex`; Fügen Sie `--client claude-code` oder `--client all` für andere hinzu.
   Wenn Sie nur die tragbaren Fertigkeitsanweisungen über Vercel/Open wünschen
   Skills CLI, verwenden Sie:

   ```bash
   npx skills@latest add BuilderIO/agent-native --skill asset
   ```

   Der Vercel/open Skills CLI installiert nur die Anweisungsdatei; Das ist nicht der Fall
   Führen Sie das MCP-Connector-Setup aus. Verwenden Sie bei Bedarf den obigen Pfad Agent Native CLI
   das Ein-Befehl-Setup.

2. **Fragen Sie nach Bildern.** Im Chat Ihres Agenten: „Generieren Sie drei Blog-Hero-Optionen aus den Acme-Produktaufnahmen.“ Der Agent öffnet die Auswahl mit Kandidatenbildern, die Sie neu generieren, neu abstimmen (Eingabeaufforderung, Seitenverhältnis, Anzahl) und aus denen Sie auswählen können.
3. **Pick.** In Inline-Hosts (ChatGPT, Claude.ai, Claude Desktop-Hauptchat) wird der Picker direkt im Chat gerendert – klicken Sie auf einen Kandidaten und die Auswahl wird automatisch zurückgesendet. Auf CLI/Nur-Link-Hosts (Codex, Claude Code, Claude Desktop-Registerkarte „Code“) erhalten Sie einen Link **„In Assets öffnen →“**; Öffnen Sie es, wählen Sie es im Browser aus und fügen Sie dann die kopierte Übergabezusammenfassung wieder in Ihren Chat ein – oder sagen Sie einfach „Bild A verwenden“.

   ```Text
   Fügen Sie diese Auswahl wieder in Ihren Chat ein, damit der Agent sie verwenden kann.

   Ausgewähltes Assets-Bild für den nächsten Schritt: <label>
   Medien URL: <url>
   Dieses ausgewählte Asset im aktuellen Artefakt oder Design verwenden.

   Ausgewählter Asset-Kontext:
   { "selectedAsset": { "assetId": "...", "url": "...", "mediaType": "image", ... }
   ```

4. **Auf Code anwenden.** Die ausgewählten Medien URL und `assetId` kehren zum Agenten zurück, der den URL direkt in dem Code verwendet, den er schreibt (ein `<img>`-Quelle, ein Download) oder `export-asset` aufruft.

## Für Entwickler

Der Rest dieses Dokuments richtet sich an alle, die die Assets-Vorlage verzweigen oder erweitern.

### Gerüst

```bash
npx @agent-native/core@latest create my-assets --standalone --template assets
```

### Datenmodell

Alle Daten befinden sich in SQL über Drizzle ORM (Binärmedien befinden sich im Objektspeicher oder im lokalen Datei-Upload-Fallback während der Entwicklung). Schema: `templates/assets/server/db/schema.ts`. Bibliotheken verfügen über den Standard `ownableColumns` und eine passende Framework-Freigabentabelle, sodass sie in das Freigabemodell pro Benutzer/pro Organisation integriert sind.

Hinweis: Die SQL-Tabellennamen behalten das alte `image_*`-Präfix aus der Zeit, als die App „Bilder“ hieß. Sie decken auch Videos und andere Medien ab.

| Tabelle                          | Was es enthält                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image_libraries`                | Eine Bibliothek – der Container der obersten Ebene, gruppiert nach Marke, Kampagne, Produkt oder Kategorie. Enthält `custom_instructions`, `style_brief`, kanonische Logo- und Cover-Asset-Referenzen sowie den Archivstatus |
| `image_library_shares`           | Framework teilt Tabellenzuordnungsprinzipale (Benutzer oder Organisationen) zu Rollen (Betrachter, Editor, Administrator) pro Bibliothek                                                                                     |
| `image_collections`              | Stil-/Kategoriegruppierungen innerhalb einer Bibliothek – `style_brief`, `prompt_template`, Standardseitenverhältnis und Bildgröße                                                                                           |
| `asset_folders`                  | Verschachtelbare Ordner innerhalb einer Bibliothek (`parent_id` für Hierarchie)                                                                                                                                              |
| `image_generation_presets`       | Gespeicherte Generierungsrezepte – Medientyp, Eingabeaufforderungsvorlage, Seitenverhältnis, Modell und Text-/Referenzrichtlinie                                                                                             |
| `image_generation_sessions`      | Eine iterative Generier-und-Auswahl-Sitzung mit einer kurzen Zusammenfassung, dem Status, dem aktiven Asset und einer Feedback-Zusammenfassung                                                                               |
| `image_generation_session_items` | Kandidaten-Assets innerhalb einer Sitzung, jeweils mit einer Rolle und einer Notiz                                                                                                                                           |
| `image_assets`                   | Der Asset-Datensatz – Medientyp, Rolle, Status, Titel/Beschreibung/Alternativtext, Eingabeaufforderung, Modell, Abmessungen, MIME-Typ, Objekt-/Miniaturbildschlüssel und Herkunft                                            |
| `image_generation_runs`          | Das Generierungs-Audit-Protokoll – Eingabeaufforderung, kompilierte Eingabeaufforderung, Modell, Referenzen, Status, Fehler und das `source` (`chat` / `ui` / `a2a`), das es ausgelöst hat                                   |

```an-schema title="Assets Datenmodell" summary="Bibliotheken sind der besitzbare Container; Collections, Ordner und Presets organisieren sie. Sessions steuern Generieren-und-Auswählen; Assets und Runs halten Ausgabe und Audit-Log. Tabellennamen behalten das ältere Präfix image_* bei, decken aber alle Medien ab."
{
  "entities": [
    { "id": "library", "name": "image_libraries", "note": "Besitzbarer Container der obersten Ebene", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "custom_instructions", "type": "text", "nullable": true },
      { "name": "style_brief", "type": "text", "nullable": true },
      { "name": "logo_asset_id", "type": "id", "fk": "image_assets.id", "nullable": true },
      { "name": "archived", "type": "boolean" }
    ] },
    { "id": "library_shares", "name": "image_library_shares", "note": "Tabelle mit Framework-Freigaben", "fields": [
      { "name": "library_id", "type": "id", "fk": "image_libraries.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] },
    { "id": "collections", "name": "image_collections", "note": "Style/category-Gruppierungen", "fields": [
      { "name": "library_id", "type": "id", "fk": "image_libraries.id" },
      { "name": "style_brief", "type": "text", "nullable": true },
      { "name": "prompt_template", "type": "text", "nullable": true }
    ] },
    { "id": "folders", "name": "asset_folders", "note": "Nestbare Ordner", "fields": [
      { "name": "library_id", "type": "id", "fk": "image_libraries.id" },
      { "name": "parent_id", "type": "id", "fk": "asset_folders.id", "nullable": true }
    ] },
    { "id": "presets", "name": "image_generation_presets", "note": "Gespeicherte Generationsrezepte", "fields": [
      { "name": "media_type", "type": "text" },
      { "name": "prompt_template", "type": "text" },
      { "name": "model", "type": "text" }
    ] },
    { "id": "sessions", "name": "image_generation_sessions", "note": "Iteratives Generieren und Auswählen", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "status", "type": "text" },
      { "name": "active_asset_id", "type": "id", "fk": "image_assets.id", "nullable": true }
    ] },
    { "id": "session_items", "name": "image_generation_session_items", "note": "Kandidaten-Assets in einer Sitzung", "fields": [
      { "name": "session_id", "type": "id", "fk": "image_generation_sessions.id" },
      { "name": "asset_id", "type": "id", "fk": "image_assets.id" },
      { "name": "role", "type": "text" }
    ] },
    { "id": "assets", "name": "image_assets", "note": "Der Anlagendatensatz", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "media_type", "type": "text", "note": "image / video" },
      { "name": "status", "type": "text" },
      { "name": "prompt", "type": "text", "nullable": true },
      { "name": "object_key", "type": "text", "nullable": true }
    ] },
    { "id": "runs", "name": "image_generation_runs", "note": "Überwachungsprotokoll für die Generierung", "fields": [
      { "name": "model", "type": "text" },
      { "name": "status", "type": "text" },
      { "name": "source", "type": "text", "note": "chat / ui / a2a" }
    ] }
  ],
  "relations": [
    { "from": "library", "to": "collections", "kind": "1-n" },
    { "from": "library", "to": "folders", "kind": "1-n" },
    { "from": "library", "to": "assets", "kind": "1-n" },
    { "from": "sessions", "to": "session_items", "kind": "1-n" },
    { "from": "library", "to": "library_shares", "kind": "1-n" }
  ]
}
```

### Anpassen

Assets ist eine vollständige, klonbare Vorlage. Einige praktische Erweiterungsideen:

- „Fügen Sie einen Produktkatalog-Connector hinzu, damit Produktreferenzaufnahmen von SKU ausgewählt werden können.“
- „Fügen Sie eine strenge Genehmigungswarteschlange hinzu, bevor generierte Assets als für das Marketing verwendbar markiert werden.“
- „Fügen Sie ein Markenbewertungs-Dashboard hinzu, das fehlgeschlagene oder schlecht bewertete Generationen nach Modell filtert.“
- „Erstellen Sie eine arbeitsbereichsweite Standard-Asset-Bibliothek und leiten Sie die Bildgenerierung für Folien durch diese.“
- „Fügen Sie einen neuen Anbieter hinter der Schnittstelle zur Bildgenerierung hinzu, nachdem Sie die neuesten Anbieterdokumente überprüft haben.“

Der Agent bearbeitet Routen, Komponenten, actions-, skills- und SQL-gestützte Modelle nach Bedarf. Siehe [Templates](/docs/cloneable-saas) für den vollständigen Klon-, Anpassungs- und Bereitstellungsablauf und [A2A Protocol](/docs/a2a-protocol) für die App-übergreifende Generierung.

### Betten Sie die Auswahl ein

Verwenden Sie die Auswahlroute, wenn ein Mensch darin ein Asset auswählt oder generiert
ein anderes Produkt. Bild ist der Standardmedientyp; Übergeben Sie `mediaType=video`, wenn
Sie möchten Videos durchsuchen/auswählen:

```tsx
import { EmbeddedApp } from "@agent-native/embedding";

<EmbeddedApp
  url="https://assets.agent-native.com/picker?mediaType=image"
  onMessage={(name, payload) => {
    if (name === "chooseAsset") {
      insertAsset((payload as { url: string }).url);
    }
  }}
/>;
```

Externe MCP-Hosts sollten `open-asset-picker` aufrufen, anstatt dies zu erstellen
iframe von Hand. Die Aktion gibt einen Browser-Fallback-Link und MCP App-Metadaten
für Inline-Hosts. Wenn ein Benutzer ein Asset auswählt, gibt der Picker `chooseAsset`,
der alte `chooseImage`-Alias für Bild-Assets und aktualisiert das MCP-App-Modell
Kontext, in dem der Host dies unterstützt. Wenn ein Host den Fallback-Link in einem
Normale Browser-Registerkarte, anstatt die MCP-App inline zu rendern und ein Asset auszuwählen
kopiert eine Übergabezusammenfassung und zeigt einen kopierbaren Kontextblock an; Fügen Sie diese Zusammenfassung ein
zurück in den Chat, damit der externe Agent die ausgewählten Medien URL und
Asset-Metadaten.

Codex-, Claude-Code und Claude-Desktop-Code sollten als Link-Out-Hosts behandelt werden
für diesen Fluss. Sie können MCP-Apps möglicherweise nicht inline und mit Remote-CDN-Markdown rendern
Bilder werden im Chat-Transkript möglicherweise nicht zuverlässig angezeigt. Agenten sollten die
Asset-Link als Quelle der Wahrheit; wenn eine sichtbare Inline-Vorschau in einem
Code-Editor-Chat, laden Sie das ausgewählte `previewUrl`/`downloadUrl` auf einen lokalen Server herunter
Bilddatei und betten Sie diesen absoluten lokalen Pfad ein.

Für Flows zum Generieren und Auswählen rufen Sie `open-asset-picker` mit `prompt` auf.
`autoGenerate: true` und `count: 3` (anpassbar von 1-6). Der Picker wird geöffnet
mit Kandidatenbildern und ermöglicht dem Benutzer das Anpassen von Anzahl, Seitenverhältnis oder a
Generierungsvoreinstellung vor der Auswahl des endgültigen Assets URL.

Verwenden Sie A2A, wenn ein anderer Agent Assets ohne erstellen, suchen oder exportieren muss.
menschlicher Picker UI.

### Entwickler: App-Skill verteilen

Der Assets-App-Skill hat die App-ID `assets` und wird als MCP URL gehostet
`https://assets.agent-native.com/_agent-native/mcp`.

```bash
# Einfachste gehostete Installation: exportierte Skill-Anweisungen plus MCP-Connector.
npx @agent-native/core@latest skills add assets

# Vercel/open-Kenntnisse CLI-Installation: Nur exportierte Anweisungen, keine MCP-Konfiguration.
npx skills@latest add BuilderIO/agent-native --skill assets

# Gehostete Installation: URL-nur MCP-Connector, keine gemeinsamen Geheimnisse in Skill-Dateien.
npx @agent-native/core@latest app-skill ensure --manifest templates/assets/agent-native.app-skill.json

# Lokal bearbeitbarer Start.
npx @agent-native/core@latest app-skill launch --manifest templates/assets/agent-native.app-skill.json --local --into ./assets-local

# Marktplatzpaket, inklusive Claude Code Marktplatz und Vercel Labs Skills-Adapter.
npx @agent-native/core@latest app-skill pack --manifest templates/assets/agent-native.app-skill.json --out ./dist/assets-skill

# Installieren Sie ein lokal exportiertes Assets-Bundle mit den offenen Skills CLI.
npx skills@latest add ./dist/assets-skill --skill assets -a codex -y

# Installation vom generierten Claude Code Marktplatz-Adapter.
claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace
claude plugin install agent-native-assets@agent-native-apps
```

Der exportierte Skill lehrt Agenten, den Picker für Human-in-the-Loop zu verwenden
Auswahl, direktes actions für unbeaufsichtigte Bild-/Videogenerierung und Browser
Links, wenn Inline-MCP-Apps nicht verfügbar sind.

Der Marktplatzadapter Claude enthält einen `.claude-plugin/marketplace.json`
Katalog und ein `agent-native-assets`-Plugin mit `skills/assets/SKILL.md` plus
das gehostete `.mcp.json`. Im interaktiven Claude-Code ist der gleiche Ablauf verfügbar
als `/plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace`,
`/plugin install agent-native-assets@agent-native-apps`, `/reload-plugins` und
`/mcp` für MCP-Authentifizierung.

Wenn Sie von einem unformatierten Marketplace-Bundle mit `npx skills@latest` installieren, registrieren Sie das
gehosteter MCP-Connector, damit diese Anweisungen die Live-Assets-App aufrufen können:

```bash
npx @agent-native/core@latest app-skill ensure --manifest ./dist/assets-skill/agent-native.app-skill.json --yes
```

## Was kommt als nächstes?

- [**Templates**](/docs/cloneable-saas) – das Modell zum Klonen und Besitzen
- [**Embedding SDK**](/docs/embedding-sdk) – Iframe-Auswahl und Sidecar-Muster
- [**A2A Protocol**](/docs/a2a-protocol) – wie andere Apps Assets nennen
- [**File Uploads**](/docs/file-uploads) – Speicherung und authentifizierte Asset-Bereitstellung
- [**Sharing & Privacy**](/docs/sharing) – Zugriffskontrolle auf Bibliotheksebene
