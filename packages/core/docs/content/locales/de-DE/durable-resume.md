---
title: "Dauerhafter Lebenslauf"
description: "Wenn die Ausführung eines gehosteten Agenten unterbrochen und fortgesetzt wird, werden abgeschlossene Tool-Aufrufe mit Nebeneffekten nicht erneut ausgeführt – ein aus dem dauerhaften Hauptbuch abgeleitetes Tool-Call-Journal blockiert doppelte Versendungen, Gebühren und Tickets."
---

# Dauerhafter Lebenslauf

> **Für wen ist das gedacht:** Jeder, der verstehen möchte, wie das Framework funktioniert
> -Wiederherstellung vermeidet doppelte Nebenwirkungen. Dies ist ein eingebautes Verhalten – es gibt
> nichts zu verkabeln.

Gehostete Agentenausführungen werden unterbrochen: Eine serverlose Funktion erreicht mitten im Stream ihr hartes Timeout, ein Gateway trennt die Verbindung nach 45 Sekunden, ein Socket hängt sich auf, die Plattform startet einen Kaltstart. Das Framework stellt diese bereits wieder her, indem es das Konversationspräfix speichert und den LLM-Aufruf erneut ausführt („Weiter an der Stelle, an der Sie aufgehört haben“). Aber die Wiederherstellung allein hat einen scharfen Vorteil: Wenn der unterbrochene Versuch **bereits eine E-Mail gesendet oder ein Ticket erstellt hat**, könnte ein naiver Lebenslauf es noch einmal tun.

Dauerhafter Lebenslauf schließt diese Lücke. Beim Fortsetzen weiß das Framework, welche Toolaufrufe mit Nebeneffekten bereits abgeschlossen sind, und weigert sich, sie erneut auszuführen – und zwar auf zwei Ebenen.

