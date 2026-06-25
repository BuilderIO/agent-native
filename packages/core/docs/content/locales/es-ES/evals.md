---
title: "Puerta de evaluación de CI"
description: "Escriba casos de prueba *.eval.ts que ejecuten el agente real contra entradas fijas, califique la salida con puntajes componibles y controle CI/implementaciones en un umbral."
---

# Puerta de evaluación de CI

Las evaluaciones son una primitiva de prueba de primera clase: usted declara un mensaje más el comportamiento que espera, el corredor **en realidad ejecuta el bucle del agente** contra esa entrada, califica la salida con puntajes componibles y sale con un valor distinto de cero si algún caso obtiene un puntaje por debajo de su umbral. Esa salida distinta de cero convierte a `agent-native eval` en una puerta de implementación de CI inmediata.

Esto es complementario a la puntuación post-hoc en [Observability](/docs/observability):

- **Evaluaciones de observabilidad** (`observability/evals.ts`) — _"¿Cómo funcionó esta ejecución real?"_ Pasivo, muestreado, vive junto a los rastros.
- **`*.eval.ts` (esta primitiva)** — _"¿el agente hace lo correcto en esta entrada fija?"_ Activa, determinista, una puerta de CI que se ejecuta a través de CLI.

El ejecutor resuelve un motor/modelo independiente del proveedor a partir del registro existente (ningún modelo está codificado), por lo que el mismo conjunto se ejecuta en cualquier motor para el que esté configurada la aplicación.

```an-diagram title="De entrada fija a puerta desplegable" summary="En realidad, el corredor ejecuta el ciclo del agente en cada caso, califica la salida y sale con un valor distinto de cero si algún puntaje cae por debajo del umbral, lo que la convierte en una puerta de CI directa."
{
  "html": "<div class=\"eval-flow\"><div class=\"diagram-node\">*.eval.ts<br><small class=\"diagram-muted\">prompt + expected behavior</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Ejecutar el bucle del agente<br><small class=\"diagram-muted\">real engine/model</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Scorers<br><small class=\"diagram-muted\">every one must pass threshold</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box ok\">exit 0 &rarr; deploy</div><div class=\"diagram-box warn\">exit 1 &rarr; block</div></div></div>",
  "css": ".eval-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.eval-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.eval-flow .diagram-col{display:flex;flex-direction:column;gap:8px}.eval-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Escribir una evaluación {#writing}

Suelte un archivo `*.eval.ts` en cualquier lugar de la aplicación (o un archivo `evals/*.ts`). Cada archivo `export default defineEval(...)` (o exporta una serie de ellos):

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

Una evaluación se realiza solo cuando **todos** los anotadores alcanzan el umbral. Campos clave de `defineEval`:

| Campo       | Tipo                  | Notas                                                                                 |
| ----------- | --------------------- | ------------------------------------------------------------------------------------- |
| `name`      | cadena                | Obligatorio. Se muestra en el informe.                                                |
| `input`     | `{ prompt, history }` | Requerido `prompt`; Giros previos opcionales de `{ role, text }`.                     |
| `scorers`   | `Scorer[]`            | Obligatorio, al menos uno.                                                            |
| `threshold` | número `0..1`         | Barra de pase por anotador. Predeterminado `0.5`; anulable desde el CLI.              |
| `run`       | función               | Anulación opcional para configuración personalizada (datos de semillas, multivuelta). |

El recorrido del agente entregado a los anotadores es pequeño y independiente del transporte:

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

## Anotadores integrados {#built-in}

Importado de `@agent-native/core/eval`:

| Goleador                 | Puntuación                                                                                      | ¿Modelo? |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------- |
| `exactMatch(expected)`   | `1.0` si el texto es igual a `expected` (recortado, no distingue entre mayúsculas y minúsculas) | No       |
| `contains(needles)`      | Fracción de subcadenas requeridas presentes (por lo que aparecen coincidencias parciales)       | No       |
| `usesTool(toolName)`     | `1.0` si el agente invocó esa herramienta/acción al menos una vez                               | No       |
| `llmJudge({ criteria })` | LLM-como-juez anotó según una rúbrica de lenguaje natural, → `0..1`                             | Sí       |

`exactMatch` y `contains` toman un `{ caseSensitive }` opcional. `llmJudge` toma `{ criteria, rubric?, name?, scoreRange? }`; su salida está normalizada a `[0, 1]` y el modelo de juez es lo que resolvió el corredor (nunca un proveedor codificado).

## Calificadores personalizados: el proceso de 4 pasos {#custom}

`createScorer` construye un anotador a partir de un proceso de 4 pasos estilo Mastra. Sólo se requiere `generateScore`:

```an-diagram title="El proceso de anotador de 4 pasos" summary="preprocesar y analizar la identidad predeterminada; solo se requiere generateScore. analizar puede ejecutar JS simple o llamar a un juez LLM a través de ctx."
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

`preprocess` y `analyze` tienen por defecto la identidad (el anotador ve el `AgentRunOutput` sin procesar). El paso `analyze` recibe un `ctx` con un asistente `judge()` independiente del proveedor para la puntuación respaldada por LLM:

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

## corriendo la puerta {#cli}

```bash
agent-native eval                    # run every *.eval.ts; non-zero exit on failure
agent-native eval billing            # sólo archivos cuya ruta contenga "facturación"
agent-native eval --json             # machine-readable report (for CI)
agent-native eval --threshold 0.8    # override every eval's pass threshold (0..1)
```

El comando descubre `**/*.eval.ts` y `evals/*.ts` en la aplicación actual, ejecuta el agente para cada entrada, lo califica, imprime una tabla legible (o JSON) y **sale de un valor distinto de cero si alguna evaluación obtiene un puntaje inferior a su umbral**.

Códigos de salida:

| Código | Significado                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------- |
| `0`    | Se aprobaron todas las evaluaciones, _o_ no se encontró ningún archivo de evaluación (compatible con CI). |
| `1`    | Al menos una evaluación obtuvo una puntuación inferior al umbral o la suite tuvo un error.                |
| `2`    | Malos argumentos (por ejemplo, `--threshold` fuera de `[0, 1]`).                                          |

### Como puerta de implementación de CI {#ci}

Agréguelo al proceso que se ejecuta antes de una implementación:

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npx agent-native eval --json
```

Una regresión que deja a cualquier anotador por debajo del umbral falla el paso y bloquea el despliegue. Una aplicación sin archivos de evaluación sale de `0`, por lo que la adopción de evaluaciones es una opción de suscripción por aplicación.

## ¿Qué sigue?

- [**Observability**](/docs/observability): puntuación post hoc de tiradas de producción reales (la capa complementaria)
- [**Actions**](/docs/actions): las herramientas/actions que aparecen en `toolCalls`
- [**Agent Teams**](/docs/agent-teams): subagentes que una evaluación podría ejercer
