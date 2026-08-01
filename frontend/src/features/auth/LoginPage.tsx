import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, type Location } from "react-router-dom";
import { Button, Card, Input } from "../../components";
import { ApiRequestError } from "../../lib/api";
import { DISPLAY_HEADING_CLASSES, EYEBROW_CLASSES } from "../../components/typography";
import { useAuth } from "../../hooks/useAuth";

interface LocationState {
  readonly from?: Location;
}

export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      const state = location.state as LocationState | null;
      const destination = state?.from ? `${state.from.pathname}${state.from.search}` : "/app";
      void navigate(destination, { replace: true });
    } catch (err) {
      // The server deliberately returns the same message for "wrong
      // password" and "no such account" — this just surfaces it verbatim,
      // it doesn't add its own guess about which one it was.
      setError(
        err instanceof ApiRequestError && err.info.kind !== "network"
          ? err.info.message
          : "Something went wrong signing in.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">
        <div className={`mb-6 flex items-baseline justify-center gap-2 ${DISPLAY_HEADING_CLASSES}`}>
          Incident Console
          <span className={`${EYEBROW_CLASSES} tracking-widest`}>NOC</span>
        </div>

        <Card>
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="flex flex-col gap-4"
            noValidate
          >
            <h1 className="text-base font-semibold text-ink">Sign in</h1>

            <Input
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && (
              <p role="alert" className="font-body text-prose text-severity-p0">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" loading={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>

            <p className="text-center font-body text-prose text-ink-muted">
              No account?{" "}
              <Link to="/signup" className="text-ink underline hover:no-underline">
                Sign up
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
