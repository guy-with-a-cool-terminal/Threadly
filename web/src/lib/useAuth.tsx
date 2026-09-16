import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { Mailbox } from "./types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  mailbox: Mailbox | null;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    let currentUserId: string | null = null;

    async function loadForSession(nextSession: Session | null, showLoading: boolean) {
      if (showLoading) setLoading(true);
      setSession(nextSession);
      if (!nextSession) {
        setMailbox(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      const [{ data: mailboxRow }, { data: adminFlag }] = await Promise.all([
        supabase.from("mailboxes").select("*").eq("auth_user_id", nextSession.user.id).maybeSingle(),
        supabase.rpc("is_admin"),
      ]);
      if (!active) return;
      setMailbox((mailboxRow as Mailbox) ?? null);
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
    isAdmin,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
