---
title: "Lokaler Dateimodus"
description: "Führen Sie agentennative Apps mit lokalen Markdown-, MDX- und anderen Repo-Dateien als Quelle der Wahrheit aus – einschließlich MDX-Dokumenten im Obsidian-Stil mit benutzerdefinierten Komponenten."
---

# Lokaler Dateimodus

Im lokalen Dateimodus kann eine agentennative App ihre normale UI- und Aktionsoberfläche anhängen
direkt zu Dateien in einem Repository oder Arbeitsbereich. Die App fühlt sich immer noch wie eine gehostete App an
Produkt, aber seine Listenansichten, Editor- und Agent-Tools lesen und schreiben lokale Dateien
anstelle von SQL-gestützten App-Datensätzen.

Die erste Implementierung befindet sich in der Inhaltsvorlage: Die linke Seitenleiste ist
wird aus lokalen `.md`- und `.mdx`-Dateien gefüllt. Wenn Sie eine Seite auswählen, wird der Standard geöffnet
Inhaltseditor und Speichern schreibt zurück in die ausgewählte Datei. Dieselben Dateien können
kann auch von Codex, Claude Code, dem Agent-Native-Sidebar-Agenten oder einem normalen bearbeitet werden
Herausgeber.

Was den Inhalt angeht, fühlt sich das Produkt dadurch wie Open-Source-Obsidian für MDX an:
Ihre Dokumente bleiben als Dateien bestehen, während die App einen visuellen Editor, Agentenaktionen, hinzufügt
gemeinsame Kopien und umfangreiche interaktive MDX-Komponenten.

Verwenden Sie den lokalen Dateimodus, wenn Sie einen Repo-First-Workflow wünschen:

- ein Dokumenten-Repo mit `docs/*.mdx`
- ein Blog mit `blog/*.mdx`
- Ressourcen wie Positionierung, Nachrichten oder Teamnotizen in `resources/*.md`
- eine persönliche Wissensdatenbank im Obsidian-Stil mit einem umfangreicheren MDX-Editor
- Dokumente, die interaktive benutzerdefinierte MDX-Blöcke benötigen, die aus lokalem React-Code generiert werden
- App-Artefakte, die für Programmierer leicht zu prüfen und zu patchen sein sollten

Verwenden Sie den Datenbankmodus, wenn Sie die gehostete kollaborative App-Erfahrung wünschen:
Mehrbenutzerfreigabe, SQL-gestützte Berechtigungen, Kommentare, Versionsverlauf und
Produktionshosting ohne Zugriff auf das lokale Dateisystem.

## Das mentale Modell

Es gibt zwei Source-of-Truth-Modi:

| Modus              | Quelle der Wahrheit                             | Am besten für                                                                              |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Datenbankmodus     | SQL Zeilen bis Drizzle                          | Gehostete Apps, Zusammenarbeit, Freigabe, Kommentare, Versionsverlauf                      |
| Lokaler Dateimodus | Repo-Dateien deklariert von `agent-native.json` | Lokale/Entwickler-Workflows, Git-Überprüfung, Coding-Agent-Änderungen, dateinativer Inhalt |

UI und Agentenaktionen sollten in beiden Modi die gleiche Form behalten. Ein Inhalt
Editor bearbeitet weiterhin Dokumente; Der Unterschied besteht darin, ob diese Dokumente aufgelöst werden
in SQL Zeilen oder lokale Dateien.

```an-diagram title="Gleiche Handlungen, zwei Quellen der Wahrheit" summary="Die Benutzeroberfläche und der Agent rufen in beiden Modi identische Aktionen auf. Die Aktionsschicht entscheidet, ob jeder Aufruf in SQL-Zeilen oder Repo-Dateien aufgelöst wird."
{
  "html": "<div class=\"diagram-mode\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">Content-UI</div><div class=\"diagram-node\">Agent + Actions<br><small class=\"diagram-muted\">list/get/update-document</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-row resolve\"><div class=\"diagram-panel\" data-rough><span class=\"diagram-pill accent\">Datenbankmodus</span><small class=\"diagram-muted\">SQL rows via Drizzle</small><small class=\"diagram-muted\">gehostet · Teilen · Kommentare · Verlauf</small></div><div class=\"diagram-panel\" data-rough><span class=\"diagram-pill ok\">Local File Mode</span><small class=\"diagram-muted\">repo files via agent-native.json</small><small class=\"diagram-muted\">Git-Review · Coding-Agent-Edits</small></div></div></div>",
  "css": ".diagram-mode{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mode .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mode .diagram-arrow{font-size:22px;line-height:1}.diagram-mode .resolve{display:flex;gap:12px;flex-wrap:wrap}.diagram-mode .diagram-panel{display:flex;flex-direction:column;gap:4px;padding:12px 14px}"
}
```

