---
title: "Freigabe und Datenschutz"
description: "Freigabe im Google-Docs-Stil, in das Framework integriert. Jede vom Benutzer erstellte Ressource – Dokumente, Dashboards, Designs, Decks, Clips, Aufzeichnungen, Formulare – erhält standardmäßig dasselbe private Modell mit einer einheitlichen Freigabe UI."
---

# Freigabe und Datenschutz

Jede Ressource, die ein Benutzer in einer agentennativen App erstellt – ein Dokument, ein Dashboard, ein Design, eine Präsentation, eine Videobearbeitung, eine Bildschirmaufzeichnung, ein Besprechungsprotokoll, ein Formular, ein Buchungslink – ist **standardmäßig privat für den Ersteller**. Andere sehen es nur, wenn der Ersteller es ausdrücklich teilt oder seine Sichtbarkeit in `org` oder `public` ändert.

Es sieht aus und funktioniert wie Google Docs. Die gleiche Schaltfläche zum Teilen, derselbe Dialog, das gleiche dreistufige Sichtbarkeitsmodell, die gleichen Gewährungen pro Benutzer/pro Organisation – für jede Vorlage, ohne Neuerfindung pro App.

## Warum ein Modell {#why}

Die meisten App-Frameworks machen die Freigabe zu einem Feature-Projekt. Das Ergebnis: Jede dokumentartige Oberfläche verfügt am Ende über einen eigenen Freigabedialog, ein eigenes Berechtigungsschema und eigene Fehler bei der Zugriffsprüfung. In Agent-nativ ist die Freigabe ein **Framework-Grundelement**. Die Schemaspalten, die Zugriffsprüfungshilfen, das Freigabe-Popover und die vom Agenten aufrufbare Freigabe actions werden alle mit dem Kern geliefert. Eine neue Vorlage erhält die vollständige Sharing-Story, indem sie zwei Spalten und eine Registrierungszeile hinzufügt.

Das bedeutet auch, dass der Agent nie ein neues Freigabemodell pro App erlernen muss. Sagen Sie dem Agenten in einer beliebigen Vorlage „Teilen Sie dies mit Alice als Redakteurin“, und die gleiche `share-resource`-Aktion wird ausgelöst.

## Die drei Sichtbarkeitsstufen {#visibility}

Die grobe Sichtbarkeit lebt von der Ressource selbst; Fein abgestufte Zuteilungen werden in einer Companion-Shares-Tabelle gespeichert.

| Sichtbarkeit | Wer kann es sehen                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `private`    | Eigentümer + Personen ausdrücklich gewährt. **Standard für jede neue Ressource.**                                           |
| `org`        | Eigentümer + explizite Berechtigungen + jeder in derselben Organisation (schreibgeschützt).                                 |
| `public`     | Eigentümer + explizite Genehmigungen + jeder mit dem Link (schreibgeschützt). Erscheint nicht in den Listen/Suchen anderer. |

`public` ist eine bewusst ruhige Ebene: Eine öffentliche Ressource ist über einen direkten Link erreichbar, sie wird jedoch **nicht** in den Seitenleisten, Listen oder der Suche anderer Benutzer angezeigt. Dadurch bleibt „Öffentlich für die gemeinsame Nutzung des URL“ von „Öffentlich für benutzerübergreifende Erkennung“ getrennt. Galerien und Vorlagenkataloge, die wirklich eine benutzerübergreifende Erkennung wünschen, entscheiden sich ausdrücklich dafür.

