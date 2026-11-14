"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChatIcon, PlusIcon, SendIcon } from "@/components/icons";
import { LoggedSessionCard } from "@/components/session-card";
import { Button, OfflineHint } from "@/components/states";
import { ApiError, sendChat, type Session } from "@/lib/api";
import { dropLegacyChats, loadChat, saveChat } from "@/lib/chat-storage";
import { currentUserId } from "@/lib/supabase/client";
import { Markdown } from "@/lib/markdown";
import { SessionSheet } from "./sessions/session-sheet";

/** A session the agent logged, as its card shows it now: changed or undone from the card. */
type Logged = Session & { edited?: boolean; undone?: boolean };

type Item =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "agent"; text: string; logged: Logged[] }
  | { id: string; role: "error"; text: string; offline: boolean; retry: string };

type Conversation = { items: Item[]; history: unknown[]; conversationId: string | null };

const EMPTY: Conversation = { items: [], history: [], conversationId: null };

/** Starters fill the input (the user adds their numbers); questions send at once. */
const QUICK_REPLIES = [
  { label: "Log a run", fill: "Ran  km in  min today, effort " , caret: 4 },
  { label: "Log climbing", fill: "Climbed for  min today, effort . Climbs: ", caret: 12 },
  { label: "Am I improving?", send: "Am I improving?" },
  { label: "This week's load", send: "How is my training load this week?" },
] as const;

function loadConversation(userId: string): Conversation {
  const saved = loadChat(userId);
  return saved && typeof saved === "object" ? { ...EMPTY, ...saved } : EMPTY;
}

const newId = () => Math.random().toString(36).slice(2);

