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
  Download,
  Globe,
  Link2,
  LogIn,
  LogOut,
  Menu,
  MessageSquarePlus,
  Moon,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  Settings2,
  Share2,
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
import { ALLOWED_IMAGE_TYPES, fileToImageData, imageSrc } from "@/lib/image";
import { cloudEnabled, supabase } from "@/lib/supabase";
import {
  deleteConversationCloud,
  fetchConversations,
  setPublic,
  upsertConversations,
} from "@/lib/cloud";
import type { ChatMessage, Conversation, ImageData } from "@/lib/types";

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2);

const MAX_ATTACHMENTS = 4;

const SUGGESTIONS = [
  { title: "Explain a concept", prompt: "Explain how large language models work, in simple terms." },
  { title: "Write some code", prompt: "Write a Python function that returns the nth Fibonacci number, with comments." },
  { title: "Draft an email", prompt: "Draft a friendly email asking my team to submit their weekly updates by Friday." },
  { title: "Plan something", prompt: "Give me a 3-day itinerary for a first trip to Tokyo." },
];

function deriveTitle(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 48 ? t.slice(0, 48) + "…" : t;
}

type ApiMessage = { role: "user" | "assistant"; content: string; images?: ImageData[] };

function toApi(msgs: ChatMessage[]): ApiMessage[] {
  return msgs
    .filter((m) => m.content.trim() || (m.role === "user" && m.images?.length))
    .map((m) => ({ role: m.role, content: m.content, images: m.images }));
}

interface AccountUser {
  id: string;
  email: string | null;
}

