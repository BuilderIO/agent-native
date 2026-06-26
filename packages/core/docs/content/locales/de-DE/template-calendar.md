---
title: "Kalender"
description: "Ein von Agenten betriebener Kalender mit Google Calendar-Synchronisierung und Buchungslinks im Calendly-Stil. Planen Sie, finden Sie Slots und verwalten Sie die Verfügbarkeit in einfachem Englisch."
---

# Kalender

Eine von einem Agenten betriebene Kalender-App. Schließen Sie Ihr Google Calendar an und der Agent kann Ihren Zeitplan lesen, freie Slots finden, Veranstaltungen erstellen und Buchungslinks im Calendly-Stil verwalten – alles in einfachem Englisch. Es ersetzt die Google Calendar + Calendly-Kombination durch eine App, die Sie besitzen.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1.4px solid var(--wf-line)'><button>Week</button><button>Today</button><button>‹</button><button>›</button><div style='flex:1'></div><strong>3.-9. Mai 2026</strong><div style='flex:1'></div><button class='primary'>Neues Ereignis</button></div><div style='display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));grid-template-rows:36px repeat(5,72px);gap:7px;padding:14px;flex:1'><div></div><strong>So 3</strong><strong>Mo 4</strong><strong>Di 5</strong><strong>Mi 6</strong><strong>Do 7</strong><strong>Fr 8</strong><strong>Sa 9</strong><small class='wf-muted'>7 AM</small><div class='wf-box' style='opacity:.45'></div><div></div><div></div><div></div><div></div><div></div><div></div><small class='wf-muted'>9 AM</small><div class='wf-box'>All-Hands</div><div class='wf-box'>Engineering-Standup</div><div class='wf-box'>Engineering-Standup</div><div class='wf-box'>Engineering-Standup</div><div></div><div class='wf-box'>Planning</div><div></div><small class='wf-muted'>11 AM</small><div class='wf-box'>Design-Review</div><div></div><div class='wf-box'>Designkritik</div><div class='wf-box'>Roadmap</div><div class='wf-box'>Freitagsdemo</div><div></div><div></div><small class='wf-muted'>1 PM</small><div></div><div class='wf-box'>1:1</div><div class='wf-box'>Fokusblock</div><div></div><div></div><div class='wf-box'>All-Hands</div><div></div><small class='wf-muted'>3 PM</small><div></div><div></div><div></div><div class='wf-box'>Skip-Level</div><div></div><div></div><div></div></div></div>"
}
```

Wenn Sie die App öffnen, ist die aktive Kalenderansicht die primäre Oberfläche. Der Agent weiß immer noch, um welchen Tag, welche Woche oder welches Ereignis es sich handelt, sodass Sie sagen können: „Vereinbaren Sie an diesem Tag ein 30-minütiges Gespräch mit Alex“, ohne alles zu buchstabieren.

```an-diagram title="Wie eine Planungsanfrage abläuft" summary="Unabhängig davon, ob Sie in den Kalender klicken oder den Agenten fragen, werden dieselben Aktionen live aus Google Calendar gelesen und in dieselbe Ansicht zurückgeschrieben."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Du klickst<br><small class=\"diagram-muted\">Ziehen, Toolbar, Kurzbefehle</small></div><div class=\"diagram-node\">Sie fragen den Agenten<br><small class=\"diagram-muted\">\"find a 1-hour slot next week\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-events · check-availability · create-event</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Google Calendar<br><small class=\"diagram-muted\">live, mehrere Konten</small></div><div class=\"diagram-box\">SQL<br><small class=\"diagram-muted\">Buchungen · Verfügbarkeit</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">Kalenderansicht aktualisiert live</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Was Sie damit machen können

