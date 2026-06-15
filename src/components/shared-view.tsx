"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Markdown } from "./markdown";
import { LumioMark } from "./logo";
import { fetchShared } from "@/lib/cloud";
import { cloudEnabled } from "@/lib/supabase";
import { imageSrc } from "@/lib/image";
import type { Conversation } from "@/lib/types";

export default function SharedView({ shareId }: { shareId: string }) {
  const [state, setState] = useState<"loading" | "notfound" | "ready">("loading");
  const [conv, setConv] = useState<Conversation | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    if (!cloudEnabled) {
      setState("notfound");
      return;
    }
    fetchShared(shareId).then((c) => {
      if (c) {
        setConv(c);
        setState("ready");
      } else {
        setState("notfound");
      }
    });
  }, [shareId]);

  return (
    <div className="min-h-[100dvh] bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <LumioMark size={28} />
            <span className="font-semibold tracking-tight">Lumio</span>
          </Link>
          <Link
            href="/"
            className="lumio-gradient flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
          >
            Try Lumio <ArrowRight size={15} />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        {state === "loading" && (
          <p className="py-20 text-center text-zinc-400">Loading conversation…</p>
        )}

        {state === "notfound" && (
          <div className="py-20 text-center">
            <LumioMark size={56} />
            <h1 className="mt-4 text-xl font-semibold">Conversation not found</h1>
            <p className="mt-2 text-zinc-500 dark:text-zinc-400">
              This shared link is invalid or is no longer public.
            </p>
            <Link
              href="/"
              className="lumio-gradient mt-6 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white"
            >
              Go to Lumio <ArrowRight size={15} />
            </Link>
          </div>
        )}

        {state === "ready" && conv && (
          <>
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">
              {conv.title}
            </h1>
            {conv.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="mb-6 flex flex-col items-end">
                  {m.images?.length ? (
                    <div className="mb-1.5 flex flex-wrap justify-end gap-2">
                      {m.images.map((img, i) => (
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
                  {m.content && (
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-violet-600 px-4 py-2.5 text-[0.95rem] text-white">
                      {m.content}
                    </div>
                  )}
                </div>
              ) : (
                <div key={m.id} className="mb-6 flex gap-3">
                  <div className="mt-0.5 shrink-0">
                    <LumioMark size={28} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {m.content ? <Markdown content={m.content} /> : null}
                  </div>
                </div>
              ),
            )}
            <p className="mt-10 border-t border-zinc-200 pt-6 text-center text-sm text-zinc-400 dark:border-zinc-800">
              Shared from{" "}
              <Link href="/" className="lumio-gradient-text font-medium">
                Lumio
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