```an-diagram title="Sichtbarkeit, die sich nach außen erweitert" summary="Grobe Sichtbarkeit auf der Ressource legt den Boden fest; Durch explizite Aktienzuteilungen in der Begleittabelle werden benannte Personen oben hinzugefügt."
{
  "html": "<div class=\"share-tiers\"><div class=\"diagram-card\"><span class=\"diagram-pill\">private</span><small class=\"diagram-muted\">owner + explicit grants only &middot; <strong>default</strong></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">org</span><small class=\"diagram-muted\">+ anyone in the same org (read-only)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">public</span><small class=\"diagram-muted\">+ anyone with the link (read-only) &middot; hidden from others' lists/search</small></div></div>",
  "css": ".share-tiers{display:flex;flex-direction:column;align-items:stretch;gap:8px}.share-tiers .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.share-tiers .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

## Rollen bei einer Aktienzuteilung {#roles}

Wenn Sie etwas mit einem bestimmten Benutzer oder einer bestimmten Organisation teilen, wählen Sie eine Rolle aus:

- **Viewer** – schreibgeschützt.
- **Editor** – lesen + schreiben.
- **Admin** – Freigaben lesen + schreiben + verwalten (kann andere Personen hinzufügen/entfernen).

`admin` ändert NOT den Besitzer – es gibt immer noch genau einen Besitzer pro Ressource, anders als bei den Anteilsgewährungen.

## Was abgedeckt ist {#covered}

Jede Vorlage, die vom Benutzer erstellte Arbeiten speichert, verwendet dieses Modell. Konkret:

- **Inhalt** – Dokumente
- **Folien** – Decks
- **Design** – Designs und Assets
- **Video** – Kompositionen
- **Clips** – Bildschirmaufnahmen (Loom-Stil)
- **Formulare** – Formulardefinitionen
- **Kalender** – Veranstaltungen und Buchungslinks
- **Analytics** – Dashboards (Einführung – siehe `AGENTS.md` der Analytics-Vorlage)
- **Erweiterungen** – Sandbox-Mini-Apps (siehe [Extensions](/docs/extensions#sharing))

Alle davon verwenden denselben `ownableColumns()`-Schema-Helfer, dieselbe `share-resource`-Aktion und denselben `<ShareButton>` UI. Wenn Sie von einer Vorlage zu einer anderen wechseln, sieht der Freigabedialog identisch aus.

## Was nicht abgedeckt ist {#not-covered}

Einige Bereiche liegen absichtlich außerhalb des Freigabesystems:

- **Apps für persönliche Daten** (Mail, Makros) – vom Design her benutzerbezogen. Es gibt kein Konzept zum Teilen meines Posteingangs.
- **Externe Source-of-Truth-Apps** – die Zugriffskontrolle erfolgt im Upstream-System, nicht in der agentennativen App.
- **Anonyme öffentliche URLs** – bilden Veröffentlichungs-Slugs und Buchungs-Link-Slugs, die einen URL abgemeldeten Benutzern zugänglich machen, sind eine separate Achse. Sie leben neben dem Sharing-System, nicht darüber.

## Die Freigabe UI {#share-ui}

Jede gemeinsam nutzbare Ressource erhält in ihrer Kopfzeile eine Schaltfläche zum Teilen. Wenn Sie darauf klicken, wird ein Popover geöffnet, das an der Schaltfläche verankert ist (kein modales Popover) mit:

- Sichtbarkeitsauswahl (`Private` / `Organization` / `Public link`).
- Autovervollständigung „Personen oder Teams hinzufügen“ – Benutzer in der Organisation suchen oder eine E-Mail einfügen.
- Ein `Benachrichtigen people`-Kontrollkästchen im Google Docs-Stil für individuelle E-Mail-Genehmigungen.
- Eine Liste aktueller Gewährungen mit Rollenauswahl und einer Entfernungskontrolle.
- Eine Schaltfläche zum Kopieren von Links, die die aktuelle Sichtbarkeit berücksichtigt.

Die Schaltfläche „Teilen“ ist ein einzelner Import:

```tsx
import { ShareButton } from "@agent-native/core/client";

<ShareButton
  resourceType="deck"
  resourceId={deck.id}
  resourceTitle={deck.title}
/>;
```

Fügen Sie bei Listen neben jeder Zeile ein `<VisibilityBadge visibility={row.visibility} />` ein, damit Benutzer auf einen Blick sehen können, was privat oder geteilt ist.

## Gleiches Modell, gleicher Agent und gleicher UI {#agent-and-ui}

Das Framework mountet diese actions automatisch in jeder Vorlage – der Agent nennt sie als Tools und der UI ruft sie über `useActionQuery` / `useActionMutation` auf:

| Aktion                    | Was es tut                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `share-resource`          | Gewähren Sie einem Benutzer oder einer Organisation Zugriff für eine bestimmte Rolle. Optionales `notify` steuert E-Mail-Benachrichtigungen. |
| `unshare-resource`        | Zugriff für einen Benutzer oder eine Organisation widerrufen.                                                                                |
| `list-resource-shares`    | Aktuelle Sichtbarkeit sowie alle expliziten Gewährungen anzeigen.                                                                            |
| `set-resource-visibility` | Wechseln Sie zu `private`, `org` oder `public`.                                                                                              |

Sagen Sie dem Agenten: „Teilen Sie dieses Design mit dem Marketingteam als Redakteuren“, und er ruft `share-resource` für denselben Endpunkt auf, den UI verwendet. Das Ergebnis wird beim nächsten Rendern im Freigabedialog angezeigt.

## In eine neue Vorlage einbauen {#building}

Wenn Sie eine Vorlage erstellen (siehe [Creating Templates](/docs/creating-templates)), ist die gemeinsame Nutzung der Verkabelung kurz. Zwei Ergänzungen zu Ihrem Schema:

```ts
import {
  table,
  text,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const decks = table("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  ...ownableColumns(), // adds owner_email, org_id, visibility
});

