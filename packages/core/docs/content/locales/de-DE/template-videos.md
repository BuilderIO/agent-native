---
title: "Video"
description: "Ein programmatisches Videostudio für Bewegungsgrafiken, Produktdemos und kinetischen Text. Generieren Sie Animationen aus einer Eingabeaufforderung und optimieren Sie sie auf einer Zeitachse."
---

# Video

Ein programmatisches Videostudio für die Art von Bewegungsgrafiken, Produktdemos und Videos mit kinetischem Text, bei denen das Keyframeing von Hand mühsam ist. Bitten Sie den Agenten um „eine 6-Sekunden-Logo-Enthüllung, die nach 2 Sekunden eingeblendet wird“, und er erstellt die Animation. Passen Sie Timing, Easing und Kamerabewegungen auf einer Zeitleiste an und rendern Sie sie dann in MP4 oder WebM.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Logo-Reveal</h1><span class='wf-pill accent'>6 seconds</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Render</button></div><div class='wf-card' style='flex:1;display:flex;align-items:center;justify-content:center;min-height:250px'><div style='text-align:center'><strong>Remotion-Vorschau</strong><br/><small class='wf-muted'>logo scales in as the title fades</small></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><div style='display:flex;gap:8px;align-items:center'><span class='wf-pill'>0s</span><span class='wf-pill'>2s</span><span class='wf-pill'>4s</span><span class='wf-pill'>6s</span><div style='flex:1'></div><button>Neue Spur</button></div><div class='wf-box'>Titel einblenden · Frames 0-48</div><div class='wf-box'>Logo skalieren · Frames 48-120</div><div class='wf-box'>Kamerafahrt · Frames 72-144</div></div></div>"
}
```

Wenn Sie das Studio öffnen, wird auf dem Startbildschirm eine Liste der Kompositionen angezeigt. Klicken Sie darauf und Sie erhalten oben einen Player, unten eine Zeitleiste und rechts ein Eigenschaftenfenster. Der Agent weiß immer, welche Komposition Sie geöffnet haben.

```an-diagram title="Animation als Daten" summary="Eine Komposition ist eine React-Komponente; Jede Animation liest von einer Spur, sodass der Agent und die Zeitleiste dieselben Daten bearbeiten."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Timeline<br><small class=\"diagram-muted\">ziehen, Größe ändern, scrubben</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">\"fade in at 2s\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">AnimationTrack</span><small class=\"diagram-muted\">startFrame / easing / animatedProps</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>React-Komposition<br><small class=\"diagram-muted\">Remotion &lt;Player&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">MP4 / WebM</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Was Sie damit machen können

- **Generieren Sie Animationen aus einer Eingabeaufforderung.** „Fügen Sie eine Titelkarte hinzu, die nach 2 Sekunden eingeblendet wird und bis 5 Sekunden anhält.“ Der Agent bearbeitet die Komposition.
- **Passen Sie das Timing auf einer Zeitleiste an.** Ziehen Sie Animationsspuren und ändern Sie ihre Größe, scrollen Sie durch Frames und legen Sie Beschleunigungskurven visuell fest.
- **Animieren Sie die Kamera.** Schwenken, Zoomen und Neigen mit Werkzeugen auf dem Bildschirm. Klicken Sie auf das Werkzeug, ziehen Sie es in die Vorschau und ein Keyframe wird automatisch erstellt.
- **Beginnen Sie mit einer leeren Komposition oder einem Beispiel.** Die Vorlage enthält eine In-Code-Komposition (`BlankComposition`), mit der Sie beginnen können; Beispielkompositionen – kinetischer Text, Logo-Enthüllungen, Partikelausbrüche, interaktive UI-Demos, Diashows – laden Sie aus der Datenbank, und Sie können Ihre eigenen hinzufügen.
- **Easing-Kurven visuell bearbeiten.** Über 30 Kurven im Lieferumfang enthalten – Power, Back, Bounce, Circ, Elastic, Expo, Sinus und Federphysik.
- **Rendern Sie in MP4 oder WebM** mit 1x, 2x oder 3x Supersampling für gestochen scharfen Text und Vektoren während des Kamerazooms.