- **Sehen Sie Ihr echtes Google Calendar** in der Tages-, Wochen- oder Monatsansicht mit mehreren überlagerten Konten.
- **Abonnieren Sie ICS-Feeds** (Freistellung in der Personalabteilung, Konferenzpläne, Teamkalender) – schreibgeschützt, gemischt in derselben Ansicht.
- **Legen Sie die wöchentliche Verfügbarkeit fest** mit Zeitzonenunterstützung – der Agent verwendet dies, wenn er freie Slots findet.
- **Erstellen Sie öffentliche Buchungslinks** bei `/book/{slug}` für Dinge wie „15-minütige Einführung“ oder „30-minütige Demo“. Konfigurieren Sie Dauer, benutzerdefinierte Felder und das zu verwendende Konferenztool.
- **Fragen Sie den Agenten nach Terminen**: „Habe ich Donnerstagnachmittag Zeit?“ „Suchen Sie sich nächste Woche einen einstündigen Slot und platzieren Sie dort ‚Planning with Alex‘.“ „Link zur Demo-Buchung pausieren.“
- **Teilen Sie Buchungslinks** mit Teamkollegen, damit diese diese auch verwalten können.

## Erste Schritte

Live-Demo: [calendar.agent-native.com](https://calendar.agent-native.com).

Wenn Sie die App zum ersten Mal öffnen:

1. Klicken Sie auf **Einstellungen**.
2. Klicken Sie auf **Google Calendar verbinden** und genehmigen Sie.
3. (Optional) Verbinden Sie weitere Google-Konten, wenn Sie möchten, dass private und geschäftliche Konten überlagert werden.
4. Öffnen Sie die Hauptansicht – Ihr echter Kalender wird geladen.

So erstellen Sie Ihren ersten Buchungslink:

1. Klicken Sie in der Seitenleiste auf **Buchungslinks**.
2. Klicken Sie auf **Neuer Buchungslink** und legen Sie einen Titel und eine Dauer fest.
3. Teilen Sie die Öffentlichkeit URL – Besucher wählen aus Ihren verfügbaren Slots.

Oder fragen Sie einfach den Agenten: „Erstellen Sie einen 15-minütigen Einführungsbuchungslink mit einem Namensfeld.“

### Nützliche Eingabeaufforderungen

- „Was steht heute in meinem Kalender?“
- „Habe ich am Donnerstagnachmittag 30 Minuten Zeit?“
- „Suchen Sie sich nächste Woche einen einstündigen Slot und platzieren Sie dort ‚Planning with Alex‘.“
- "Verschieben Sie diese Veranstaltung auf Freitag um 14:00 Uhr." (wenn ein Ereignis ausgewählt ist)
- „Zur Tagesansicht wechseln und zum nächsten Montag springen.“
- „Erstellen Sie einen Buchungslink mit dem Namen „15-Minuten-Einführung“ bei 15 Minuten mit einem Notizfeld.“
- „Meinen Buchungslink „30-Minuten-Demo“ pausieren.“
- „Freitagnachmittage je nach Verfügbarkeit blockieren.“
- „Welche Besprechungen habe ich diesen Monat zum Thema „Launch“?“

Der Agent fragt Google Calendar live bei jeder Terminfrage ab – er rät nie.

## Für Entwickler

Der Rest dieses Dokuments richtet sich an alle, die die Kalendervorlage verzweigen oder erweitern.

### Schnellstart

Erstellen Sie einen neuen Arbeitsbereich mit der Kalendervorlage:

```bash
npx @agent-native/core@latest create my-app --standalone --template calendar
cd my-app
pnpm install
pnpm dev
```

Öffnen Sie `http://localhost:8082` (den standardmäßigen Kalender-Entwicklungsport).

Um Google Calendar in Dev zu verbinden, öffnen Sie die Einstellungsansicht, fügen Sie einen `GOOGLE_CLIENT_ID` und einen `GOOGLE_CLIENT_SECRET` aus [Google Cloud Console](https://console.cloud.google.com/) ein und klicken Sie auf „Google Calendar verbinden“. Die OAuth-Umleitung URI ist `http://localhost:8082/_agent-native/google/callback` in der Entwicklung. Token werden in der Tabelle `oauth_tokens` SQL gespeichert und automatisch aktualisiert.

### Hauptfunktionen

**Live-Kalenderansichten.** Tages-, Wochen- und Monatsansichten, die direkt von verbundenen Google-Konten gelesen werden, mit optionalen schreibgeschützten ICS-Feeds, die in denselben Zeitplan eingebunden sind.

**Verfügbarkeit und Suche nach freien Plätzen.** Wöchentliche Verfügbarkeitsregeln, Zeitzonenunterstützung und vorhandene Ereignisse füttern alle die gleiche Verfügbarkeitsaktion, die UI und der Agent verwenden.

**Buchungslinks.** Auf öffentlichen `/book/{slug}`-Seiten werden Name, E-Mail, benutzerdefinierte Felder, Konferenzeinstellungen und Stornierungs-/Verschiebungstokens erfasst.

**Gemeinsame Verwaltung.** Buchungslinks sind standardmäßig privat, können aber über das Framework-Sharing actions mit Teamkollegen geteilt werden.

**Inline-Ereignisvorschauen.** Der Agent kann kompakte Ereigniskarten mit Titel, Zeit, Ort, Teilnehmern und einer Zurück-Schaltfläche in den Chat einbetten.

### Zusammenarbeit mit dem Agenten

Der Agent sieht, was Sie sehen. Die aktuelle Kalenderansicht, das ausgewählte Datum und das ausgewählte Ereignis sind in jeder Nachricht als `current-screen`-Block enthalten, sodass Sie „dieses Ereignis“ oder „diesen Tag“ sagen können und es korrekt aufgelöst wird.

Unter der Haube nennt der Agentenaktionen wie `list-events`, `check-availability`, `create-event`, `navigate` und `update-availability`. Da Ereignisse in Google Calendar gespeichert sind, fragt der Agent immer API ab, anstatt zu raten – er gibt keine leeren Ergebnisse zurück, ohne vorher ein Skript auszuführen.

### Datenmodell

Definiert in `templates/calendar/server/db/schema.ts`. Nur Nicht-Ereignisdaten werden lokal gespeichert:

- `bookings` – bestätigte Termine von öffentlichen Buchungsseiten. Speichert Name, E-Mail, Anfang, Ende, Slug, optionale Notizen, benutzerdefinierte Feldantworten, Besprechungslink, einen `cancelToken` für die öffentliche Verwaltung URL und einen `confirmed`- oder `cancelled`-Status.
- `booking_links` – die Linkdefinitionen im Calendly-Stil. Slug, Titel, Beschreibung, primäres `duration`, optionale `durations`-Liste, `customFields`, `conferencing`, `color` und ein `isActive`-Flag. Verwendet `ownableColumns` des Frameworks, sodass das Freigabesystem gilt.
- `booking_slug_redirects` – erinnert sich an alte Slugs, wenn ein Link umbenannt wird, sodass bestehende öffentliche URLs weiterhin funktionieren.
- `booking_link_shares` – Anteilszuschüsse für Buchungslinks.

```an-schema title="Calendar Datenmodell" summary="Nur Nicht-Ereignisdaten werden lokal gespeichert – Ereignisse leben in Google Calendar. Buchungslinks verwenden ownableColumns, daher gilt das Freigabesystem."
{
  "entities": [
    {
      "id": "booking_links",
      "name": "booking_links",
      "note": "Calendly-style link definitions (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "note": "public page at /book/{slug}" },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "duration", "type": "int", "note": "primary duration in minutes" },
        { "name": "durations", "type": "json", "nullable": true, "note": "alternative durations" },
        { "name": "customFields", "type": "json", "nullable": true },
        { "name": "conferencing", "type": "string", "note": "Google Meet / Zoom / Brauch" },
        { "name": "color", "type": "string", "nullable": true },
        { "name": "isActive", "type": "bool", "note": "pause without deleting" }
      ]
    },
    {
      "id": "bookings",
      "name": "bookings",
      "note": "Bestätigte Termine von öffentlichen Buchungsseiten",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "fk": "booking_links.slug" },
        { "name": "name", "type": "string" },
        { "name": "email", "type": "string" },
        { "name": "start", "type": "datetime" },
        { "name": "end", "type": "datetime" },
        { "name": "notes", "type": "string", "nullable": true },
        { "name": "customFields", "type": "json", "nullable": true, "note": "custom field responses" },
        { "name": "meetingLink", "type": "string", "nullable": true },
        { "name": "cancelToken", "type": "string", "note": "powers /booking/manage/{token}" },
        { "name": "status", "type": "enum", "note": "bestätigt | abgesagt" }
      ]
    },
    {
      "id": "booking_slug_redirects",
      "name": "booking_slug_redirects",
      "note": "Hält alte öffentliche URLs weiterhin aktiv, nachdem ein Link umbenannt wurde",
      "fields": [
        { "name": "oldSlug", "type": "string", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" }
      ]
    },
    {
      "id": "booking_link_shares",
      "name": "booking_link_shares",
      "note": "Teilen Sie Zuschüsse für Buchungslinks",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "Zuschauer | Herausgeber | Administrator" }
      ]
    }
  ],
  "relations": [
    { "from": "booking_links", "to": "bookings", "kind": "1-n", "label": "has bookings" },
    { "from": "booking_links", "to": "booking_slug_redirects", "kind": "1-n", "label": "has old slugs" },
    { "from": "booking_links", "to": "booking_link_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

Verfügbarkeitsregeln und Konfiguration pro Benutzer sind in der Einstellungstabelle verfügbar, verschlüsselt durch `calendar-availability`. Google OAuth-Tokens befinden sich in der Framework-`oauth_tokens`-Tabelle. Der kurzlebige UI-Status (aktuelle Ansicht, Datum, ausgewähltes Ereignis) befindet sich in `application_state` unter dem Schlüssel `navigation`.

### Anpassen

Jeder Teil der App ist eine bearbeitbare Quelle. Beginnen Sie hier:

- `templates/calendar/actions/` – jede vom Agenten aufrufbare Operation. Fügen Sie eine neue Datei mit `defineAction` hinzu, um neue Funktionen sowohl für den Agenten als auch für das Frontend verfügbar zu machen. Schlüsseldateien: `check-availability.ts`, `create-event.ts`, `list-events.ts`, `create-booking-link.ts`, `update-availability.ts`, `add-external-calendar.ts`, `navigate.ts`, `view-screen.ts`.
- `templates/calendar/app/routes/` – der UI. `_app._index.tsx` ist der Kalender, `_app.availability.tsx` ist der Zeitplaneditor, `_app.booking-links._index.tsx` und `_app.booking-links.$id.tsx` verwalten Buchungslinks, `_app.bookings.tsx` listet Buchungen auf, `_app.settings.tsx` sind Einstellungen und `book.$slug.tsx` plus `meet.$username.$slug.tsx` sind die öffentlichen Buchungsseiten.
- `templates/calendar/server/db/schema.ts` – Spalten oder Tabellen mit Drizzle hinzufügen. Halten Sie den Code dialektunabhängig, damit die Vorlage auf SQLite, Postgres, Turso, D1 und Neon läuft.
- `templates/calendar/AGENTS.md` – Agentenanweisungen. Aktualisieren Sie dies, wenn Sie dem Agenten neue Fähigkeiten oder Konventionen beibringen.
- `templates/calendar/.agents/skills/` – detaillierte Muster, denen der Agent folgt. Relevante skills: `event-management`, `availability-booking`, `real-time-sync`, `storing-data`, `delegate-to-agent`, `frontend-design`.
- `templates/calendar/shared/api.ts` – die gemeinsam genutzten TypeScript-Typen (`AvailabilityConfig`, `BookingLink`, `ExternalCalendar` usw.), die sowohl vom Server als auch vom Client verwendet werden.

Wenn Sie eine Funktion hinzufügen, denken Sie daran, alle vier Bereiche zu aktualisieren: UI, Aktion, Skill oder AGENTS.md-Eintrag und alle Anwendungsstatus, die der Agent sehen muss. Das ist es, was den Agenten und den UI in Parität hält.