## Beispiel-Repo

Ein Inhaltsarbeitsbereich kann so klein sein:

```an-file-tree title="Ein Content-Workspace-Repo"
{
  "entries": [
    { "path": "agent-native.json", "note": "Deklariert, welche Ordner Content-Roots sind und welche Arten sie haben" },
    { "path": "docs/", "note": "Content-Root: erscheint in der Sidebar als Seiten" },
    { "path": "docs/getting-started.mdx" },
    { "path": "docs/guides/custom-components.mdx" },
    { "path": "blog/", "note": "Content-Root" },
    { "path": "blog/launch-post.mdx" },
    { "path": "resources/", "note": "Content-Root" },
    { "path": "resources/messaging/positioning.md" },
    { "path": "components/", "note": "KEIN Content-Root: Preview-Komponentenbibliothek, die MDX importieren kann" },
    { "path": "components/FrameworkTabs.tsx" },
    { "path": "components/Callout.tsx" },
    { "path": "extensions/", "note": "KEIN Content-Root: lokale Extension-Bibliothek (sandboxed Widgets)" },
    { "path": "extensions/doc-status/extension.json" },
    { "path": "extensions/doc-status/index.html" }
  ]
}
```

Im lokalen Dateimodus zeigt die Inhaltsseitenleiste `docs/`, `blog/` und
`resources/` Bäume als Seiten. Wenn Sie `docs/getting-started.mdx` auswählen, wird das geöffnet
Datei im Standard-Inhaltseditor; Bearbeitung im UI schreibt zurück nach
`docs/getting-started.mdx`.

`components/` ist kein Inhaltsstammverzeichnis. Es handelt sich um eine Vorschau-Komponentenbibliothek, die MDX
Dateien können importiert oder referenziert werden. Der Editor kann einfache lokale MDX-Komponenten rendern
ohne dass Sie die gesamte Content-App klonen oder forken müssen.

`extensions/` ist ebenfalls kein Inhaltsstammverzeichnis. Es handelt sich um eine lokale Erweiterungsbibliothek:
kleine Sandbox-Widgets, die in App-Slots gerendert werden können, während ihre Quelle drin bleibt
das Repo.

## Inhalt in ein Repo installieren

Installieren Sie für vorhandene Dokumente, Blogs oder MDX-Arbeitsbereiche die lokalen Inhaltsdateien
Fähigkeit:

```bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
```

Dadurch wird der `content`-Skill in die Agent-Skill-Ordner des Repositorys kopiert und geschrieben
oder aktualisiert `agent-native.json` mit den Inhaltsstandards:

- `mode: "local-files"` auf Arbeitsbereichsebene
- `apps.content.mode: "local-files"`
- Inhaltsstämme für `docs/`, `blog/`, `content/` und `resources/`
- `components/` für lokale MDX-Komponenten
- `extensions/` für lokale Erweiterungs-Widgets

Der installierte Skill weist Programmieragenten an, Content actions zu verwenden
(`list-documents`, `get-document`, `edit-document`, `update-document`,
`share-local-file-document` und Komponentendatei actions) bei einer lokalen Content-App
oder Agent Native Desktop Bridge macht sie verfügbar. Wenn keine Bridge läuft, wird der Skill
greift auf sichere direkte Repo-Bearbeitungen zurück und behält dabei Frontmatter, Importe, JSX,
und unbekanntes MDX.

## Konfiguration

Fügen Sie `agent-native.json` zum Repository oder Arbeitsbereichsstamm hinzu:

```json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "kind": "docs",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Blog",
          "path": "blog",
          "kind": "blog",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Resources",
          "path": "resources",
          "kind": "resources",
          "extensions": [".md", ".mdx"]
        }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
```

Sie können lokale Dateien auch mit `AGENT_NATIVE_MODE=local-files` oder
`AGENT_NATIVE_DATA_MODE=local-files`; Das Manifest wird bevorzugt, weil es
dokumentiert den Ordnervertrag im Repo selbst.

## Inhaltsdateiformat

Der Inhalt lautet Markdown und MDX. Frontmatter enthält Seitenmetadaten und der Text ist
das bearbeitbare Dokument:

