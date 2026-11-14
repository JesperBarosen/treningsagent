// The Coach chat is saved in localStorage so it survives a reload. It is
// stored per user and cleared on sign-out, so someone else signing in on the
// same browser never sees it.

const PREFIX = "treningsagent.chat.";
const VERSION = "v2";

/** Keys from before chats were stored per user. Their owner is unknown, so they are dropped. */
const LEGACY_KEYS = [`${PREFIX}v1`, `${PREFIX}v2`];

export const chatKey = (userId: string) => `${PREFIX}${VERSION}.${userId}`;

export function loadChat(userId: string): unknown {
  try {
    const raw = localStorage.getItem(chatKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // blocked storage or a corrupt entry: start fresh
  }
}

export function saveChat(userId: string, chat: unknown): void {
  try {
    localStorage.setItem(chatKey(userId), JSON.stringify(chat));
  } catch {
    // private mode or full storage: the chat still works, it just won't survive a reload
  }
}

/** Drops chats saved before they were keyed by user. */
export function dropLegacyChats(): void {
  try {
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

/** Removes every saved chat on this browser, for any user. Called on sign-out. */
export function clearSavedChats(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    keys.forEach((k) => {
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    });
  } catch {}
}
