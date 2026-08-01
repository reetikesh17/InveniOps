import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Input } from "../../components";
import { ApiRequestError } from "../../lib/api";
import { DISPLAY_HEADING_CLASSES, EYEBROW_CLASSES } from "../../components/typography";
import { useAuth } from "../../hooks/useAuth";

// Mirrors backend/src/api/routes/auth.ts's MIN_PASSWORD_LENGTH — a
// client-side convenience gate only, same posture as RcaForm's validation:
// the server is authoritative, this just skips a request that's certain
// to fail.
const MIN_PASSWORD_LENGTH = 8;

export function SignupPage(): JSX.Element {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    if (password.length < MIN_PASSWORD_LENGTH) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signup(email, password, name);
      void navigate("/app", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.info.kind !== "network"
          ? err.info.message
          : "Something went wrong creating your account.",
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
            <h1 className="text-base font-semibold text-ink">Create an account</h1>

            <Input
              label="Name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched(true)}
              error={
                touched && passwordTooShort
                  ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
                  : undefined
              }
              required
            />

            {error && (
              <p role="alert" className="font-body text-prose text-severity-p0">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" loading={submitting}>
              {submitting ? "Creating account…" : "Sign up"}
            </Button>

            <p className="text-center font-body text-prose text-ink-muted">
              Already have an account?{" "}
              <Link to="/login" className="text-ink underline hover:no-underline">
                Sign in
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