Dies ist eher ein Tool für Entwickler als andere Vorlagen – Kompositionen sind React-Komponenten, sodass Power-User (oder der Agent) ganz neue Animationstypen von Grund auf schreiben können. Aber alltägliche Optimierungen („das Tippen verlangsamen“, „die Partikelanzahl auf 12 senken“) sind nur Geschwätz.

## Erste Schritte

Live-Demo: [videos.agent-native.com](https://videos.agent-native.com).

Wenn Sie das Studio öffnen:

1. Wählen Sie eine Komposition auf dem Startbildschirm aus.
2. Probieren Sie den Agenten aus: „Fügen Sie eine Logo-Einblendung hinzu, die nach 2 Sekunden eingeblendet wird.“ Sehen Sie sich das Timeline-Update an.
3. Ziehen Sie Titel zur Neuzeit, klicken Sie auf das Kamera-Tool und scrollen Sie durch den Player.

### Nützliche Eingabeaufforderungen

- „Fügen Sie eine Titelkarte hinzu, die nach 2 Sekunden eingeblendet wird und bis 5 Sekunden anhält.“
- „Stellen Sie die Kamera so ein, dass das Logo zwischen Bild 60 und 90 zweifach vergrößert wird.“
- „Machen Sie die Eingabegeschwindigkeit langsamer – 40 % länger.“
- „Der Partikelstoß ist zu dicht. Senken Sie die Zahl auf 12.“
- „Erstellen Sie eine neue Komposition namens Intro-Loop, 1080 x 1080, 6 Sekunden.“
- „Fügen Sie eine Klickanimation zur Schaltflächenzone hinzu und animieren Sie den Cursor dorthin.“
- „Geben Sie diesem Track eine Feder-Entspannung statt eine Entspannung.“

Wenn Sie eine Spur in der Timeline auswählen und Befehl+I drücken, übernimmt der Agent diese Auswahl – „diese Spur schneller machen“ funktioniert einfach.

## Für Entwickler

Der Rest dieses Dokuments richtet sich an alle, die die Videovorlage teilen oder erweitern. Diese Vorlage ist codeorientierter als die anderen – jede Komposition ist eine React-Komponente und jede Animation sind Daten auf einer Spur.

### Architektur

Alles, was Sie im Studio sehen, ist Code. Eine Komposition ist ein `CompositionEntry` in `app/remotion/registry.ts`, das auf eine React-Komponente in `app/remotion/compositions/` zeigt. Jede Animation in dieser Komponente wird von einem `AnimationTrack` gelesen, sodass Benutzer sie in der Zeitleiste UI ziehen, in der Größe ändern und zeitlich anpassen können. Der Agent kann neue Kompositionen erstellen, Titel hinzufügen, Easing optimieren und ganze React-Komponenten schreiben, die in die Registrierung eingebunden werden.

Das Studio läuft auf dem `<Player>` von Remotion für die Vorschau und auf dem CLI von Remotion für das endgültige Rendern. Die Ausgabe erfolgt standardmäßig auf 1920 x 1080 bei 30 Bildern pro Sekunde.

### Schnellstart

Gerüst einer neuen Video-App aus dem CLI:

```bash
npx @agent-native/core@latest create my-video-app --standalone --template videos
cd my-video-app
pnpm install
pnpm dev
```

Öffnen Sie das Studio in Ihrem Browser, erstellen Sie eine Komposition und beginnen Sie ganz von vorne. Bitten Sie den Agenten um etwas wie „Fügen Sie eine Logo-Enthüllung hinzu, die nach 2 Sekunden eingeblendet wird“, und er wird die Komposition für Sie bearbeiten.

### Hauptfunktionen

**React-basierte Kompositionen.** Videos sind Remotion-gestützte React-Komponenten mit SQL-gestützten Benutzerkompositionen und einer optionalen Coderegistrierung für lokale Standardeinstellungen.

**Timeline-First-Animation.** Dauerspuren, Keyframes, Beschleunigungskurven, Kamerabewegungen und programmatische Ausdrucksspuren bearbeiten alle dieselben Kompositionsdaten.

**Anpassbare Bewegungssysteme.** Parameter, Cursorspuren, interaktive Schwebezonen, Bereichsnavigation und wiederholte Wiedergabe machen generierte Animationen ohne Code anpassbar.

**Rendern und Persistenz.** Kompositionseinstellungen, Qualität, FPS, Spurwerte und Überschreibungen bleiben pro Komposition bestehen und werden über Remotion in MP4 oder WebM gerendert.

### Zusammenarbeit mit dem Agenten

Der Agent weiß immer, welche Komposition Sie geöffnet haben. Der Navigationsstatus (`{ view, compositionId }`) wird in die Tabelle `application_state` des Frameworks geschrieben und die Aktion `view-screen` gibt ihn plus einen Hinweis zurück, der auf `app/remotion/registry.ts` zeigt. Sie müssen dem Agenten nicht sagen, auf welcher Komposition Sie sich befinden – bitten Sie ihn, auf „diese“ zu reagieren, und er wird es tun.

Unter der Haube nennt der Agentenaktionen wie `navigate`, `save-composition` und `generate-animated-component`. Von SQL unterstützte Kompositionsdatensätze werden über `save-composition` erstellt oder aktualisiert. Code-gestützte Remotion-Komponenten sind weiterhin in `app/remotion/compositions/*.tsx` verfügbar und in `app/remotion/registry.ts` registriert.

### Datenmodell

Serverseitiges Schema befindet sich in `templates/videos/server/db/schema.ts`:

```an-schema title="Videodatenmodell" summary="Von SQL unterstützte Kompositionen sowie Designsysteme und verschachtelbare Ordner, jeweils mit einer Framework-Shares-Tabelle."
{
  "entities": [
    {
      "id": "compositions",
      "name": "compositions",
      "note": "User-created compositions and overrides; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "type", "type": "text" },
        { "name": "data", "type": "text", "note": "Vollständige Komposition JSON Blob" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "folders",
      "name": "folders",
      "note": "Nestable folders; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "name", "type": "text" }
      ]
    },
    {
      "id": "folder_memberships",
      "name": "folder_memberships",
      "note": "Viele-zu-viele schließen sich an",
      "fields": [
        { "name": "folder_id", "type": "text", "fk": "folders.id" },
        { "name": "composition_id", "type": "text", "fk": "compositions.id" }
      ]
    }
  ],
  "relations": [
    { "from": "folders", "to": "folder_memberships", "kind": "1-n", "label": "members" },
    { "from": "compositions", "to": "folder_memberships", "kind": "1-n", "label": "in folders" }
  ]
}
```

Jede Tabelle verfügt außerdem über eine passende Framework-Anteilstabelle (`composition_shares`, `design_system_shares`, `folder_shares`), die von `createSharesTable()` erstellt wurde.

- `compositions` – ID, Titel, Typ, `data` (vollständiger Kompositions-JSON-Blob), Besitzspalten, Zeitstempel.
- `composition_shares` – Standard-Aktienzuteilungen, erstellt von `createSharesTable()`.
- `design_systems` – wiederverwendbare Marken-Tokens (Farben, Typografie, Abstände, Assets, benutzerdefinierte Anweisungen, `is_default`-Flagge) mit `ownableColumns`.
- `design_system_shares` – Aktienzuschüsse für Designsysteme.
- `folders` – verschachtelbare Ordner für die Bibliotheksorganisation, mit `ownableColumns`.
- `folder_shares` – Freigabeberechtigungen für Ordner.
- `folder_memberships` – Viele-zu-viele-Verbindung zwischen einem `folder_id` und einem `composition_id`.

### Ordner und Designsysteme

Kompositionen können in Ordnern organisiert und mit Designsystemen gestaltet werden. Actions: `create-folder`, `rename-folder`, `delete-folder`, `move-composition-to-folder`. Designsystem actions: `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `set-default-design-system`, `apply-design-system`, `analyze-brand-assets`. Importieren Sie actions: `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF).

