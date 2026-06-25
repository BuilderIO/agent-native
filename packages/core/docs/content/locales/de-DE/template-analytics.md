---
title: "Analysen"
description: "Stellen Sie Analysefragen in einfachem Englisch und erhalten Sie Diagramme und Dashboards zurück. Ein Open-Source-Ersatz für Amplitude, Mixpanel und Looker."
---

# Analysen

Stellen Sie Analysefragen in einfachem Englisch und erhalten Sie Diagramme und Dashboards zurück. Der Agent stellt eine Verbindung zu BigQuery, GA4, Amplitude, dem integrierten Erstanbieter-Ereignissammler, HubSpot, Jira und einem Dutzend anderer Quellen her, schreibt die Abfrage für Sie, validiert sie und gibt die Antwort als Diagramm, Tabelle oder gespeichertes Dashboard-Panel wieder.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:500px;box-sizing:border-box'><h1 style='margin:0'>Agent-Native-Templates</h1><p class='wf-muted' style='margin:0'>Adoption und Engagement in den letzten 12 Wochen.</p><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card'><small class='wf-muted'>Wöchentlich aktive Nutzer</small><br/><strong>24,318</strong><br/><span class='wf-pill accent'>+12.4%</span></div><div class='wf-card'><small class='wf-muted'>Neue Registrierungen</small><br/><strong>1,842</strong><br/><span class='wf-pill accent'>+8.7%</span></div><div class='wf-card'><small class='wf-muted'>MRR-Umsatz</small><br/><strong>$48,210</strong><br/><span class='wf-pill accent'>+21.3%</span></div></div><div style='display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1'><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Wöchentlich aktive Nutzer</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:38%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:44%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:58%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:74%;flex:1;background:var(--wf-accent-soft)'></div></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Umsatz im Zeitverlauf</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:32%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:48%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:63%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:80%;flex:1;background:var(--wf-accent-soft)'></div></div></div></div><div class='wf-card'><strong>Registrierungen nach Quelle</strong><br/><small class='wf-muted'>Das untere Diagramm beginnt unter den Hauptdiagrammen.</small></div></div>"
}
```

Es ist ein Open-Source-Ersatz für Amplitude, Mixpanel und Looker – für Teams, die den Code, die Abfragen und die Daten besitzen möchten.

```an-diagram title="Frage zum Diagramm" summary="Der Agent konsultiert das Datenwörterbuch, schreibt SQL, validiert es anhand des Warehouse und rendert dann ein Diagramm oder speichert ein Panel."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">Klare Sprache<br>question</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">reads data dictionary</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Schreibt SQL</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">Dry-run validieren</div><small class=\"diagram-muted\">BigQuery / Quelle</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Diagramm, Tabelle oder<br>saved panel</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Was Sie damit machen können

- **Stellen Sie Datenfragen in einfachem Englisch.** „Wie viel Prozent der Anmeldungen im letzten Monat wurden in bezahlte Anmeldungen umgewandelt?“ oder „Zeige mir wöchentlich aktive Benutzer der letzten 6 Monate.“ Der Agent wählt die richtige Quelle aus, schreibt SQL und rendert das Diagramm.
- **Erstellen Sie wiederverwendbare SQL-Dashboards** mit Filtern, gespeicherten Ansichten und parametrischen Abfragen.
- **Führen Sie Ad-hoc-Analysen durch**, die auf mehrere Datenquellen verweisen – gespeichert als wiederholbare Untersuchungen mit der ursprünglichen Frage, Anweisungen und Ergebnissen.
- **Verwalten Sie ein lebendiges Datenwörterbuch** mit Metriken, Tabellen und SQL-Rezepten, damit der Agent jedes Mal die richtigen Spaltennamen verwendet (kein erratenes `is_closed` mehr, wenn es tatsächlich `hs_is_closed` ist).
- **Teilen Sie Dashboards** mit Ihrem Team – standardmäßig privat, teilbar pro Benutzer oder pro Organisation mit den Rollen Betrachter/Editor/Administrator.
- **Stellen Sie sofort eine Verbindung zu vielen Quellen her**: BigQuery, GA4, Mixpanel, Amplitude, PostHog, HubSpot, Jira, Apollo, Pylon, Gong, Common Room, Twitter sowie app-spezifische SEO-Quellen.
- **Arbeitsbereichintegrationen wiederverwenden**, wenn ein Arbeitsbereich bereits verbunden ist und
  hat Analytics einen Anbieter zugewiesen. Der Anbieter für gemeinsame Integrationsspeicher
  Identitäts- und Anmeldeinformationsreferenzen; Analytics behält die anwendungsspezifische Quellenauswahl bei,
  Datenwörterbucheinträge, Dashboard SQL und Analyseverlauf.

