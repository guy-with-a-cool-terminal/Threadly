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

    async function loadForSession(nextSession: Session | null) {
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
      loadForSession(initialSession);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setLoading(true);
      loadForSession(nextSession);
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
