import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["zh-CN"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation: "在此工作区创建应用",
      suggestionCustomizeOperation: "自定义",
      reviewActionSuggestionLabel: "查看{{label}}",
      dismissActionSuggestion: "关闭{{label}}",
      reviewActionSuggestionTitle: "查看建议的操作",
      cancelActionSuggestion: "取消",
      runActionSuggestion: "运行操作",
      suggestionNullValue: "无",
      suggestionYesValue: "是",
      suggestionNoValue: "否",
      suggestionActionLabel: "操作",
      suggestionAppLabel: "应用",
      openExistingApp: "打开应用",
      openInBuilder: "在 Builder 中打开",
      actionSuggestionAccepted: "已接受建议。",
      actionSuggestionContinueInCode: "在 Code 中继续。",
      reviewActionSuggestionApproval: "查看审批请求",
      actionSuggestionApprovalRequired: "此操作需要审批。",
      actionSuggestionUnconfirmed: "无法确认建议的操作。请先检查应用，再重试。",
    },
  },
};
