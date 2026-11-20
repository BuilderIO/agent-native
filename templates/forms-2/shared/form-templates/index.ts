import {
  blockText,
  createBlock,
  deriveQuestions,
  questionBlocks,
  type Block,
  type QuestionSpec,
} from "../form-model/index.js";

export const TEMPLATE_IDS = [
  "contact-form",
  "registration-form",
  "customer-feedback",
  "trivia-quiz",
  "web-project-intake",
  "personality-quiz",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

const title = (text: string) => createBlock("FORM_TITLE", { text });
const text = (value: string) => createBlock("TEXT", { text: value });
const heading = (value: string) => createBlock("HEADING_2", { text: value });
const page = () => createBlock("PAGE_BREAK", {});
const thankYou = (heading: string, message: string) =>
  createBlock("THANK_YOU_PAGE", { title: heading, message });
const ask = (spec: QuestionSpec) => questionBlocks(spec);

function scale(
  titleText: string,
  left: string,
  right: string,
  end = 5,
): QuestionSpec {
  return {
    type: "LINEAR_SCALE",
    title: titleText,
    isRequired: true,
    settings: {
      start: 1,
      end,
      step: 1,
      hasLeftLabel: true,
      leftLabel: left,
      hasRightLabel: true,
      rightLabel: right,
    },
  };
}

function contactForm(): Block[] {
  return [
    title("Get in touch"),
    text("Send us a note and we will reply within two working days."),
    ...ask({ type: "INPUT_TEXT", title: "Your name", isRequired: true }),
    ...ask({
      type: "INPUT_EMAIL",
      title: "Email",
      isRequired: true,
      placeholder: "you@example.com",
    }),
    ...ask({
      type: "DROPDOWN",
      title: "What is this about?",
      options: ["General question", "Support", "Partnership", "Something else"],
    }),
    ...ask({ type: "TEXTAREA", title: "Message", isRequired: true }),
    thankYou("Message sent", "Thanks for reaching out. We will be in touch."),
  ];
}

function registrationForm(): Block[] {
  const ticket = ask({
    type: "MULTIPLE_CHOICE",
    title: "Ticket type",
    isRequired: true,
    options: ["Standard", "Student", "Supporter"],
  });
  return [
    title("Workshop registration"),
    text("Reserve your seat for the full-day workshop."),
    heading("About you"),
    ...ask({ type: "INPUT_TEXT", title: "Full name", isRequired: true }),
    ...ask({ type: "INPUT_EMAIL", title: "Email address", isRequired: true }),
    ...ask({ type: "INPUT_PHONE_NUMBER", title: "Phone number" }),
    page(),
    heading("Your visit"),
    ...ticket,
    ...ask({
      type: "CHECKBOXES",
      title: "Which sessions will you join?",
      options: ["Morning keynote", "Hands-on lab", "Panel", "Evening mixer"],
    }),
    ...ask({
      type: "DROPDOWN",
      title: "Dietary needs",
      options: ["None", "Vegetarian", "Vegan", "Gluten free", "Other"],
    }),
    ...ask({ type: "INPUT_DATE", title: "Arrival date" }),
    thankYou(
      "You are registered",
      "A confirmation is on its way to your inbox.",
    ),
  ];
}

function customerFeedback(): Block[] {
  return [
    title("How did we do?"),
    text("Two minutes of honest feedback helps us improve."),
    ...ask({
      type: "RATING",
      title: "How would you rate your overall experience?",
      isRequired: true,
      settings: { stars: 5 },
    }),
    ...ask(
      scale(
        "How likely are you to recommend us to a friend?",
        "Not likely",
        "Very likely",
      ),
    ),
    ...ask({
      type: "CHECKBOXES",
      title: "What did you like most?",
      options: ["Quality", "Price", "Speed", "Support", "Design"],
    }),
    page(),
    ...ask({ type: "TEXTAREA", title: "What could we do better?" }),
    ...ask({
      type: "INPUT_EMAIL",
      title: "Email, if you would like a reply",
      placeholder: "you@example.com",
    }),
    thankYou("Thank you", "Your feedback goes straight to the team."),
  ];
}

function triviaQuiz(): Block[] {
  return [
    title("Everyday science quiz"),
    text(
      "Four questions. Answer them all and see how you did on the last page.",
    ),
    ...ask({
      type: "MULTIPLE_CHOICE",
      title: "Which planet is closest to the sun?",
      isRequired: true,
      options: ["Venus", "Mercury", "Mars", "Earth"],
    }),
    ...ask({
      type: "MULTIPLE_CHOICE",
      title: "What do bees collect from flowers to make honey?",
      isRequired: true,
      options: ["Pollen", "Nectar", "Sap", "Water"],
    }),
    page(),
    ...ask({
      type: "MULTIPLE_CHOICE",
      title: "Which gas do plants take in from the air?",
      isRequired: true,
      options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"],
    }),
    ...ask({
      type: "DROPDOWN",
      title: "How many bones does an adult human have?",
      isRequired: true,
      options: ["106", "206", "306", "406"],
    }),
    thankYou("Quiz complete", "Here are the correct answers."),
    heading("Answers"),
    text("1. Mercury"),
    text("2. Nectar"),
    text("3. Carbon dioxide"),
    text("4. 206"),
  ];
}

function webProjectIntake(): Block[] {
  return [
    title("Start a web project"),
    text("Tell us about your project and we will come back with a plan."),
    heading("You and your company"),
    ...ask({ type: "INPUT_TEXT", title: "Your name", isRequired: true }),
    ...ask({ type: "INPUT_EMAIL", title: "Work email", isRequired: true }),
    ...ask({ type: "INPUT_TEXT", title: "Company" }),
    ...ask({
      type: "INPUT_LINK",
      title: "Current website",
      placeholder: "https://",
    }),
    page(),
    heading("The project"),
    ...ask({
      type: "MULTI_SELECT",
      title: "What do you need?",
      isRequired: true,
      options: ["New website", "Redesign", "Online store", "Web app", "Upkeep"],
    }),
    ...ask({
      type: "TEXTAREA",
      title: "Describe the goals of the project",
      isRequired: true,
    }),
    ...ask({
      type: "MULTIPLE_CHOICE",
      title: "Budget range",
      options: ["Under 5k", "5k to 15k", "15k to 40k", "Over 40k"],
    }),
    ...ask({ type: "INPUT_DATE", title: "Ideal launch date" }),
    thankYou(
      "Brief received",
      "We will review it and reply within three days.",
    ),
  ];
}

function personalityQuiz(): Block[] {
  const breakMaker = page();
  const breakConnector = page();
  const breakExplorer = page();
  const settle = ask({
    type: "MULTIPLE_CHOICE",
    title: "Pick the afternoon you would enjoy most",
    isRequired: true,
    options: [
      "A quiet corner with a good book",
      "A busy market with friends",
      "A trail with a map and no plan",
    ],
  });
  const [, quiet, market, trail] = settle;
  if (!quiet || !market || !trail) throw new Error("Template options missing.");
  const jump = (optionId: string, target: Block) =>
    createBlock("CONDITIONAL_LOGIC", {
      condition: {
        type: "single",
        questionId: settle[0]?.groupUuid ?? "",
        comparison: "is",
        value: optionId,
      },
      actions: [{ type: "jump_to_page", target: target.uuid }],
    });
  const finish = () =>
    createBlock("CONDITIONAL_LOGIC", {
      condition: {
        type: "single",
        questionId: settle[0]?.groupUuid ?? "",
        comparison: "is_not_empty",
      },
      actions: [{ type: "jump_to_page", target: "end" }],
    });
  return [
    title("What kind of weekend person are you?"),
    ...ask({
      type: "MULTIPLE_CHOICE",
      title: "How do you start a free morning?",
      options: ["Slowly, with coffee", "With a plan", "Out the door"],
    }),
    ...ask({
      type: "MULTIPLE_CHOICE",
      title: "Your ideal group size is",
      options: ["Just me", "A few close friends", "The more the merrier"],
    }),
    ...settle,
    jump(market.uuid, breakConnector),
    jump(trail.uuid, breakExplorer),
    breakMaker,
    heading("You are the Thinker"),
    text("You recharge in calm spaces and love ideas that take time."),
    finish(),
    breakConnector,
    heading("You are the Connector"),
    text("Energy comes from people, and your weekends are never dull."),
    finish(),
    breakExplorer,
    heading("You are the Explorer"),
    text("You follow curiosity wherever it leads and keep the map loose."),
    thankYou("Thanks for playing", "Share the quiz with a friend."),
  ];
}

const BUILDERS: Record<TemplateId, () => Block[]> = {
  "contact-form": contactForm,
  "registration-form": registrationForm,
  "customer-feedback": customerFeedback,
  "trivia-quiz": triviaQuiz,
  "web-project-intake": webProjectIntake,
  "personality-quiz": personalityQuiz,
};

/** A fresh block list for the template; the first block is its title. Uuids differ on every call. */
export function buildTemplate(id: TemplateId): Block[] {
  return BUILDERS[id]();
}

export function templateOutline(id: TemplateId): {
  title: string;
  questions: { title: string; type: string }[];
} {
  const blocks = buildTemplate(id);
  return {
    title: blocks[0] ? blockText(blocks[0]) : "",
    questions: deriveQuestions(blocks).map((q) => ({
      title: q.title,
      type: q.type,
    })),
  };
}
