# Lumio ✦

**Lumio** is a polished, Claude-style AI chat app — your companion for thinking,
writing, coding, and getting things done. Built with Next.js 16, React 19,
Tailwind CSS v4, and the Anthropic Claude API with streaming responses.

## Features

- 💬 **Streaming chat** — responses appear token-by-token in real time
- 🧠 **Multiple models** — Lumio Balanced (Sonnet 4.6), Lumio Max (Opus 4.8), Lumio Lite (Haiku 4.5)
- 📝 **Rich Markdown** — headings, tables, lists, and syntax-highlighted code with copy buttons
- 🗂️ **Conversation history** — saved locally in your browser; rename, delete, switch
- ⚙️ **Custom instructions** — tell Lumio how you'd like it to respond
- 🌗 **Light & dark themes** — with no flash on load
- 📱 **Fully responsive** — adapts to phone, tablet, and desktop with a collapsible sidebar
- ⏹️ **Stop & regenerate** — interrupt a reply or re-roll the last one
- 🎨 **Branded** — custom app icon, PWA manifest, and installable on mobile

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

## How it works

- **Frontend** (`src/components/chat-app.tsx`) — a client component that manages
  conversations in `localStorage`, renders messages, and streams replies via
  `fetch` + a `ReadableStream` reader.
- **Backend** (`src/app/api/chat/route.ts`) — a Node.js route handler that calls
  `client.messages.stream()` from the Anthropic SDK and pipes text deltas back to
  the browser. The API key stays server-side and is never exposed to the client.
- **Branding** (`src/app/icon.tsx`, `apple-icon.tsx`, `manifest.ts`) — icons are
  generated at build time with `next/og`.

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · `@anthropic-ai/sdk` ·
react-markdown · rehype-highlight · lucide-react

---

Built with [Claude Code](https://claude.com/claude-code).
