"use client";

/**
 * One chat surface for both scopes: a game's private conversation, or the
 * lobby when no gameId is given.
 *
 * Polling, like the rest of the site — every five seconds while the tab is
 * visible, nothing while it is hidden, and each poll carries the last message
 * id so a quiet channel answers with an empty list. Sending appends the
 * message straight from the response rather than waiting for the next poll.
 *
 * The list only auto-scrolls when the reader is already at the bottom.
 * Someone scrolled up is reading, and yanking them down because a message
 * arrived is the fastest way to make a chat unpleasant.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface Msg {
  id: number;
  name: string;
  body: string;
  at: number;
}

const POLL_MS = 5000;
const MAX_LENGTH = 500;

export default function ChatPanel({
  gameId = null,
  title,
  canPost,
  postHint,
}: {
  /** Null is the lobby. */
  gameId?: string | null;
  title: string;
  canPost: boolean;
  /** Shown instead of the input when posting is not available. */
  postHint?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastId = useRef(0);
  const scope = gameId === null ? "" : `game=${encodeURIComponent(gameId)}&`;

  /** Append without duplicates — a send and a poll can race over one message. */
  const append = useCallback((incoming: Msg[]) => {
    if (incoming.length === 0) return;
    setMessages((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return cur;
      return [...cur, ...fresh];
    });
    const top = incoming[incoming.length - 1].id;
    if (top > lastId.current) lastId.current = top;
  }, []);

  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(`/api/chat?${scope}after=${lastId.current}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: Msg[] };
      append(data.messages ?? []);
    } catch {
      /* the next poll retries */
    }
  }, [scope, append]);

  useEffect(() => {
    void poll();
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  // Stick to the bottom only when already there (within a line or two).
  const nearBottom = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: gameId, body: text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: Msg;
        error?: string;
      };
      if (!res.ok || !data.message) {
        setError(data.error ?? "Could not send that.");
        return;
      }
      setDraft("");
      nearBottom.current = true;
      append([data.message]);
    } finally {
      setSending(false);
    }
  }, [draft, sending, gameId, append]);

  return (
    <div className="panel chat-panel">
      <h2>{title}</h2>

      <div className="chat-messages" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing yet.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="chat-msg">
              <span className="chat-name">
                <Link href={`/player/${encodeURIComponent(m.name)}`}>{m.name}</Link>
              </span>{" "}
              <span className="chat-time">{timeOf(m.at)}</span>
              <div className="chat-body">{m.body}</div>
            </div>
          ))
        )}
      </div>

      {canPost ? (
        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            className="chat-input"
            value={draft}
            maxLength={MAX_LENGTH}
            placeholder="Say something…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn btn-primary" disabled={sending || !draft.trim()}>
            Send
          </button>
        </form>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {postHint ?? "Sign in to chat."}
        </p>
      )}

      {error && <p className="error" style={{ margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}

/** A clock time for messages from today, a date for older ones. */
function timeOf(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