export const deckShares = createSharesTable("deck_shares");
```

```an-schema title="Tabelle „Ressourcen- und Begleitanteile“." summary="Coarse visibility lives on the resource; each fine-grained grant is a row in the shares table."
{
  "entities": [
    {
      "id": "deck",
      "name": "decks",
      "note": "...ownableColumns()",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text", "nullable": false },
        { "name": "owner_email", "type": "text", "nullable": false, "note": "Die einzige Quelle der Wahrheit für Eigentum." },
        { "name": "org_id", "type": "text", "nullable": true },
        { "name": "visibility", "type": "enum", "nullable": false, "note": "privat | org | öffentlich" }
      ]
    },
    {
      "id": "deckShare",
      "name": "deck_shares",
      "note": "createSharesTable() — one row per grant",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "resource_id", "type": "text", "fk": "decks.id", "nullable": false },
        { "name": "principal_type", "type": "enum", "note": "Benutzer | org" },
        { "name": "principal_id", "type": "text", "note": "email (user) or org id (org)" },
        { "name": "role", "type": "enum", "note": "Zuschauer | Herausgeber | Administrator" },
        { "name": "created_by", "type": "text" },
        { "name": "created_at", "type": "text" }
      ]
    }
  ],
  "relations": [
    { "from": "deckShare", "to": "deck", "kind": "n-n", "label": "grants access to" }
  ]
}
```

Ein Registrierungsaufruf in `server/db/index.ts`:

```ts
import { registerShareableResource } from "@agent-native/core/sharing";

registerShareableResource({
  type: "deck",
  resourceTable: schema.decks,
  sharesTable: schema.deckShares,
  displayName: "Deck",
  titleColumn: "title",
  getResourcePath: (deck) => `/deck/${deck.id}`,
  getDb,
});
```

Danach durchlaufen Listen-/Leseabfragen `accessFilter()` und schreiben actions. Verwenden Sie `assertAccess()`, um Rollen durchzusetzen.

### Optionale Härtungsflags {#hardening-flags}

`registerShareableResource` akzeptiert zwei Sicherheitsflags für Ressourcen, die Code ausführen oder über erhöhte Vertrauenswürdigkeit verfügen:

```ts
registerShareableResource({
  type: "extension",
  resourceTable: schema.extensions,
  sharesTable: schema.extensionShares,
  // ...
  allowPublic: false, // Reject set-resource-visibility → "public"
  requireOrgMemberForUserShares: true, // Reject user grants to non-org emails
});
```

`allowPublic: false` verhindert, dass ein Anrufer – Agent oder UI – die Sichtbarkeit der Ressource auf `public` setzt. `requireOrgMemberForUserShares: true` lehnt die Gewährung einzelner Benutzer an E-Mail-Adressen außerhalb der Organisation des Ressourceneigentümers ab. Erweiterungen legen beides fest: HTML einer Erweiterung wird in einem Iframe ausgeführt, der actions und DB als _Viewer_ aufruft, sodass der öffentliche Zugriff über beliebigen Code mit den Anmeldeinformationen des Viewers erfolgen würde.

```an-callout
{
  "tone": "risk",
  "body": "For resources that execute code or carry elevated trust (like extensions), set `allowPublic: false` and `requireOrgMemberForUserShares: true`. Otherwise a public share becomes arbitrary code running with the *viewer's* credentials."
}
```

`getResourcePath` gibt Benachrichtigungs-E-Mails einen direkten Fallback-Link, wenn eine Freigabe vom Agenten oder einem anderen Nicht-UI-Anrufer erstellt wird. Das vollständige Muster (einschließlich Eigentumsstempel für Erstellungsaktionen und das Migrationsrezept für vorhandene Tabellen) befindet sich im Agentenskill `sharing` – der Agent liest es bei Bedarf, wenn er eine Funktion zur Freigabeerkennung erstellt.

## Sicherheitsgarantien {#security}

Die gemeinsame Nutzung erfolgt auf dem umfassenderen Datenscoping-Modell des Frameworks – der Listen-/Lese-/Schreibzugriff auf besitzbare Tabellen erfolgt über `accessFilter()` / `resolveAccess()` / `assertAccess()`, und mit `org_id` gekennzeichnete Ressourcen sind organisationsübergreifend unsichtbar. Siehe [Security → Data Scoping](/docs/security#data-scoping) für die vollständige Pipeline, den CI-Schutz und die Bedrohungsoberfläche.

## Siehe auch {#see-also}

- [Security & Data Scoping](/docs/security) – das Zugriffsfilter- und Eigentumsmodell, auf dem das Teilen basiert.
- [Authentication](/docs/authentication) – Sitzungen, Organisationen und wie Identität in den Anfragekontext fließt.
- [Extensions](/docs/extensions#sharing) – Teilen in der Sandbox-Mini-App-Oberfläche.
- [Creating Templates](/docs/creating-templates) – Verknüpfen von `ownableColumns` mit dem Schema einer neuen Vorlage.
