import { supabase, TABLE } from "./supabase";
import type { ModelId } from "./models";
import type { ChatMessage, Conversation } from "./types";

interface Row {
  id: string;
  user_id?: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  share_id: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export function rowToConversation(row: Row): Conversation {
  return {
    id: row.id,
    title: row.title,
    model: row.model as ModelId,
    messages: Array.isArray(row.messages) ? row.messages : [],
    createdAt: Date.parse(row.created_at) || Date.now(),
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    shareId: row.share_id,
    isPublic: row.is_public,
  };
}

function conversationToRow(conv: Conversation, userId: string) {
  // Note: share_id is intentionally omitted so the DB default / existing value
  // is preserved across upserts.
  return {
    id: conv.id,
    user_id: userId,
    title: conv.title,
    model: conv.model,
    messages: conv.messages,
    is_public: !!conv.isPublic,
    created_at: new Date(conv.createdAt).toISOString(),
    updated_at: new Date(conv.updatedAt).toISOString(),
  };
}

export async function fetchConversations(userId: string): Promise<Conversation[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return (data as Row[]).map(rowToConversation);
}

export async function upsertConversations(
  convs: Conversation[],
  userId: string,
): Promise<Conversation[]> {
  if (!supabase || convs.length === 0) return [];
  const rows = convs.map((c) => conversationToRow(c, userId));
  const { data } = await supabase
    .from(TABLE)
    .upsert(rows, { onConflict: "id" })
    .select("*");
  return data ? (data as Row[]).map(rowToConversation) : [];
}

export async function deleteConversationCloud(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from(TABLE).delete().eq("id", id);
}

/** Toggle public sharing and return the row's share_id. */
export async function setPublic(
  id: string,
  isPublic: boolean,
): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update({ is_public: isPublic })
    .eq("id", id)
    .select("share_id")
    .single();
  if (error || !data) return null;
  return (data as { share_id: string }).share_id;
}

/** Public, read-only fetch of a shared conversation by its share id. */
export async function fetchShared(shareId: string): Promise<Conversation | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("share_id", shareId)
    .eq("is_public", true)
    .maybeSingle();
  if (error || !data) return null;
  return rowToConversation(data as Row);
}
