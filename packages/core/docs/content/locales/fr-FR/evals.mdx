---
title: "Porte d'évaluation CI"
description: "Écrivez des cas de test *.eval.ts qui exécutent l'agent réel sur des entrées fixes, évaluez la sortie avec des évaluateurs composables et contrôlez les CI/déploiements sur un seuil."
---

# Porte d'évaluation CI

Les évaluations sont une primitive de test de première classe : vous déclarez une invite ainsi que le comportement que vous attendez, le coureur **exécute en fait la boucle d'agent** sur cette entrée, note la sortie avec des marqueurs composables et sort non nul si un cas obtient un score inférieur à son seuil. Cette sortie non nulle fait de `agent-native eval` une porte de déploiement CI instantanée.

Ceci est complémentaire à la notation post-hoc dans [Observability](/docs/observability) :

- **Évaluations d'observabilité** (`observability/evals.ts`) — _"Comment s'est déroulée cette véritable exécution ?"_ Passif, échantillonné, vit à côté des traces.
- **`*.eval.ts` (cette primitive)** — _"L'agent fait-il la bonne chose sur cette entrée fixe ?"_ Active, déterministe, une porte CI exécutée via le CLI.

Le programme d'exécution résout un moteur/modèle indépendant du fournisseur à partir du registre existant (aucun modèle n'est codé en dur) de sorte que la même suite s'exécute sur le moteur pour lequel l'application est configurée.

