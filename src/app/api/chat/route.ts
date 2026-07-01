import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import { EFFORT_LEVELS, THINKING_CAPABLE_MODELS, type Effort } from "@/lib/constants";

// Run on the Node.js runtime (the Anthropic SDK needs it) and allow long replies.
export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_MODELS = new Set(MODELS.map((m) => m.id));
const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const DEFAULT_SYSTEM =
  "You are Lumio, a friendly, knowledgeable AI assistant created to help people " +
  "think, write, learn, and build. Be clear, accurate, and genuinely helpful. " +
  "Use Markdown for structure: headings, bullet points, tables, and fenced code " +
  "blocks with a language tag when sharing code. Be concise by default and expand " +
  "when the task calls for depth. When you use web search results, cite the sources.";

const REMEMBER_INSTRUCTIONS =
  "\n\nYou have a `remember` tool backed by durable, cross-conversation memory. " +
  "Use it only for facts worth recalling in future conversations (stated " +
  "preferences, ongoing projects, how the user likes answers formatted) — not for " +
  "one-off details relevant only to this message.";

const REMEMBER_TOOL = {
  name: "remember",
  description:
    "Save a short, durable fact about the user so future conversations can use it. " +
    "Only call this for information worth remembering long-term.",
  input_schema: {
    type: "object",
    properties: {
      fact: {
        type: "string",
        description: "A single concise fact, written in third person (e.g. \"Prefers TypeScript over JavaScript.\").",
      },
    },
    required: ["fact"],
  },
} as unknown as Anthropic.Tool;

const MAX_TOOL_ITERATIONS = 4;

// --- Rate limiting ---------------------------------------------------------
// Shared across serverless instances via Supabase when configured; otherwise
// falls back to a best-effort per-instance in-memory bucket (resets on
// redeploy / cold start, not shared — better than nothing, not a real limit).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const buckets = new Map<string, { count: number; reset: number }>();

const rlUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const rlKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const rlClient = rlUrl && rlKey ? createClient(rlUrl, rlKey) : null;
const RATE_LIMIT_TABLE = "lumio_rate_limits";

function hashKey(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function inMemoryRateLimited(key: string): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    b = { count: 0, reset: now + WINDOW_MS };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count > MAX_PER_WINDOW;
}

async function isRateLimited(ip: string): Promise<boolean> {
  const key = hashKey(ip);
  if (!rlClient) return inMemoryRateLimited(key);
  try {
    const now = Date.now();
    const { data } = await rlClient
      .from(RATE_LIMIT_TABLE)
      .select("count, reset_at")
      .eq("key", key)
      .maybeSingle();
    if (!data || Date.parse(data.reset_at) < now) {
      await rlClient
        .from(RATE_LIMIT_TABLE)
        .upsert({ key, count: 1, reset_at: new Date(now + WINDOW_MS).toISOString() });
      return false;
    }
    const next = (data.count as number) + 1;
    await rlClient.from(RATE_LIMIT_TABLE).update({ count: next }).eq("key", key);
    return next > MAX_PER_WINDOW;
  } catch (err) {
    console.error("lumio: rate limit check failed, falling back to in-memory", err);
    return inMemoryRateLimited(key);
  }
}

