---
title: "Projeto"
description: "Um estúdio de prototipagem HTML nativo do agente: gere, refine, visualize e exporte designs Alpine/Tailwind interativos com um agente."
---

# Projeto

Design é um estúdio de prototipagem HTML nativo do agente. Em vez de uma tela de desenho em camadas, o agente gera protótipos Alpine/Tailwind HTML completos e independentes, renderiza-os em um iframe e permite refinar o resultado com prompts e ajustes de controles.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Página de lançamento do produto</h1><span class='wf-pill accent'>Desktop</span><span class='wf-pill'>Tablet</span><span class='wf-pill'>Mobile</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Export code</button></div><div class='wf-card' style='flex:1;display:grid;grid-template-rows:auto 1fr auto;gap:12px'><div style='display:flex;gap:8px'><span class='wf-pill accent'>Hero</span><span class='wf-pill'>Pricing</span><span class='wf-pill'>FAQ</span></div><div class='wf-box' style='display:flex;align-items:center;justify-content:center;min-height:230px'><strong>Protótipo HTML gerado</strong></div><div class='wf-card' style='display:flex;align-items:center;gap:10px'><span class='wf-muted'>Deixe o hero mais denso e o CTA mais claro.</span><div style='flex:1'></div><button class='primary'>Aplicar revisão</button></div></div></div>"
}
```

Quando você abre o aplicativo, o protótipo gerado é o centro da área de trabalho, com modos de visualização, revisões imediatas e controles de exportação à mão. Tudo o que o agente produz é HTML real que você pode refinar, exportar ou entregar.

```an-diagram title="Um artefato, sem tradução" summary="O agente gera Alpine/Tailwind HTML autônomo; o iframe, a fonte editável e todas as exportações leem os mesmos arquivos. Um sistema de design vinculado alimenta tokens em cada passagem."
{
  "html": "<div class=\"diagram-design\"><div class=\"diagram-col\"><div class=\"diagram-node\">Prompt<br><small class=\"diagram-muted\">describe screen / page</small></div><div class=\"diagram-pill\">Sistema de design</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">Gerar com agente</span><small class=\"diagram-muted\">arquivos HTML / JSX independentes</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>iframe preview<br><small class=\"diagram-muted\">ajuste controles · refine com Cmd+I</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">Export</span><small class=\"diagram-muted\">HTML · ZIP · PDF · entrega</small></div></div>",
  "css": ".diagram-design{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-design .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-design .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-design .diagram-arrow{font-size:20px;line-height:1}.diagram-design .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Quando escolher

- **Você deseja um conceito refinado de página de destino, direção de produto UI ou exploração de marca** que possa deixar a ferramenta como HTML real, e não uma tela de desenho em camadas.
- **Você quer um protótipo interativo funcional**, com estilos Alpine interactions e Tailwind, em vez de modelos estáticos.
- **Você deseja comparar rotas rapidamente**, gerar algumas variantes, escolher a mais forte e continuar refinando.
- **Você deseja um resultado de design de sua propriedade** — exporte HTML, ZIP ou PDF ou entregue o protótipo para uma ferramenta de codificação.

## O que você pode fazer com isso

- **Gere protótipos completos.** Descreva a tela ou página necessária e o agente criará um documento HTML funcional com estilo Tailwind e interactions Alpine.
- **Compare variantes.** Comece com várias direções, escolha a mais forte e continue refinando.
- **Ajuste visual.** Use os controles de ajuste integrados para alterações comuns ou peça ao agente atualizações de cópia, layout, cor, espaçamento e interação.
- **Aplique sistemas de design.** Salve e reutilize as preferências do sistema de design para que o trabalho gerado fique mais próximo de sua marca.
- **Importe referências.** Traga HTML existente ou material de referência como contexto para uma nova passagem de design.
- **Exporte arquivos reais.** Exporte HTML, ZIP ou PDF do protótipo gerado.

## Primeiros passos

Demonstração ao vivo: [design.agent-native.com](https://design.agent-native.com).

1. **Descreva o artefato.** Peça a tela, o fluxo, a página de destino ou o visual
   direção desejada. Inclua público, tom e quaisquer restrições de produto.
2. **Compare as direções.** Gere algumas variantes, escolha a mais forte e
   continue refinando em vez de começar de novo.
3. **Ajuste os detalhes.** Use controles de ajuste para alterações visuais comuns ou pergunte
   o agente para alterações de layout, cópia, resposta e interação.
4. **Exporte quando for útil.** Baixe HTML, ZIP ou PDF assim que o protótipo
   está pronto para ser entregue a outra ferramenta ou colega de equipe.

### Instruções úteis

- "Crie três direções de página de destino para um produto de análise técnica."
- "Torne este painel mais denso e fácil de verificar para uma equipe de operações."
- "Aplique nosso sistema de design salvo e simplifique o layout móvel."
- "Exporte este protótipo como ZIP assim que a variante final for selecionada."
- "Transforme este HTML em uma página de preços mais forte sem alterar as cores da marca."

## Para desenvolvedores

O restante deste documento é para qualquer pessoa que faça bifurcação do modelo Design ou estenda-o.

### Início rápido

```bash
npx @agent-native/core@latest create my-design --standalone --template design
cd my-design
pnpm install
pnpm dev
```

### Modelo de dados

Todos os dados residem em SQL com Drizzle ORM. Esquema: `templates/design/server/db/schema.ts`. Os designs e sistemas de design carregam o padrão `ownableColumns` e uma tabela de compartilhamentos de estrutura correspondente, para que eles se encaixem no modelo de compartilhamento por usuário/por organização.

| Tabela                                   | O que ele contém                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `designs`                                | Um projeto de design — `title`, `description`, `project_type` (`prototype`/`other`), o blob `data` JSON e um link `design_system_id` opcional |
| `design_files`                           | Arquivos individuais pertencentes a um desenho (`filename`, `content`, `file_type` com padrão `html`)                                         |
| `design_versions`                        | `snapshot`s pontuais de um design com um `label` opcional, para histórico e reversão                                                          |
| `design_systems`                         | Tokens de marca reutilizáveis — `data` (cores/tipografia/espaçamento), `assets`, `custom_instructions` e uma sinalização `is_default`         |
| `design_shares` / `design_system_shares` | O Framework compartilha tabelas mapeando principais (usuários ou organizações) para funções (visualizador, editor, administrador)             |

```an-schema title="Projetar modelo de dados" summary="Um design possui seus arquivos e instantâneos versionados e, opcionalmente, vincula um sistema de design reutilizável. Tanto os designs quanto os sistemas podem ser adquiridos, cada um com uma tabela de compartilhamentos da estrutura."
{
  "entities": [
    { "id": "designs", "name": "designs", "note": "A design project (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "title", "type": "text" },
      { "name": "description", "type": "text", "nullable": true },
      { "name": "project_type", "type": "text", "note": "prototype / other" },
      { "name": "data", "type": "json", "note": "starts as {}" },
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id", "nullable": true }
    ] },
    { "id": "files", "name": "design_files", "note": "Arquivos em um desenho", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "filename", "type": "text" },
      { "name": "content", "type": "text" },
      { "name": "file_type", "type": "text", "note": "defaults to html" }
    ] },
    { "id": "versions", "name": "design_versions", "note": "Histórico/reversão", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "snapshot", "type": "json" },
      { "name": "label", "type": "text", "nullable": true }
    ] },
    { "id": "systems", "name": "design_systems", "note": "Reusable brand tokens (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "data", "type": "json", "note": "colors / typography / spacing" },
      { "name": "assets", "type": "json", "nullable": true },
      { "name": "custom_instructions", "type": "text", "nullable": true },
      { "name": "is_default", "type": "boolean" }
    ] },
    { "id": "design_shares", "name": "design_shares", "note": "Tabela de compartilhamentos da estrutura", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] },
    { "id": "system_shares", "name": "design_system_shares", "note": "Tabela de compartilhamentos da estrutura", "fields": [
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] }
  ],
  "relations": [
    { "from": "designs", "to": "files", "kind": "1-n" },
    { "from": "designs", "to": "versions", "kind": "1-n" },
    { "from": "systems", "to": "designs", "kind": "1-n", "label": "applied to" },
    { "from": "designs", "to": "design_shares", "kind": "1-n" },
    { "from": "systems", "to": "system_shares", "kind": "1-n" }
  ]
}
```

Um projeto de design é um shell até ter conteúdo: `create-design` cria uma linha vazia (`data: "{}"`) e, em seguida, `generate-design` grava os arquivos HTML/JSX independentes reais. O artefato gerado, a fonte editável e todas as exportações vêm do mesmo HTML, portanto, não há um formato de "maquete de IA" separado para traduzir. Um sistema de design vinculado fornece tokens e `custom_instructions` que o agente honra em cada passagem de geração.

As rotas no UI estão sob `templates/design/app/routes/`: `_index.tsx` (lista), `design.$id.tsx` (editor), `present.$id.tsx` (apresentação), `design-systems.tsx` e `design-systems_.setup.tsx`, `templates.tsx`, `examples.tsx`, mais `settings.tsx` e `team.tsx`.

### Chave actions

Cada operação que pode ser chamada pelo agente é um arquivo TypeScript em `templates/design/actions/`, montado automaticamente em `POST /_agent-native/actions/:name` e executável a partir de CLI como `pnpm action <name>`. Os agrupamentos:

- **Designs** — `create-design` (shell vazio), `generate-design` (gravação de conteúdo HTML/JSX gerado), `update-design`, `get-design`, `list-designs`, `duplicate-design`, `delete-design` e `apply-tweaks` para valores de botão de ajuste ao vivo persistentes (cor de destaque, densidade, etc.).
- **Arquivos** — `create-file`, `update-file`, `list-files`, `delete-file` para os arquivos dentro de um projeto de design.
- **Sistemas de design** — `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `delete-design-system`, `set-default-design-system` e `analyze-brand-assets` para coletar dados da marca antes da análise.
- **Importar** — `import-code`, `import-figma`, `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF/XLSX) e `import-design-project` para extrair um sistema de design de um projeto existente.
- **Exportação e transferência** — `export-html`, `export-pdf`, `export-svg`, `export-zip` e `export-coding-handoff` para transformar um design em uma transferência de ferramenta de codificação.
- **Contexto e navegação** — `view-screen` (design atual, arquivo aberto, visualização, pergunta pendente ou grade de variantes), `get-design-snapshot` (estado atual para um agente externo continuar) e `navigate`.

### Trabalhando com o agente

O agente sempre sabe o que você tem em aberto. O design atual, o arquivo aberto, a visualização ativa e qualquer questão pendente ou grade de variantes são retornados por `view-screen` e injetados em cada mensagem, para que você possa dizer "tornar isso mais denso" ou "exportar esta variante" sem nomear o design.

Como um design consiste apenas em arquivos HTML/JSX independentes, o agente edita a mesma fonte que o iframe renderiza e de onde vem cada exportação — não há um formato de "maquete de IA" separado para traduzir. Um sistema de design vinculado fornece tokens e `custom_instructions` que o agente homenageia em cada passagem de geração. Selecione o texto ou uma região na visualização e pressione Cmd+I para focar o agente exatamente nessa parte.

### Personalizando

Design é um modelo completo e clonável. Algumas ideias práticas de extensão:

- "Adicione um sistema de design de comércio eletrônico reutilizável com nossos tokens e componentes de amostra."
- "Adicione uma etapa de exportação que carregue o ZIP para nosso sistema de revisão interno."
- "Deixe-me colar a página de destino HTML existente e pedir ao agente três versões mais fortes."
- "Adicione uma biblioteca de prompts salva para a página do produto, painel e resumos da tela de integração."
- "Adicionar uma predefinição de exportação PDF personalizada para análise das partes interessadas."

O agente edita rotas, componentes, actions e modelos apoiados por SQL conforme necessário. Consulte [Templates](/docs/cloneable-saas) para clonagem completa, personalização, fluxo de implantação e [Getting Started](/docs/getting-started) se este for seu primeiro modelo nativo de agente.

## O que vem a seguir

- [**Templates**](/docs/cloneable-saas) — o modelo clone e próprio
- [**Context Awareness**](/docs/context-awareness) — como o agente sabe o que o usuário está visualizando
- [**Creating Templates**](/docs/creating-templates) — padrões de construção atuais para modelos nativos de agente
