---
title: "Vídeo"
description: "Um estúdio de vídeo programático para gráficos em movimento, demonstrações de produtos e texto cinético. Gere animações a partir de um prompt e ajuste-as em uma linha do tempo."
---

# Vídeo

Um estúdio de vídeo programático para o tipo de gráficos em movimento, demonstrações de produtos e vídeos de texto cinético que são difíceis de capturar manualmente. Peça ao agente “uma revelação do logotipo de 6 segundos que desaparece em 2 segundos” e ele cria a animação. Ajuste o tempo, a atenuação e os movimentos da câmera em uma linha do tempo e depois renderize para MP4 ou WebM.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Revelação do logo</h1><span class='wf-pill accent'>6 seconds</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Render</button></div><div class='wf-card' style='flex:1;display:flex;align-items:center;justify-content:center;min-height:250px'><div style='text-align:center'><strong>Prévia do Remotion</strong><br/><small class='wf-muted'>logo scales in as the title fades</small></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><div style='display:flex;gap:8px;align-items:center'><span class='wf-pill'>0s</span><span class='wf-pill'>2s</span><span class='wf-pill'>4s</span><span class='wf-pill'>6s</span><div style='flex:1'></div><button>Nova trilha</button></div><div class='wf-box'>Fade do título · frames 0-48</div><div class='wf-box'>Escala do logo · frames 48-120</div><div class='wf-box'>Avanço de câmera · frames 72-144</div></div></div>"
}
```

Ao abrir o estúdio, você verá uma lista de composições na tela inicial. Clique em um e você verá um player na parte superior, uma linha do tempo na parte inferior e um painel de propriedades à direita. O agente sempre sabe qual composição você tem aberta.

```an-diagram title="Animação como dados" summary="Uma composição é um componente React; cada animação lê uma trilha para que o agente e a linha do tempo editem os mesmos dados."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Timeline<br><small class=\"diagram-muted\">arrastar, redimensionar, percorrer</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">\"fade in at 2s\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">AnimationTrack</span><small class=\"diagram-muted\">startFrame / easing / animatedProps</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Composição React<br><small class=\"diagram-muted\">Remotion &lt;Player&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">MP4 / WebM</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## O que você pode fazer com isso

- **Gere animações a partir de um prompt.** "Adicione um cartão de título que aparece gradualmente em 2 segundos e dura até 5." O agente edita a composição.
- **Ajuste o tempo em uma linha do tempo.** Arraste e redimensione trilhas de animação, percorra quadros, defina curvas de atenuação visualmente.
- **Anime a câmera.** Panorâmica, zoom e inclinação com ferramentas na tela. Clique na ferramenta, arraste na visualização e um quadro-chave será criado automaticamente.
- **Comece com uma composição em branco ou um exemplo.** O modelo envia uma composição no código (`BlankComposition`) para começar; exemplos de composições — texto cinético, revelação de logotipo, explosões de partículas, demonstrações interativas do UI, apresentações de slides — são carregados do banco de dados e você pode adicionar os seus próprios.
- **Edite visualmente as curvas de atenuação.** Mais de 30 curvas fornecidas — potência, costas, salto, circ, elástico, expo, senoidal, além de física de mola.
- **Renderize para MP4 ou WebM** com superamostragem de 1x, 2x ou 3x para texto e vetores nítidos durante o zoom da câmera.

Esta é mais uma ferramenta voltada para o desenvolvedor do que outros modelos - as composições são componentes React, então usuários avançados (ou o agente) podem escrever novos tipos de animação do zero. Mas os ajustes diários ("tornar a digitação mais lenta", "reduzir a contagem de partículas para 12") são apenas conversa fiada.

## Primeiros passos

