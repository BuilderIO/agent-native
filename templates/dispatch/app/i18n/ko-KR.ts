import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["ko-KR"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation: "이 워크스페이스에서 앱 만들기",
      suggestionCustomizeOperation: "맞춤 설정",
      reviewActionSuggestionLabel: "{{label}} 검토",
      dismissActionSuggestion: "{{label}} 닫기",
      reviewActionSuggestionTitle: "제안된 작업 검토",
      cancelActionSuggestion: "취소",
      runActionSuggestion: "작업 실행",
      suggestionNullValue: "없음",
      suggestionYesValue: "예",
      suggestionNoValue: "아니요",
      suggestionActionLabel: "작업",
      suggestionAppLabel: "앱",
      openExistingApp: "앱 열기",
      openInBuilder: "Builder에서 열기",
      actionSuggestionAccepted: "제안이 수락되었습니다.",
      actionSuggestionContinueInCode: "Code에서 계속하세요.",
      reviewActionSuggestionApproval: "승인 요청 검토",
      actionSuggestionApprovalRequired: "이 작업에는 승인이 필요합니다.",
      actionSuggestionUnconfirmed:
        "제안된 작업을 확인할 수 없습니다. 다시 시도하기 전에 앱을 확인하세요.",
    },
  },
};
