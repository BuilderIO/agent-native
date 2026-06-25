---
title: "Apresentações"
description: "Gere apresentações a partir de um prompt, edite visualmente e apresente em tela inteira. Um substituto de código aberto para Apresentações Google, Pitch e PowerPoint."
---

# Apresentações

Gere apresentações completas a partir de um prompt, edite slides visualmente e apresente em tela inteira. Peça ao agente "uma apresentação de 10 slides para um serviço de assinatura de café" e assista-a ser transmitida slide por slide para o editor em segundos. Um substituto de código aberto para Apresentações Google, Pitch e PowerPoint.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Atualização do conselho no T3</h1><span class='wf-pill accent'>Slide de título</span><div style='flex:1'></div><button>Preview</button><button>Present</button><button class='primary'>Compartilhar</button></div><main style='display:grid;grid-template-columns:1fr 220px;gap:12px;flex:1;min-height:0'><section class='wf-card' style='display:flex;align-items:center;justify-content:center;text-align:center;padding:36px'><div><strong style='font-size:28px'>Atualização do conselho no T3</strong><br/><small>Maya Chen · diretora executiva</small><div style='height:46px'></div><span class='wf-pill'>Impulso do produto</span></div></section><section style='display:flex;flex-direction:column;gap:10px'><div class='wf-card'><strong>Esboço do slide</strong><div class='wf-box'>1 Título</div><div class='wf-box'>2 Pauta</div><div class='wf-box'>3 Métricas</div><div class='wf-box'>4 Enviado</div></div><div class='wf-card' style='flex:1'><strong>Notas do apresentador</strong><p class='wf-muted' style='margin:8px 0 0'>Abrir com progresso do lançamento e história de retenção.</p></div></section></main><div style='display:grid;grid-template-columns:repeat(5,1fr);gap:8px'><div class='wf-box'>1 Título</div><div class='wf-box'>2 Pauta</div><div class='wf-box'>3 Métricas</div><div class='wf-box'>4 Enviado</div><div class='wf-box'>5 Riscos</div></div></div>"
}
```

Quando você abre uma apresentação, a tela do slide, o esboço, as notas e a tira de filme permanecem em uma superfície do editor enquanto o agente ainda pode criar, revisar e navegar pelos slides por meio do actions.

```an-diagram title="Solicitar a apresentação" summary="Peça uma apresentação e o agente transmitirá os slides, um de cada vez, por meio das mesmas ações que você poderia chamar do CLI."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">Prompt<br><small class=\"diagram-muted\">\"10-slide pitch deck\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">escolhe layouts</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">create-deck</div><div class=\"diagram-pill\">add-slide &#215; n</div><small class=\"diagram-muted\">paralelo, em streaming</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>decks (SQL)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">O editor renderiza ao vivo</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## O que você pode fazer com isso

- **Gere apresentações a partir de um prompt.** "Gere uma apresentação de 10 slides para um serviço de assinatura de café, o público são investidores."
- **Edite slides visualmente** — clique duas vezes no texto para editar, clique em um bloco para o menu de bolha, use `/` para o menu de barra para inserir blocos.
- **Gere imagens com IA.** Imagens principais, modelos de produtos, ilustrações, de preferência delegadas ao Assets, com geração de imagens gerenciadas por Builder prontas para permitir chaves de provedor diretas e uma vez implantadas como substituto de hoje.
- **Pesquise fotos e logotipos de empresas.** "Encontre o logotipo de stripe.com e adicione-o ao slide 2."
- **Apresentação em tela cheia** com navegação pelo teclado, controles de ocultação automática e anotações do orador.
- **Comente, colabore e compartilhe.** Várias pessoas podem editar o mesmo deck em tempo real. Gere um URL público somente leitura ou compartilhe com colegas de equipe específicos.
- **Importe de PDF.** Transforme um PDF em um deck inicial — o agente o analisa e apresenta o conteúdo.
- **Importar de outros formatos.** Importe repositórios PPTX, DOCX, Google Docs, GitHub ou qualquer URL como ponto de partida. Exporte para PPTX, Apresentações Google ou HTML.
- **Aplicar sistemas de design.** Tokens de marca, instruções personalizadas e paletas padrão são salvos como sistemas de design e aplicados a novos decks.
- **Restaure versões anteriores.** Cada mudança de deck é capturada; liste ou restaure qualquer versão anterior.