Demonstração ao vivo: [videos.agent-native.com](https://videos.agent-native.com).

Quando você abre o estúdio:

1. Escolha uma composição na tela inicial.
2. Experimente o agente: "adicione um logotipo revelado que apareça gradualmente em 2 segundos." Assista à atualização da linha do tempo.
3. Arraste as faixas para reprogramar, clique na ferramenta câmera, deslize o player.

### Instruções úteis

- "Adicione um cartão de título que apareça gradualmente em 2 segundos e permaneça até 5."
- "Mude a câmera para ampliar 2x o logotipo entre os quadros 60 e 90."
- "Torne a digitação mais lenta — 40% mais longa."
- "A explosão de partículas é muito densa. Reduza a contagem para 12."
- "Crie uma nova composição chamada intro-loop, 1080x1080, 6 segundos."
- "Adicione uma animação de clique na zona do botão e anime o cursor para ela."
- "Dê a esta faixa uma flexibilização elástica em vez de uma suavização."

Se você selecionar uma faixa na linha do tempo e pressionar Cmd+I, o agente seleciona essa seleção — "tornar esta mais rápida" simplesmente funciona.

## Para desenvolvedores

O restante deste documento é para qualquer pessoa que faça bifurcação do modelo de vídeo ou estenda-o. Este modelo é mais avançado em código do que os outros: cada composição é um componente React e cada animação são dados em uma trilha.

### Arquitetura

Tudo o que você vê no estúdio é código. Uma composição é um `CompositionEntry` em `app/remotion/registry.ts` que aponta para um componente React em `app/remotion/compositions/`. Cada animação nesse componente é lida em um `AnimationTrack` para que os usuários possam arrastá-la, redimensioná-la e reprogramá-la na linha do tempo UI. O agente pode criar novas composições, adicionar faixas, ajustar a easing e gravar componentes React inteiros que se conectam ao registro.

O estúdio roda no `<Player>` do Remotion para visualização e no Remotion CLI para renderização final. O padrão de saída é 1920x1080 a 30fps.

### Início rápido

Estruture um novo aplicativo de vídeo do CLI:

```bash
npx @agent-native/core@latest create my-video-app --standalone --template videos
cd my-video-app
pnpm install
pnpm dev
```

Abra o estúdio no seu navegador, crie uma composição e comece do zero. Pergunte ao agente algo como "adicione um logotipo revelado que apareça gradualmente em 2 segundos" e ele editará a composição para você.

### Principais recursos

**Composições baseadas em React.** Os vídeos são componentes React apoiados por Remotion, com composições de usuário apoiadas por SQL e um registro de código opcional para padrões locais.

**Animação que prioriza a linha do tempo.** Faixas de duração, quadros-chave, curvas de atenuação, movimentos de câmera e faixas de expressão programática editam os mesmos dados de composição.

**Sistemas de movimento ajustáveis.** Parâmetros, trilhas de cursor, zonas interativas de foco, navegação de alcance e reprodução repetida tornam as animações geradas ajustáveis sem código.

**Renderização e persistência.** As configurações de composição, qualidade, fps, valores de rastreamento e substituições persistem por composição e são renderizadas para MP4 ou WebM por meio do Remotion.

### Trabalhando com o agente

O agente sempre sabe qual composição você tem aberta. O estado de navegação (`{ view, compositionId }`) é gravado na tabela `application_state` da estrutura e a ação `view-screen` o retorna mais uma dica apontando para `app/remotion/registry.ts`. Você não precisa dizer ao agente em qual composição você está — peça para ele agir de acordo com "este" e ele o fará.

Nos bastidores, o agente chama actions como `navigate`, `save-composition` e `generate-animated-component`. Os registros de composição apoiados por SQL são criados ou atualizados por meio de `save-composition`; Os componentes Remotion apoiados por código ainda residem em `app/remotion/compositions/*.tsx` e são registrados em `app/remotion/registry.ts`.

### Modelo de dados

O esquema do lado do servidor está em `templates/videos/server/db/schema.ts`:

```an-schema title="Modelo de dados de vídeo" summary="Composições apoiadas por SQL, além de sistemas de design e pastas aninhadas, cada uma com uma tabela de compartilhamentos de estrutura."
{
  "entities": [
    {
      "id": "compositions",
      "name": "compositions",
      "note": "User-created compositions and overrides; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "type", "type": "text" },
        { "name": "data", "type": "text", "note": "Blob de composição completa JSON" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
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
      "id": "folders",
      "name": "folders",
      "note": "Nestable folders; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "name", "type": "text" }
      ]
    },
    {
      "id": "folder_memberships",
      "name": "folder_memberships",
      "note": "Junção muitos-para-muitos",
      "fields": [
        { "name": "folder_id", "type": "text", "fk": "folders.id" },
        { "name": "composition_id", "type": "text", "fk": "compositions.id" }
      ]
    }
  ],
  "relations": [
    { "from": "folders", "to": "folder_memberships", "kind": "1-n", "label": "members" },
    { "from": "compositions", "to": "folder_memberships", "kind": "1-n", "label": "in folders" }
  ]
}
```

Cada tabela também possui uma tabela de compartilhamentos de estrutura correspondente (`composition_shares`, `design_system_shares`, `folder_shares`) produzida por `createSharesTable()`.

- `compositions` — id, título, tipo, `data` (blob JSON de composição completa), colunas de propriedade, carimbos de data/hora.
- `composition_shares` — concessões de ações padrão produzidas por `createSharesTable()`.
- `design_systems` — tokens de marca reutilizáveis (cores, tipografia, espaçamento, recursos, instruções personalizadas, sinalizador `is_default`) com `ownableColumns`.
- `design_system_shares` — compartilha subsídios para sistemas de design.
- `folders` — pastas aninhadas para organização de bibliotecas, com `ownableColumns`.
- `folder_shares` — concessões de compartilhamento para pastas.
- `folder_memberships` — junção muitos-para-muitos entre um `folder_id` e um `composition_id`.

### Pastas e sistemas de design

As composições podem ser organizadas em pastas e estilizadas com sistemas de design. Actions: `create-folder`, `rename-folder`, `delete-folder`, `move-composition-to-folder`. Sistema de design actions: `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `set-default-design-system`, `apply-design-system`, `analyze-brand-assets`. Importar actions: `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF).

