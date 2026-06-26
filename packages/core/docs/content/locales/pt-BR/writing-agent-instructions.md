---
title: "Escrevendo instruções do agente e Habilidades"
description: "Como escrever ótimas instruções de agente para um aplicativo ou modelo nativo de agente: AGENTS.md, skills e descrições de ferramentas."
---

# Escrevendo instruções do agente e Habilidades

O comportamento do agente em um aplicativo nativo do agente é tão bom quanto as instruções fornecidas. Três superfícies trazem essa orientação: `AGENTS.md` (o mapa), skills (os mergulhos profundos) e descrições de ação/ferramenta (como o agente escolhe a ferramenta certa). Escreva cada um para recuperação rápida, não para prosa.

```an-diagram title="Três superfícies de autoria + uma superfície de tempo de execução" summary="AGENTS.md e descrições de ferramentas são carregadas a cada turno; carga de habilidades sob demanda; application_state é escrito ao vivo pela sua UI."
{
  "html": "<div class=\"diagram-surfaces\"><div class=\"diagram-card always\" data-rough><span class=\"diagram-pill accent\">Cada turno</span><strong>AGENTS.md</strong><small class=\"diagram-muted\">o mapa: propósito, regras centrais, chaves de estado, índice de ações + skills</small></div><div class=\"diagram-card always\" data-rough><span class=\"diagram-pill accent\">Cada turno</span><strong>Descrições de ferramentas</strong><small class=\"diagram-muted\">orienta a seleção de ferramentas — uma frase precisa cada</small></div><div class=\"diagram-card ondemand\" data-rough><span class=\"diagram-pill\">Sob demanda</span><strong>Habilidades</strong><small class=\"diagram-muted\">guia aprofundado, carregado quando a descrição dispara</small></div><div class=\"diagram-card runtime\" data-rough><span class=\"diagram-pill ok\">Live</span><strong>application_state</strong><small class=\"diagram-muted\">escrito pela sua UI: navegação, seleção, foco</small></div></div>",
  "css": ".diagram-surfaces{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.diagram-surfaces .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px}"
}
```

## Mantenha AGENTS.md pequeno e passível de leitura {#small-agents-md}

`AGENTS.md` é carregado como orientação. Deve ser a menor coisa que permite ao agente agir corretamente, com tudo profundamente inserido em skills. Procure estas seções e pouco mais:

- **Linha de objetivo** — uma frase sobre o que é o aplicativo e o fluxo de trabalho principal.
- **Regras básicas** — o punhado de invariantes que sempre devem ser mantidas (dados em SQL, operações passam por actions, IA passa pelo chat do agente, mudanças de esquema são aditivas). Marcadores curtos e imperativos.
- **Chaves de estado do aplicativo** — as chaves `navigation`/seleção/foco que o agente lê para saber o que o usuário está vendo, com seu formato.
- **Tabela de ações** — uma tabela compacta com nomes de ações específicos.
- **Índice Habilidades** — uma lista dos skills que existem e quando ler cada um deles.

Se uma seção ultrapassar uma tela, ela pertence a uma habilidade. `AGENTS.md` responde "o que é este aplicativo e o que posso fazer", e não "como exatamente faço a coisa difícil".

```markdown
# Aplicativo de projetos

One workspace for projects, tasks, and notes. Agent and UI share the same SQL
data and the same actions.

## Regras Básicas

- Data lives in SQL com Drizzle. Use actions for all writes.
- All AI work goes through the agent chat; never call an LLM inline.
- Schema changes are additive only.

## Estado do aplicativo

- `navigation.view`: `home` | `project`
- `navigation.projectId`: selected project on a project page

## Ações

| Action           | Purpose                     |
| ---------------- | --------------------------- |
| `list-projects`  | List accessible projects    |
| `create-project` | Create a project            |
| `update-project` | Rename or archive a project |

## Habilidades

- `project-imports` — read before importing legacy CSV exports.
- `sharing` — read before exposing a project to other users.
```