export default function ChatApp() {
  const [hydrated, setHydrated] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [webSearch, setWebSearch] = useState(false);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImageData[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [user, setUser] = useState<AccountUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const webRef = useRef(webSearch);
  webRef.current = webSearch;
  const systemRef = useRef(systemPrompt);
  systemRef.current = systemPrompt;
  const convsRef = useRef<Conversation[]>([]);
  convsRef.current = conversations;
  const userRef = useRef<AccountUser | null>(null);
  userRef.current = user;
  const syncedRef = useRef<Record<string, number>>({});
  const syncedUserRef = useRef<string | null>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

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
      const w = localStorage.getItem(STORAGE.web);
      if (w) setWebSearch(JSON.parse(w));
      const t = (localStorage.getItem(STORAGE.theme) as "light" | "dark") || "dark";
      setTheme(t === "light" ? "light" : "dark");
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  /* ---------- cloud auth + initial sync ---------- */
  const initialSync = useCallback(async (userId: string) => {
    // Push any local conversations up to the account, then make the cloud the
    // source of truth for this device.
    const local = convsRef.current;
    if (local.length) await upsertConversations(local, userId);
    const cloud = await fetchConversations(userId);
    syncedRef.current = {};
    for (const c of cloud) syncedRef.current[c.id] = c.updatedAt;
    setConversations(cloud);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u ? { id: u.id, email: u.email ?? null } : null);
      if (u && syncedUserRef.current !== u.id) {
        syncedUserRef.current = u.id;
        void initialSync(u.id);
      } else if (!u) {
        syncedUserRef.current = null;
        syncedRef.current = {};
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [initialSync]);

  /* ---------- push local changes to cloud (debounced) ---------- */
  useEffect(() => {
    if (!user || !cloudEnabled || isStreaming) return;
    const changed = conversations.filter(
      (c) => syncedRef.current[c.id] !== c.updatedAt,
    );
    if (changed.length === 0) return;
    const id = userRef.current?.id;
    if (!id) return;
    const handle = setTimeout(() => {
      void upsertConversations(changed, id).then((saved) => {
        for (const c of changed) syncedRef.current[c.id] = c.updatedAt;
        if (saved.length) {
          setConversations((prev) =>
            prev.map((p) => {
              const s = saved.find((r) => r.id === p.id);
              return s ? { ...p, shareId: s.shareId, isPublic: s.isPublic } : p;
            }),
          );
        }
      });
    }, 1200);
    return () => clearTimeout(handle);
  }, [conversations, user, isStreaming]);

  /* ---------- persist locally ---------- */
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE.conversations, JSON.stringify(conversations));
    } catch {
      /* storage full (likely large images) — keep running without persisting */
    }
  }, [conversations, hydrated]);
  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE.activeId, JSON.stringify(activeId));
  }, [activeId, hydrated]);
  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE.model, JSON.stringify(model));
  }, [model, hydrated]);
  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE.system, JSON.stringify(systemPrompt));
  }, [systemPrompt, hydrated]);
  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE.web, JSON.stringify(webSearch));
  }, [webSearch, hydrated]);
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
      apiMessages: ApiMessage[],
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
            system: systemRef.current,
            webSearch: webRef.current,
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
          updateMessage(convId, assistantId, () => ({ content: msg, error: true }));
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
          updateMessage(convId, assistantId, (m) => ({ content: m.content || "_Stopped._" }));
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
    [updateMessage],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      const imgs = attachments;
      if ((!text && imgs.length === 0) || isStreaming) return;

      const conv = conversations.find((c) => c.id === activeId) ?? null;
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: text,
        images: imgs.length ? imgs : undefined,
      };
      const assistantMsg: ChatMessage = { id: uid(), role: "assistant", content: "" };
      const priorMessages = conv ? conv.messages : [];
      const useModel = conv ? conv.model : model;
      const convId = conv ? conv.id : uid();
      const newMessages = [...priorMessages, userMsg, assistantMsg];

      if (conv) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId ? { ...c, messages: newMessages, updatedAt: Date.now() } : c,
          ),
        );
      } else {
        const newConv: Conversation = {
          id: convId,
          title: deriveTitle(text || "Image"),
          messages: newMessages,
          model: useModel,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setConversations((prev) => [newConv, ...prev]);
        setActiveId(convId);
      }
      setInput("");
      setAttachments([]);

      void streamResponse(convId, assistantMsg.id, toApi([...priorMessages, userMsg]), useModel);
    },
    [activeId, attachments, conversations, isStreaming, model, streamResponse],
  );

  const regenerate = useCallback(() => {
    if (!active || isStreaming) return;
    const msgs = active.messages;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i].role !== "assistant") i--;
    if (i < 0) return;
    const priorMessages = msgs.slice(0, i);
    const assistantMsg: ChatMessage = { id: uid(), role: "assistant", content: "" };
    setConversations((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? { ...c, messages: [...priorMessages, assistantMsg], updatedAt: Date.now() }
          : c,
      ),
    );
    void streamResponse(active.id, assistantMsg.id, toApi(priorMessages), active.model);
  }, [active, isStreaming, streamResponse]);

  const editAndResend = useCallback(
    (msgId: string, newText: string) => {
      if (!active || isStreaming) return;
      const idx = active.messages.findIndex((m) => m.id === msgId);
      if (idx < 0) return;
      const priorMessages = active.messages.slice(0, idx);
      const original = active.messages[idx];
      const editedUser: ChatMessage = { ...original, id: uid(), content: newText.trim() };
      const assistantMsg: ChatMessage = { id: uid(), role: "assistant", content: "" };
      setConversations((prev) =>
        prev.map((c) =>
          c.id === active.id
            ? { ...c, messages: [...priorMessages, editedUser, assistantMsg], updatedAt: Date.now() }
            : c,
        ),
      );
      void streamResponse(
        active.id,
        assistantMsg.id,
        toApi([...priorMessages, editedUser]),
        active.model,
      );
    },
    [active, isStreaming, streamResponse],
  );

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    if (isStreaming) return;
    setActiveId(null);
    setAttachments([]);
    setSidebarOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const selectConversation = (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    delete syncedRef.current[id];
    if (user) void deleteConversationCloud(id);
    if (activeId === id) setActiveId(null);
  };

  const renameConversation = (id: string) => {
    const current = conversations.find((c) => c.id === id);
    const next = window.prompt("Rename chat", current?.title ?? "");
    if (next == null) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, title: next.trim() || c.title, updatedAt: Date.now() } : c,
      ),
    );
  };

  const changeModel = (id: ModelId) => {
    setModel(id);
    setModelMenuOpen(false);
    if (active)
      setConversations((prev) =>
        prev.map((c) => (c.id === active.id ? { ...c, model: id, updatedAt: Date.now() } : c)),
      );
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const slots = MAX_ATTACHMENTS - attachments.length;
    const picked = Array.from(files)
      .filter((f) => ALLOWED_IMAGE_TYPES.has(f.type))
      .slice(0, Math.max(0, slots));
    for (const f of picked) {
      try {
        const img = await fileToImageData(f);
        setAttachments((prev) => [...prev, img]);
      } catch {
        /* skip unreadable image */
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const exportConversation = () => {
    if (!active) return;
    const lines = [`# ${active.title}`, ""];
    for (const m of active.messages) {
      lines.push(m.role === "user" ? "## You" : "## Lumio");
      if (m.images?.length) lines.push(`_(${m.images.length} image attachment(s))_`);
      lines.push(m.content || "", "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.title.replace(/[^\w\- ]+/g, "").slice(0, 40) || "lumio-chat"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---------- sharing ---------- */
  const makePublic = async () => {
    if (!active || !user) return;
    await upsertConversations([active], user.id);
    const shareId = await setPublic(active.id, true);
    if (shareId) {
      setConversations((prev) =>
        prev.map((c) => (c.id === active.id ? { ...c, isPublic: true, shareId } : c)),
      );
      const link = `${location.origin}/share/${shareId}`;
      await navigator.clipboard.writeText(link).catch(() => {});
      showToast("Public link copied to clipboard");
    } else {
      showToast("Could not create share link");
    }
  };

  const stopSharing = async () => {
    if (!active) return;
    await setPublic(active.id, false);
    setConversations((prev) =>
      prev.map((c) => (c.id === active.id ? { ...c, isPublic: false } : c)),
    );
    setShareOpen(false);
    showToast("Sharing turned off");
  };

  const copyShareLink = async () => {
    if (!active?.shareId) return;
    await navigator.clipboard
      .writeText(`${location.origin}/share/${active.shareId}`)
      .catch(() => {});
    showToast("Link copied");
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    showToast("Signed out");
  };

  const activeModelId: ModelId = active ? active.model : model;
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !isStreaming;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
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
                className="flex flex-1 items-center gap-1.5 truncate py-2 text-left text-sm"
                title={c.title}
              >
                {c.isPublic && <Link2 size={12} className="shrink-0 text-violet-500" />}
                <span className="truncate">{c.title}</span>
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

        <div className="space-y-1 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Settings2 size={16} />
            Custom instructions
          </button>
          {cloudEnabled &&
            (user ? (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                  {(user.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {user.email}
                </span>
                <button
                  onClick={signOut}
                  className="rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut size={15} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAuthOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <LogIn size={16} />
                Sign in to sync
              </button>
            ))}
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>

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
                <div className="fixed inset-0 z-10" onClick={() => setModelMenuOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => changeModel(m.id)}
                      className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-700/60 ${
                        m.id === activeModelId ? "bg-zinc-100 dark:bg-zinc-700/60" : ""
                      }`}
                    >
                      <Sparkles size={15} className="mt-0.5 shrink-0 text-violet-500" />
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

          {cloudEnabled && active && active.messages.length > 0 && (
            <div className="relative">
              <button
                onClick={() => {
                  if (!user) {
                    setAuthOpen(true);
                  } else if (active.isPublic) {
                    setShareOpen((v) => !v);
                  } else {
                    void makePublic();
                  }
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
                  active.isPublic
                    ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                title={user ? "Share conversation" : "Sign in to share"}
              >
                <Share2 size={16} />
                <span className="hidden sm:inline">Share</span>
              </button>
              {shareOpen && active.isPublic && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShareOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
                    <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Anyone with this link can view this conversation.
                    </p>
                    <div className="flex items-center gap-1.5">
                      <input
                        readOnly
                        value={
                          active.shareId
                            ? `${location.origin}/share/${active.shareId}`
                            : ""
                        }
                        className="min-w-0 flex-1 truncate rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <button
                        onClick={copyShareLink}
                        className="lumio-gradient rounded-lg px-2.5 py-1.5 text-xs font-medium text-white"
                      >
                        Copy
                      </button>
                    </div>
                    <button
                      onClick={stopSharing}
                      className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      Stop sharing
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {active && active.messages.length > 0 && (
            <button
              onClick={exportConversation}
              className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Export conversation as Markdown"
              title="Export as Markdown"
            >
              <Download size={18} />
            </button>
          )}
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
                  canEdit={!isStreaming}
                  onResend={editAndResend}
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
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((img, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageSrc(img)}
                      alt="attachment"
                      className="h-16 w-16 rounded-lg border border-zinc-300 object-cover dark:border-zinc-700"
                    />
                    <button
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-white shadow hover:bg-zinc-700"
                      aria-label="Remove image"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white p-2 shadow-sm transition focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-violet-500/60 dark:focus-within:ring-violet-500/20">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={attachments.length >= MAX_ATTACHMENTS}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
                aria-label="Attach image"
                title="Attach image"
              >
                <Paperclip size={18} />
              </button>
              <button
                onClick={() => setWebSearch((v) => !v)}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm transition ${
                  webSearch
                    ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                aria-pressed={webSearch}
                title="Toggle web search"
              >
                <Globe size={17} />
                <span className="hidden sm:inline">Search</span>
              </button>

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
                  disabled={!canSend}
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

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onToast={showToast} />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
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
        Your AI companion for thinking, writing, coding, and getting things done.
        What can I help you with today?
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
  canEdit,
  onResend,
}: {
  message: ChatMessage;
  streaming: boolean;
  canEdit: boolean;
  onResend: (id: string, text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
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
      <div className="group mb-6 flex flex-col items-end">
        {message.images?.length ? (
          <div className="mb-1.5 flex flex-wrap justify-end gap-2">
            {message.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={imageSrc(img)}
                alt="attachment"
                className="max-h-48 rounded-xl border border-zinc-200 object-cover dark:border-zinc-700"
              />
            ))}
          </div>
        ) : null}

        {editing ? (
          <div className="w-full max-w-[85%]">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border border-violet-300 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-violet-200 dark:border-violet-500/50 dark:bg-zinc-800 dark:focus:ring-violet-500/20"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setDraft(message.content);
                }}
                className="rounded-lg px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (draft.trim()) {
                    setEditing(false);
                    onResend(message.id, draft);
                  }
                }}
                className="lumio-gradient rounded-lg px-3 py-1.5 text-xs font-medium text-white"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.content && (
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-violet-600 px-4 py-2.5 text-[0.95rem] text-white">
                {message.content}
              </div>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
                className="mt-1 flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
          </>
        )}
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

function AuthModal({
  onClose,
  onToast,
}: {
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || busy) return;
    setError(null);
    setInfo(null);
    if (!email.trim() || password.length < 6) {
      setError("Enter an email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) setError(error.message);
        else if (!data.session)
          setInfo("Account created! Check your email to confirm, then sign in.");
        else {
          onToast("Welcome to Lumio");
          onClose();
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) setError(error.message);
        else {
          onToast("Signed in");
          onClose();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          <LumioMark size={44} />
          <h2 className="mt-3 text-lg font-semibold">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Sync your conversations across devices.
          </p>
        </div>

        <div className="mt-5 space-y-2.5">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:ring-violet-500/20"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="Password (min 6 characters)"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:ring-violet-500/20"
          />
        </div>

        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        {info && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{info}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="lumio-gradient mt-4 w-full rounded-xl py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>

        <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {mode === "signin" ? "New to Lumio?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
            className="font-medium text-violet-600 hover:underline dark:text-violet-400"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
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
          Tell Lumio how you&apos;d like it to respond. This is added to every new
          message.
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
