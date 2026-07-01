import { supabase } from "./supabase";

const TABLE = "lumio_memory";
const MAX_FACTS = 50;

/** Facts Lumio has been told to remember about a signed-in user. */
export async function fetchMemory(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("facts")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return [];
  return Array.isArray(data.facts) ? (data.facts as string[]) : [];
}

/** Append a new fact, de-duplicated, capped to the most recent MAX_FACTS. */
export async function addMemoryFact(userId: string, fact: string): Promise<string[]> {
  if (!supabase || !fact.trim()) return [];
  const existing = await fetchMemory(userId);
  if (existing.includes(fact)) return existing;
  const facts = [...existing, fact].slice(-MAX_FACTS);
  await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, facts, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  return facts;
}

export async function removeMemoryFact(userId: string, fact: string): Promise<string[]> {
  if (!supabase) return [];
  const existing = await fetchMemory(userId);
  const facts = existing.filter((f) => f !== fact);
  await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, facts, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  return facts;
}

export async function clearMemory(userId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from(TABLE).delete().eq("user_id", userId);
}