## Erste Schritte

Live-Demo: [analytics.agent-native.com](https://analytics.agent-native.com).

Wenn Sie die App zum ersten Mal öffnen:

1. Mit Google anmelden.
2. Öffnen Sie die Seite **Datenquellen** in der Seitenleiste.
3. Für jede Quelle gibt es eine exemplarische Vorgehensweise – verbinden Sie die Quellen, die Sie benötigen (beginnen Sie mit einer, wie BigQuery, GA4, Amplitude oder Erstanbieter-Tracking).
4. Öffnen Sie einen neuen Chat mit dem Agenten und stellen Sie eine Frage: „Wie viele Anmeldungen haben wir letzte Woche erhalten?“

Die erste Frage reicht aus, um zu bestätigen, dass die Verbindung funktioniert. Bitten Sie den Agenten von dort aus, „dies als Dashboard zu speichern“ oder „ein 4-Panel-Übersichts-Dashboard für unsere wichtigsten Kennzahlen zu erstellen“.

### Nützliche Eingabeaufforderungen

- „Erstellen Sie ein Dashboard, das wöchentlich aktive Benutzer der letzten 6 Monate anzeigt.“
- „Wie viel Prozent der Anmeldungen im letzten Monat wurden in bezahlte Anmeldungen umgewandelt?“
- „Fügen Sie diesem Dashboard ein Diagramm hinzu, das den Umsatz nach Plan vergleicht.“
- „Ordnen Sie die Bereiche in diesem Dashboard neu an, sodass die MRR-Metrik an erster Stelle steht.“
- „Analysieren Sie unsere abgeschlossenen und verlorenen Geschäfte aus dem ersten Quartal und speichern Sie die Analyse.“
- „Führen Sie die Abwanderungsanalyse erneut mit den Daten dieses Monats durch.“
- „Dokumentieren Sie diese Metrik im Datenwörterbuch.“

Der Agent weiß immer, was Sie sehen – aktuelles Dashboard, Filter, Ansicht – sodass Sie „dieses Dashboard“ oder „dieses Panel“ sagen können, ohne es explizit zu sagen.

## Drei Dinge, die Sie wissen sollten

Die App verfügt über drei Hauptoberflächen, auf denen Sie Zeit verbringen:

- **SQL Dashboards** – wiederverwendbare Panels mit Filtern und gespeicherten Ansichten. Am besten für Messwerte, die Sie regelmäßig überprüfen.
- **Ad-hoc-Analysen** – umfangreiche Untersuchungen, die aus mehreren Quellen stammen, mit gespeicherten Wiederholungsanweisungen. Am besten geeignet für einmalige Fragen, die Sie vielleicht noch einmal beantworten möchten.
- **Data Dictionary** – der kanonische Katalog von Metriken, Tabellen, Spalten und SQL-Rezepten. Der Agent konsultiert es, bevor er SQL schreibt, sodass er echte Warehouse-Spaltennamen verwendet und Vorbehalte wie „schließt interne E-Mails aus“ kennt.

Das Wörterbuch wird geseedet, indem der Agent gefragt wird: „Importieren Sie unsere DBT-Definitionen“ oder „Ziehen Sie die Metriken aus unserem Notion-Handbuch“, und es erledigt die Arbeit.

## Für Entwickler

Der Rest dieses Dokuments richtet sich an alle, die die Analytics-Vorlage verzweigen oder erweitern.

### Schnellstart

Erstellen Sie eine neue Analytics-App aus CLI:

```bash
npx @agent-native/core@latest create my-analytics --standalone --template analytics
```

Lokaler Entwickler:

```bash
cd my-analytics
pnpm install
pnpm dev
```

CLI gibt den lokalen Entwickler URL aus. Melden Sie sich bei Google an und öffnen Sie dann die Seite **Datenquellen**, um BigQuery, GA4, First-Party-Tracking, HubSpot, Jira und den Rest zu verbinden.

### Hauptfunktionen

**Stellen Sie Fragen, rufen Sie Diagramme ab.** Der Agent wählt eine Datenquelle aus, schreibt und validiert SQL und rendert dann ein Diagramm, eine Tabelle, eine Metrik oder ein gespeichertes Panel.

**Dashboards und Untersuchungen.** Wiederverwendbare Dashboards behalten SQL Panels, Filter, gespeicherte Ansichten und Freigaben bei; Ad-hoc-Analysen ersparen längere Ergebnisse durch Wiederholungsanweisungen.

**Living Data Dictionary.** Metrikdefinitionen, Besitzer, Quelltabellen und bekannte Einschränkungen geben dem Agenten das tatsächliche Warehouse-Vokabular, bevor er Abfragen schreibt.

**Breite Konnektoroberfläche.** BigQuery, GA4, Produktanalyse, CRM, Support, Community, GitHub/Jira, SEO und Erstanbieter-`/track`-Ereignisse kommen alle über actions, das der Agent anrufen kann.

### Zusammenarbeit mit dem Agenten

Der Agent weiß immer, was Sie sehen. Der aktuelle Bildschirmstatus wird als `<current-screen>`-Block in jede Nachricht eingefügt – er enthält die aktive Ansicht, das geöffnete Dashboard oder die geöffnete Analyse und alle ausgewählten Filter.

Die Systemeingabeaufforderung des Agenten erhält einen eingefügten `<data-dictionary>`-Block mit den genehmigten Metrikeinträgen für die aktive Organisation. Wenn Sie nach einem Dashboard fragen, konsultiert der Agent zuerst das Wörterbuch und verwendet die dokumentierten `table` / `columns` / `queryTemplate` wörtlich – er errät keine Spaltennamen.

**Kontext, den es automatisch hat:**

- **Aktuelle Ansicht** – `overview`, `adhoc` (mit `dashboardId`), `analyses` (mit `analysisId`), `data-dictionary`, `data-sources` oder `settings`.
- **Aktive Organisation** – umfasst alle Abfragen und Schreibvorgänge.
- **Genehmigte Wörterbucheinträge** – für den aktiven Arbeitsbereich.

**Dashboard-Bearbeitungen.** Der Agent verwendet die `update-dashboard`-Aktion, um Dashboards zu bearbeiten. Es unterstützt zwei Modi:

- `ops` – JSON-Pointer-Patches für chirurgische Bearbeitungen (ein Panel verschieben, eine SQL-Zeichenfolge ersetzen, einen Filter entfernen).
- `config` – vollständiger Ersatz der Dashboard-Konfiguration.

SQL jedes BigQuery-Panels wird mit dem Warehouse getestet, bevor das Dashboard speichert. Wenn eine Spalte falsch ist, wird das Speichern mit dem BigQuery-Fehler abgelehnt – der Agent behebt das Problem SQL und versucht es erneut, anstatt defekte Panels beizubehalten.

### Datenquellen verbinden

Öffnen Sie die Seite **Datenquellen** (`/data-sources`), um Anbieter zu verbinden. Jeder
Quelle stellt eine Umgebungsschlüsselliste, eine exemplarische Vorgehensweise und eine Schaltfläche **Verbindung testen** bereit.
Wenn Analytics in einem Arbeitsbereich ausgeführt wird, erstellt `data-source-status` auch Berichte
wiederverwendbare Workspace-Verbindungen für `appId=analytics` gewährt, damit der Agent dies tun kann
fordern Sie einen App Grant anstelle einer weiteren Kopie desselben Anbieterschlüssels an.
Für wiederverwendbare Anbieter wie Slack, HubSpot, Notion und GitHub die Daten
Quellen UI zeigt den Status der freigegebenen Integration direkt an: bereit über den Arbeitsbereich,
erfordert eine Genehmigung, benötigt Anmeldeinformationen oder lokale Anmeldeinformationen.

Wiederverwendbare Arbeitsbereichsintegrationen sind die Laufzeitrichtung für gemeinsam genutzte Anbieter:
Das Framework speichert Anbieteridentität, Kontometadaten, Anmeldeinformationsreferenzen und
Zuschüsse pro App einmalig; Analytics speichert Datenquelleninterpretation, Quelle von
Wahrheitsentscheidungen, Metrikdefinitionen, Dashboards und Analysen.

Anmeldeinformationen werden über die Settings/Env-Ebene des Frameworks gespeichert – keine Geheimnisse in Git. Für die Produktion ist Folgendes erforderlich:

| Variable                                 | Zweck                                                 |
| ---------------------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`                           | Persistente SQL-Verbindung URL                        |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Auth                                                  |
| `GOOGLE_SIGN_IN_CLIENT_ID` / `_SECRET`   | Bevorzugter Google-Anmeldeclient (OAuth 2.0)          |
| `GOOGLE_CLIENT_ID` / `_SECRET`           | Legacy-Anmelde-Fallback/Google API-Integrationsclient |
| `BIGQUERY_PROJECT_ID`                    | BigQuery-Projekt                                      |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`    | BigQuery-Dienstkonto JSON                             |
| `ANTHROPIC_API_KEY`                      | Agenten-Chat                                          |

Anbieterspezifische Schlüssel (HubSpot, Jira, Gong, Pylon usw.) werden in der exemplarischen Vorgehensweise für jede Quelle auf der Seite „Datenquellen“ dokumentiert. Wenn Sie eine neue Aktion hinzufügen, die einen API-Schlüssel benötigt, wird sie über die Onboarding-Registrierung der Vorlage als neue Quelle auf dieser Seite angezeigt.

Hinweis: Die BigQuery OAuth-Anmeldeinformationen für die Google-Anmeldung sind **separat**
Anmeldeinformationen vom BigQuery-Dienstkonto JSON. Erstellen Sie den Anmeldeclient unter
GCP-Konsole → APIs & Dienste → Anmeldeinformationen → OAuth-Client-ID, und bevorzugen Sie die
`GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` Umgebungsnamen also
Der Anmeldeclient mit geringem Bereich bleibt von den Google API-Integrationsclients getrennt.

### Datenmodell

Kerntabellen (siehe `templates/analytics/server/db/schema.ts`):

```an-schema title="Analytics Datenmodell" summary="Dashboards und Analysen sind die Ressourcen; Views, Shares und ein Query-Cache hängen daran. Organisationstabellen kommen aus @agent-native/core/org."
{
  "entities": [
    {
      "id": "dashboards",
      "name": "dashboards",
      "note": "Explorer- und SQL-Dashboards",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "kind", "type": "text", "note": "\"explorer\" or \"sql\"" },
        { "name": "config", "type": "text", "note": "JSON passend zu SqlDashboardConfig" }
      ]
    },
    {
      "id": "dashboard_views",
      "name": "dashboard_views",
      "note": "Gespeicherte Filtervoreinstellungen pro Dashboard",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "dashboard_id", "type": "text", "fk": "dashboards.id" }
      ]
    },
    {
      "id": "analyses",
      "name": "analyses",
      "note": "Wiederholbare Ad-hoc-Untersuchungen",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "question", "type": "text" },
        { "name": "instructions", "type": "text", "note": "Führen Sie die Schritte erneut aus" },
        { "name": "dataSources", "type": "text", "note": "Quellen berührt" },
        { "name": "resultMarkdown", "type": "text" },
        { "name": "resultData", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "bigquery_cache",
      "name": "bigquery_cache",
      "note": "Ergebniscache, verschlüsselt durch SQL-Hash",
      "fields": [
        { "name": "sql_hash", "type": "text", "pk": true },
        { "name": "bytes_processed", "type": "integer" }
      ]
    }
  ],
  "relations": [
    { "from": "dashboards", "to": "dashboard_views", "kind": "1-n", "label": "saved views" }
  ]
}
```

Plus Pro-Ressourcen-Freigabetabellen (`dashboard_shares`, `analysis_shares`) und die von `@agent-native/core/org` bereitgestellten Organisationstabellen (`organizations`, `org_members`, `org_invitations`). Das Datenwörterbuch befindet sich in der `settings`-Tabelle des Frameworks unter bereichsbezogenen Schlüsseln.

- **`dashboards`** – sowohl Explorer- als auch SQL-Dashboards. `kind` ist `"explorer"` oder `"sql"`; `config` ist ein JSON-Blob, der zu `SqlDashboardConfig` passt.
- **`dashboard_shares`** – Aktienzuteilungen pro Ressource (Prinzipal, Rolle).
- **`dashboard_views`** – gespeicherte Filtervoreinstellungen pro Dashboard.
- **`analyses`** – Ad-hoc-Untersuchungen mit `question`, `instructions`, `dataSources`, `resultMarkdown` und optional `resultData`.
- **`analysis_shares`** – Aktienzuteilungen pro Ressource für Analysen.
- **`bigquery_cache`** – Abfrageergebnis-Cache, verschlüsselt durch SQL-Hash mit Byte-verarbeiteter Abrechnung.

Plus die von `@agent-native/core/org` bereitgestellten Organisationstabellen (`organizations`, `org_members`, `org_invitations`).

Das Datenwörterbuch befindet sich in der `settings`-Tabelle des Frameworks unter bereichsbezogenen Schlüsseln. Die vollständige Form finden Sie unter `list-data-dictionary` und `save-data-dictionary-entry` actions.

### Anpassen

Die Analytics-Vorlage soll gespalten und erweitert werden. Alles lebt in `templates/analytics/`:

- **`AGENTS.md`** – der Top-Level-Leitfaden des Agenten. Dokumentansichten, actions und Workflows.
- **`actions/`** – jede vom Agenten aufrufbare Operation. Fügen Sie eine neue Datei hinzu, um eine neue Aktion hinzuzufügen. Bemerkenswerte:
  - `update-dashboard.ts` – Dashboard-Änderungen (Ops + vollständiges Ersetzen)
  - `save-analysis.ts` / `list-analyses.ts` – Ad-hoc-Analysen
  - `save-data-dictionary-entry.ts` / `list-data-dictionary.ts` – Wörterbuch
  - `bigquery.ts` – reine BigQuery-Ausführung
  - `view-screen.ts` / `navigate.ts` – Kontextbewusstsein
- **`app/routes/`** – dateibasierte Routen. Jede Route ist ein dünner Wrapper um eine Seite in `app/pages/`.
- **`app/pages/adhoc/sql-dashboard/`** – der SQL-Dashboard-Renderer, Panel-Editor, Filterleiste, gespeicherte Ansichten.
- **`app/pages/analyses/`** – analysiert die Listen- und Detailansicht.
- **`app/pages/DataSources.tsx`** – die Datenquellen-Onboarding-UI.
- **`app/pages/DataDictionary.tsx`** – der Wörterbuchbrowser und -editor.
- **`.agents/skills/`** – Muster, das der Agent bei Bedarf liest:
  - `dashboard-management` – Speicher, Bereichsauflösung, Dashboard-Konfigurationsform
  - `data-querying` – welches Skript Sie verwenden sollten, Filtermuster
  - `adhoc-analysis` – Workflow für quellenübergreifende Untersuchungen
  - `data-querying`, `real-time-sync`, `frontend-design`, `storing-data`, `self-modifying-code`
- **`.builder/skills/<provider>/SKILL.md`** – anbieterspezifische Fallstricke (BigQuery, HubSpot, Jira, GA4 usw.). Vor der Abfrage lesen; Aktualisieren Sie, wenn Sie etwas Neues erfahren.
- **`server/db/schema.ts`** – Drizzle-Schema für Dashboards, Freigaben, Ansichten, Analysen, BigQuery-Cache.
- **`server/lib/dashboards-store.ts`** – Dashboard-Lesen/Schreiben mit Bereichsauflösung und Legacy-KV-Migration.
- **`server/lib/bigquery.ts`** – BigQuery-Client, Probelaufvalidator, Cache-Logik.

Um eine neue Datenquelle hinzuzufügen, legen Sie ein Skript in `actions/` ab, das den Anbieter aufruft und Ergebnisse über den `output()`-Helfer zurückgibt. Es steht dem Agenten sofort zur Verfügung und kann in Dashboard-Panels verwendet werden (wenn Sie das Ergebnis über einen Server-Handler verfügbar machen).

Um einen neuen Diagrammtyp hinzuzufügen, erweitern Sie die `ChartType`-Vereinigung in `app/pages/adhoc/sql-dashboard/types.ts`, verarbeiten Sie sie in `SqlChartCard.tsx`, und der Agent kann sie in jedem Panel verwenden.

Das allgemeinere Muster zum Erweitern von Vorlagen finden Sie in [Skills guide](/docs/skills-guide) und [Actions](/docs/actions).
