---
title: "Clips"
description: "Asynchrone Bildschirmaufzeichnung, mit dem Kalender synchronisierte Besprechungsnotizen und Push-to-Talk-Sprachdiktat – fügen Sie Clips-Links in Agenten ein und diese können Transkripte, Bilder und Zusammenfassungen lesen."
search: "Clips, Browserprotokolle, Entwicklerprotokolle, Konsolenprotokolle, Netzwerkprotokolle, Abruf XHR Chrome-Erweiterung, Diagnose-Recorder, Desktop-App"
---

# Clips

Eine App, die alles festhält: Bildschirmaufzeichnungen, Besprechungsnotizen aus Ihrem Kalender und Diktieren mit gedrückter Fn-Taste. Der Agent transkribiert, betitelt, fasst alles zusammen und indiziert es. Anschließend können Sie fragen: „Suchen Sie den Clip, in dem wir den Einführungsplan besprochen haben“, und durchsuchen Sie jedes Transkript, das Sie jemals erstellt haben.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Engineering-Clips</h1><span class='wf-pill accent'>Library</span><span class='wf-pill'>Meetings</span><span class='wf-pill'>Dictation</span><div style='flex:1'></div><button>Import</button><button class='primary'>Record</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>OKR-Review</strong><small>35 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Onboarding-Ablauf</strong><small>12 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Bug-Repro</strong><small>4 min</small></div></div><div class='wf-card' style='display:flex;gap:10px;align-items:center'><span class='wf-pill accent'>Agentenlesbar</span><span>Transkript + Frames bereit für Freigabelinks</span><div style='flex:1'></div><button>Teilen</button></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:8px'><strong>Transkriptsuche</strong><div class='wf-box'>Treffer Kapitel 03:12 · Rollout-Risiken und Owner-Übergabe</div><div class='wf-box'>Meeting-Zusammenfassung und Aufgaben</div></div></div>"
}
```

Denken Sie an Loom + Granola + Wispr Flow in einer App – aber der Agent ist ein erstklassiger Redakteur auf allen Oberflächen, und die Aufzeichnungen, Besprechungen und Diktate gehören Ihnen und nicht denen eines SaaS-Anbieters. Clips macht freigegebene Aufzeichnungen auch für Agenten lesbar: Fügen Sie einen normalen Clips-Freigabelink in einen Agenten ein, und dieser kann das Transkript als Text „hören“ und zeitgestempelte Bildschirmbilder als Bilder „sehen“ – es ist kein Rohvideo erforderlich. Frame-Viewing funktioniert in jedem bildfähigen Agenten (ChatGPT, Claude Code, Cursor, Codex); Nur-Text-Webchats erhalten weiterhin das vollständige Transkript und können einen von Ihnen hochgeladenen Frame übernehmen.

```an-diagram title="Erfassen, transkribieren, wiederverwenden" summary="Drei Eroberungsarten landen in einer Bibliothek; Der Agent transkribiert, betitelt und fasst zusammen, dann ist jedes Transkript durchsuchbar und kann geteilt werden."
{
  "html": "<div class=\"diagram-clips\"><div class=\"diagram-col\"><div class=\"diagram-node\">Bildschirmaufnahme</div><div class=\"diagram-node\">Kalendermeeting</div><div class=\"diagram-node\">Fn-halten-Diktat</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Eine Bibliothek<br><small class=\"diagram-muted\">recordings + transcripts (SQL)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">Titel · Zusammenfassung · Kapitel</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">Suchen</div><div class=\"diagram-pill\">Teilen</div><div class=\"diagram-pill\">Agentenlesbar links</div></div></div>",
  "css": ".diagram-clips{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-clips .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-clips .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-clips .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Was Sie damit machen können

- **Nehmen Sie Ihren Bildschirm auf** mit integriertem Rekorder, Webcam-Overlay, Audioaufnahme und Pause/Zuschneiden.
- **Erfassen Sie Besprechungen aus Ihrem Kalender.** Verbinden Sie Google Calendar, sehen Sie sich bevorstehende Besprechungen in der Seitenleiste an und klicken Sie bei einer beliebigen Besprechung auf „Aufzeichnen“. Sobald es endet, erhalten Sie ein Live-Transkript sowie eine KI-Zusammenfassung, Aufzählungszeichen und Aktionspunkte.
- **Push-to-Talk-Diktat.** Halten Sie Fn auf Ihrem Gerät gedrückt, sprechen Sie, und der bereinigte Text wird in die von Ihnen verwendete App verschoben. Jedes Diktat wird in einem durchsuchbaren Verlauf mit Originalen und KI-bereinigten Versionen nebeneinander gespeichert.
- **Erhalten Sie einen automatisch generierten Titel, eine Zusammenfassung und Kapitelmarkierungen** für jede Aufnahme – der Agent füllt sie aus und hält sie auf dem neuesten Stand.
- **Durchsuchen Sie alle Transkripte** – Bildschirmaufzeichnungen, Besprechungen und Diktate in einer Bibliothek. „Hier finden Sie den Clip, in dem wir den Einführungsplan besprochen haben.“
- **Clips teilen** mit Berechtigungen pro Clip (öffentlich, Team, privat). Link-Tracking und Thread-Kommentare funktionieren ebenfalls.
- **Vorschau öffentlicher Clips in Slack** mit einer spielbaren Fortsetzung im Loom-Stil nach dem
  workspace installiert Ihre Clips Slack-App.
- **Erfassen Sie Browserprotokolle mit der Chrome-Erweiterung.** Browseraufzeichnungen können
  hängen Sie geschwärzte Konsolenprotokolle an und fetch/XHR-Metadaten, was hilfreich ist für
  Produktfehler und reine Browser-Repros.
- **Fügen Sie Clips-Links in Agenten ein**, damit diese den vom Agenten lesbaren Kontext entdecken können: Metadaten, Transkriptsegmente, empfohlene Frames und Frame-Bilder mit Zeitstempel, ohne die Rohvideodatei zu empfangen.
- **Intelligente Bibliotheksansichten.** Gruppieren nach Projekt, Filtern nach Sprecher, automatisches Taggen basierend auf Inhalt.
- **Bearbeiten Sie das Transkript über den Chat.** „Korrigieren Sie das falsch transkribierte Wort bei 1:42.“ „Ziehen Sie drei Zitate für einen Blogbeitrag.“ Der Agent bearbeitet das Transkript und die UI-Updates werden live ausgeführt.

## Browserprotokolle und Entwicklerdiagnose

Verwenden Sie die Clips-Chrome-Erweiterung, wenn Sie eine Aufzeichnung plus Browserprotokolle von
die Registerkarte, die Sie debuggen. Die Erweiterung startet eine Active-Tab-Aufzeichnung und kann
geschwärzte Konsolenprotokolle, JavaScript-Ausnahmen und fetch/XHR-Netzwerk speichern
Metadaten wie Methode, redigiertes URL, Status, Dauer und Fehlertext. Es
speichert keine Anforderungstexte, Antworttexte oder Header.

Die reguläre Browser-Recorder-Seite kann Diagnosen von der Recorder-Seite speichern
selbst. Die Chrome-Erweiterung ist der Pfad für Entwicklerprotokolle mit aktiven Tabs und
Nur-Browser-Repros. Verwenden Sie in den Clips UI die Chrome-Option für Browserprotokolle und
die Desktop-App für den nahtlosesten alltäglichen Aufnahmepfad.

Die Liste der Agent-Native Clips Chrome-Erweiterungen lautet
`https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`.
Wenn Sie Ihren eigenen Clips-Server hosten, lassen Sie die Chrome-Erweiterungsoption ausgeblendet, bis
Ihr Webshop-Eintrag ist online. Legen Sie `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1`
nach der Genehmigung, die Erweiterung neben den Eingabeaufforderungen zum Herunterladen von Desktop-Apps anzuzeigen. Festlegen
`VITE_CLIPS_CHROME_EXTENSION_URL` nur, wenn Sie die Standardeinstellung überschreiben müssen
Auflistung URL.

## Von Agenten lesbare Clips

Fügen Sie einen normalen öffentlichen Clips-Freigabelink in einen Agenten ein. Die Freigabeseite wirbt mit
ein kompakter Agentenkontext URL, und dieser Kontext verweist auf das Transkript und den Frame
APIs, sodass Modelle, die nur Text oder Standbilder akzeptieren, trotzdem verstehen können, was
ist in der Aufnahme passiert.

Jeder Agent, der ein Bild URL in seine Vision abrufen kann – ChatGPT, Claude Code,
Mit Cursor, Codex und MCP verbundene Agenten – liest das Transkript und sieht das
Frames. Bei einigen Nur-Text-Webchats wird das Transkript gelesen, es werden jedoch keine Rahmenbilder abgerufen
von alleine; Laden Sie dort ein Schlüsselbild hoch oder öffnen Sie den Clip in einem bildfähigen Format
Agent.

| Endpunkt                                          | Was Agenten bekommen                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/api/agent-context.json?id=<recordingId>`        | Clip-Metadaten, Transkriptstatus, Kapitel, CTAs, empfohlene Frames und Links zu den Transkripten/Frames APIs               |
| `/api/agent-transcript.json?id=<recordingId>`     | Transkriptsegmente mit Zeitstempel mit `startMs`, `endMs`, lesbaren Zeitstempeln, Text und optionalen Quellenbezeichnungen |
| `/api/agent-frame.jpg?id=<recordingId>&atMs=<ms>` | Ein JPEG-Frame, der mit einem Originalvideo-Zeitstempel aus dem Video extrahiert wurde                                     |

Die Endpunkte folgen denselben öffentlichen/Passwort-/Ablaufregeln wie die Freigabeseite.
Passwortgeschützte Clips erfordern das einmalige Passwort; Erfolgreiche Antworten werden zurückgegeben
kurzlebige tokenisierte Links, sodass nachgeschaltete Agenten den Klartext nicht benötigen
Passwort.

Slack-Vorschauen verwenden dieselbe Freigabegrenze. Der `/api/slack/unfurl`-Webhook
gibt nur einen abspielbaren Slack `video`-Block für fertige, öffentliche Clips ohne zurück
Passwort, Ablauftreffer, Archivmarkierung oder Papierkorbmarkierung. Andere Clips erhalten weiterhin das
Normale Share-Seitentitel-/Miniaturbild-Metadaten und erfordern das Öffnen von Clips.

```an-api title="Einstiegspunkt für den Agentenkontext"
{
  "method": "GET",
  "path": "/api/agent-context.json",
  "summary": "Kompakte, für Agenten lesbare Beschreibung eines freigegebenen Clips",
  "description": "Returns clip metadata, transcript status, chapters, CTAs, recommended frames, and links to the transcript and frame APIs. Advertised by the public share page so a text- or image-only agent can understand a recording without ingesting raw video.",
  "auth": "Same public / password / expiry rules as the share page",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Clip metadata plus transcript and frame API links" }
  ]
}
```

```an-api title="Transkript mit Zeitstempel"
{
  "method": "GET",
  "path": "/api/agent-transcript.json",
  "summary": "Transkript mit Zeitstempel segments for a shared clip",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Segments with startMs, endMs, readable timestamps, text, and optional source labels" }
  ]
}
```

```an-api title="Frame mit Zeitstempel"
{
  "method": "GET",
  "path": "/api/agent-frame.jpg",
  "summary": "Ein JPEG-Frame, der mit einem Originalvideo-Zeitstempel aus dem Video extrahiert wurde",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" },
    { "name": "atMs", "in": "query", "type": "integer", "required": true, "description": "Original-video timestamp in milliseconds" }
  ],
  "responses": [
    { "status": "200", "description": "image/jpeg frame" }
  ]
}
```

## Erste Schritte

Live-Demo: [clips.agent-native.com](https://clips.agent-native.com).

1. **Öffnen Sie die Bibliothek.** Durchsuchen Sie Bildschirmaufzeichnungen, Besprechungsaufzeichnungen, Diktate usw.
   Ordner und Leerzeichen von einem Ort.
2. **Aufzeichnen oder importieren.** Erfassen Sie eine Bildschirmaufzeichnung und starten Sie sie über einen Kalender.
   Besprechung, oder verwenden Sie Push-to-Talk-Diktat.
3. **Lassen Sie den Agenten die Reinigung durchführen.** Generieren Sie einen Titel, eine Zusammenfassung, Kapitel und eine Aktion
   Elemente oder bereinigter Transkripttext.
4. **Suchen und wiederverwenden.** Fragen Sie nach dem Clip, Zitat, Aktionselement oder der Entscheidung, die Sie benötigen
   Bedürfnis, dann teilen Sie das Ergebnis mit der richtigen Sichtbarkeit.

### Nützliche Eingabeaufforderungen

- „Fassen Sie diesen Clip für ein Produktupdate zusammen.“
- „Suchen Sie die Besprechung, bei der wir den Einführungsplan besprochen haben.“
- „Entnehmen Sie drei Kundenzitate aus diesem Transkript.“
- „Erstellen Sie Aktionselemente aus dem letzten Verkaufsgespräch.“
- „Bereinigen Sie dieses Diktat und verwandeln Sie es in ein Linear-Ticket.“

## Für Entwickler

Der Rest dieses Dokuments richtet sich an alle, die die Clips-Vorlage verzweigen oder erweitern.

### Schnellstart

```bash
npx @agent-native/core@latest create my-clips --standalone --template clips
cd my-clips
pnpm install
pnpm dev
```

Clips ist eine größere Vorlage mit einem nativen Rekorder (es wird ein Desktop-Begleiter für die lokale Aufnahme mitgeliefert). Bevor Aufnahmen hochgeladen werden können, sind drei Einrichtungsschritte erforderlich:

1. **Videospeicher (erforderlich).** Verbinden Sie ein Speicher-Backend über den Onboarding-Assistenten. Der einfachste Weg ist Builder.io (kostenlos während der Beta, ein Klick). Für selbst gehosteten Speicher stellen Sie `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` und optional `S3_REGION` und `S3_PUBLIC_BASE_URL` ein. Cloudflare R2 und DigitalOcean Spaces verwenden dieselben Umgebungsvariablen mit dem Präfix `R2_*`.
2. **Google Calendar (optional).** Um anstehende Besprechungen zu synchronisieren, verbinden Sie ein Google Calendar-Konto über die Einstellungen. Der OAuth-Callback URL in dev ist `http://localhost:8094/_agent-native/google/callback`. Richten Sie einen Google OAuth-Client in [Google Cloud Console](https://console.cloud.google.com/) mit aktivierten Gmail- und Google Calendar-APIs ein.
3. **Berechtigungen zur Bildschirmaufnahme.** Erteilen Sie unter macOS dem Browser (oder der Desktop-Begleit-App) unter Systemeinstellungen → Datenschutz und Sicherheit → Bildschirmaufzeichnung die Berechtigung zur Bildschirmaufzeichnung. Browseraufzeichnungen können geschwärzte Konsolen speichern und/XHR-Diagnosen von der Rekorderseite abrufen. Sobald die Chrome-Erweiterungsliste verfügbar ist, aktivieren Sie `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1`, damit Benutzer die Erweiterung für Browserprotokolle im aktiven Tab oder die Desktop-App für den reibungslosesten nativen Erfassungspfad auswählen können.
4. **Slack-Vorschauen (optional).** Erstellen Sie eine Slack-App mit `links:read`, `links:write` und `links.embed:write`; abonnieren Sie `link_shared`; Fügen Sie Ihre Clips-Share-Domain unter **App Unfurl Domains** hinzu; Setzen Sie die Anforderung URL auf `https://your-clips.example.com/api/slack/unfurl`. und fügen Sie die OAuth-Umleitung URL `https://your-clips.example.com/api/slack/oauth/callback` hinzu. Konfigurieren Sie `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` und `SLACK_SIGNING_SECRET` und verbinden Sie dann Arbeitsbereiche über die Clips-Einstellungen.