```mdx
---
title: "Erste Schritte"
icon: "sparkles"
isFavorite: true
updatedAt: "2026-06-12T20:00:00.000Z"
---

# Erste Schritte

Use <FrameworkTabs value="react" /> to show framework-specific code.
```

Der Titel stammt von `title` frontmatter, sofern vorhanden, andernfalls von
Dateiname. Der Editor behält die MDX-Quelle bei, die er noch nicht visuell bearbeiten kann, also
Codierungsagenten und normale Texteditoren bleiben sichere Fluchtwege.

## Benutzerdefinierte MDX-Komponenten

Inhalte können eine Vorschau lokaler Komponenten aus dem konfigurierten `components`-Ordner anzeigen.
Dies ist für MDX-Komponenten im Dokumentstil wie Registerkarten, Beschriftungen und Pakete gedacht.
Installieren Sie Snippets oder Framework-spezifische Codeblöcke.

Fügen Sie beispielsweise eine interaktive Komponente neben Ihrem Inhalt hinzu:

```tsx
// components/ImpactCounter.tsx
import { useState } from "react";

export function ImpactCounter({
  label = "points",
  accent = "blue",
  featured = false,
}: {
  label?: string;
  accent?: "blue" | "green" | "purple";
  featured?: boolean;
}) {
  const [count, setCount] = useState(3);
  const accentClass =
    accent === "green"
      ? "border-green-300 bg-green-50"
      : accent === "purple"
        ? "border-purple-300 bg-purple-50"
        : "border-blue-300 bg-blue-50";

  return (
    <div className={`rounded-md border p-4 ${accentClass}`}>
      <div className="text-sm text-muted-foreground">Launch impact</div>
      <div className="mt-1 text-3xl font-semibold">
        {count} {label}
      </div>
      {featured ? <div className="mt-1 text-sm">Featured metric</div> : null}
      <button
        type="button"
        className="mt-3 rounded border px-3 py-1 text-sm"
        onClick={() => setCount((value) => value + 1)}
      >
        Add point
      </button>
    </div>
  );
}

export const ImpactCounterInputs = {
  label: {
    type: "string",
    label: "Metric label",
    default: "points",
  },
  accent: {
    type: "select",
    label: "Accent",
    options: ["blue", "green", "purple"],
    default: "blue",
  },
  featured: {
    type: "boolean",
    label: "Featured",
    default: false,
  },
};
```

Dann verwenden Sie es aus einer beliebigen lokalen MDX-Datei:

```mdx
---
title: "Notizen starten"
---

# Notizen starten

<ImpactCounter label="wins" />
```

Der Content-Entwicklungsserver erkennt PascalCase-benannte Exporte und PascalCase-Standardwerte
Exporte aus `.tsx`-, `.jsx`-, `.ts`- und `.js`-Dateien unter `components/`. Diese
Komponenten werden im Editor gerendert und im Slash-Menü darunter angezeigt
**Lokale Komponenten**. Durch das Einfügen eines Schrägstrichs wird ein minimales Tag erstellt, z. B.
`<ImpactCounter />`; Fügen Sie bei Bedarf Requisiten zur MDX-Quelle hinzu.

Die Komponentenausführung ist absichtlich eine lokale Dev/Desktop-Bridge-Funktion, nicht
einfacher Zugriff auf gehostete Browserordner. Wenn Sie `content.agent-native.com` öffnen,
Wählen Sie **Lokale Dateien** und einen Ordner in Chrome, den die App lesen und schreiben kann
die Dateien `.md` und `.mdx` über den Browser-Dateisystemzugriff auf API, aber
Chrome stellt keinen absoluten Ordnerpfad für die Kompilierung durch Vite bereit
`components/*.tsx`. Um benutzerdefinierte React-Komponenten in der Vorschau anzuzeigen und im laufenden Betrieb neu zu laden, führen Sie
Inhalte lokal oder verwenden Sie Agent Native Desktop, damit die vertrauenswürdige lokale Bridge dies tun kann
registrieren Sie den ausgewählten Arbeitsbereich beim lokalen Content-Entwicklungsserver. In diesem Modus
Änderungen an vorhandenen Komponentendateien, Hot-Reload über Vite und Hinzufügen von oder
Durch das Entfernen von Komponentendateien werden die Komponentenregistrierung und das Slash-Menü neu geladen.

