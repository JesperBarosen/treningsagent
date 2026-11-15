"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChatIcon, PlusIcon, SendIcon } from "@/components/icons";
import { LoggedSessionCard } from "@/components/session-card";
import { Button, OfflineHint } from "@/components/states";
import { WeekGlance } from "@/components/week-glance";
import { asSession, DraftCard } from "@/components/draft-card";
import { ApiError, createSession, draftInput, sendChat, type Draft, type Session } from "@/lib/api";
import {
  clearDraftForForm,
  handDraftToForm,
  parseHandedDraft,
  peekDraftForForm,
  readAutoSave,
  takeSavedDraft,
  type DraftRef,
} from "@/lib/chat-drafts";
import { dropLegacyChats, loadChat, saveChat } from "@/lib/chat-storage";
import { SENSITIVE } from "@/lib/discreet";
import { currentUserId } from "@/lib/supabase/client";
import { sessionSummary } from "@/lib/format";
import { Markdown } from "@/lib/markdown";
import { SessionSheet } from "./sessions/session-sheet";

/** A session the agent logged, as its card shows it now: changed or undone from the card. */
type Logged = Session & { edited?: boolean; undone?: boolean };

/** A draft the agent made (N4) and what the user did with it. Saved drafts move
 *  into `logged`, so their card gets Edit and Undo like any logged session. */
type DraftItem = { key: string; draft: Draft; status: "open" | "saved" | "dismissed" };

type Item =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "agent"; text: string; logged: Logged[]; drafts?: DraftItem[] }
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

/** "Run · 10 km · 30 min · effort 6 on 2026-11-14 (id 7)", for the coach's history notes. */
const describe = (s: Session) => `${sessionSummary(s)} on ${s.date} (id ${s.id})`;

/** History notes for changes made on a Logged card. The system prompt explains them. */
export const removedNote = (s: Session) =>
  `[User removed the session: ${describe(s)}. It is no longer in their log.]`;
export const editedNote = (s: Session) => `[User edited the session to: ${describe(s)}.]`;
export const savedDraftNote = (s: Session) => `[User saved the draft as: ${describe(s)}.]`;
export const dismissedDraftNote = (d: Draft) =>
  `[User dismissed the draft: ${sessionSummary(asSession(d))} on ${d.date}. Nothing was stored.]`;

/** Append a note for the coach to the stored history (the API merges it with the
 *  next user message into one turn). Not before the first reply: nothing to note. */