### Hosten Sie Ihren eigenen Clips-Server

Die gehostete Clips-App unter [clips.agent-native.com](https://clips.agent-native.com)
ist lediglich eine bereitgestellte Kopie der Clips-Vorlage. Um Ihren eigenen Server zu betreiben, erstellen Sie ein Gerüst
die Vorlage, stellen Sie sie wie jede andere agentennative App bereit und verweisen Sie dann auf den Desktop
Tray-App bei Ihrer Bereitstellung.

1. **Erstellen Sie die App.**

   ```bash
   npx @agent-native/core@latest create my-clips --standalone --template clips
   cd my-clips
   pnpm-Installation
   ```

2. **Konfigurieren Sie den Produktionsstatus.** Legen Sie einen dauerhaften `DATABASE_URL` fest, den Normalen
   Produktions-Authentifizierungs-/Geheimnisvariablen von [Deployment](/docs/deployment) und eine
   Videospeicheranbieter. Builder.io Connect ist der einfachste Speicherpfad; für
   Selbst gehosteter Speicher, verwenden Sie die Variablen `S3_*` oder `R2_*` für einen S3-kompatiblen Speicher
   Eimer.

3. **Stellen Sie die Web-App bereit.** Für eine einfache Knotenbereitstellung:

   ```bash
   pnpm-Build
   Knoten .output/server/index.mjs
   ```

   Sie können auch jedes beliebige Nitro-Ziel von [Deployment](/docs/deployment) verwenden, z. B.
   als Netlify, Vercel, Cloudflare Pages, AWS Lambda oder Deno Deploy. Stellen Sie sicher
   `BETTER_AUTH_URL` ist beispielsweise der Ursprung des öffentlichen Clips
   `https://clips.example.com`.

4. **Verbinden Sie die Desktop-Tray-App.** Öffnen Sie die Desktop-Einstellungen von Clips und legen Sie fest
   **Befestigt den Server URL** beispielsweise an der öffentlichen Basis URL Ihrer Bereitstellung
   `https://clips.example.com`. Wenn die App unter einem Arbeitsbereichspfad gemountet ist,
   Fügen Sie diesen Pfad ein, z. B. `https://example.com/clips`. Klicken Sie auf **Verbinden**,
   Melden Sie sich dann mit einem Konto auf diesem Clips-Server an.

5. **Aktivieren Sie die Chrome-Erweiterung nach der Veröffentlichung.** Behalten
   `VITE_CLIPS_CHROME_EXTENSION_ENABLED` bis zum Chrome Web Store-Eintrag nicht festgelegt
   ist genehmigt. Setzen Sie es dann auf `1`, um die Browser-Protokolloption neben dem
   Desktop-App-Eingabeaufforderungen. Die Standardliste URL ist
   `https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`;
   Legen Sie `VITE_CLIPS_CHROME_EXTENSION_URL` nur fest, wenn Ihre Bereitstellung ein
   Andere Erweiterungsliste.

6. **Verbinden Sie optionale Integrationen.** Google Calendar unterstützt die Registerkarte „Besprechungen“,
   `GEMINI_API_KEY` oder Builder.io Connect ermöglicht die Bereinigung von Transkripten und Titeln
   `GROQ_API_KEY` kann Sprache-zu-Text-Fallback bieten, und Slack OAuth
   Die Verbindung in den Einstellungen ermöglicht spielbare Slack-Entfaltungen.

Führen Sie für die lokale Entwicklung die Web-App mit `pnpm dev` aus und zeigen Sie auf den Desktop
Tray-App bei `http://localhost:8094`.

### Hauptfunktionen

**Eine Bibliothek, drei Aufnahmearten.** Bildschirmaufzeichnungen, Kalenderbesprechungen und Push-to-Talk-Diktaten teilen sich eine durchsuchbare Bibliothek.

**Transkript- und KI-Pipeline.** Aufzeichnungen erhalten zeitgestempelte Transkriptsegmente, generierte Titel, Zusammenfassungen und Kapitelmarkierungen.

**Zerstörungsfreie Bearbeitung.** Zuschneiden, Teilen, Entfernen von Füllwörtern, Entfernen von Pausen und Zusammenfügen bleiben in `edits_json`, sodass das Originalmedium intakt bleibt.

**Von Agenten lesbare Freigabelinks.** Öffentliche Freigabelinks stellen Transkripte und Frames von APIs zur Verfügung, damit Agenten Aufzeichnungen verstehen können, ohne Rohvideos aufzunehmen.

**Slack spielbar entfaltet sich.** Öffentliche Freigabelinks können einen Slack `video`-Block rendern
das auf den vorhandenen `/embed/:id`-Player zeigt. Dies ist eine Workspace-Slack-App
Installation, kein globales Crawler-Verhalten: Normale Open Graph/Twitter-Metadaten sind
der Fallback, wenn die App nicht installiert ist.

### Datenmodell

Alle Daten befinden sich in SQL über Drizzle ORM. Schema: `templates/clips/server/db/schema.ts`. Aufzeichnungen, Besprechungen, Diktate, Kalenderkonten und Vokabeln tragen alle den Standard `ownableColumns` und verfügen über eine entsprechende Framework-Freigabentabelle, sodass sie in das Freigabemodell pro Benutzer/pro Organisation passen.

```an-schema title="Clips Kerndatenmodell" summary="recordings is the source of truth for media; transcripts, meetings, and dictations compose with it rather than duplicating video. (Engagement and org tables omitted for clarity — see the full table below.)"
{
  "entities": [
    {
      "id": "recordings",
      "name": "recordings",
      "note": "Core resource; source of truth for media. ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "video_url", "type": "text", "note": "plus format / size / duration / thumbnails" },
        { "name": "status", "type": "text" },
        { "name": "edits_json", "type": "text", "note": "Zerstörungsfreie Bearbeitungen" },
        { "name": "chapters_json", "type": "text", "nullable": true },
        { "name": "password", "type": "text", "nullable": true, "note": "Datenschutz: Passwort / Ablauf" }
      ]
    },
    {
      "id": "recording_transcripts",
      "name": "recording_transcripts",
      "note": "Aufteilen, damit die Bibliotheks- und Transkriptansichten schnell gerendert werden",
      "fields": [
        { "name": "recording_id", "type": "text", "fk": "recordings.id" },
        { "name": "segments_json", "type": "text", "note": "{ startMs, endMs, text }" },
        { "name": "full_text", "type": "text" },
        { "name": "language", "type": "text" },
        { "name": "status", "type": "text" }
      ]
    },
    {
      "id": "clips_meetings",
      "name": "clips_meetings",
      "note": "Calendar-sourced or ad-hoc; owns a recording",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "recording_id", "type": "text", "fk": "recordings.id", "nullable": true },
        { "name": "summary_md", "type": "text", "nullable": true },
        { "name": "bullets_json", "type": "text", "nullable": true },
        { "name": "action_items_json", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "clips_dictations",
      "name": "clips_dictations",
      "note": "Push-to-talk dictation history; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "full_text", "type": "text", "note": "Roh" },
        { "name": "cleaned_text", "type": "text", "nullable": true },
        { "name": "source", "type": "text", "note": "fn-hold usw." },
        { "name": "target_app", "type": "text", "nullable": true }
      ]
    }
  ],
  "relations": [
    { "from": "recordings", "to": "recording_transcripts", "kind": "1-1", "label": "transcript" },
    { "from": "recordings", "to": "clips_meetings", "kind": "1-1", "label": "captured by" }
  ]
}
```

| Tabelle                                         | Was es enthält                                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordings`                                    | Die Kernressource – Titel, Video URL/Format/Größe, Dauer, Miniaturansichten, Status, zerstörungsfreies `edits_json`, `chapters_json`, Datenschutz (Passwort, Ablauf) und Player-Umschaltung          |
| `recording_transcripts`                         | Transkript pro Aufnahme: `segments_json` (`{startMs,endMs,text}`), `full_text`, Sprache und Status                                                                                                   |
| `recording_tags`                                | Freiform-Tags für eine Aufnahme                                                                                                                                                                      |
| `recording_ctas`                                | Call-to-Action-Schaltflächen (Beschriftung, URL, Farbe, Platzierung), die einer Aufzeichnung überlagert sind                                                                                         |
| `recording_comments`                            | Kommentare mit Threads, Zeitstempel, Emoji-Reaktionskarte und Aufgelöst-Flag                                                                                                                         |
| `recording_reactions`                           | Emoji reactions an einen Videozeitstempel angeheftet (anonyme Zuschauer erlaubt)                                                                                                                     |
| `recording_viewers` / `recording_events`        | Ansichtsanalysen: Wiedergabezeit und -abschluss pro Zuschauer sowie detaillierte Ereignisse (Ansichtsstart, Wiedergabefortschritt, Suche, Pause, CTA-Klick, Reaktion)                                |
| `clips_meetings`                                | Kalenderbezogene oder Ad-hoc-Besprechungen – geplante/tatsächliche Zeiträume, Plattform, Benutzernotizen, AI `summary_md`, `bullets_json`, `action_items_json` und der Link zu seinem `recording_id` |
| `meeting_participants` / `meeting_action_items` | Teilnehmer und extrahierte Aktionselemente für ein Meeting                                                                                                                                           |
| `calendar_accounts` / `calendar_events`         | Verbundene Kalenderkonten (OAuth-Tokens leben in `app_secrets`, hier wird nur referenziert) und synchronisierte Ereignis-Snapshots                                                                   |
| `clips_dictations`                              | Push-to-talk-Diktierverlauf – rohes `full_text`, optionales `cleaned_text`, Quelle (`fn-hold` usw.) und Ziel-App                                                                                     |
| `clips_vocabulary`                              | Persönliche Vokabelkorrekturen (Begriff → bevorzugte Ersetzung), die zukünftige Diktate beeinflussen                                                                                                 |
| `spaces` / `space_members` / `folders`          | Bibliotheksorganisation – Bereiche (themenbezogene Container), ihre Mitglieder und verschachtelbare Ordner                                                                                           |
| `organization_settings`                         | Sidecar für Clips pro Organisation: Markenfarbe, Logo, Standardsichtbarkeit                                                                                                                          |

Aufzeichnungen und Transkripte sind absichtlich getrennte Tabellen, damit die Bibliotheks- und Transkriptansichten jeweils schnell gerendert werden können. Meetings bestehen aus Aufzeichnungen und nicht aus duplizierten Medien: Ein Meeting ist Eigentümer der Aufzeichnung, die es erfasst, aber die Zeile `recordings` bleibt die Quelle der Wahrheit für das Video und das Transkript pro Segment.

Routen im UI leben unter `templates/clips/app/routes/` – die authentifizierte App befindet sich unter `_app.*` (Bibliothek, Bereiche, Ordner, Besprechungen, Diktieren, Einblicke, Papierkorb, Einstellungen), mit öffentlichen Oberflächen unter `r.$recordingId`, `share.$shareId`, `embed.$shareId` und `invite.$token`.

### Schlüssel actions

Jeder vom Agenten aufrufbare Vorgang ist eine TypeScript-Datei in `templates/clips/actions/`, die automatisch bei `POST /_agent-native/actions/:name` gemountet wird und vom CLI als `pnpm action <name>` ausgeführt werden kann. Es gibt ~80 actions; die nützlichen Gruppierungen:

- **Aufzeichnungslebenszyklus** – `create-recording`, `finalize-recording`, `update-recording`, `set-thumbnail`, `archive-recording` / `restore-recording` / `trash-recording` / `delete-recording-permanent`, `move-recording`, `tag-recording`.
- **Transkript & KI** – `request-transcript`, `cleanup-transcript`, `regenerate-title` / `regenerate-summary` / `regenerate-chapters`, `set-chapters`, `generate-workflow`. (`cleanup-transcript` und `finalize-meeting` sind serverseitige Medien-Pipeline-Aufrufe; die meisten anderen KI-Funktionen delegieren an den Agenten-Chat.)
- **Bearbeiten** – zerstörungsfrei `trim-recording`, `split-recording`, `remove-filler-words`, `remove-silences`, plus `stitch-recordings`, `undo-edit`, `clear-edits`. Änderungen werden in `edits_json` gesammelt; Der Client verkettet/exportiert über ffmpeg.wasm.
- **Besprechungen** – `create-meeting`, `start-meeting-recording` / `stop-meeting-recording`, `finalize-meeting`, `update-meeting`, `get-meeting`, `list-meetings`, plus Kalenderverkabelung `connect-calendar` / `disconnect-calendar` / `sync-calendars` / `list-calendar-accounts`.
- **Diktat** – `create-dictation`, `cleanup-dictation`, `update-dictation`, `list-dictations` und `add-vocabulary-term` / `list-vocabulary` zur persönlichen Vokabelorientierung.
- **Bibliotheksorganisation** – `create-space` / `rename-space` / `delete-space`, `add-space-member` / `remove-space-member`, `create-folder` / `rename-folder` / `delete-folder`, `add-recording-to-space`.
- **Teilen, Kommentare und Engagement** – Framework-Freigabe actions plus `create-cta` / `update-cta` / `delete-cta`, `add-comment` / `reply-to-comment` / `resolve-comment` / `react-to-comment` / `delete-comment`, `react-to-recording`, `list-viewers`.
- **Organisationen und Mitglieder** – `create-organization`, `set-organization-branding`, `invite-member` / `accept-invite` / `decline-invite` / `get-invite`, `remove-member`, `update-member-role`, `list-organization-state`, `list-notifications`.
- **Suche, Einblicke und Export** – `search-recordings` (vergleicht Titel, Beschreibungen, Transkripttext und Kommentare mit Zeitstempeln), `get-recording-insights`, `get-organization-insights`, `export-insights-csv`, `export-to-brain`.
- **Kontext und Navigation** – `view-screen` (aktueller Clip, Abspielkopf, ausgewählter Transkriptbereich) und `navigate`; `refresh-list` nach Mutationen.

### Anpassen

Clips ist eine vollständige, klonbare Vorlage – forken Sie sie und bitten Sie den Agenten, sie zu erweitern. Einige Beispiele:

- „Fügen Sie eine Schaltfläche zum Entfernen von Füllwörtern hinzu, die ums und uhs aus dem Transkript entfernt und das Video neu zusammenfügt.“
- „Meine Standup-Notizen automatisch an Slack #eng senden, wenn ein Meeting endet.“ (ZxQ3QXZ zuerst über [Messaging](/docs/messaging) verbinden.)
- „Fügen Sie einen Hotkey hinzu, der das letzte Diktat als neues Ticket in Linear ablegt.“
- „Gruppieren Sie die Bibliothek nach Projekt – erkennen Sie das Projekt anhand der ersten Wörter jedes Transkripts.“
- „Fügen Sie eine Schaltfläche „Blogbeitrag aus diesem Clip generieren“ hinzu, die einen Beitrag aus dem Transkript erstellt und ihn als Entwurf speichert.“
- „Erlauben Sie Zuschauern, den Zeitstempel reactions in einem geteilten Clip zu hinterlassen.“

Der Agent bearbeitet Routen, Komponenten, die Transkriptpipeline und das Schema nach Bedarf. Siehe [Templates](/docs/cloneable-saas) für den vollständigen Klon-, Anpassungs- und Bereitstellungsablauf und [Getting Started](/docs/getting-started), wenn dies Ihre erste agentennative Vorlage ist.

## Was kommt als nächstes?

- [**Templates**](/docs/cloneable-saas) – das Modell zum Klonen und Besitzen
- [**Context Awareness**](/docs/context-awareness) – wie der Agent den aktuellen Clip und Abspielkopf kennt
- [**Agent Teams**](/docs/agent-teams) – Delegieren Sie die Transkriptbereinigung an einen spezialisierten Subagenten
