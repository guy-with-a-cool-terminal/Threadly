import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { Logo } from "../components/Logo";

// Single-step (email + password together), unlike Gmail/Outlook's
// email-then-password split - that split exists so they can branch into
// SSO/passkey options after the email step, which doesn't apply here.
// There's also no "Forgot password?" link: mailboxes are admin-provisioned
// with no self-serve reset flow, so a note pointing at the admin is the
// honest version of that affordance instead of a dead-end link.
export function LoginPage() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && session) return <Navigate to="/inbox" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    setSubmitting(false);
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand-panel">
        <Logo />
        <p className="auth-brand-tagline">Custom-built email hosting, one inbox per address.</p>
        <ul className="auth-brand-points">
          <li>Your own inbox, threaded and searchable</li>
          <li>Backed by your provider, not a shared mailbox farm</li>
          <li>Access managed by your administrator</li>
        </ul>
      </div>
      <div className="auth-form-panel">
        <div className="login-card">
          <p className="login-tagline">Sign in to your mailbox</p>
          <form className="login-form" onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="you@yourdomain.com"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="muted login-footnote">Lost your password? Contact your administrator to reset it.</p>
        </div>
      </div>
    </div>
  );
}