const withNote = (history: unknown[], note: string) =>
  history.length ? [...history, { role: "user", content: note }] : history;

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
        // A draft reviewed and saved in the Log form: mark its card here.
        const saved = takeSavedDraft();
        if (id && saved) settleDraft(saved.ref, { saved: saved.session });
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
      const res = await sendChat(message, convo.history, convo.conversationId, undefined, readAutoSave());
      const drafts = (res.drafts ?? []).map((draft) => ({ key: newId(), draft, status: "open" as const }));
      setConvo((c) => ({
        history: res.history,
        conversationId: res.conversation_id,
        items: [
          ...c.items,
          { id: newId(), role: "agent", text: res.reply, logged: res.logged_sessions ?? [], drafts },
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

  /** Update one logged session's card in place, wherever it is in the conversation,
   *  and tell the coach: `note` is appended to the stored history as a user
   *  message, so the next /chat turn knows the session changed outside the chat.
   *  (The API merges consecutive user messages into one turn.) */
  function updateLogged(id: number, change: (s: Logged) => Logged, note: string) {
    setConvo((c) => ({
      ...c,
      history: withNote(c.history, note),
      items: c.items.map((i) =>
        i.role === "agent" ? { ...i, logged: i.logged.map((s) => (s.id === id ? change(s) : s)) } : i,
      ),
    }));
  }

  /** A draft was saved (here or in the Log form) or dismissed: update its card
   *  and tell the coach. A saved draft joins the message's logged sessions. */
  function settleDraft(ref: DraftRef, outcome: { saved: Session } | { dismissed: Draft }) {
    setConvo((c) => {
      const found = c.items.some(
        (i) => i.id === ref.itemId && i.role === "agent" && i.drafts?.some((d) => d.key === ref.key && d.status === "open"),
      );
      if (!found) return c; // already settled, or a cleared chat
      const note = "saved" in outcome ? savedDraftNote(outcome.saved) : dismissedDraftNote(outcome.dismissed);
      return {
        ...c,
        history: withNote(c.history, note),
        items: c.items.map((i) =>
          i.id !== ref.itemId || i.role !== "agent"
            ? i
            : {
                ...i,
                logged: "saved" in outcome ? [...i.logged, outcome.saved] : i.logged,
                drafts: i.drafts?.map((d) =>
                  d.key === ref.key ? { ...d, status: "saved" in outcome ? "saved" : "dismissed" } : d,
                ),
              },
        ),
      };
    });
  }

  async function saveDraft(ref: DraftRef, draft: Draft) {
    const saved = await createSession(draftInput(draft));
    settleDraft(ref, { saved });
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
        {userId && <WeekGlance />}
        {empty && <Welcome />}
        <ol aria-label="Conversation" aria-live="polite" className="space-y-4">
          {convo.items.map((item) => (
            <li key={item.id} className="animate-rise">
              <Message
                item={item}
                onRetry={send}
                disabled={sending}
                onEdit={setEditing}
                onUndone={(s) =>
                  updateLogged(s.id, (old) => ({ ...old, undone: true }), removedNote(s))
                }
                onSaveDraft={saveDraft}
                onReviewDraft={handDraftToForm}
                onDismissDraft={(ref, draft) => {
                  // A dismissed draft must not reappear in the Log form.
                  if (parseHandedDraft(peekDraftForForm())?.ref.key === ref.key) clearDraftForForm();
                  settleDraft(ref, { dismissed: draft });
                }}
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
          const before = editing;
          setEditing(null);
          if (!before) return;
          updateLogged(
            before.id,
            (old) => (updated ? { ...updated, edited: true } : { ...old, undone: true }),
            updated ? editedNote(updated) : removedNote(before),
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
                className="min-h-11 shrink-0 rounded-full border border-control bg-surface px-3.5 text-sm font-medium whitespace-nowrap text-ink transition hover:border-accent hover:text-accent disabled:opacity-40"
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
              className="field-sizing-content max-h-36 min-h-12 flex-1 resize-none rounded-lg border border-control bg-surface px-4 py-3 text-base placeholder:text-ink-muted focus:border-accent focus:outline-none focus-visible:outline-none"
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
  onSaveDraft,
  onReviewDraft,
  onDismissDraft,
}: {
  item: Item;
  onRetry: (text: string) => void;
  disabled: boolean;
  onEdit: (s: Session) => void;
  onUndone: (s: Session) => void;
  onSaveDraft: (ref: DraftRef, d: Draft) => Promise<void>;
  onReviewDraft: (ref: DraftRef, d: Draft) => void;
  onDismissDraft: (ref: DraftRef, d: Draft) => void;
}) {
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <p {...SENSITIVE} className="max-w-[85%] rounded-lg rounded-br-sm bg-sunken px-4 py-2.5 whitespace-pre-wrap">
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
        <p {...SENSITIVE} className="mt-2 truncate text-ink">&ldquo;{item.retry}&rdquo;</p>
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
      {item.drafts
        ?.filter((d) => d.status === "open")
        .map(({ key, draft }) => {
          const ref = { itemId: item.id, key };
          return (
            <DraftCard
              key={key}
              draft={draft}
              onSave={() => onSaveDraft(ref, draft)}
              onReview={() => onReviewDraft(ref, draft)}
              onDismiss={() => onDismissDraft(ref, draft)}
            />
          );
        })}
      <div {...SENSITIVE} className="max-w-[92%] leading-relaxed">
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