Die Registrierung in `app/remotion/registry.ts` ist die In-Code-Quelle der Wahrheit für das, was mit der Vorlage geliefert wird. In der SQL-Tabelle werden vom Benutzer erstellte Kompositionen und Überschreibungen gespeichert. Der Studiostatus (Trackbearbeitungen pro Komposition, Überschreibungen von Requisiten, Kompositionseinstellungen) wird unter `videos-tracks:<id>`, `videos-props:<id>` und `videos-comp-settings:<id>` auf `localStorage` gespiegelt und beim Laden wieder tief in die Registrierungseinstellungen eingefügt.

TypeScript-Kernformen (`app/types.ts`):

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` – `property`, `from`, `to`, `unit`, plus optional `keyframes`, `programmatic`, `description`, `codeSnippet`, `parameters`, `parameterValues`.
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

Kompositionen sind standardmäßig privat. Die Sichtbarkeit kann `private`, `org` oder `public` sein, und Freigabegewährungen gewähren `viewer`-, `editor`- oder `admin`-Rollen – verbunden durch das Freigabeprimitiv des Frameworks.

### Anpassen

Der Vorlagenordner ist `templates/videos/` (der für den Benutzer sichtbare Slug ist `video`, aber der Ordner ist Plural).

**Actions** — `templates/videos/actions/`

- `view-screen.ts` – gibt den aktuellen Navigationsstatus für den Agenten zurück.
- `navigate.ts` – Navigieren Sie zu einer Komposition (`--compositionId <id>`) oder der Startansicht (`--view home`).
- `save-composition.ts` – Erstellen oder aktualisieren Sie einen von SQL unterstützten Kompositionsdatensatz.
- `generate-animated-component.ts` – generiert eine neue Remotion-Komponentendatei mit Boilerplate.
- `validate-compositions.ts` – Überprüfen Sie alle registrierten Kompositionen auf strukturelle Probleme.
- `list-compositions.ts`, `get-composition.ts`, `update-composition.ts`, `delete-composition.ts` – von SQL unterstützte Kompositionsdatensätze lesen, aktualisieren und löschen.

**Routen** – `templates/videos/app/routes/`

- `_index.tsx` – Studiohaus; rendert die Shell- und Kompositionsliste.
- `c.$compositionId.tsx` – Kompositionseditor (Zeitleiste, Player, Eigenschaftenfenster).
- `components.tsx` – Komponentenbibliotheksbrowser.
- `team.tsx` – Teammanagement.

**Remotion-Interna** – `templates/videos/app/remotion/`

- `registry.ts` – die maßgebliche Kompositionsliste.
- `compositions/` – ein `.tsx` pro Zusammensetzung, plus ein `index.ts`-Lauf.
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx` – umschließt Kompositionsinhalte mit der Kameratransformation.
- `hooks/`, `ui-components/`, `components/` – interaktive Elementhelfer, Cursor-Rendering, animierte Element-Wrapper.

