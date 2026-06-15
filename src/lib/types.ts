import type { ModelId } from "./models";

export type Role = "user" | "assistant";

export interface ImageData {
  mediaType: string;
  data: string; // base64 without the data-url prefix
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  images?: ImageData[];
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: ModelId;
  createdAt: number;
  updatedAt: number;
}