interface IncomingImage {
  mediaType: string;
  data: string;
}
interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  images?: IncomingImage[];
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "The server is missing its ANTHROPIC_API_KEY. Add it in your hosting environment to start chatting.",
      },
      { status: 503 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (await isRateLimited(ip)) {
    return Response.json(
      { error: "You're sending messages too quickly. Please wait a moment." },
      { status: 429 },
    );
  }

  let body: {
    messages?: IncomingMessage[];
    model?: string;
    system?: string;
    webSearch?: boolean;
    codeExecution?: boolean;
    thinking?: boolean;
    effort?: string;
    memory?: string[];
    rememberEnabled?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const raw = (body.messages ?? []).filter(
    (m): m is IncomingMessage =>
      !!m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      (m.content.trim().length > 0 ||
        (m.role === "user" &&
          Array.isArray(m.images) &&
          m.images.length > 0)),
  );

  if (raw.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

  const messages: Anthropic.MessageParam[] = raw.map((m) => {
    const images = (m.images ?? []).filter(
      (img) =>
        img &&
        ALLOWED_MEDIA.has(img.mediaType) &&
        typeof img.data === "string" &&
        img.data.length > 0,
    );
    if (m.role === "user" && images.length > 0) {
      const blocks: Anthropic.ContentBlockParam[] = [
        ...images.map(
          (img): Anthropic.ImageBlockParam => ({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
              data: img.data,
            },
          }),
        ),
      ];
      if (m.content.trim()) blocks.push({ type: "text", text: m.content });
      return { role: "user", content: blocks };
    }
    return { role: m.role, content: m.content };
  });

  const model = VALID_MODELS.has(body.model as never)
    ? (body.model as string)
    : DEFAULT_MODEL;

  const rememberEnabled = body.rememberEnabled === true;
  const memoryFacts = Array.isArray(body.memory)
    ? body.memory.filter((f) => typeof f === "string" && f.trim()).slice(0, 50)
    : [];

  let system =
    typeof body.system === "string" && body.system.trim().length > 0
      ? DEFAULT_SYSTEM +
        "\n\nAdditional instructions from the user:\n" +
        body.system.trim()
      : DEFAULT_SYSTEM;
  if (memoryFacts.length) {
    system += "\n\nThings you remember about this user:\n" + memoryFacts.map((f) => `- ${f}`).join("\n");
  }
  if (rememberEnabled) system += REMEMBER_INSTRUCTIONS;

  const tools: Anthropic.ToolUnion[] = [];
  if (body.webSearch) {
    tools.push({ type: "web_search_20260209", name: "web_search" } as unknown as Anthropic.ToolUnion);
  } else if (body.codeExecution) {
    tools.push({ type: "code_execution_20260521", name: "code_execution" } as unknown as Anthropic.ToolUnion);
  }
  if (rememberEnabled) tools.push(REMEMBER_TOOL);

  const wantsThinking = body.thinking === true && THINKING_CAPABLE_MODELS.has(model);
  const effort: Effort = EFFORT_LEVELS.includes(body.effort as Effort)
    ? (body.effort as Effort)
    : "high";

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        let loopMessages = messages;

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const run = client.messages.stream({
            model,
            max_tokens: wantsThinking ? 16000 : 8000,
            system,
            messages: loopMessages,
            ...(tools.length ? { tools } : {}),
            ...(wantsThinking
              ? {
                  thinking: { type: "adaptive", display: "summarized" },
                  output_config: { effort },
                }
              : {}),
          } as Anthropic.MessageStreamParams);

          for await (const event of run) {
            if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                send({ type: "text", text: event.delta.text });
              } else if (event.delta.type === "thinking_delta") {
                send({ type: "thinking", text: event.delta.thinking });
              }
            }
          }

          const message = await run.finalMessage();

          // Server-side tool results (e.g. code execution) resolve automatically
          // within the stream — surface them to the client for display.
          for (const block of message.content as unknown as Array<Record<string, unknown>>) {
            if (block.type === "bash_code_execution_tool_result") {
              const result = block.content as Record<string, unknown> | undefined;
              if (result && result.type === "bash_code_execution_result") {
                send({
                  type: "tool_result",
                  tool: "code_execution",
                  stdout: result.stdout,
                  stderr: result.stderr,
                  returnCode: result.return_code,
                });
              }
            }
          }

          loopMessages = [...loopMessages, { role: "assistant", content: message.content }];

          if (message.stop_reason === "pause_turn") continue; // server-side tool loop limit — resume automatically

          if (message.stop_reason !== "tool_use") break;

          const rememberCalls = message.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "remember",
          );
          if (rememberCalls.length === 0) break;

          const toolResults: Anthropic.ToolResultBlockParam[] = rememberCalls.map((call) => {
            const fact =
              typeof (call.input as { fact?: unknown })?.fact === "string"
                ? (call.input as { fact: string }).fact.trim()
                : "";
            if (fact) send({ type: "memory", fact });
            return {
              type: "tool_result",
              tool_use_id: call.id,
              content: fact ? "Saved." : "No fact provided.",
            };
          });
          loopMessages = [...loopMessages, { role: "user", content: toolResults }];
        }

        controller.close();
      } catch (err) {
        console.error("lumio: chat stream failed", {
          model,
          message: err instanceof Error ? err.message : String(err),
        });
        const message = err instanceof Error ? err.message : "Unexpected error.";
        send({ type: "error", message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
