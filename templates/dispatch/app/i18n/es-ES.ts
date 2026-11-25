import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["es-ES"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation:
        "Crear una aplicación en este espacio de trabajo",
      suggestionCustomizeOperation: "Personalizar",
      reviewActionSuggestionLabel: "Revisar {{label}}",
      dismissActionSuggestion: "Descartar {{label}}",
      reviewActionSuggestionTitle: "Revisar la acción sugerida",
      cancelActionSuggestion: "Cancelar",
      runActionSuggestion: "Ejecutar acción",
      suggestionNullValue: "Ninguno",
      suggestionYesValue: "Sí",
      suggestionNoValue: "No",
      suggestionActionLabel: "Acción",
      suggestionAppLabel: "App",
      openExistingApp: "Abrir aplicación",
      openInBuilder: "Abrir en Builder",
      actionSuggestionAccepted: "Sugerencia aceptada.",
      actionSuggestionContinueInCode: "Continuar en Code.",
      reviewActionSuggestionApproval: "Revisar la solicitud de aprobación",
      actionSuggestionApprovalRequired: "Esta acción requiere aprobación.",
      actionSuggestionUnconfirmed:
        "No se pudo confirmar la acción sugerida. Comprueba la aplicación antes de volver a intentarlo.",
    },
  },
};
