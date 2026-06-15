// Shared between the API route and the client. Keep free of server-only imports.
export const ERROR_SENTINEL = "\x1eLUMIO_ERROR\x1e";

export const STORAGE = {
  conversations: "lumio.conversations.v1",
  activeId: "lumio.activeId.v1",
  model: "lumio.model.v1",
  theme: "lumio.theme.v1",
  system: "lumio.system.v1",
} as const;