**Studio UI** – `templates/videos/app/components/`

- `Timeline.tsx` – die vollständig kontrollierte Zeitleiste (`viewStart` / `viewEnd` besitzen intern keinen Status).
- `VideoPlayer.tsx` – Remotion `<Player>`-Wrapper mit bereichsbeschränkter Wiedergabe.
- `TrackPropertiesPanel.tsx`, `CompSettingsEditor.tsx`, `PropsEditor.tsx` – die rechten Seitenplatten.
- `CameraToolbar.tsx`, `CameraControls.tsx` – Kamera-Tools und numerische Steuerelemente.

**Agentenanweisungen** – `templates/videos/AGENTS.md` ist die ausführliche Anleitung, die der Agent liest. Es behandelt die Animation-as-Track-Regel, das Kamerasystem, das Cursorsystem, CSS-Filtereinheiten, die interaktive Komponentenregistrierung, UI-Abstände und Checklisten zum Erstellen oder Bearbeiten von Kompositionen.

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md` – wie man Kompositionen erstellt und registriert.
- `animation-tracks/SKILL.md` – wie man Tracks und animierte Requisiten bearbeitet.
- Plus das Standard-Framework skills: `actions`, `self-modifying-code`, `delegate-to-agent`, `storing-data`, `security`, `frontend-design`, `create-skill`, `capture-learnings`.

Um eine neue Komposition hinzuzufügen, befolgen Sie die Checkliste in `AGENTS.md`: Erstellen Sie die Komponente, deklarieren Sie `FALLBACK_TRACKS`, verwenden Sie `findTrack` / `trackProgress` / `getPropValue` (niemals Hardcode-Frames), exportieren Sie aus `compositions/index.ts`, fügen Sie einen `CompositionEntry` zur Registrierung hinzu und führen Sie `pnpm typecheck` aus.
