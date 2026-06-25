---
title: "Beobachtungsgedächtnis"
description: "Dreistufige Hintergrundkomprimierung (aktuelle Rohdaten → Beobachtungen → Reflexionen), die lange Agent-Threads kostengünstig und stabil im Prompt-Cache hält, ohne kurze Konversationen zu beeinträchtigen."
---

# Beobachtungsgedächtnis

Ein Agent-Thread mit langer Laufzeit sammelt ein riesiges Transkript: jede Nachricht, jeder Tool-Aufruf, jedes Ergebnis. Das erneute Abspielen des gesamten Verlaufs in das Modell bei jeder Runde ist teuer und führt schließlich dazu, dass das Kontextfenster zerstört wird. **Observational Memory (OM)** komprimiert den älteren Teil eines langen Threads in einer veralteten, geschichteten Zusammenfassung, sodass das Modell immer noch weiß, was passiert ist – nur zu einem Bruchteil der Token-Kosten –, während die letzten Wendungen wörtlich bleiben.

OM ist völlig automatisch und inhaberabhängig. **Kurze Threads sind davon nicht betroffen**: Bis ein Thread den ersten Komprimierungsschwellenwert überschreitet, ist OM ein No-Op und der Kontext ist Byte für Byte so, wie er ohne ihn wäre.

## Die drei Ebenen {#tiers}

OM stellt einen langen Thread mit drei Schichten dar, vom am meisten destillierten zum aktuellsten:

| Stufe                      | Was es ist                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Reflexionen**            | Höchste Ebene, komprimiert aus dem Beobachtungsprotokoll, sobald es groß wird. Die lange Zusammenfassung.                             |
| **Beobachtungen**          | Dichte, datierte Einträge, die eine Reihe von Rohnachrichten zu einer kompakten Aufzeichnung dessen zusammenfassen, was passiert ist. |
| **Neueste Rohnachrichten** | Die letzten N Runden werden **wörtlich** beibehalten – nie gefaltet –, sodass der Agent immer den neuesten Kontext sieht.             |

