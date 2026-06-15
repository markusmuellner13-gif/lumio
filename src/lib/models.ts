export type ModelId =
  | "claude-opus-4-8"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

export interface ModelInfo {
  id: ModelId;
  name: string;
  tagline: string;
  badge: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Lumio Balanced",
    tagline: "Fast, smart, great for everyday tasks",
    badge: "Recommended",
  },
  {
    id: "claude-opus-4-8",
    name: "Lumio Max",
    tagline: "Most capable — deep reasoning & long tasks",
    badge: "Pro",
  },
  {
    id: "claude-haiku-4-5",
    name: "Lumio Lite",
    tagline: "Quickest replies for simple questions",
    badge: "Fast",
  },
];

export const DEFAULT_MODEL: ModelId = "claude-sonnet-4-6";

export function getModel(id: string | undefined): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
