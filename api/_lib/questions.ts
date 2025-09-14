export type LikertOption = 1 | 2 | 3 | 4 | 5;

export type TestQuestion = {
  id: string;
  text: string;
  type: "likert";
  scaleLabels: { left: string; right: string };
};

export type TestDefinition = {
  id: string;
  title: string;
  description: string;
  questions: TestQuestion[];
};

const communicationV1: TestDefinition = {
  id: "communication-v1",
  title: "Communication Style Self-Assessment",
  description:
    "Rate how strongly you identify with each statement (1=Strongly disagree, 5=Strongly agree).",
  questions: [
    {
      id: "q1",
      text: "I say what I think even if it may cause disagreement.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q2",
      text: "I prioritize preserving relationships over being right.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q3",
      text: "I organize my thoughts before speaking and prefer structure.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q4",
      text: "I adapt my message based on the other person's reactions.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q5",
      text: "I am comfortable being brief and direct.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q6",
      text: "I often check in on how others are feeling during conversations.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q7",
      text: "I value accuracy and clarity over speed when communicating.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q8",
      text: "I tend to mirror the tone and pace of the other person.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q9",
      text: "I am comfortable giving constructive feedback directly.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
    {
      id: "q10",
      text: "I ask clarifying questions to ensure shared understanding.",
      type: "likert",
      scaleLabels: { left: "Disagree", right: "Agree" },
    },
  ],
};

const testIndex: Record<string, TestDefinition> = {
  [communicationV1.id]: communicationV1,
};

export function getTestDefinition(testId: string): TestDefinition | null {
  return testIndex[testId] || null;
}

export function getDefaultTest(): TestDefinition {
  return communicationV1;
}

