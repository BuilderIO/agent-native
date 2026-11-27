import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["pt-BR"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation: "Criar um app neste espaço de trabalho",
      suggestionCustomizeOperation: "Personalizar",
      reviewActionSuggestionLabel: "Revisar {{label}}",
      dismissActionSuggestion: "Dispensar {{label}}",
      reviewActionSuggestionTitle: "Revisar ação sugerida",
      cancelActionSuggestion: "Cancelar",
      runActionSuggestion: "Executar ação",
      suggestionNullValue: "Nenhum",
      suggestionYesValue: "Sim",
      suggestionNoValue: "Não",
      suggestionActionLabel: "Ação",
      suggestionAppLabel: "App",
      openExistingApp: "Abrir aplicativo",
      openInBuilder: "Abrir no Builder",
      actionSuggestionAccepted: "Sugestão aceita.",
      actionSuggestionContinueInCode: "Continue no Code.",
      reviewActionSuggestionApproval: "Revisar a solicitação de aprovação",
      actionSuggestionApprovalRequired: "Esta ação requer aprovação.",
      actionSuggestionUnconfirmed:
        "Não foi possível confirmar a ação sugerida. Verifique o app antes de tentar novamente.",
    },
  },
};
