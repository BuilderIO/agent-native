---
title: "Migration nach Agent-Native (/migrate)"
description: "Migration ist ein integriertes /migrate-Ziel im Agent-Native-Code-Arbeitsbereich – keine separate App. Die vollständige Anleitung finden Sie unter Agent-Native-Code UI."
---

# Migration nach Agent-Native (/migrate)

Migration ist **kein separates Produkt oder eine separate Vorlage** – sie ist integriert
`/migrate`-Ziel im [Agent-Native Code](/docs/code-agents-ui)-Arbeitsbereich.
Es wird als normale Code-Sitzung ausgeführt, die Sie fortsetzen, anhängen, überprüfen und beenden können.

```an-diagram title="/migrate ist eine Code-Sitzung, keine separate App" summary="Ein Pfad, URL oder eine Beschreibung wird eingegeben; Die Ausführung nutzt den gleichen Speicher, das gleiche Transkript und die gleichen Steuerelemente wie jede andere Code-Sitzung und kann ein tragbares Dossier ausgeben."
{
  "html": "<div class=\"diagram-migrate\"><div class=\"diagram-col\"><div class=\"diagram-pill\">./local-app</div><div class=\"diagram-pill\">https://example.com</div><div class=\"diagram-pill\">--describe \\\"...\\\"</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">/migrate goal</span><small class=\"diagram-muted\">gleicher Store · Transkript · Laufsteuerung</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>Migrierte App</div><div class=\"diagram-pill ok\">--emit dossier</div></div></div>",
  "css": ".diagram-migrate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-migrate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-migrate .diagram-arrow{font-size:22px;line-height:1}.diagram-migrate .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site plus dashboard"
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app   # shortcut into the same goal
```

Der vollständige Leitfaden – Eingabeformen (Pfad / URL / Beschreibung), `--emit`-Dossiers,
Plan vs. Auto-Modus, Ausführungskontrollen, Anmeldeinformationen, Desktop-Deep-Links und
`@agent-native/migrate`-Paketexporte – lebt in
[Agent-Native Code UI → Migrating to Agent-Native](/docs/code-agents-ui#migrate).

> [!NOTE]
> Die alte versteckte `migration`-Detail-App wurde entfernt. Verwenden Sie den Code
> -Arbeitsbereich, die Registerkarte „Desktop-Code“ oder ein ausgegebenes Dossier als unterstützt
> Oberflächen.
