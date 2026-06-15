import Anthropic from "@anthropic-ai/sdk";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import { ERROR_SENTINEL } from "@/lib/constants";

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

// --- Best-effort in-memory rate limit (per warm serverless instance) ---
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const buckets = new Map<string, { count: number; reset: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || b.reset < now) {
    b = { count: 0, reset: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  b.count += 1;
  return b.count > MAX_PER_WINDOW;
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
  if (rateLimited(ip)) {
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

  const system =
    typeof body.system === "string" && body.system.trim().length > 0
      ? DEFAULT_SYSTEM +
        "\n\nAdditional instructions from the user:\n" +
        body.system.trim()
      : DEFAULT_SYSTEM;

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const run = client.messages.stream({
          model,
          max_tokens: 8000,
          system,
          messages,
          ...(body.webSearch
            ? {
                tools: [
                  {
                    type: "web_search_20260209",
                    name: "web_search",
                  } as unknown as Anthropic.ToolUnion,
                ],
              }
            : {}),
        });

        for await (const event of run) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error.";
        controller.enqueue(encoder.encode(ERROR_SENTINEL + message));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