export function Chat() {
  const [convo, setConvo] = useState<Conversation>(EMPTY);
  const [restored, setRestored] = useState(false);
  // Whose chat this is: it is saved under their id, so another account never restores it.
  const [userId, setUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // The logged session whose sheet is open in edit mode, from its card's Edit.
  const [editing, setEditing] = useState<Session | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore after mount (the server render has no localStorage), for the signed-in user only.
  useEffect(() => {
    let cancelled = false;
    currentUserId()
      .catch(() => null)
      .then((id) => {
        if (cancelled) return;
        dropLegacyChats();
        setUserId(id);
        if (id) setConvo(loadConversation(id));
        setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (restored && userId) saveChat(userId, convo);
  }, [convo, restored, userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [convo.items.length, sending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setDraft("");
    setSending(true);
    setConvo((c) => ({
      ...c,
      // A retry replaces the failed attempt's error bubble.
      items: [...c.items.filter((i) => i.role !== "error"), { id: newId(), role: "user", text: message }],
    }));
    try {
      const res = await sendChat(message, convo.history, convo.conversationId);
      setConvo((c) => ({
        history: res.history,
        conversationId: res.conversation_id,
        items: [
          ...c.items,
          { id: newId(), role: "agent", text: res.reply, logged: res.logged_sessions ?? [] },
        ],
      }));
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e), 0);
      setConvo((c) => ({
        ...c,
        // Drop the unanswered message; the error bubble offers to send it again.
        items: [
          ...c.items.slice(0, -1),
          { id: newId(), role: "error", text: err.message, offline: err.status === null, retry: message },
        ],
      }));
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  }

  function quickReply(q: (typeof QUICK_REPLIES)[number]) {
    if ("send" in q) return send(q.send);
    setDraft(q.fill);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(q.caret, q.caret);
    });
  }

  function newChat() {
    setConvo(EMPTY);
    inputRef.current?.focus();
  }

  /** Update one logged session's card in place, wherever it is in the conversation. */
  function updateLogged(id: number, change: (s: Logged) => Logged) {
    setConvo((c) => ({
      ...c,
      items: c.items.map((i) =>
        i.role === "agent" ? { ...i, logged: i.logged.map((s) => (s.id === id ? change(s) : s)) } : i,
      ),
    }));
  }

  const empty = restored && convo.items.length === 0;

  return (
    <>
      <div className="flex items-center justify-between pt-4 pb-2">
        <h1 className="font-display text-xl font-semibold">Coach</h1>
        {convo.items.length > 0 && (
          <Button variant="ghost" onClick={newChat} className="-mr-3 px-3" disabled={sending}>
            <PlusIcon size={18} /> New chat
          </Button>
        )}
      </div>

      {/* Bottom padding leaves room for the fixed composer (and the tab bar on mobile). */}
      <div className="pb-52 md:pb-40">
        {empty && <Welcome />}
        <ol aria-label="Conversation" aria-live="polite" className="space-y-4">
          {convo.items.map((item) => (
            <li key={item.id} className="animate-rise">
              <Message
                item={item}
                onRetry={send}
                disabled={sending}
                onEdit={setEditing}
                onUndone={(s) => updateLogged(s.id, (old) => ({ ...old, undone: true }))}
              />
            </li>
          ))}
          {sending && (
            <li aria-label="Coach is thinking">
              <Thinking />
            </li>
          )}
        </ol>
        <div ref={endRef} />
      </div>

      <SessionSheet
        session={editing}
        startEditing
        onClose={() => setEditing(null)}
        onChanged={(updated) => {
          const id = editing?.id;
          setEditing(null);
          if (id === undefined) return;
          updateLogged(id, (old) =>
            updated ? { ...updated, edited: true } : { ...old, undone: true },
          );
        }}
      />

      <div className="fixed inset-x-0 bottom-14 z-20 border-t border-line bg-canvas/95 shadow-sheet backdrop-blur md:bottom-0">
        <div className="mx-auto max-w-content px-4 pt-3 pb-3 sm:px-6">
          <div
            className="scrollbar-none -mx-4 mb-2 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6"
            role="group"
            aria-label="Quick replies"
          >
            {QUICK_REPLIES.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => quickReply(q)}
                disabled={sending}
                className="min-h-11 shrink-0 rounded-full border border-line bg-surface px-3.5 text-sm font-medium whitespace-nowrap text-ink transition hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {q.label}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <label htmlFor="message" className="sr-only">
              Message
            </label>
            <textarea
              id="message"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ran 10 km in 50 min, effort 6…"
              className="field-sizing-content max-h-36 min-h-12 flex-1 resize-none rounded-lg border border-line bg-surface px-4 py-3 text-base placeholder:text-ink-muted focus:border-accent focus:outline-none focus-visible:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              aria-label="Send"
              className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition hover:opacity-90 disabled:opacity-35"
            >
              <SendIcon size={20} />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

function Welcome() {
  return (
    <div className="animate-rise py-8">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
        <ChatIcon size={24} />
      </div>
      <h2 className="font-display text-2xl font-semibold text-balance">How did training go?</h2>
      <p className="mt-2 max-w-md text-ink-muted">
        Tell me what you did in plain words. I&apos;ll log it, keep an eye on your load and tell
        you straight whether you&apos;re improving.
      </p>
      <ul className="mt-6 space-y-2 text-sm text-ink-muted">
        <li className="rounded-md border border-line bg-surface px-4 py-3">
          &ldquo;Ran 10 km in 50 min today, effort 6&rdquo;
        </li>
        <li className="rounded-md border border-line bg-surface px-4 py-3">
          &ldquo;90 min bouldering, effort 7: flashed two blues, sent a purple, fell off a red&rdquo;
        </li>
      </ul>
    </div>
  );
}

function Message({
  item,
  onRetry,
  disabled,
  onEdit,
  onUndone,
}: {
  item: Item;
  onRetry: (text: string) => void;
  disabled: boolean;
  onEdit: (s: Session) => void;
  onUndone: (s: Session) => void;
}) {
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg rounded-br-sm bg-sunken px-4 py-2.5 whitespace-pre-wrap">
          <span className="sr-only">You: </span>
          {item.text}
        </p>
      </div>
    );
  }
  if (item.role === "error") {
    return (
      <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm">
        <p className="font-semibold text-danger">
          {item.offline ? "Can't reach the backend" : "That didn't go through"}
        </p>
        <p className="mt-1 text-ink-muted">
          {item.offline ? <OfflineHint /> : item.text}
        </p>
        <p className="mt-2 truncate text-ink">&ldquo;{item.retry}&rdquo;</p>
        <Button className="mt-3 -ml-1" onClick={() => onRetry(item.retry)} disabled={disabled}>
          Send again
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {item.logged.map((s) => (
        <LoggedSessionCard
          key={s.id}
          session={s}
          edited={s.edited}
          undone={s.undone}
          onEdit={() => onEdit(s)}
          onUndone={() => onUndone(s)}
        />
      ))}
      <div className="max-w-[92%] leading-relaxed">
        <span className="sr-only">Coach: </span>
        <Markdown text={item.text} />
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex h-8 items-center gap-1.5" aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-2 animate-pulse rounded-full bg-ink-muted"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
