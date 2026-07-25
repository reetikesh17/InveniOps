import { describe, expect, it } from "vitest";
import { ROOT_CAUSE_CATEGORIES } from "../../types";
import {
  MIN_TEXT_FIELD_LENGTH,
  firstInvalidField,
  hasErrors,
  validateRcaForm,
  type RcaFormValues,
  type RcaValidationContext,
} from "./rcaValidation";

// All datetime strings here are timezone-less ("...T00:00"), exactly as a
// <input type="datetime-local"> emits them, so both the form values AND the
// context dates parse in the same local zone — the suite is deterministic
// regardless of the machine's TZ. This mirrors backend
// tests/unit/domain/rca/validateRca.test.ts rule-for-rule.
const FIRST_SIGNAL_AT = new Date("2026-06-01T00:00");
const NOW = new Date("2026-06-02T00:00");
const CONTEXT: RcaValidationContext = { firstSignalAt: FIRST_SIGNAL_AT, now: NOW };

const VALID_TEXT = "Restarted the connection pool after exhausting max connections.";

function validValues(overrides: Partial<RcaFormValues> = {}): RcaFormValues {
  return {
    incidentStartTime: "2026-06-01T01:00",
    incidentEndTime: "2026-06-01T02:00",
    rootCauseCategory: "INFRASTRUCTURE_FAILURE",
    rootCauseDescription: VALID_TEXT,
    fixApplied: VALID_TEXT,
    preventionSteps: VALID_TEXT,
    ...overrides,
  };
}