```an-diagram title="Dreistufig, destilliert bis aktuell" summary="Das ältere Präfix gliedert sich in datierte Beobachtungen und eine Langbogenreflexion; nur die letzten Wendungen bleiben wörtlich."
{
  "html": "<div class=\"om\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Reflexionen</span><small class=\"diagram-muted\">Langfristige Zusammenfassung aus dem Beobachtungsprotokoll</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Beobachtungen</span><small class=\"diagram-muted\">dichte, datierte Einträge, die Rohmeldungen zusammenfassen</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&uarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">Aktuelle Rohmeldungen</span><small class=\"diagram-muted\">last N turns, kept <strong>verbatim</strong> — nie zusammengefaltet</small></div></div>",
  "css": ".om{display:flex;flex-direction:column-reverse;align-items:stretch;gap:8px}.om .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.om .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

Bei jeder Runde fügt die Leseseite diese in einem einzigen selbstbeschrifteten `[Observational Memory]`-Block zusammen, der das rohe ältere Präfix ersetzt, das aktuelle Rohfenster intakt hält und das Modell anweist, den komprimierten Datensatz als maßgeblich zu behandeln (fertige Arbeiten nicht wiederholen, den aufgezeichneten Entscheidungen, Namen, Daten und Status vertrauen).

## Wie die Komprimierung ausgeführt wird {#compaction}

Zwei Durchgänge werden als **Fire-and-Forget-Best-Effort-Schritt** _nach_ einer sauberen Drehung ausgeführt, sodass sie der für den Benutzer sichtbaren Reaktion niemals Latenz hinzufügen und Fehler verschluckt werden:

1. **Beobachter** – sobald die _unbeobachteten_ Nachrichten eines Threads den Beobachtungstoken-Schwellenwert überschreiten, werden sie zu einem einzigen dichten Beobachtungseintrag zusammengefasst.
2. **Reflektor** – sobald das persistente Beobachtungsprotokoll selbst den Reflexions-Token-Schwellenwert überschreitet, werden die Beobachtungen in einer Reflexion höherer Ebene zusammengefasst.

```an-diagram title="Zwei beste Pässe nach einer sauberen Drehung" summary="Unterhalb der Schwelle erfolgt bei jedem Durchgang ein No-Ops-Vorgang, daher ist es günstig, den Verdichter in jeder Runde laufen zu lassen. Fehler werden verschluckt und verursachen keine zusätzliche Latenz."
{
  "html": "<div class=\"om-pass\"><div class=\"diagram-node\">Sauberer Turn endet<br><small class=\"diagram-muted\">fire-and-forget</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Observer</span><small class=\"diagram-muted\">unobserved tokens &gt; 30k? &rarr; fold into one observation</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Reflector</span><small class=\"diagram-muted\">observation log &gt; 40k? &rarr; condense into a reflection</small></div></div>",
  "css": ".om-pass{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.om-pass .diagram-node,.om-pass .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.om-pass .diagram-arrow{font-size:22px;line-height:1}"
}
```

Beide passieren unter ihren Schwellenwerten keinen Betrieb, daher ist es günstig, den Verdichter nach jeder Runde anzurufen. Da OM das flüchtige Rohpräfix durch stabilen komprimierten Text ersetzt, bleibt die Eingabeaufforderung auch über die Windungen eines langen Threads hinweg **cachestabil**.

OM-Daten befinden sich in der eigenen SQL-Datenbank der App und sind auf den Besitzer (und die Organisation, falls vorhanden) beschränkt – das gleiche Scoping-Modell wie der Rest des Frameworks. Es wird niemals von mehreren Benutzern geteilt.

## Konfiguration {#config}

Standardeinstellungen sind konservativ. Ein Bediener kann die Komprimierung zum Zeitpunkt der Bereitstellung mit `AGENT_NATIVE_OM_*`-Umgebungsvariablen wählen (keine erneute Bereitstellung des App-Codes erforderlich); Bei einem ungültigen oder fehlenden Wert wird immer auf den genannten Standardwert zurückgegriffen.

| Umgebungsvariable                             | Standard | Was es steuert                                                                                                       |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `AGENT_NATIVE_OM_OBSERVATION_TOKEN_THRESHOLD` | `30000`  | Token für unbeobachtete Nachrichten, die den Beobachter dazu veranlassen, sie zu einer Beobachtung zusammenzufassen. |
| `AGENT_NATIVE_OM_REFLECTION_TOKEN_THRESHOLD`  | `40000`  | Beobachtungsprotokolltoken, die den Reflektor dazu veranlassen, sich zu einer Reflexion zu verdichten.               |
| `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT`    | `12`     | Wie viele der aktuellsten Nachrichten bleiben wörtlich (werden nie zu einer Beobachtung zusammengefasst).            |

Die Ausgabeobergrenzen für Observer und Reflector (4000/2000 Token) verhindern, dass ein einziger Verdichtungsdurchgang das Budget sprengt. Sie sind im Code über `resolveObservationalMemoryConfig({ ... })` einstellbar, aber nicht umgebungsexponiert.

> [!TIP]
> Senken Sie die Schwellenwerte für eine frühere Komprimierung (günstigere lange Threads, etwas mehr Zusammenfassung); Erhöhen Sie sie, um vor dem Komprimieren mehr Rohgeschichte im Kontext zu behalten. Stellen Sie `AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT` höher ein, wenn Ihre Workflows ein längeres wörtliches Ende benötigen.

## Wenn es losgeht {#when}

OM ändert das Verhalten nur für Threads, die lange genug sind, um mindestens eine Beobachtung oder Reflexion zu erzeugen. Konkret:

- Ein brandneuer oder kurzer Thread: noch keine OM-Einträge → der Kontext ist das reine Transkript, unverändert.
- Ein langer Thread, der den Beobachtungsschwellenwert überschritten hat: Das ältere Präfix wird durch den komprimierten `[Observational Memory]`-Block ersetzt, das aktuelle Rohende bleibt unverändert und die Token-Nutzung sinkt erheblich.

Die Injektion erfolgt nach bestem Aufwand und grenzensicher – wenn kein sicherer Trimmpunkt gefunden werden kann (z. B. ein ausstehendes Tool-Nutzungs-/Ergebnispaar am Fensterrand liegt), injiziert OM den Speicherblock _additiv_ ohne Trimmen, anstatt das Risiko einzugehen, ein ausstehendes Tool-Ergebnis fallen zu lassen.

## Verwandt

- [**Using Your Agent**](/docs/using-your-agent) – die tägliche Schleife der Arbeit mit dem Agent, der neben Ihrer App angedockt ist.
- [**Observability**](/docs/observability) – Token- und Kostenmetriken pro Lauf, in denen die Einsparungen von OM angezeigt werden.
- [**Custom Agents & Teams**](/docs/agent-teams) – lange Subagent-Läufe profitieren von der gleichen Komprimierung.