O registro em `app/remotion/registry.ts` é a fonte de verdade no código para o que vem com o modelo. A tabela SQL armazena composições e substituições criadas pelo usuário. O estado do Studio (edições de trilha por composição, substituições de objetos, configurações de composição) é espelhado em `localStorage` em `videos-tracks:<id>`, `videos-props:<id>` e `videos-comp-settings:<id>` e mesclado de volta aos padrões do registro durante o carregamento.

Formas principais TypeScript (`app/types.ts`):

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` — `property`, `from`, `to`, `unit`, além de `keyframes`, `programmatic`, `description`, `codeSnippet`, `parameters`, `parameterValues` opcionais.
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

As composições são privadas por padrão. A visibilidade pode ser `private`, `org` ou `public`, e as concessões de compartilhamento fornecem funções `viewer`, `editor` ou `admin`, conectadas por meio da primitiva de compartilhamento da estrutura.

### Personalizando

A pasta do modelo é `templates/videos/` (o slug voltado para o usuário é `video`, mas a pasta está no plural).

**Actions** — `templates/videos/actions/`

- `view-screen.ts` — retorna o estado de navegação atual do agente.
- `navigate.ts` — navegue até uma composição (`--compositionId <id>`) ou a visualização inicial (`--view home`).
- `save-composition.ts` — cria ou atualiza um registro de composição baseado em SQL.
- `generate-animated-component.ts` — gera um novo arquivo de componente Remotion com padrão.
- `validate-compositions.ts` — verifique todas as composições registradas em busca de problemas estruturais.
- `list-compositions.ts`, `get-composition.ts`, `update-composition.ts`, `delete-composition.ts` — leia, atualize e exclua registros de composição baseados em SQL.

**Rotas** — `templates/videos/app/routes/`

- `_index.tsx` — estúdio doméstico; renderiza o shell e a lista de composição.
- `c.$compositionId.tsx` — editor de composição (linha do tempo, player, painel de propriedades).
- `components.tsx` — navegador da biblioteca de componentes.
- `team.tsx` — gerenciamento de equipe.

**Remoção interna** — `templates/videos/app/remotion/`

- `registry.ts` — a lista de composição oficial.
- `compositions/` — um `.tsx` por composição, mais um barril `index.ts`.
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx` — agrupa o conteúdo da composição com a transformação da câmera.
- `hooks/`, `ui-components/`, `components/` — auxiliares de elementos interativos, renderização de cursor, wrappers de elementos animados.

**Estúdio UI** — `templates/videos/app/components/`

- `Timeline.tsx` — a linha do tempo totalmente controlada (`viewStart`/`viewEnd` não possui nenhum estado internamente).
- `VideoPlayer.tsx` — Wrapper `<Player>` de remoção com reprodução com intervalo limitado.
- `TrackPropertiesPanel.tsx`, `CompSettingsEditor.tsx`, `PropsEditor.tsx` — os painéis do lado direito.
- `CameraToolbar.tsx`, `CameraControls.tsx` — ferramentas de câmera e controles numéricos.

**Instruções do agente** — `templates/videos/AGENTS.md` é o guia extenso que o agente lê. Ele cobre a regra de animação como trilha, sistema de câmera, sistema de cursor, unidades de filtro CSS, registro de componentes interativos, espaçamento UI e listas de verificação para criação ou edição de composições.

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md` — como criar e registrar composições.
- `animation-tracks/SKILL.md` — como editar trilhas e objetos animados.
- Além da estrutura padrão skills: `actions`, `self-modifying-code`, `delegate-to-agent`, `storing-data`, `security`, `frontend-design`, `create-skill`, `capture-learnings`.

Para adicionar uma nova composição, siga a lista de verificação em `AGENTS.md`: crie o componente, declare `FALLBACK_TRACKS`, use `findTrack` / `trackProgress` / `getPropValue` (nunca codifique quadros), exporte de `compositions/index.ts`, adicione um `CompositionEntry` ao registro e execute `pnpm typecheck`.