describe("validateRcaForm", () => {
  it("mirrors the backend minimum text length", () => {
    // backend/src/domain/rca/validateRca.ts's MIN_TEXT_FIELD_LENGTH.
    expect(MIN_TEXT_FIELD_LENGTH).toBe(10);
  });

  it("returns no errors for a fully-formed RCA", () => {
    expect(validateRcaForm(validValues(), CONTEXT)).toEqual({});
    expect(hasErrors(validateRcaForm(validValues(), CONTEXT))).toBe(false);
  });

  describe("incidentStartTime", () => {
    it("is required when empty", () => {
      expect(validateRcaForm(validValues({ incidentStartTime: "" }), CONTEXT).incidentStartTime).toBeDefined();
    });

    it("is invalid when unparseable", () => {
      expect(validateRcaForm(validValues({ incidentStartTime: "not-a-date" }), CONTEXT).incidentStartTime).toBeDefined();
    });
  });

  describe("incidentEndTime", () => {
    it("is required when empty", () => {
      expect(validateRcaForm(validValues({ incidentEndTime: "" }), CONTEXT).incidentEndTime).toBeDefined();
    });
  });

  describe("rootCauseCategory", () => {
    it("is required when empty", () => {
      expect(validateRcaForm(validValues({ rootCauseCategory: "" }), CONTEXT).rootCauseCategory).toBeDefined();
    });

    it("is required when whitespace only", () => {
      expect(validateRcaForm(validValues({ rootCauseCategory: "   " }), CONTEXT).rootCauseCategory).toBeDefined();
    });

    it("fails when not a member of the enum", () => {
      const message = validateRcaForm(validValues({ rootCauseCategory: "ALIEN_INVASION" }), CONTEXT).rootCauseCategory;
      expect(message).toContain("must be one of");
    });

    it.each(ROOT_CAUSE_CATEGORIES)("passes for the %s category", (category) => {
      expect(validateRcaForm(validValues({ rootCauseCategory: category }), CONTEXT).rootCauseCategory).toBeUndefined();
    });
  });

  describe.each(["rootCauseDescription", "fixApplied", "preventionSteps"] as const)("%s", (field) => {
    it("is required when empty", () => {
      expect(validateRcaForm(validValues({ [field]: "" }), CONTEXT)[field]).toBeDefined();
    });

    it("is required when whitespace only", () => {
      expect(validateRcaForm(validValues({ [field]: "        " }), CONTEXT)[field]).toBeDefined();
    });

    it("fails at a single character", () => {
      expect(validateRcaForm(validValues({ [field]: "x" }), CONTEXT)[field]).toBeDefined();
    });

    it(`fails at ${MIN_TEXT_FIELD_LENGTH - 1} characters (one under the minimum)`, () => {
      expect(validateRcaForm(validValues({ [field]: "a".repeat(MIN_TEXT_FIELD_LENGTH - 1) }), CONTEXT)[field]).toBeDefined();
    });

    it(`passes at exactly ${MIN_TEXT_FIELD_LENGTH} characters`, () => {
      expect(validateRcaForm(validValues({ [field]: "a".repeat(MIN_TEXT_FIELD_LENGTH) }), CONTEXT)[field]).toBeUndefined();
    });

    it("trims surrounding whitespace before checking length", () => {
      const padded = `   ${"a".repeat(MIN_TEXT_FIELD_LENGTH)}   `;
      expect(validateRcaForm(validValues({ [field]: padded }), CONTEXT)[field]).toBeUndefined();
    });
  });

  describe("end strictly after start", () => {
    it("fails when end equals start", () => {
      const result = validateRcaForm(
        validValues({ incidentStartTime: "2026-06-01T01:00", incidentEndTime: "2026-06-01T01:00" }),
        CONTEXT,
      );
      expect(result.incidentEndTime).toBeDefined();
    });

    it("fails when end is before start", () => {
      const result = validateRcaForm(
        validValues({ incidentStartTime: "2026-06-01T02:00", incidentEndTime: "2026-06-01T01:00" }),
        CONTEXT,
      );
      expect(result.incidentEndTime).toBeDefined();
    });

    it("passes when end is one minute after start", () => {
      const result = validateRcaForm(
        validValues({ incidentStartTime: "2026-06-01T01:00", incidentEndTime: "2026-06-01T01:01" }),
        CONTEXT,
      );
      expect(result.incidentEndTime).toBeUndefined();
    });
  });

  describe("start not before firstSignalAt", () => {
    it("fails when start is before firstSignalAt", () => {
      const result = validateRcaForm(
        validValues({ incidentStartTime: "2026-05-31T23:59", incidentEndTime: "2026-06-01T03:00" }),
        CONTEXT,
      );
      expect(result.incidentStartTime).toBeDefined();
    });

    it("passes when start equals firstSignalAt exactly", () => {
      const result = validateRcaForm(
        validValues({ incidentStartTime: "2026-06-01T00:00", incidentEndTime: "2026-06-01T01:00" }),
        CONTEXT,
      );
      expect(result.incidentStartTime).toBeUndefined();
    });
  });

  describe("neither timestamp in the future", () => {
    it("fails when start is after now", () => {
      const result = validateRcaForm(
        validValues({ incidentStartTime: "2026-06-03T00:00", incidentEndTime: "2026-06-03T01:00" }),
        CONTEXT,
      );
      expect(result.incidentStartTime).toBeDefined();
    });

    it("fails when end is after now", () => {
      const result = validateRcaForm(validValues({ incidentEndTime: "2026-06-03T00:00" }), CONTEXT);
      expect(result.incidentEndTime).toBeDefined();
    });

    it("passes when end equals now exactly", () => {
      const result = validateRcaForm(
        validValues({ incidentStartTime: "2026-06-01T23:59", incidentEndTime: "2026-06-02T00:00" }),
        CONTEXT,
      );
      expect(result.incidentEndTime).toBeUndefined();
    });
  });

  it("reports every failing field at once, not just the first", () => {
    const result = validateRcaForm(
      {
        incidentStartTime: "",
        incidentEndTime: "",
        rootCauseCategory: "",
        rootCauseDescription: "",
        fixApplied: "",
        preventionSteps: "",
      },
      CONTEXT,
    );

    expect(Object.keys(result).sort()).toEqual(
      ["fixApplied", "incidentEndTime", "incidentStartTime", "preventionSteps", "rootCauseCategory", "rootCauseDescription"].sort(),
    );
  });
});

describe("firstInvalidField", () => {
  it("returns null when there are no errors", () => {
    expect(firstInvalidField({})).toBeNull();
  });

  it("returns the first field in form order, not insertion order", () => {
    // preventionSteps set first, but incidentEndTime comes earlier in the form.
    expect(firstInvalidField({ preventionSteps: "x", incidentEndTime: "y" })).toBe("incidentEndTime");
  });
});
