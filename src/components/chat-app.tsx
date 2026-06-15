"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Copy,
  Menu,
  MessageSquarePlus,
  Moon,
  Pencil,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { Markdown } from "./markdown";
import { LumioMark } from "./logo";
import {
  DEFAULT_MODEL,
  MODELS,
  getModel,
  type ModelId,
} from "@/lib/models";
import { ERROR_SENTINEL, STORAGE } from "@/lib/constants";
import type { ChatMessage, Conversation } from "@/lib/types";

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    Date.now().toString(36) + Math.random().toString(36).slice(2));

const SUGGESTIONS = [
  {
    title: "Explain a concept",
    prompt: "Explain how large language models work, in simple terms.",
  },
  {
    title: "Write some code",
    prompt:
      "Write a Python function that returns the nth Fibonacci number, with comments.",
  },
  {
    title: "Draft an email",
    prompt:
      "Draft a friendly email asking my team to submit their weekly updates by Friday.",
  },
  {
    title: "Plan something",
    prompt: "Give me a 3-day itinerary for a first trip to Tokyo.",
  },
];

function deriveTitle(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? t.slice(0, 48) + "…" : t || "New chat";
}

export default function ChatApp() {
  const [hydrated, setHydrated] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  /* ---------- load persisted state ---------- */
  useEffect(() => {
    try {
      const convs = localStorage.getItem(STORAGE.conversations);
      if (convs) setConversations(JSON.parse(convs));
      const aid = localStorage.getItem(STORAGE.activeId);
      if (aid) setActiveId(JSON.parse(aid));
      const m = localStorage.getItem(STORAGE.model);
      if (m) setModel(JSON.parse(m));
      const sys = localStorage.getItem(STORAGE.system);
      if (sys) setSystemPrompt(JSON.parse(sys));
      const t = (localStorage.getItem(STORAGE.theme) as "light" | "dark") || "dark";
      setTheme(t === "light" ? "light" : "dark");
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  /* ---------- persist ---------- */
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE.conversations, JSON.stringify(conversations));
  }, [conversations, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE.activeId, JSON.stringify(activeId));
  }, [activeId, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE.model, JSON.stringify(model));
  }, [model, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE.system, JSON.stringify(systemPrompt));
  }, [systemPrompt, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE.theme, theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme, hydrated]);

  /* ---------- auto-scroll ---------- */
  const scrollSig = active
    ? active.messages.length + ":" + (active.messages.at(-1)?.content.length ?? 0)
    : "";
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [scrollSig, activeId]);

  /* ---------- textarea auto-grow ---------- */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  const updateMessage = useCallback(
    (convId: string, msgId: string, patch: (m: ChatMessage) => Partial<ChatMessage>) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === msgId ? { ...m, ...patch(m) } : m,
                ),
              }
            : c,
        ),
      );
    },
    [],
  );

  const streamResponse = useCallback(
    async (
      convId: string,
      assistantId: string,
      apiMessages: { role: "user" | "assistant"; content: string }[],
      useModel: ModelId,
    ) => {
      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            model: useModel,
            system: systemPrompt,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let msg = "Something went wrong. Please try again.";
          try {
            const data = await res.json();
            if (data?.error) msg = data.error;
          } catch {
            /* non-JSON */
          }
          updateMessage(convId, assistantId, () => ({
            content: msg,
            error: true,
          }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          const errIdx = acc.indexOf(ERROR_SENTINEL);
          if (errIdx !== -1) {
            const before = acc.slice(0, errIdx).trimEnd();
            const errMsg = acc.slice(errIdx + ERROR_SENTINEL.length);
            updateMessage(convId, assistantId, () => ({
              content:
                (before ? before + "\n\n" : "") +
                "⚠️ " +
                (errMsg || "The model could not complete this response."),
              error: true,
            }));
            return;
          }
          updateMessage(convId, assistantId, () => ({ content: acc }));
        }
      } catch (err) {
        if (controller.signal.aborted) {
          updateMessage(convId, assistantId, (m) => ({
            content: m.content || "_Stopped._",
          }));
        } else {
          updateMessage(convId, assistantId, (m) => ({
            content:
              (m.content ? m.content + "\n\n" : "") +
              "⚠️ Connection interrupted. Please try again.",
            error: true,
          }));
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [systemPrompt, updateMessage],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || isStreaming) return;

      const conv = conversations.find((c) => c.id === activeId) ?? null;
      const userMsg: ChatMessage = { id: uid(), role: "user", content: text };
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
      };
      const priorMessages = conv ? conv.messages : [];
      const useModel = conv ? conv.model : model;
      const convId = conv ? conv.id : uid();
      const newMessages = [...priorMessages, userMsg, assistantMsg];

      if (conv) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? { ...c, messages: newMessages, updatedAt: Date.now() }
              : c,
          ),
        );
      } else {
        const newConv: Conversation = {
          id: convId,
          title: deriveTitle(text),
          messages: newMessages,
          model: useModel,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setConversations((prev) => [newConv, ...prev]);
        setActiveId(convId);
      }
      setInput("");

      const apiMessages = [...priorMessages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      void streamResponse(convId, assistantMsg.id, apiMessages, useModel);
    },
    [activeId, conversations, isStreaming, model, streamResponse],
  );

  const regenerate = useCallback(() => {
    if (!active || isStreaming) return;
    const msgs = active.messages;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i].role !== "assistant") i--;
    if (i < 0) return;
    const priorMessages = msgs.slice(0, i);
    const assistantMsg: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: "",
    };
    const newMessages = [...priorMessages, assistantMsg];
    setConversations((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? { ...c, messages: newMessages, updatedAt: Date.now() }
          : c,
      ),
    );
    const apiMessages = priorMessages
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    void streamResponse(active.id, assistantMsg.id, apiMessages, active.model);
  }, [active, isStreaming, streamResponse]);

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    if (isStreaming) return;
    setActiveId(null);
    setSidebarOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const selectConversation = (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const renameConversation = (id: string) => {
    const current = conversations.find((c) => c.id === id);
    const next = window.prompt("Rename chat", current?.title ?? "");
    if (next == null) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, title: next.trim() || c.title } : c,
      ),
    );
  };

  const changeModel = (id: ModelId) => {
    setModel(id);
    setModelMenuOpen(false);
    if (active)
      setConversations((prev) =>
        prev.map((c) => (c.id === active.id ? { ...c, model: id } : c)),
      );
  };

  const activeModelId: ModelId = active ? active.model : model;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform duration-200 md:static md:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <LumioMark size={30} />
            <span className="text-lg font-semibold tracking-tight">Lumio</span>
          </div>
          <button
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-200/60 md:hidden dark:hover:bg-zinc-800"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-3">
          <button
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium shadow-sm transition hover:border-violet-300 hover:shadow dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-violet-500/50"
          >
            <MessageSquarePlus size={17} className="text-violet-500" />
            New chat
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {conversations.length === 0 && (
            <p className="px-2 py-4 text-xs text-zinc-400">
              Your conversations will appear here.
            </p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-lg px-2 ${
                c.id === activeId
                  ? "bg-violet-100/70 dark:bg-violet-500/15"
                  : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
              }`}
            >
              <button
                onClick={() => selectConversation(c.id)}
                className="flex-1 truncate py-2 text-left text-sm"
                title={c.title}
              >
                {c.title}
              </button>
              <button
                onClick={() => renameConversation(c.id)}
                className="rounded p-1 text-zinc-400 opacity-0 transition hover:text-zinc-700 group-hover:opacity-100 dark:hover:text-zinc-200"
                aria-label="Rename chat"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => deleteConversation(c.id)}
                className="rounded p-1 text-zinc-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                aria-label="Delete chat"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Settings2 size={16} />
            Custom instructions
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>

          {/* Model selector */}
          <div className="relative">
            <button
              onClick={() => setModelMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Sparkles size={15} className="text-violet-500" />
              {getModel(activeModelId).name}
              <span className="text-zinc-400">▾</span>
            </button>
            {modelMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setModelMenuOpen(false)}
                />
                <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => changeModel(m.id)}
                      className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-700/60 ${
                        m.id === activeModelId
                          ? "bg-zinc-100 dark:bg-zinc-700/60"
                          : ""
                      }`}
                    >
                      <Sparkles
                        size={15}
                        className="mt-0.5 shrink-0 text-violet-500"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {m.name}
                          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                            {m.badge}
                          </span>
                        </span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {m.tagline}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!active || active.messages.length === 0 ? (
            <EmptyState onPick={(p) => send(p)} />
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
              {active.messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  streaming={
                    isStreaming &&
                    m.role === "assistant" &&
                    m.id === active.messages.at(-1)?.id
                  }
                />
              ))}
              {!isStreaming &&
                active.messages.at(-1)?.role === "assistant" &&
                !active.messages.at(-1)?.error && (
                  <div className="mt-1 flex justify-start pl-1">
                    <button
                      onClick={regenerate}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <RotateCcw size={13} />
                      Regenerate
                    </button>
                  </div>
                )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <div className="mx-auto w-full max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white p-2 shadow-sm transition focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-violet-500/60 dark:focus-within:ring-violet-500/20">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Message Lumio…"
                className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[0.95rem] outline-none placeholder:text-zinc-400"
              />
              {isStreaming ? (
                <button
                  onClick={stop}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-white transition hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
                  aria-label="Stop generating"
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  className="lumio-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Send message"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-zinc-400">
              Lumio can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          value={systemPrompt}
          onClose={() => setSettingsOpen(false)}
          onSave={(v) => {
            setSystemPrompt(v);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-10 text-center">
      <LumioMark size={64} />
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">
        Meet <span className="lumio-gradient-text">Lumio</span>
      </h1>
      <p className="mt-2 max-w-md text-zinc-500 dark:text-zinc-400">
        Your AI companion for thinking, writing, coding, and getting things
        done. What can I help you with today?
      </p>
      <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className="rounded-xl border border-zinc-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-500/50"
          >
            <div className="text-sm font-medium">{s.title}</div>
            <div className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
              {s.prompt}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  if (isUser) {
    return (
      <div className="mb-6 flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-violet-600 px-4 py-2.5 text-[0.95rem] text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="group mb-6 flex gap-3">
      <div className="mt-0.5 shrink-0">
        <LumioMark size={28} />
      </div>
      <div className="min-w-0 flex-1">
        {message.content ? (
          message.error ? (
            <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {message.content}
            </div>
          ) : (
            <Markdown content={message.content} />
          )
        ) : streaming ? (
          <div className="flex items-center gap-1 py-1 text-zinc-400">
            <span className="lumio-caret">▍</span>
          </div>
        ) : null}

        {!streaming && message.content && !message.error && (
          <button
            onClick={copy}
            className="mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}

function SettingsModal({
  value,
  onClose,
  onSave,
}: {
  value: string;
  onClose: () => void;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Custom instructions</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Tell Lumio how you&apos;d like it to respond. This is added to every
          new message.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          placeholder="e.g. I'm a beginner developer. Keep explanations simple and include examples."
          className="mt-3 w-full resize-none rounded-xl border border-zinc-300 bg-white p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:ring-violet-500/20"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="lumio-gradient rounded-lg px-4 py-2 text-sm font-medium text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