Agenten können auch mit diesen registrierten Komponentendateien arbeiten. Verwenden
`list-local-component-files`, um dann die registrierte Arbeitsbereichs-ID zu finden
`write-local-component-file` zum Erstellen oder Aktualisieren von `.tsx`, `.jsx`, `.ts` oder
`.js`-Dateien im Ordner `components/` des Arbeitsbereichs. Die MDX-Dateien bleiben die
Quelle der Wahrheit für die Komponentenverwendung; Die Komponentendateien bleiben normale Repo
Quelldateien mit Git überprüft.

Wenn eine Komponente Eingabemetadaten exportiert, wählen Sie die Komponente im Editor aus
zeigt eine Schaltfläche zum Bearbeiten in der oberen rechten Ecke der Komponente an. Unterstützte Eingabetypen
sind `string`, `textarea`, `number`, `boolean` und `select`. Das Formular schreibt
wechselt zurück zum MDX-Tag, sodass lokale Dateien die Quelle der Wahrheit bleiben. Die
Metadaten können als `ComponentNameInputs`, `ComponentNameConfig.inputs`,
`Component.inputs` oder `agentNative.inputs`.

Einfache Komponenten-Tags mit Literal-Requisiten können inline in der Vorschau angezeigt werden:

```mdx
<FrameworkTabs value="react" />

<Callout type="warning">This setting affects production deploys.</Callout>
```

Komplexe JSX-Ausdrücke bleiben in der Quelle erhalten. Wenn der Editor dies nicht sicher tun kann
Sehen Sie sich noch eine Vorschau einer Komponenten-Requisite an, es wird ein Warnungsplatzhalter angezeigt und nicht
Daten werden stillschweigend gelöscht.

## Lokale Dateien teilen

Lokale Dateien werden nicht direkt freigegeben, da andere Benutzer einen Pfad darauf nicht lesen können
Ihre Maschine. Mit der Schaltfläche „Teilen“ in der Symbolleiste „Inhalt“ wird ein
datenbankgestützte Kopie der ausgewählten Datei, navigiert zu dieser Kopie und öffnet die
normales Freigabe-Popover. Die ursprüngliche lokale Datei verbleibt unter „Lokale Dateien“. die
Datenbankkopie erscheint unter „Freigegebene Kopien“ im lokalen Dateimodus und verwendet die
Standardmodell für die gemeinsame Nutzung von Dokumenten.

## Lokale Erweiterungen

Der lokale Dateimodus kann auch Repo-gestützte Erweiterungen aus der konfigurierten Datei laden
`extensions`-Ordner. Jede Erweiterung ist ein Verzeichnis mit einem `extension.json`
Manifest und eine HTML-Eintragsdatei:

```text
extensions/
  doc-status/
    extension.json
    index.html
```

```json
{
  "id": "doc-status",
  "name": "Doc Status",
  "description": "Shows metadata for the selected Content file.",
  "entry": "index.html",
  "slots": ["content.sidebar.bottom"],
  "permissions": {
    "appActions": ["list-documents"],
    "extensionData": true
  }
}
```

`index.html` ist das gleiche Alpine/Tailwind-Erweiterungskörperformat, das von Normal verwendet wird
datenbankgestützte Erweiterungen. Wenn die Content-App eine lokale Erweiterung erkennt,
deklariert `content.sidebar.bottom` und rendert diese Erweiterung am Ende von
die Inhaltsseitenleiste. Der Host übergibt `window.slotContext` mit dem ausgewählten
Dokument-ID, Titel, Quellmetadaten und ob sich der Inhalt im lokalen Dateimodus befindet.

Lokale Erweiterungen werden von der App in der Vorschau angezeigt, aber als Dateien bearbeitet. Die Erweiterungen
Liste zeigt sie mit einem Lokaldatei-Logo an und der Ganzseitenbetrachter verweist darauf
die Eintragsdatei. Von SQL unterstützte Erweiterung actions wie Aktualisieren, Löschen, Teilen und
Verlauf gilt nicht; Verwenden Sie Ihren Editor, Codex-, Claude-Code oder den Git-Verlauf für
Quellenänderungen.

Für v1 sind lokale Erweiterungen absichtlich konservativ:

- Sie können `extensionData` für ihren eigenen kleinen Laufzeitstatus verwenden
- Sie können nur die in `extension.json` aufgeführten `appAction`s aufrufen
- rohe SQL-Helfer und externe `extensionFetch` sind deaktiviert
- Slot-Ziele werden in `extension.json` deklariert und nicht über SQL installiert

Dadurch erhalten lokale Arbeitsbereiche eine Obsidian-ähnliche Plugin-Oberfläche, ohne dass eine
Beliebige Repo-Dateien erben alle Funktionen einer datenbankgestützten Erweiterung.

