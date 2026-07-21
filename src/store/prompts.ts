/**
 * Prompts store — built-in, custom, and community prompt templates.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PromptTemplate } from "@/types";
import { uid } from "@/lib/utils";

const BUILTIN_PROMPTS: PromptTemplate[] = [
  {
    id: "prompt_summarize",
    title: "Summarize document",
    body: "Summarize the following document in 5 concise bullet points, then provide a one-paragraph executive summary.\n\nDocument:\n{{document}}",
    category: "Writing",
    description: "Distill a long document into bullet points + executive summary.",
    variables: [{ name: "document", label: "Document text", placeholder: "Paste the document here", required: true }],
    origin: "builtin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    uses: 0,
  },
  {
    id: "prompt_code_review",
    title: "Code review",
    body: "Review the following code for correctness, performance, and readability. Flag any bugs, suggest improvements, and provide a refactored version.\n\n```{{language}}\n{{code}}\n```",
    category: "Engineering",
    description: "Thorough code review with refactored output.",
    variables: [
      { name: "language", label: "Language", defaultValue: "ts", placeholder: "ts, py, rs, go..." },
      { name: "code", label: "Code", placeholder: "Paste code", required: true },
    ],
    origin: "builtin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    uses: 0,
  },
  {
    id: "prompt_explain",
    title: "Explain like I'm new",
    body: "Explain {{topic}} as if I'm new to it. Use a concrete analogy, then layer in the precise technical details. End with a 3-step learning path.",
    category: "Learning",
    description: "Layered explanation — analogy first, then technical depth.",
    variables: [{ name: "topic", label: "Topic", placeholder: "e.g. tensor parallelism", required: true }],
    origin: "builtin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    uses: 0,
  },
  {
    id: "prompt_email",
    title: "Polished email",
    body: "Write a professional, warm email about {{topic}} to {{recipient}}. Keep it under 150 words. Sign off as {{sender}}.",
    category: "Writing",
    description: "Crisp professional email draft.",
    variables: [
      { name: "topic", label: "Topic", required: true },
      { name: "recipient", label: "Recipient", placeholder: "e.g. the design team" },
      { name: "sender", label: "Your name", placeholder: "e.g. Danyal" },
    ],
    origin: "builtin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    uses: 0,
  },
  {
    id: "prompt_sql",
    title: "SQL from question",
    body: "Given the schema below, write a SQL query that answers the user's question. Return only the query in a ```sql block, then briefly explain it.\n\nSchema:\n{{schema}}\n\nQuestion: {{question}}",
    category: "Data",
    description: "Generate SQL from a natural-language question and a schema.",
    variables: [
      { name: "schema", label: "Schema (DDL)", placeholder: "CREATE TABLE ...", required: true },
      { name: "question", label: "Question", required: true },
    ],
    origin: "builtin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    uses: 0,
  },
  {
    id: "prompt_brainstorm",
    title: "Brainstorm variants",
    body: "Brainstorm 10 distinct, non-obvious variations of {{idea}}. Group them into 3 strategic buckets. For each, note the strongest risk and the strongest upside.",
    category: "Strategy",
    description: "Divergent thinking with risk/upside framing.",
    variables: [{ name: "idea", label: "Idea", required: true }],
    origin: "builtin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    uses: 0,
  },
];

interface PromptsState {
  prompts: PromptTemplate[];
  add: (input: Omit<PromptTemplate, "id" | "createdAt" | "updatedAt">) => string;
  update: (id: string, patch: Partial<PromptTemplate>) => void;
  remove: (id: string) => void;
  toggleFavorite: (id: string) => void;
  incrementUse: (id: string) => void;
}

export const usePromptsStore = create<PromptsState>()(
  persist(
    (set) => ({
      prompts: BUILTIN_PROMPTS,

      add: (input) => {
        const id = uid("prmpt");
        const now = new Date().toISOString();
        const prompt: PromptTemplate = { id, createdAt: now, updatedAt: now, ...input };
        set((s) => ({ prompts: [prompt, ...s.prompts] }));
        return id;
      },

      update: (id, patch) =>
        set((s) => ({
          prompts: s.prompts.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
          ),
        })),

      remove: (id) => set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),

      toggleFavorite: (id) =>
        set((s) => ({
          prompts: s.prompts.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)),
        })),

      incrementUse: (id) =>
        set((s) => ({
          prompts: s.prompts.map((p) => (p.id === id ? { ...p, uses: (p.uses ?? 0) + 1 } : p)),
        })),
    }),
    {
      name: "xirea:prompts",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const PROMPT_CATEGORIES = ["Writing", "Engineering", "Learning", "Data", "Strategy", "Creative", "Personal"];