## AGENTS.md de fonte única {#single-source}

Mantenha um arquivo de instruções canônicas: `AGENTS.md`. Se um cliente espera `CLAUDE.md`, faça dele um link simbólico para `AGENTS.md` em vez de uma segunda cópia. Dois arquivos mantidos manualmente são levados à deriva e o agente acaba com regras contraditórias. Uma fonte de verdade, vinculada onde necessário.

## O frontmatter SKILL.md deve dizer o que AND quando {#skill-frontmatter}

O `description` é a única coisa que o agente vê ao decidir se deve ler uma habilidade. Deve responder a duas perguntas: o que a habilidade cobre e quando ativá-la. Uma descrição que descreva apenas o tópico não será acionada.

```markdown
---
name: project-imports
description: >-
  How to import projects from the legacy CSV export. Use when the user uploads
  a project CSV or asks to migrate projects from the old system.
---
```

- Lidere com a capacidade e adicione uma cláusula explícita **"Usar quando…"**.
- Seja um pouco agressivo – o acionamento excessivo supera uma habilidade que nunca carrega.
- Mantenha menos de 40 palavras; ele é carregado no contexto de cada conversa.

## Divulgação progressiva {#progressive-disclosure}

Escreva o `SKILL.md` como a camada enxuta e obrigatória: a regra, como fazer, a lista do que fazer/não fazer e dicas. Envie exemplos longos, referências de campo exaustivas, peculiaridades do API e tabelas de casos extremos em arquivos `references/` que o agente lê somente quando precisa deles.

```text
.agents/skills/project-imports/
├── SKILL.md            # regra + caminho feliz + do/don't
└── references/
    └── csv-format.md   # especificação completa da coluna, codificações, casos extremos
```

Isso mantém a superfície sempre carregada pequena e permite a escala de profundidade sem aumentar o contexto. Consulte o [Habilidades Guide](/docs/skills-guide) para ver o formato completo da habilidade.

## Escreva tabelas orientadas para a ação {#action-tables}

O agente verifica as tabelas mais rápido do que a prosa. Prefira uma tabela de nomes a propósitos em vez de parágrafos que descrevem cada operação. O mesmo se aplica a chaves de estado, tipos de campos e qualquer conjunto enumerável. As tabelas podem ser lidas, diferenciadas e fáceis de manter sincronizadas quando você adiciona uma ação.

## Escreva descrições claras das ferramentas {#tool-descriptions}

As descrições de ações são descrições de ferramentas – elas orientam a seleção de ferramentas. Faça de cada uma delas uma frase precisa e de propósito único:

- Diga o que faz e o que retorna, não como é implementado.
- Descreva cada parâmetro em seu `.describe()` para que o agente o preencha corretamente.
- Uma responsabilidade por ação. Se uma descrição precisar de "e também…", divida-a.
- Marque actions (`readOnly: true` ou `http: { method: "GET" }`) como somente leitura para que o agente saiba que é seguro ligar livremente.

```ts
defineAction({
  description: "Create a project. Returns the new project id and title.",
  schema: z.object({
    title: z.string().min(1).describe("Project title shown in the sidebar"),
  }),
  // ...
});
```

## Habilidades versus actions {#skills-vs-actions}

Habilidades e actions são complementares. Uma habilidade é uma orientação que o agente lê; um
ação é o código que o agente pode executar.

| Necessidade                                                                             | Usar                             |
| --------------------------------------------------------------------------------------- | -------------------------------- |
| O agente precisa seguir um fluxo de trabalho, política, lista de verificação ou rubrica | **Habilidade**                   |
| O agente precisa de exemplos, material de referência ou regras específicas do domínio   | **Habilidade**                   |
| O agente precisa ler ou gravar dados do aplicativo                                      | **Ação**                         |
| O agente precisa ligar para um API externo ou realizar uma aprovação                    | **Ação**                         |
| O agente chama a operação certa, mas da maneira errada                                  | Melhore a **habilidade**         |
| O agente não pode invocar a operação de forma confiável                                 | Melhore a **ação**               |
| O agente escolhe a ferramenta errada                                                    | Melhorar a **descrição da ação** |