## Wie Apps es nutzen

Der lokale Dateimodus wird durch die lokalen Artefakt-Helfer des Frameworks implementiert.
Eine App deklariert Roots für die Artefakttypen, die sie besitzt, und liest und schreibt dann
über dieselbe Aktionsoberfläche, die UI und Agent bereits verwenden.

Für Inhalte bedeutet das:

- `list-documents` listet konfigurierte `.md`- und `.mdx`-Dateien auf.
- `get-document` liest eine ausgewählte lokale Datei.
- `update-document` schreibt die ausgewählte lokale Datei.
- `create-document` erstellt eine neue lokale `.mdx`-Datei im ausgewählten Ordner.
- `delete-document` löscht die lokale Datei.
- Die Suche erfolgt über die konfigurierten lokalen Dateien.

Das Verschieben, Umbenennen und Neuanordnen lokaler Dateiseiten aus dem Inhalt UI ist nicht möglich
wird noch unterstützt. Führen Sie diese Vorgänge im Arbeitsbereich oder mit einem Codierungsagenten aus. die
Die Inhaltsseitenleiste spiegelt den resultierenden Dateibaum wider.

Dadurch bleibt der Agentenvertrag einfach: Der Agent kann weiterhin Inhalte actions verwenden,
und diese actions entscheiden, ob das Ziel SQL-backed oder file-backed ist.

Andere Apps können im Laufe der Zeit dasselbe Muster annehmen. Eine Slides-App kann Karten erstellen
`slides/*.mdx` zu Decks, eine Pläne-App kann `plans/*` zu Plandokumenten zuordnen und ein
Dashboards-App kann `dashboards/*.mdx` Dashboards zuordnen. Diese App-spezifischen
Ordner sind Konventionen, die über demselben lokalen Artefaktvertrag liegen.

## Lokale Dateien vs. Export/Import

Inhalt hat zwei verschiedene Datei-Workflows:

| Workflow                     | Was passiert                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/local-files` Export/Import | Der Datenbankmodus bleibt die Quelle der Wahrheit. Dateien sind eine explizite Synchronisierungsoberfläche, die Sie exportieren, bearbeiten, in der Vorschau anzeigen und importieren können. |
| Lokaler Dateimodus           | Dateien sind die Quelle der Wahrheit. Die Inhaltsseitenleiste und der Editor arbeiten direkt mit lokalen Dateien.                                                                             |

Verwenden Sie Export/Import, wenn Sie gelegentlich Dateien in einem gehosteten Arbeitsbereich überprüfen möchten.
Verwenden Sie den lokalen Dateimodus, wenn das Repo selbst der Arbeitsbereich ist.

## Geschichte und Zusammenarbeit

Der lokale Dateimodus basiert auf dem dateinativen Verlauf:

- übertragen Sie wichtige Änderungen an Git
- Pull-Anfragen zur Überprüfung verwenden
- Lassen Sie Codierungsagenten dieselben Dateien direkt bearbeiten
- Verwenden Sie normale Dateiunterschiede, um Änderungen zu verstehen

Der Datenbankmodus eignet sich weiterhin besser für gehostete Kollaborationsfunktionen wie
Freigabe, Kommentare, SQL-gestützter Versionsverlauf und Live-Mehrbenutzerbearbeitung.

Die Anbietersynchronisierung kann über beide Modi gelegt werden. Beispielsweise kann ein Dokumenten-Repository
Fügen Sie actions hinzu, die Inhalte von einem CMS in lokale MDX-Dateien ziehen oder ausgewählte Dateien per Push übertragen
lokale Dateien zurück zu diesem CMS.

## Produktionssicherheit

Der lokale Dateimodus gewährt der App-Actions direkten Schreibzugriff auf den konfigurierten Arbeitsbereich
Dateien. Dies eignet sich für die lokale Entwicklung und vertrauenswürdige Single-Tenant-Dateien
Brücken, aber es ist nicht das Standard-Produktionssicherheitsmodell.

Bei `NODE_ENV=production` verweigert das Framework den `local-files`-Modus, es sei denn, Sie
set:

```bash
AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION=true
```

Legen Sie dies nur für eine vertrauenswürdige Einzelmandantenbereitstellung fest, die jeder verwenden kann
Die App darf die konfigurierten Dateien lesen und schreiben. Für normales Hosting:
Mehrbenutzer-Apps, verwenden Sie den Datenbankmodus und SQL-gestützte Freigabe.
