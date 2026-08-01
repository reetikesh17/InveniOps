import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { AuthProvider } from "../../hooks/useAuth";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, login: vi.fn(), logout: vi.fn() } };
});

import { api, ApiRequestError } from "../../lib/api";
// api.login is a mock function (see vi.mock above) — it never reads `this`,
// same vitest 1.x/method-shorthand interaction as RcaForm.test.tsx's
// identical comment on its own vi.mocked() call.
// eslint-disable-next-line @typescript-eslint/unbound-method
const login = vi.mocked(api.login);

function renderLoginPage(initialEntries: string[] = ["/login"]): void {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/app", element: <div>Live Feed</div> },
      { path: "/incidents/wi-1", element: <div>Incident Detail</div> },
    ],
    { initialEntries },
  );
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  login.mockReset();
});

describe("LoginPage", () => {
  it("renders email and password fields", () => {
    renderLoginPage();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect(screen.getByLabelText("Password")).not.toBeNull();
  });

  it("submits credentials and navigates to /app on success", async () => {
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
    renderLoginPage();

    await user.type(screen.getByLabelText("Email"), "operator@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Live Feed")).not.toBeNull();
    expect(login).toHaveBeenCalledWith({
      email: "operator@example.com",
      password: "correct-horse-battery",
    });
  });

  it("shows the server's error message on invalid credentials, without guessing which field was wrong", async () => {
    const user = userEvent.setup();
    login.mockRejectedValueOnce(
      new ApiRequestError({ kind: "unknown", status: 401, message: "invalid email or password" }),
    );
    renderLoginPage();

    await user.type(screen.getByLabelText("Email"), "operator@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect((await screen.findByRole("alert")).textContent).toBe("invalid email or password");
  });

  it("redirects back to the originally intended page after login, not always /", async () => {
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
    const router = createMemoryRouter(
      [
        { path: "/login", element: <LoginPage /> },
        { path: "/incidents/wi-1", element: <div>Incident Detail</div> },
      ],
      {
        initialEntries: [
          { pathname: "/login", state: { from: { pathname: "/incidents/wi-1", search: "" } } },
        ],
      },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText("Email"), "operator@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Incident Detail")).not.toBeNull();
  });
});