A maioria dos recursos reais usa ambos: a habilidade explica como abordar a tarefa e
a ação fornece a operação digitada. Por exemplo, uma habilidade `invoice-review`
pode explicar a política de revisão e as regras de escalonamento, enquanto `list-invoices`,
`flag-invoice` e `approve-invoice` actions fazem as leituras e gravações reais.

## Asse em antifabricação e verifique antes de fazer {#anti-fabrication}

As instruções do aplicativo devem tornar a honestidade e a verificação o comportamento padrão:

- **Nunca invente.** Se os dados não forem encontrados ou uma ação falhar, diga isso e recupere — não invente resultados ou reivindique sucesso. Leia o valor real por meio de uma ação ou consulta antes de relatá-lo.
- **Verifique antes de declarar concluído.** Após uma alteração, confirme-a com uma releitura (consulte novamente a linha, releia a tela via `view-screen`) em vez de presumir que a gravação funcionou.
- **Recupere, não desista.** Em um erro recuperável (uma consulta com falha, uma busca transitória), tente novamente ou corrija a entrada em vez de abandonar a tarefa. Mantenha isso separado da regra antifabricação: não confunda “não invente” com “pare no primeiro erro”.

Coloque-as como regras básicas em `AGENTS.md` para que se apliquem a todos os turnos.

## As quatro superfícies que o agente vê {#four-surfaces}

Cada orientação que você cria chega a uma das quatro superfícies. Saber qual superfície usar evita duplicação e detalhes perdidos:

| Superfície                        | Quem escreve                         | Quando estiver carregado                                         | O que pertence a esse lugar                                                       |
| --------------------------------- | ------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Instruções `AGENTS.md`            | Você (desenvolvedor)                 | Cada curva, conforme orientação                                  | Objetivo, regras básicas, chaves de estado, índice de ação, índice skills         |
| Habilidades (`SKILL.md`)          | Você (desenvolvedor)                 | Sob demanda, quando o agente decide que a habilidade é relevante | Instruções passo a passo para um padrão específico, listas do que fazer/não fazer |
| Descrições de ações (ferramentas) | Você (desenvolvedor)                 | Cada turno, conforme lista de ferramentas                        | O que a ação faz, o que ela retorna, semântica dos parâmetros                     |
| Contexto `application_state`      | Seu código UI (em tempo de execução) | A cada turno, conforme o estado do aplicativo ao vivo            | Navegação atual, seleção, objeto em foco, URL                                     |

**Diagnóstico rápido:**

- "O agente continua perguntando em qual registro agir mesmo quando um está aberto" → correção: escreva o ID do item atual em `application_state` (chave `navigation`) do seu UI. Essa é uma lacuna `application_state`, não uma lacuna de habilidades.
- "O agente chama a ação errada ou utiliza indevidamente um parâmetro" → correção: melhore o `description` e `.describe()` da ação no parâmetro. Essa é uma correção na descrição da ferramenta, não uma habilidade.

## O que vai aonde {#what-goes-where}

- **AGENTS.md** — aplica-se a todo o aplicativo, em cada etapa: finalidade, regras básicas, chaves de estado, índice de ação, índice skills.
- **Habilidades** — instruções reutilizáveis para um padrão específico, carregado sob demanda. Aplica-se a todos que trabalham no aplicativo.
- **Memória (`memory/MEMORY.md`)** — preferências e correções por usuário, não orientação de autoria.

## O que vem a seguir {#whats-next}

- [Habilidades Guide](/docs/skills-guide) — o formato de arquivo de habilidade, estrutura skills e skills apoiado por aplicativo.
- [Creating Templates](/docs/creating-templates) — como `AGENTS.md` e skills se encaixam em um modelo entregável.
- [The four-area checklist](/docs/key-concepts#four-area-checklist) — o modelo de quatro áreas que cada recurso deve satisfazer.
