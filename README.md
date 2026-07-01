# Lumio ✦

🔗 **Live demo:** https://lumio-one-sepia.vercel.app

**Lumio** is a polished, Claude-style AI chat app — your companion for thinking,
writing, coding, and getting things done. Built with Next.js 16, React 19,
Tailwind CSS v4, and the Anthropic Claude API with streaming responses.

## Features

- 💬 **Streaming chat** — responses appear token-by-token in real time
- 🧠 **Multiple models** — Lumio Balanced (Sonnet 5), Lumio Max (Opus 4.8), Lumio Lite (Haiku 4.5)
- 🤔 **Extended thinking** — toggle adaptive reasoning with a Low/Medium/High effort control (Sonnet/Opus only)
- 🧰 **Code execution** — a sandboxed Python tool for data analysis, math, and file generation
- 🔎 **Web search** — grounds answers in current information, with cited sources
- 🧵 **Persistent memory** — signed-in users get facts Lumio remembers across conversations, viewable/removable in settings
- 📝 **Rich Markdown** — headings, tables, lists, and syntax-highlighted code with copy buttons
- 🗂️ **Conversation history** — saved locally in your browser, or synced to your account
- ⚙️ **Custom instructions** — tell Lumio how you'd like it to respond
- 🌗 **Light & dark themes** — with no flash on load
- 📱 **Fully responsive** — adapts to phone, tablet, and desktop with a collapsible sidebar
- ⏹️ **Stop & regenerate** — interrupt a reply or re-roll the last one
- 🎨 **Branded** — custom app icon, PWA manifest, and installable on mobile

Web search, code execution, and the memory tool are mutually distinct per turn:
enabling Search or Code selects one server-side tool for that request; memory
uses a separate model-invoked `remember` tool that only appears once you're
signed in with cloud sync enabled.

## Getting started (local)

```bash
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

You need an Anthropic API key from <https://console.anthropic.com/>. Without it,
the UI loads but chatting returns a friendly "missing API key" message.

## Deploying

This app is built for [Vercel](https://vercel.com). Push to the connected
GitHub repository and Vercel auto-deploys. Set `ANTHROPIC_API_KEY` as a Project
Environment Variable in the Vercel dashboard (Production, Preview, Development).

### Optional: accounts, cloud sync, memory, and shared rate limiting

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable
accounts, cross-device conversation sync, shareable links, persistent memory,
and a rate limiter shared across serverless instances. Run
[`supabase/schema.sql`](./supabase/schema.sql) once in your Supabase project's
SQL editor to create the required tables (`lumio_conversations`,
`lumio_memory`, `lumio_rate_limits`) with row-level security. Without these
env vars, Lumio runs entirely in local-only mode — the equivalent features are
simply unavailable, not broken.

## How it works

- **Frontend** (`src/components/chat-app.tsx`) — a client component that manages
  conversations in `localStorage` (or Supabase, when signed in), renders
  messages, and streams replies via `fetch` + a `ReadableStream` reader,
  parsing newline-delimited JSON events (text / thinking / tool_result / memory / error).
- **Backend** (`src/app/api/chat/route.ts`) — a Node.js route handler that runs
  a manual Claude tool-use loop via `client.messages.stream()`: it wires up
  adaptive thinking, web search, code execution, and a custom `remember` tool,
  and streams each event back to the browser as it arrives. The API key stays
  server-side and is never exposed to the client.
- **Memory** (`src/lib/memory.ts`) — reads/writes the `lumio_memory` table
  directly from the browser under the signed-in user's Supabase session (RLS
  scoped to `auth.uid()`); the API route only receives the resulting fact list
  as plain text to inject into the system prompt.
- **Branding** (`src/app/icon.tsx`, `apple-icon.tsx`, `manifest.ts`) — icons are
  generated at build time with `next/og`.

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · `@anthropic-ai/sdk` ·
react-markdown · rehype-highlight · lucide-react

---

Built with [Claude Code](https://claude.com/claude-code).
