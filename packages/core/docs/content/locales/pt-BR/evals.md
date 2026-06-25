---
title: "Portão de avaliação de CI"
description: "Escreva casos de teste *.eval.ts que executam o agente real em entradas fixas, pontuam a saída com marcadores que podem ser compostos e controlam CI/implantações em um limite."
---

# Portão de avaliação de CI

Evals são uma primitiva de teste de primeira classe: você declara um prompt mais o comportamento esperado, o executor **realmente executa o loop do agente** contra essa entrada, pontua a saída com marcadores composíveis e sai diferente de zero se algum caso pontuar abaixo de seu limite. Essa saída diferente de zero torna o `agent-native eval` uma porta de implantação de CI imediata.

Isso é complementar à pontuação post-hoc em [Observability](/docs/observability):

- **Avaliações de observabilidade** (`observability/evals.ts`) — _"como foi essa execução real?"_ Passivo, amostrado, vive próximo aos rastros.
- **`*.eval.ts` (este primitivo)** — _"o agente faz a coisa certa nesta entrada fixa?"_ Ativo, determinístico, um portão CI executado através do CLI.

O executor resolve um mecanismo/modelo independente de provedor a partir do registro existente (nenhum modelo é codificado), de modo que o mesmo conjunto é executado em qualquer mecanismo para o qual o aplicativo está configurado.

```an-diagram title="Da entrada fixa ao portão de implantação" summary="Na verdade, o executor executa o loop do agente em cada caso, pontua a saída e sai diferente de zero se algum marcador cair abaixo do limite – tornando-o um portão CI drop-in."
{
  "html": "<div class=\"eval-flow\"><div class=\"diagram-node\">*.eval.ts<br><small class=\"diagram-muted\">prompt + expected behavior</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Executar o loop do agente<br><small class=\"diagram-muted\">real engine/model</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Scorers<br><small class=\"diagram-muted\">every one must pass threshold</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box ok\">exit 0 &rarr; deploy</div><div class=\"diagram-box warn\">exit 1 &rarr; block</div></div></div>",
  "css": ".eval-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.eval-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.eval-flow .diagram-col{display:flex;flex-direction:column;gap:8px}.eval-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Escrever uma avaliação {#writing}

Solte um arquivo `*.eval.ts` em qualquer lugar do aplicativo (ou um arquivo `evals/*.ts`). Cada arquivo `export default defineEval(...)` (ou exporta um array deles):

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

Uma avaliação é aprovada somente quando **todos** pontuadores atingem o limite. Principais campos `defineEval`:

| Campo       | Tipo                  | Notas                                                                                |
| ----------- | --------------------- | ------------------------------------------------------------------------------------ |
| `name`      | string                | Obrigatório. Mostrado no relatório.                                                  |
| `input`     | `{ prompt, history }` | `prompt` obrigatório; turnos `{ role, text }` anteriores opcionais.                  |
| `scorers`   | `Scorer[]`            | Obrigatório, pelo menos um.                                                          |
| `threshold` | número `0..1`         | Barra de passes por artilheiro. Padrão `0.5`; substituível pelo CLI.                 |
| `run`       | função                | Substituição opcional para configuração personalizada (dados iniciais, multivoltas). |

A execução do agente entregue aos marcadores é pequena e independente de transporte:

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

## Marcadores integrados {#built-in}

Importado de `@agent-native/core/eval`:

| Artilheiro               | Pontuação                                                                                      | Modelo? |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------- |
| `exactMatch(expected)`   | `1.0` se o texto for igual a `expected` (cortado, sem distinção entre maiúsculas e minúsculas) | Não     |
| `contains(needles)`      | Fração de substrings necessárias presentes (portanto, ocorrências parciais aparecem)           | Não     |
| `usesTool(toolName)`     | `1.0` se o agente invocou essa ferramenta/ação pelo menos uma vez                              | Não     |
| `llmJudge({ criteria })` | LLM-como-juiz pontuou de acordo com uma rubrica de linguagem natural, → `0..1`                 | Sim     |

`exactMatch` e `contains` usam um `{ caseSensitive }` opcional. `llmJudge` usa `{ criteria, rubric?, name?, scoreRange? }` – sua saída é normalizada para `[0, 1]`, e o modelo de juiz é o que o executor resolveu (nunca um provedor codificado).

## Pontuadores personalizados: o pipeline de 4 etapas {#custom}

`createScorer` constrói um marcador a partir de um pipeline de 4 etapas no estilo Mastra. Somente `generateScore` é necessário:

```an-diagram title="O pipeline do marcador em 4 etapas" summary="pré-processar e analisar o padrão de identidade; apenas generateScore é necessário. analyze pode executar JS simples ou chamar um juiz LLM via ctx."
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

`preprocess` e `analyze` são padronizados como identidade (o apontador vê o `AgentRunOutput` bruto). A etapa `analyze` recebe um `ctx` com um auxiliar `judge()` independente de provedor para pontuação apoiada por LLM:

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

## Correndo pelo portão {#cli}

```bash
agent-native eval                    # run every *.eval.ts; non-zero exit on failure
agent-native eval billing            # somente arquivos cujo caminho contém "billing"
agent-native eval --json             # machine-readable report (for CI)
agent-native eval --threshold 0.8    # override every eval's pass threshold (0..1)
```

O comando descobre `**/*.eval.ts` e `evals/*.ts` no aplicativo atual, executa o agente para cada entrada, pontua, imprime uma tabela legível (ou JSON) e **sai diferente de zero se alguma pontuação de avaliação estiver abaixo de seu limite**.

Códigos de saída:

| Código | Significado                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| `0`    | Todas as avaliações foram aprovadas — _ou_ nenhum arquivo de avaliação foi encontrado (compatível com CI). |
| `1`    | Pelo menos uma avaliação com pontuação abaixo do limite ou o conjunto apresentou erro.                     |
| `2`    | Argumentos incorretos (por exemplo, `--threshold` fora de `[0, 1]`).                                       |

### Como porta de implantação de CI {#ci}

Adicione-o ao pipeline executado antes da implantação:

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npx agent-native eval --json
```

Uma regressão que deixa qualquer marcador abaixo do limite falha na etapa e bloqueia a implantação. Um aplicativo sem arquivos de avaliação sai do `0`, portanto, a adoção de avaliações é opcional por aplicativo.

## O que vem a seguir

- [**Observability**](/docs/observability) — pontuação post-hoc de execuções reais de produção (a camada complementar)
- [**Actions**](/docs/actions) — as ferramentas/actions que aparecem em `toolCalls`
- [**Agent Teams**](/docs/agent-teams) — subagentes que uma avaliação pode exercer
