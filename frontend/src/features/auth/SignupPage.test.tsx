import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { SignupPage } from "./SignupPage";
import { AuthProvider } from "../../hooks/useAuth";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, signup: vi.fn(), logout: vi.fn() } };
});

import { api, ApiRequestError } from "../../lib/api";
// api.signup is a mock function (see vi.mock above) — it never reads
// `this`, same vitest 1.x/method-shorthand interaction as
// RcaForm.test.tsx's identical comment on its own vi.mocked() call.
// eslint-disable-next-line @typescript-eslint/unbound-method
const signup = vi.mocked(api.signup);

function renderSignupPage(): void {
  const router = createMemoryRouter(
    [
      { path: "/signup", element: <SignupPage /> },
      { path: "/app", element: <div>Live Feed</div> },
    ],
    { initialEntries: ["/signup"] },
  );
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  signup.mockReset();
});

describe("SignupPage", () => {
  it("renders name, email, and password fields", () => {
    renderSignupPage();
    expect(screen.getByLabelText("Name")).not.toBeNull();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect(screen.getByLabelText("Password")).not.toBeNull();
  });

  it("blocks submit with a client-side error when the password is too short, without calling the API", async () => {
    const user = userEvent.setup();
    renderSignupPage();

    await user.type(screen.getByLabelText("Name"), "Operator");
    await user.type(screen.getByLabelText("Email"), "operator@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    expect(await screen.findByText(/at least 8 characters/i)).not.toBeNull();
    expect(signup).not.toHaveBeenCalled();
  });

  it("signs up and navigates to /app on success", async () => {
    const user = userEvent.setup();
    signup.mockResolvedValueOnce({
      user: {
        id: "u1",
        email: "operator@example.com",
        name: "Operator",
        role: "RESPONDER",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      token: "a.b.c",
    });
    renderSignupPage();

    await user.type(screen.getByLabelText("Name"), "Operator");
    await user.type(screen.getByLabelText("Email"), "operator@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    expect(await screen.findByText("Live Feed")).not.toBeNull();
    expect(signup).toHaveBeenCalledWith({
      email: "operator@example.com",
      password: "correct-horse-battery",
      name: "Operator",
    });
  });

  it("shows a 409 duplicate-email error from the server", async () => {
    const user = userEvent.setup();
    signup.mockRejectedValueOnce(
      new ApiRequestError({
        kind: "unknown",
        status: 409,
        message: "an account with this email already exists",
      }),
    );
    renderSignupPage();

    await user.type(screen.getByLabelText("Name"), "Operator");
    await user.type(screen.getByLabelText("Email"), "taken@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "an account with this email already exists",
    );
  });
});