```an-diagram title="Zwei Ebenen blockieren doppelte Nebenwirkungen im Lebenslauf" summary="Das Journal liest das dauerhafte Hauptbuch und klassifiziert frühere Anrufe; Schicht 1 teilt dem Modell mit, Schicht 2 blockiert einen erneut gesendeten Schreibvorgang, der mit einem abgeschlossenen Eintrag übereinstimmt, hart."
{
  "html": "<div class=\"diagram-durable\"><div class=\"diagram-box\" data-rough>Run-event ledger<br><small class=\"diagram-muted\">tool_start / tool_done</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Tool-call journal</strong><small class=\"diagram-ok\">completed = start+done</small><small class=\"diagram-warn\">interrupted = start, no done</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">Layer 1 · prompt note &rarr; model</div><div class=\"diagram-pill accent\">Schicht 2 · hart blockierter erneut ausgelöster Schreibvorgang</div></div></div>",
  "css": ".diagram-durable{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-durable .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-durable .diagram-arrow{font-size:22px;line-height:1}.diagram-durable .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Das Tool-Call-Journal {#journal}

Das Journal ist ein **reiner Lesevorgang über das dauerhafte Run-Event-Ledger** – es gibt keinen neuen Aufzeichnungs-Hook im Hot-Pfad. Es klassifiziert die bereits für die aktuelle Runde aufgezeichneten Werkzeugaufrufe:

- **Abgeschlossen** – ein `tool_start` mit einem passenden `tool_done`. Der Anruf wurde ausgeführt, die Nebenwirkung trat auf und das Ergebnis wurde aufgezeichnet. **Nicht erneut ausführen.**
- **Unterbrochen** – ein `tool_start` mit **kein** passendem `tool_done`. Der Anruf begann, sein Nebeneffekt ist möglicherweise aufgetreten oder auch nicht, und die Unterbrechung hat das Ergebnis verschlungen. Ergebnis unbekannt.

Matching spiegelt wider, wie dauerhafte Drehungen an anderer Stelle wiederhergestellt werden: Ein `tool_done` paart sich mit dem ältesten noch offenen `tool_start` für denselben Werkzeugnamen (FIFO pro Werkzeug). Ein `clear`-Ereignis (verworfene Teilausgabe) setzt die Zählung pro Runde zurück, sodass aufgegebene Teilausgaben keine offenen Phantomaufrufe hinterlassen.

## Ebene 1: Journalnotiz auf Eingabeaufforderungsebene {#prompt-note}

Wenn eine Ausführung fortgesetzt wird (Soft-Timeout, Gateway-Timeout oder irgendein wiederaufnehmbarer Transportfehler), hängt das Framework eine **strukturierte Journalnotiz** an die Wiederaufnahme-Eingabeaufforderung an, direkt nach dem Anstoß „Weiter an der Stelle, an der Sie aufgehört haben“. Die Notiz teilt dem Modell im Klartext mit:

- welches Tool **bereits abgeschlossen** aufruft (mit kurzen Ergebnissen), sodass es sie wiederverwendet und **nicht** erneut ausführt, und
- welche Toolaufrufe **mit unbekanntem Ergebnis unterbrochen** wurden, sodass der Status überprüft wird, bevor von Erfolg oder Misserfolg ausgegangen wird.

Wenn das Journal leer ist (eine Wende ohne Werkzeugaktivität oder eine saubere Fortsetzung), wird nichts Zusätzliches angehängt und das Wiederaufnahmeverhalten ist Byte für Byte das gleiche wie zuvor. Der Hinweis gilt nach bestem Wissen und Gewissen: Ein fehlgeschlagener Ledger-Lesevorgang blockiert niemals eine ansonsten erfolgreiche Wiederherstellung.

## Schicht 2: Werkzeugschicht-Hardblock {#hard-block}

Der Aufforderungshinweis hat beratenden Charakter – ein braves Model beachtet ihn, aber ein Model ist keine Garantie. Die Schleife erzwingt es also auch auf der Werkzeugebene.

Bevor die Schleife in einem wiederaufgenommenen Block ausgeführt wird, erstellt sie einmal einen Snapshot des Journals (wobei nur **vorherige** Blöcke dieser logischen Runde erfasst werden). Wenn das Modell ein **Schreibwerkzeug** erneut sendet, dessen Werkzeugname **und Eingabe** mit einem abgeschlossenen Journaleintrag übereinstimmen, wird die Schleife kurzgeschlossen: Sie gibt das aufgezeichnete Ergebnis zurück, anstatt die Aktion auszuführen, mit dem Hinweis, dass der Aufruf bereits in einem früheren unterbrochenen Versuch abgeschlossen wurde und nicht erneut ausgeführt wurde, um einen doppelten Nebeneffekt zu vermeiden.

Schlüsseleigenschaften:

- **Nur Schreibwerkzeuge.** Schreibgeschützt (`readOnly` / GET) actions werden niemals blockiert – erneutes Lesen ist sicher und idempotent.
- **Content-addressed.** Die Übereinstimmung bezieht sich auf den Namen des Werkzeugs + die Eingabesignatur, sodass ein fortgesetzter Aufruf, der sich an einer anderen Position in der Runde befindet, immer noch übereinstimmt. Ein _anderer_ Aufruf (unterschiedliche Argumente) wird als neu behandelt und normal ausgeführt.
- **Einmal verbrauchen.** Jeder abgeschlossene Eintrag wird beansprucht, wenn er übereinstimmt, sodass zwei wirklich unterschiedliche, identische neue Aufrufe in derselben Runde nicht beide bei einem protokollierten Abschluss kurzgeschlossen werden.
- **Neue Anrufe bleiben unberührt.** Bei einem ersten Anruf wird ein leeres Journal angezeigt. Bei normalen Läufen ändert sich nichts.

```an-callout
{
  "tone": "success",
  "body": "Together the two layers mean an interrupted run that already had a real side effect resumes **without repeating it** — no duplicate emails, charges, or tickets — while genuinely new work still runs. Read-only actions are never blocked; re-reading is always safe."
}
```

## Verwandt

- [**Real-Time Sync**](/docs/real-time-collaboration) – wie das dauerhafte Laufbuch zum Client streamt und bei erneuter Verbindung wiedergibt.
- [**Actions**](/docs/actions) – `readOnly` markiert Lesevorgänge als sicher für die erneute Ausführung; alles andere wird als Nebenwirkung behandelt.
- [**In-Loop Processors**](/docs/processors) – eine weitere schleifeninterne Verhärtungsnaht.
