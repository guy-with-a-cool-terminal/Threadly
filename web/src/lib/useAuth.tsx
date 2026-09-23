import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { Mailbox } from "./types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  mailbox: Mailbox | null;
  // True when the mailbox lookup itself failed (e.g. a flaky connection
  // timing out the request) rather than genuinely finding no row. Kept
  // separate from `mailbox === null` so the UI can tell "retry, this may
  // be transient" apart from "this login really has no personal mailbox."
  mailboxLookupFailed: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
  retryMailboxLookup: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// A single flaky request shouldn't be taken as "no mailbox exists" - retry
// a couple of times with a short backoff before giving up and surfacing it
// as a lookup failure rather than silently treating it as "no mailbox."
async function fetchMailbox(userId: string): Promise<{ mailbox: Mailbox | null; failed: boolean }> {
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { data, error } = await supabase.from("mailboxes").select("*").eq("auth_user_id", userId).maybeSingle();
    if (!error) return { mailbox: (data as Mailbox) ?? null, failed: false };
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return { mailbox: null, failed: true };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [mailboxLookupFailed, setMailboxLookupFailed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const currentSessionRef = useRef<Session | null>(null);

  useEffect(() => {
    let active = true;
    let currentUserId: string | null = null;

    async function loadForSession(nextSession: Session | null, showLoading: boolean) {
      if (showLoading) setLoading(true);
      setSession(nextSession);
      currentSessionRef.current = nextSession;
      if (!nextSession) {
        setMailbox(null);
        setMailboxLookupFailed(false);
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      const [{ mailbox: mailboxRow, failed }, { data: adminFlag }] = await Promise.all([
        fetchMailbox(nextSession.user.id),
        supabase.rpc("is_admin"),
      ]);
      if (!active) return;
      setMailbox(mailboxRow);
      setMailboxLookupFailed(failed);
      setIsAdmin(Boolean(adminFlag));
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      currentUserId = initialSession?.user.id ?? null;
      loadForSession(initialSession, true);
    });

    // Supabase re-validates the session (and fires this) whenever the tab
    // regains focus, and again on every silent token refresh - not just on
    // actual sign-in/out. Only the initial load and a genuine identity
    // change (different user, or signing out) should show the loading
    // gate: ProtectedRoute unmounts the whole routed page while loading is
    // true, so gating on every same-user token refresh was wiping
    // in-progress form state (e.g. mid-wizard) every time someone switched
    // tabs and came back.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      const identityChanged = nextUserId !== currentUserId;
      currentUserId = nextUserId;
      loadForSession(nextSession, identityChanged);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    loading,
    session,
    user: session?.user ?? null,
    mailbox,
    mailboxLookupFailed,
    isAdmin,
    signOut: async () => {
      await supabase.auth.signOut();
    },
    retryMailboxLookup: () => {
      const activeSession = currentSessionRef.current;
      if (!activeSession) return;
      fetchMailbox(activeSession.user.id).then(({ mailbox: mailboxRow, failed }) => {
        setMailbox(mailboxRow);
        setMailboxLookupFailed(failed);
      });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
