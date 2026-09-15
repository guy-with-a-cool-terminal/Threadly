// Shown instead of the app when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// aren't set - expected during local UI review before a Supabase project
// exists, and a normal in-app message rather than an uncaught crash if it
// ever happens after deploy too.
import { Logo } from "../components/Logo";

export function MissingConfigScreen() {
  return (
    <div className="centered">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <Logo />
        <p>
          This app isn't connected to a Supabase project yet, so there's no
          backend to log into. That's expected until the project is deployed.
        </p>
        <p className="muted">
          To connect it: copy <code>web/.env.example</code> to{" "}
          <code>web/.env</code> and fill in <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> from your Supabase project,
          then restart <code>npm run dev</code>.
        </p>
      </div>
    </div>
  );
}
