import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useNavigate } from "react-router-dom";
import { RequireAuth } from "./RequireAuth";
import { AuthProvider, useAuth } from "../hooks/useAuth";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { ...actual.api, login: vi.fn() } };
});

import { api } from "../lib/api";
// api.login is a mock function (see vi.mock above) — it never reads `this`,
// same vitest 1.x/method-shorthand interaction as RcaForm.test.tsx's
// identical comment on its own vi.mocked() call.
// eslint-disable-next-line @typescript-eslint/unbound-method
const login = vi.mocked(api.login);

/** Stands in for a real login page — just enough to drive AuthContext into "authenticated" and navigate back, without going through the full LoginPage form. */
function FakeLoginTrigger(): JSX.Element {
  const { login: doLogin } = useAuth();
  const navigate = useNavigate();

  async function handleClick(): Promise<void> {
    await doLogin("operator@example.com", "correct-horse-battery");
    void navigate("/", { replace: true });
  }

  return (
    <button type="button" onClick={() => void handleClick()}>
      trigger login
    </button>
  );
}

function renderProtectedRoute(): void {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <FakeLoginTrigger /> },
      {
        path: "/",
        element: (
          <RequireAuth>
            <div>Protected content</div>
          </RequireAuth>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe("RequireAuth", () => {
  it("redirects to /login when there is no authenticated session", () => {
    renderProtectedRoute();
    expect(screen.getByText("trigger login")).not.toBeNull();
    expect(screen.queryByText("Protected content")).toBeNull();
  });

  it("renders its children once authenticated", async () => {
    const user = userEvent.setup();
    login.mockResolvedValueOnce({
      user: {
        id: "u1",
        email: "operator@example.com",
        name: "Operator",
        role: "RESPONDER",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      token: "a.b.c",
    });
    renderProtectedRoute();

    // Starts redirected to the fake login page (same as the first test);
    // logging in should land back on the originally requested "/".
    await user.click(screen.getByText("trigger login"));

    expect(await screen.findByText("Protected content")).not.toBeNull();
  });
});
