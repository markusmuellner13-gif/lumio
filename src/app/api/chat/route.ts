import Anthropic from "@anthropic-ai/sdk";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import { ERROR_SENTINEL } from "@/lib/constants";

// Run on the Node.js runtime (the Anthropic SDK needs it) and allow long replies.
export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_MODELS = new Set(MODELS.map((m) => m.id));

const DEFAULT_SYSTEM =
  "You are Lumio, a friendly, knowledgeable AI assistant created to help people " +
  "think, write, learn, and build. Be clear, accurate, and genuinely helpful. " +
  "Use Markdown for structure: headings, bullet points, tables, and fenced code " +
  "blocks with a language tag when sharing code. Be concise by default and expand " +
  "when the task calls for depth.";

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
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

  let body: { messages?: IncomingMessage[]; model?: string; system?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messages = (body.messages ?? [])
    .filter(
      (m): m is IncomingMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (messages.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

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
