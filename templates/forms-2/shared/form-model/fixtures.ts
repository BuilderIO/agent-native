import { createBlock, questionBlocks } from "./blocks.js";
import type { Block } from "./types.js";

const title = (text: string) =>
  createBlock("FORM_TITLE", { text }, { uuid: "form-title" });

const yesNo = (id: string, question: string) =>
  questionBlocks({
    id,
    type: "MULTIPLE_CHOICE",
    title: question,
    options: ["Yes", "No"],
  });

/** One required short-text question; the draft and recover fixtures share it. */
export function draftSurveyBlocks(): Block[] {
  return [
    title("Draft survey"),
    ...questionBlocks({
      id: "draft-name",
      type: "INPUT_TEXT",
      title: "Your name",
      isRequired: true,
    }),
  ];
}

export function singlePageBlocks(): Block[] {
  return [
    title("Single survey"),
    ...questionBlocks({
      id: "single-name",
      type: "INPUT_TEXT",
      title: "Your name",
      isRequired: true,
    }),
  ];
}

/**
 * Page 1 holds name, a Yes/No and a required email that shows only on Yes;
 * No jumps to page 3. Page 2 asks for feedback; page 3 is optional.
 */
export function pagesSurveyBlocks(): Block[] {
  return [
    title("Pages survey"),
    ...questionBlocks({
      id: "pages-name",
      type: "INPUT_TEXT",
      title: "Your name",
      isRequired: true,
    }),
    ...yesNo("pages-reply", "Need a reply?"),
    ...questionBlocks({
      id: "pages-email",
      type: "INPUT_EMAIL",
      title: "Email",
      isRequired: true,
    }),
    createBlock(
      "CONDITIONAL_LOGIC",
      {
        condition: {
          type: "single",
          questionId: "pages-reply",
          comparison: "is",
          value: "pages-reply:option-0",
        },
        actions: [{ type: "show_blocks", targets: ["pages-email"] }],
      },
      { uuid: "pages-logic-show" },
    ),
    createBlock(
      "CONDITIONAL_LOGIC",
      {
        condition: {
          type: "single",
          questionId: "pages-reply",
          comparison: "is",
          value: "pages-reply:option-1",
        },
        actions: [{ type: "jump_to_page", target: "pages-break-3" }],
      },
      { uuid: "pages-logic-jump" },
    ),
    createBlock("PAGE_BREAK", {}, { uuid: "pages-break-2" }),
    ...questionBlocks({
      id: "pages-feedback",
      type: "TEXTAREA",
      title: "Feedback",
      isRequired: true,
    }),
    createBlock("PAGE_BREAK", {}, { uuid: "pages-break-3" }),
    ...questionBlocks({
      id: "pages-extra",
      type: "TEXTAREA",
      title: "Extra comments",
    }),
  ];
}

export const EVENT_FEEDBACK_QUESTION_IDS = {
  rating: "feedback-rating",
  comments: "feedback-comments",
  snack: "feedback-snack",
} as const;

/** The favorite-snack question exists only before the form is republished. */
export function eventFeedbackBlocks(options: { withSnack: boolean }): Block[] {
  return [
    title("Event feedback"),
    ...questionBlocks({
      id: EVENT_FEEDBACK_QUESTION_IDS.rating,
      type: "RATING",
      title: "Overall rating",
    }),
    ...questionBlocks({
      id: EVENT_FEEDBACK_QUESTION_IDS.comments,
      type: "TEXTAREA",
      title: "Comments",
    }),
    ...(options.withSnack
      ? questionBlocks({
          id: EVENT_FEEDBACK_QUESTION_IDS.snack,
          type: "INPUT_TEXT",
          title: "Favorite snack",
        })
      : []),
  ];
}

/** A one-question published form for the plain list entries. */
export function simpleFormBlocks(name: string): Block[] {
  return [
    createBlock("FORM_TITLE", { text: name }),
    ...questionBlocks({
      type: "TEXTAREA",
      title: "What would you like to tell us?",
    }),
  ];
}