```an-diagram title="De l'entrée fixe à la porte déployée" summary="Le coureur exécute en fait la boucle d'agent sur chaque cas, note la sortie et sort non nul si un marqueur tombe en dessous du seuil, ce qui en fait une porte CI directe."
{
  "html": "<div class=\"eval-flow\"><div class=\"diagram-node\">*.eval.ts<br><small class=\"diagram-muted\">prompt + expected behavior</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Exécuter la boucle de l’agent<br><small class=\"diagram-muted\">real engine/model</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Scorers<br><small class=\"diagram-muted\">every one must pass threshold</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box ok\">exit 0 &rarr; deploy</div><div class=\"diagram-box warn\">exit 1 &rarr; block</div></div></div>",
  "css": ".eval-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.eval-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.eval-flow .diagram-col{display:flex;flex-direction:column;gap:8px}.eval-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Écrire une évaluation {#writing}

Déposez un fichier `*.eval.ts` n'importe où dans l'application (ou un fichier `evals/*.ts`). Chaque fichier `export default defineEval(...)` (ou en exporte un tableau) :

```ts
// evals/greeting.eval.ts
import { defineEval, contains, llmJudge } from "@agent-native/core/eval";

export default defineEval({
  name: "greets the user by name",
  input: { prompt: "Say hi to Ada." },
  threshold: 0.7, // per-scorer pass bar; default 0.5
  scorers: [
    contains("Ada"),
    llmJudge({ criteria: "friendliness", rubric: "1.0 = warm greeting" }),
  ],
});
```

Une évaluation réussit uniquement lorsque **tous** les marqueurs atteignent le seuil. Champs clés `defineEval` :

| Champ       | Tapez                 | Remarques                                                                                      |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `name`      | chaîne                | Obligatoire. Affiché dans le rapport.                                                          |
| `input`     | `{ prompt, history }` | `prompt` requis ; Virages `{ role, text }` préalables en option.                               |
| `scorers`   | `Scorer[]`            | Obligatoire, au moins un.                                                                      |
| `threshold` | numéro `0..1`         | Barre de passe par buteur. `0.5` par défaut ; remplaçable à partir du CLI.                     |
| `run`       | fonction              | Remplacement facultatif pour une configuration personnalisée (données de départ, multi-tours). |

Le nombre d'agents remis aux marqueurs est petit et indépendant du transport :

```ts
interface AgentRunOutput {
  text: string; // concatenated assistant text
  toolCalls: readonly string[]; // tool/action names, in call order
  ok: boolean; // completed without a terminal error
  error?: string;
  runId: string;
  durationMs: number;
}
```

## Buteurs intégrés {#built-in}

Importé depuis `@agent-native/core/eval` :

| Buteur                   | Note                                                                          | Modèle ? |
| ------------------------ | ----------------------------------------------------------------------------- | -------- |
| `exactMatch(expected)`   | `1.0` si le texte est égal à `expected` (tronqué, insensible à la casse)      | Non      |
| `contains(needles)`      | Fraction des sous-chaînes requises présentes (donc surface des hits partiels) | Non      |
| `usesTool(toolName)`     | `1.0` si l'agent a invoqué cet outil/action au moins une fois                 | Non      |
| `llmJudge({ criteria })` | LLM-en tant que juge a été noté selon une grille en langage naturel, → `0..1` | Oui      |

Les `exactMatch` et `contains` acceptent un `{ caseSensitive }` en option. `llmJudge` prend `{ criteria, rubric?, name?, scoreRange? }` — sa sortie est normalisée à `[0, 1]` et le modèle de jugement est celui que le coureur a résolu (jamais un fournisseur codé en dur).

## Scoreurs personnalisés : le pipeline en 4 étapes {#custom}

`createScorer` crée un marqueur à partir d'un pipeline en 4 étapes de style Mastra. Seul `generateScore` est requis :

```an-diagram title="Le pipeline des marqueurs en 4 étapes" summary="prétraiter et analyser l'identité par défaut ; seul generateScore est requis. analyser peut exécuter du JS simple ou appeler un juge LLM via ctx."
{
  "html": "<div class=\"scorer\"><div class=\"diagram-card\"><span class=\"diagram-pill\">preprocess(run)</span><small class=\"diagram-muted\">transform the run/output &middot; optional</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">analyze(x, ctx)</span><small class=\"diagram-muted\">plain JS or LLM judge &middot; optional</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">generateScore(a)</span><small class=\"diagram-muted\">&rarr; 0..1 normalized &middot; <strong>required</strong></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">generateReason</span><small class=\"diagram-muted\">human-readable why &middot; optional</small></div></div>",
  "css": ".scorer{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.scorer .diagram-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.scorer .diagram-arrow{font-size:20px;line-height:1}"
}
```

```text
preprocess(run)     → x          transform the run/output (optional)
analyze(x, ctx)     → analysis   plain JS OR an LLM judge (optional)
generateScore(a)    → 0..1       REQUIRED, normalized
generateReason(...) → string     human-readable why (optional)
```

`preprocess` et `analyze` sont par défaut l'identité (le marqueur voit le `AgentRunOutput` brut). L'étape `analyze` reçoit un `ctx` avec un assistant `judge()` indépendant du fournisseur pour la notation basée sur LLM :

```ts
import { createScorer, clamp01 } from "@agent-native/core/eval";

// A scorer that rewards short, tool-using answers.
const concise = createScorer({
  name: "concise_with_tool",
  analyze(run) {
    return {
      words: run.text.trim().split(/\s+/).length,
      usedTool: run.toolCalls.length > 0,
    };
  },
  generateScore({ words, usedTool }) {
    if (!usedTool) return 0;
    return clamp01(1 - Math.max(0, words - 40) / 200);
  },
  generateReason({ analysis }) {
    return `${analysis.words} words, tool used: ${analysis.usedTool}`;
  },
});
```

## Courir la porte {#cli}

```bash
agent-native eval                    # run every *.eval.ts; non-zero exit on failure
agent-native eval billing            # uniquement les fichiers dont le chemin contient "billing"
agent-native eval --json             # machine-readable report (for CI)
agent-native eval --threshold 0.8    # override every eval's pass threshold (0..1)
```

La commande découvre `**/*.eval.ts` et `evals/*.ts` sous l'application actuelle, exécute l'agent pour chaque entrée, l'évalue, imprime un tableau lisible (ou JSON) et **quitte une valeur différente de zéro si une évaluation obtient un score inférieur à son seuil**.

Codes de sortie :

| Code | Signification                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------- |
| `0`  | Toutes les évaluations ont réussi — _ou_ aucun fichier d'évaluation n'a été trouvé (compatible CI). |
| `1`  | Au moins une évaluation a obtenu un score inférieur au seuil, ou la suite a commis une erreur.      |
| `2`  | Mauvais arguments (par exemple `--threshold` en dehors de `[0, 1]`).                                |

### En tant que porte de déploiement CI {#ci}

Ajoutez-le au pipeline qui s'exécute avant un déploiement :

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npx agent-native eval --json
```

Une régression qui fait tomber un score en dessous du seuil fait échouer l'étape et bloque le déploiement. Une application sans fichiers d'évaluation quitte `0`. L'adoption des évaluations est donc facultative par application.

## Quelle est la prochaine étape

- [**Observability**](/docs/observability) — notation post-hoc des cycles de production réels (la couche complémentaire)
- [**Actions**](/docs/actions) — les outils/actions qui apparaissent dans `toolCalls`
- [**Agent Teams**](/docs/agent-teams) — sous-agents qu'une évaluation pourrait exercer
