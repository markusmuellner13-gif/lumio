// Shared between the API route and the client. Keep free of server-only imports.
export const STORAGE = {
  conversations: "lumio.conversations.v1",
  activeId: "lumio.activeId.v1",
  model: "lumio.model.v1",
  theme: "lumio.theme.v1",
  system: "lumio.system.v1",
  web: "lumio.web.v1",
  thinking: "lumio.thinking.v1",
  effort: "lumio.effort.v1",
  codeExecution: "lumio.codeExecution.v1",
} as const;

export type Effort = "low" | "medium" | "high";
export const EFFORT_LEVELS: Effort[] = ["low", "medium", "high"];

/** Models that support Claude's adaptive thinking / effort parameters. */
export const THINKING_CAPABLE_MODELS = new Set([
  "claude-opus-4-8",
  "claude-sonnet-5",
]);
