const messages = {
  intelligence: {
    title: "Inteligência",
    description:
      "Escolha os momentos que o CRM deve perceber em evidências de chamadas limitadas. Rastreadores inteligentes são avaliados pelo Ask CRM, nunca diretamente nesta tela.",
    loading: "Carregando rastreadores…",
    kindKeyword: "Palavra-chave",
    kindSmart: "Inteligente",
    enable: "Ativar",
    disable: "Desativar",
    toggleTracker: "{{action}} {{name}}",
    emptyTitle: "Ainda não há rastreadores de sinais",
    emptyDescription:
      "Adicione uma palavra-chave para correspondência determinística ou um critério inteligente para o Ask CRM revisar.",
    trackerDeleted: "Rastreador excluído.",
    trackerEnabled: "Rastreador ativado.",
    trackerDisabled: "Rastreador desativado.",
    trackerUpdateFailed: "Não foi possível atualizar o rastreador.",
    trackerCreated: "Rastreador criado.",
    trackerCreationFailed: "Não foi possível criar o rastreador.",
    newTracker: "Novo rastreador",
    createTitle: "Criar rastreador de sinal",
    createDescription:
      "Acompanhe palavras-chave determinísticas ou defina um critério inteligente limitado para o Ask CRM avaliar com evidências de chamadas.",
    name: "Nome",
    trackerDescription: "Descrição",
    detector: "Detector",
    keywords: "Palavras-chave",
    keywordsPlaceholder: "preço, renovação, revisão de segurança",
    keywordsHelp: "Separe até 40 palavras-chave com vírgulas.",
    classificationCriterion: "Critério de classificação",
    criterionPlaceholder:
      "Identifique uma preocupação clara sobre o prazo de implementação.",
    creating: "Criando…",
    create: "Criar rastreador",
    deleteTrackerAria: "Excluir {{name}}",
    deleteTrackerTitle: "Excluir {{name}}?",
    deleteTrackerDescription:
      "Isso impede que futuras execuções de sinais usem este rastreador. Os sinais revisados existentes permanecem inalterados.",
    cancel: "Cancelar",
    deleteTracker: "Excluir rastreador",
    keywordsSummary: "Palavras-chave: {{keywords}}",
    noKeywordsConfigured: "Nenhuma palavra-chave configurada.",
    evaluatedThroughAsk: "Avaliado pelo Ask CRM.",
  },
  recordActions: {
    evidenceAttached: "Evidência de chamada anexada.",
    evidenceAttachFailed: "Não foi possível anexar a evidência.",
    addEvidence: "Adicionar evidência",
    attachEvidenceTitle: "Anexar evidência do Clips",
    attachEvidenceDescription:
      "Use um link durável da página do Clips. O CRM armazena somente a referência do artefato, a URL da página e um trecho limitado, nunca mídia ou transcrição.",
    artifactId: "ID do artefato",
    clipsUrl: "URL do Clips",
    summary: "Resumo",
    shortExcerpt: "Trecho curto",
    attachEvidence: "Anexar evidência",
    automate: "Automatizar",
    reviewNewClipsCalls: "Revisar novas chamadas do Clips",
    reviewDescription:
      "Prepare uma receita de revisão para este registro de CRM sem copiar mídia ou transcrições do Clips.",
    disabledAutomationDescription:
      "Isso começa desativado e permanece vinculado a {{name}}. Depois de ativado explicitamente, cada novo clipe pode anexar somente sua referência de página de gravação com acesso verificado a este registro.",
    handoffDescription:
      "A transferência mantém somente um ID de clipe opaco, uma URL de página {{path}} durável e o horário de captura. Ela rejeita URLs de eventos, mídia, tokens de acesso, transcrições, registros inferidos e gravações em provedores.",
    manageAutomations: "Gerenciar automações",
    configureWithAgent: "Configurar com agente",
  },
  dashboard: {
    metaTitle: "Funil · CRM",
    pipeline: "Funil",
    ready: "O painel de pipeline está pronto.",
    installFailed: "Não foi possível instalar o painel de pipeline.",
    loadingDescription:
      "Carregando seu painel de pipeline com escopo de acesso…",
    emptyDescription:
      "Uma visualização ao vivo, com reconhecimento de permissões, do valor das oportunidades por etapa.",
    installTitle: "Instalar o painel de pipeline",
    installDescription:
      "Cria um programa de dados do CRM e um painel privado para o espaço de trabalho atual.",
    installAction: "Instalar painel de pipeline",
    liveDescription:
      "Os totais de oportunidades ao vivo usam o acesso CRM do visualizador atual e são atualizados por um programa de dados em cache.",
    updating: "Atualizando…",
    updatePack: "Atualizar pacote",
  },
};

export default messages;