## Primeiros passos

Demonstração ao vivo: [slides.agent-native.com](https://slides.agent-native.com).

Quando você abre o aplicativo:

1. Clique em **Novo deck**.
2. Pergunte ao agente: "Gere uma apresentação de 10 slides para um serviço de assinatura de café. O público-alvo são investidores."
3. Assista à transmissão dos slides. Clique em qualquer slide para editar ou continue pedindo ao agente para refinar.

### Instruções úteis

- "Gere uma apresentação de 10 slides para um serviço de assinatura de café. O público-alvo são investidores."
- "Adicione um slide de preços após o slide 3."
- "Aumente o título deste slide e mude a cor de destaque para verde."
- "Gere uma imagem principal para o slide atual — escuro, minimalista, cinematográfico."
- "Encontre o logotipo de stripe.com e adicione-o ao slide 2."
- "Substitua a palavra 'clientes' por 'membros' em todos os lugares desta apresentação."
- "Resuma este PDF como uma apresentação de 6 slides." (anexe o PDF)

Selecione o texto em um slide e pressione Cmd+I para focar o agente nessa seleção — ele agirá apenas sobre o que você selecionou.

## Para desenvolvedores

O restante deste documento é para qualquer pessoa que faça bifurcação ou extensão do modelo do Apresentações.

### Início rápido

Crie um novo aplicativo Apresentações no CLI:

```bash
npx @agent-native/core@latest create my-slides --standalone --template slides
cd my-slides
pnpm install
pnpm dev
```

### Principais recursos {#key-features}

**Geração de prompt para apresentação.** Peça uma apresentação e o agente transmite os slides para o editor usando o mesmo actions de criação e edição que você mesmo pode executar.

**Tela de slide editável.** Edição de texto in-line, inserções de barras, edição de código, ordenação de arrastar e soltar, desfazer/refazer, comentários e modo de apresentação, tudo ao vivo na superfície do deck.

**Importar e exportar.** Traga repositórios PPTX, DOCX, Google Docs, PDFs, URLs e GitHub; exporte para PPTX, Apresentações Google, HTML ou um link de compartilhamento.

**Sistemas de design e mídia.** Sistemas de marca salva, geração de imagens, pesquisa de estoque e pesquisa de logotipo mantêm os decks mais próximos da direção visual pretendida.

**Colaboração e histórico.** Edição Yjs em tempo real, comentários encadeados, compartilhamento de funções e instantâneos da versão do deck estão integrados.

### Trabalhando com o agente

O chat do agente fica na barra lateral. Ele pode criar apresentações, editar slides individuais, gerar imagens, pesquisar logotipos e navegar no UI — tudo usando o mesmo actions que você executaria no CLI.

#### O que o agente vê

Quando um baralho está aberto, o agente vê automaticamente:

- Os atuais `deckId` e `slideIndex`.
- A lista completa de slides na apresentação aberta.
- O conteúdo HTML do slide atualmente selecionado.

Isso é injetado em cada mensagem como um bloco `current-screen`, para que o agente nunca precise adivinhar o que "este slide" significa. Os dados vêm da chave de estado do aplicativo `navigation`, que o UI grava em cada navegação. Consulte `templates/slides/actions/view-screen.ts`.

#### Seleção de texto para edições específicas

Selecione o texto em um slide e pressione Cmd+I para focar o agente com essa seleção pré-carregada. O agente agirá apenas de acordo com o que você selecionou.

#### Visualizações de slides embutidas no bate-papo

O agente pode incorporar uma visualização de slide ao vivo diretamente em uma resposta de bate-papo usando a cerca de incorporação da estrutura. Ele renderiza um iframe sem cromo via `app/routes/slide.tsx` para que você possa ver o resultado sem sair da conversa.

### Modelo de dados

Todos os dados do deck ficam em SQL com Drizzle ORM. Esquema: `templates/slides/server/db/schema.ts`.

```an-schema title="Modelo de dados do Apresentações" summary="A deck owns its slides as JSON in decks.data; comments, versions, shares, and design systems hang off it."
{
  "entities": [
    {
      "id": "decks",
      "name": "decks",
      "note": "Slides live as JSON in data; carries ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true, "note": "e.g. deck-1712345-abc" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "JSON: { title, slides: [{ id, content, layout }] }" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "slide_comments",
      "name": "slide_comments",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "slide_id", "type": "text", "note": "Deslize o comentário ao vivo" },
        { "name": "thread_id", "type": "text", "note": "Rosqueamento" },
        { "name": "parent_id", "type": "text", "nullable": true },
        { "name": "content", "type": "text" },
        { "name": "quoted_text", "type": "text", "nullable": true },
        { "name": "author_email", "type": "text" },
        { "name": "author_name", "type": "text" },
        { "name": "resolved", "type": "boolean" }
      ]
    },
    {
      "id": "deck_versions",
      "name": "deck_versions",
      "note": "Instantâneos pontuais para restauração",
      "fields": [
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "Baralho completo JSON" },
        { "name": "change_label", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "deck_share_links",
      "name": "deck_share_links",
      "note": "Instantâneos de link de compartilhamento público persistentes",
      "fields": [
        { "name": "token", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "slides", "type": "text", "note": "JSON instantâneo dos slides" },
        { "name": "aspect_ratio", "type": "text", "nullable": true },
        { "name": "created_at", "type": "text" }
      ]
    }
  ],
  "relations": [
    { "from": "decks", "to": "slide_comments", "kind": "1-n", "label": "comments" },
    { "from": "decks", "to": "deck_versions", "kind": "1-n", "label": "snapshots" }
  ]
}
```

A estrutura compartilha tabelas (`deck_shares`, `design_system_shares`) mapeia principais para funções de visualizador/editor/administrador por recurso.

#### baralhos

| Coluna       | Tipo  | Notas                                                     |
| ------------ | ----- | --------------------------------------------------------- |
| `id`         | texto | Chave primária, por ex. `deck-1712345-abc`                |
| `title`      | texto | Título do deck                                            |
| `data`       | texto | Blob JSON: `{ title, slides: [{ id, content, layout }] }` |
| `created_at` | texto | Carimbo de data e hora                                    |
| `updated_at` | texto | Carimbo de data e hora                                    |

Cada deck também carrega o `ownableColumns` padrão (proprietário, visibilidade, token de compartilhamento) para que ele se encaixe no modelo de compartilhamento da estrutura.

#### slide_comments

| Coluna                        | Notas                                          |
| ----------------------------- | ---------------------------------------------- |
| `id`                          | Chave primária                                 |
| `deck_id`                     | Baralho pai                                    |
| `slide_id`                    | Deslize o comentário ao vivo                   |
| `thread_id`, `parent_id`      | Rosqueamento                                   |
| `content`, `quoted_text`      | Corpo do comentário e trecho de texto opcional |
| `author_email`, `author_name` | Autor                                          |
| `resolved`                    | Sinalizador booleano                           |

#### deck_shares

Tabela de compartilhamentos fornecida pela estrutura (criada via `createSharesTable`) que mapeia principais (usuários ou organizações) para funções (visualizador, editor, administrador) por deck.

#### deck_versions

Snapshots pontuais de um deck — `deck_id`, `title`, `data` (deck completo JSON) e um `change_label` opcional. Usado por `list-deck-versions` / `restore-deck-version`.

#### sistemas_de_design

Tokens de marca reutilizáveis — `data` (cores/tipografia/espaçamento), `assets`, `custom_instructions` e um sinalizador `is_default`. Usa `ownableColumns` para que os sistemas de design possam ser compartilhados por usuário ou por organização.

#### design_system_shares

Framework compartilha tabela para sistemas de design, mapeando princípios para funções (visualizador, editor, administrador).

#### deck_share_links

Snapshots de link de compartilhamento público persistentes codificados por `token`. Cada linha armazena um `title`, um instantâneo de matriz JSON `slides`, um `aspect_ratio` opcional e `created_at`. Persistir links de compartilhamento aqui significa que eles sobrevivem às reinicializações do servidor e funcionam em instâncias sem servidor.

#### Estrutura do slide

Cada slide dentro de `decks.data` é:

```json
{
  "id": "slide-1",
  "layout": "title",
  "content": "<div class=\"fmd-slide\" style=\"...\">...</div>"
}
```

`content` é HTML bruto - o renderizador (`app/components/deck/SlideRenderer.tsx`) fornece o fundo preto e proporção de aspecto fixa, e o HTML fornece tudo dentro. A incorporação rica também é suportada: diagramas Excalidraw via `ExcalidrawSlide.tsx` e gráficos Mermaid via `MermaidRenderer.tsx`.

### Personalizando {#customizing}

O modelo do Apresentações é totalmente bifurcável. Principais pontos a serem observados ao estendê-lo:

#### Actions — `templates/slides/actions/`

Toda operação que pode ser chamada pelo agente reside aqui como um arquivo TypeScript. Alguns que você tocará com frequência:

- `create-deck.ts` — novo deck do zero ou substituição em massa.
- `add-slide.ts` — anexa um slide; prefira isso para geração de streaming.
- `update-slide.ts` — localização/substituição cirúrgica ou troca completa de conteúdo.
- `view-screen.ts` — instantâneo do que o usuário vê.
- `generate-image.ts`, `edit-image.ts`, `image-search.ts`, `logo-lookup.ts` — ferramentas de imagem.
- `extract-pdf.ts` — ingestão de PDF.

Cada ação é montada automaticamente em `POST /_agent-native/actions/:name` e pode ser chamada de CLI como `pnpm action <name>`. Adicione um novo arquivo aqui para dar ao agente uma nova capacidade.

#### Rotas — `templates/slides/app/routes/`

- `_index.tsx` — lista de decks.
- `deck.$id.tsx` — o editor.
- `deck.$id_.present.tsx` — modo de apresentação.
- `share.$token.tsx` — página de compartilhamento pública somente leitura.
- `slide.tsx` — incorporação de slide único usada em visualizações de bate-papo.
- `settings.tsx` — configurações do modelo.
- `team.tsx` — gerenciamento organizacional e de equipe.

#### Componentes do editor — `templates/slides/app/components/editor/`

A maior parte da personalização do UI acontece aqui: `SlideEditor.tsx`, `EditorToolbar.tsx`, `EditorSidebar.tsx`, menus de bolha, menu de barra e painéis para geração de imagens, pesquisa e histórico.

#### Skills — `templates/slides/.agents/skills/`

Agente skills que explica padrões quando o agente precisa modificar o código:

- `create-deck/` — como criar uma nova apresentação com slides.
- `slide-editing/` — como editar slides individuais.
- `deck-management/` — como os decks são armazenados e acessados.
- `slide-images/` — geração de imagens e fluxo de trabalho de pesquisa.

#### AGENTS.md

`templates/slides/AGENTS.md` é o roteador curto que o agente lê em cada conversa. Ele aponta para skills em `.agents/skills/` e estabelece as regras básicas, o contrato de estado do aplicativo e o índice de habilidades. Os modelos de slide HTML exatos para cada layout estão disponíveis no `.agents/skills/create-deck/SKILL.md`. Atualize essa habilidade sempre que você adicionar ou alterar um padrão de layout de slide.

#### Rotas API

Para casos em que actions não é adequado (uploads de arquivos, streaming), o modelo expõe um pequeno conjunto de endpoints REST: `GET/POST /api/decks`, `GET/PUT/DELETE /api/decks/:id`. Consulte `templates/slides/server/routes/api/`.
