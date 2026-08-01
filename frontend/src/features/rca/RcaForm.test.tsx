import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { RcaForm, type RcaFormProps } from "./RcaForm";

// Mock only api.submitRca; keep the real ApiRequestError so the 422/conflict
// branches exercise the actual error type the form checks with instanceof.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, submitRca: vi.fn() } };
});

// Must come after vi.mock so the mocked module is what's imported.
import { api, ApiRequestError } from "../../lib/api";

// vitest 1.x types `vi.mocked()` as `Mock<any, any>` regardless of the
// wrapped function's real signature (fixed in vitest 2+) — the unbound
// method and unsafe-assignment findings below are that typing gap, not a
// real risk: `api.submitRca` is a mock function, it never reads `this`.
// eslint-disable-next-line @typescript-eslint/unbound-method
const submitRca = vi.mocked(api.submitRca);

function renderForm(overrides: Partial<RcaFormProps> = {}): {
  onSubmitted: ReturnType<typeof vi.fn>;
  onConflict: ReturnType<typeof vi.fn>;
  incidentId: string;
} {
  const onSubmitted = vi.fn();
  const onConflict = vi.fn();
  const props: RcaFormProps = {
    incidentId: "wi-1",
    // A first-signal timestamp well in the past, so the prefilled start/end defaults are valid.
    firstSignalAt: "2026-06-01T00:00:00.000Z",
    onSubmitted,
    onConflict,
    ...overrides,
  };
  const router = createMemoryRouter([{ path: "/", element: <RcaForm {...props} /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);
  // Same vitest 1.x `vi.fn()` typing gap as `submitRca` above.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return { onSubmitted, onConflict, incidentId: props.incidentId };
}

async function fillNarrativeFields(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(screen.getByLabelText("Root cause category"), "INFRASTRUCTURE_FAILURE");
  await user.type(
    screen.getByLabelText("Root cause description"),
    "Detailed root cause explanation here.",
  );
  await user.type(screen.getByLabelText("Fix applied"), "Applied the corrective fix.");
  await user.type(screen.getByLabelText("Prevention steps"), "Added preventative monitoring.");
}

beforeEach(() => {
  sessionStorage.clear();
  submitRca.mockReset();
});

describe("RcaForm", () => {
  it("renders all six labelled fields", () => {
    renderForm();
    for (const label of [
      "Incident start time",
      "Incident end time",
      "Root cause category",
      "Root cause description",
      "Fix applied",
      "Prevention steps",
    ]) {
      expect(screen.getByLabelText(label)).not.toBeNull();
    }
  });

  it("prefills start and end times", () => {
    renderForm();
    expect(screen.getByLabelText<HTMLInputElement>("Incident start time").value).not.toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Incident end time").value).not.toBe("");
  });

  it("shows a live character counter that reflects progress toward the minimum", async () => {
    const user = userEvent.setup();
    renderForm();
    // Three fields start empty at 0/10.
    expect(screen.getAllByText("0/10 min").length).toBe(3);

    await user.type(screen.getByLabelText("Fix applied"), "abcd");
    expect(screen.getByText("4/10 min")).not.toBeNull();

    await user.type(screen.getByLabelText("Fix applied"), "efghij");
    expect(screen.getByText("10/10 ✓")).not.toBeNull();
  });

  it("blocks submit and focuses the first invalid field when required fields are missing", async () => {
    const user = userEvent.setup();
    const { onSubmitted } = renderForm();

    // Times are prefilled/valid; category + narratives are empty, so the first
    // invalid field in form order is the category.
    await user.click(screen.getByRole("button", { name: /submit rca/i }));

    expect(submitRca).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByText("Select a root cause category.")).not.toBeNull();
    expect((document.activeElement as HTMLElement).id).toBe("rca-rootCauseCategory");
  });

  it("maps a 422 field error from the backend onto the correct field", async () => {
    const user = userEvent.setup();
    submitRca.mockRejectedValueOnce(
      new ApiRequestError({
        kind: "invalid_rca",
        status: 422,
        message: "RCA failed validation",
        fieldErrors: [{ field: "fixApplied", message: "Fix applied reads like a placeholder." }],
      }),
    );
    const { onSubmitted } = renderForm();

    await fillNarrativeFields(user);
    await user.click(screen.getByRole("button", { name: /submit rca/i }));

    expect(await screen.findByText("Fix applied reads like a placeholder.")).not.toBeNull();
    expect(onSubmitted).not.toHaveBeenCalled();
    expect((document.activeElement as HTMLElement).id).toBe("rca-fixApplied");
  });

  it("routes a 409 conflict to onConflict rather than an inline error", async () => {
    const user = userEvent.setup();
    submitRca.mockRejectedValueOnce(
      new ApiRequestError({
        kind: "conflict",
        status: 409,
        message: "conflict",
        reason: "invalid_state",
      }),
    );
    const { onConflict, onSubmitted } = renderForm();

    await fillNarrativeFields(user);
    await user.click(screen.getByRole("button", { name: /submit rca/i }));

    await vi.waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("clears the session draft and calls onSubmitted on success", async () => {
    const user = userEvent.setup();
    submitRca.mockResolvedValueOnce({} as never);
    const { onSubmitted, incidentId } = renderForm();

    await fillNarrativeFields(user);
    // Typing has written a draft.
    expect(sessionStorage.getItem(`ims:rca-draft:${incidentId}`)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /submit rca/i }));

    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(`ims:rca-draft:${incidentId}`)).toBeNull();
  });

  it("restores a previously saved draft on mount", () => {
    sessionStorage.setItem(
      "ims:rca-draft:wi-1",
      JSON.stringify({
        incidentStartTime: "2026-06-01T01:00",
        incidentEndTime: "2026-06-01T02:00",
        rootCauseCategory: "NETWORK",
        rootCauseDescription: "Recovered from a saved draft body.",
        fixApplied: "Recovered fix text.",
        preventionSteps: "Recovered prevention text.",
      }),
    );
    renderForm();

    expect(screen.getByLabelText<HTMLTextAreaElement>("Root cause description").value).toBe(
      "Recovered from a saved draft body.",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Root cause category").value).toBe("NETWORK");
  });

  it("disables the button while in flight and does not submit twice", async () => {
    const user = userEvent.setup();
    let resolveSubmit: (value: unknown) => void = () => {};
    submitRca.mockImplementation(
      () => new Promise((resolve) => (resolveSubmit = resolve)) as never,
    );
    renderForm();

    await fillNarrativeFields(user);
    const button = screen.getByRole("button", { name: /submit rca/i });
    await user.click(button);

    // In flight: button disabled and relabelled.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /submitting/i })).not.toBeNull();

    // A second click on the disabled button must not fire another request.
    await user.click(button);
    expect(submitRca).toHaveBeenCalledTimes(1);

    resolveSubmit({});
  });
});
