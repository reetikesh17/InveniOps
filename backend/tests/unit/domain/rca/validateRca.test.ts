import { describe, expect, it } from "vitest";
import { validateRca, MIN_TEXT_FIELD_LENGTH } from "../../../../src/domain/rca/validateRca.js";
import { ROOT_CAUSE_CATEGORIES } from "../../../../src/domain/rca/types.js";
import type { RcaField, RcaRecord, RcaValidationContext, RcaValidationResult } from "../../../../src/domain/rca/types.js";

const FIRST_SIGNAL_AT = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-01-02T00:00:00.000Z");
const CONTEXT: RcaValidationContext = { firstSignalAt: FIRST_SIGNAL_AT, now: NOW };

const VALID_TEXT = "Restarted the connection pool after exhausting max connections.";

function validRca(overrides: Partial<RcaRecord> = {}): RcaRecord {
  return {
    incidentStartTime: new Date("2026-01-01T01:00:00.000Z"),
    incidentEndTime: new Date("2026-01-01T02:00:00.000Z"),
    rootCauseCategory: "INFRASTRUCTURE_FAILURE",
    rootCauseDescription: VALID_TEXT,
    fixApplied: VALID_TEXT,
    preventionSteps: VALID_TEXT,
    ...overrides,
  };
}

function fieldErrors(result: RcaValidationResult): RcaField[] {
  return result.valid ? [] : result.errors.map((error) => error.field);
}

describe("validateRca", () => {
  it("is valid for a fully-formed RCA", () => {
    const result = validateRca(validRca(), CONTEXT);
    expect(result).toEqual({ valid: true });
  });

  describe("incidentStartTime", () => {
    it("fails when undefined", () => {
      expect(fieldErrors(validateRca(validRca({ incidentStartTime: undefined }), CONTEXT))).toContain(
        "incidentStartTime",
      );
    });

    it("fails when null", () => {
      expect(fieldErrors(validateRca(validRca({ incidentStartTime: null }), CONTEXT))).toContain(
        "incidentStartTime",
      );
    });

    it("fails when an invalid Date", () => {
      const result = validateRca(validRca({ incidentStartTime: new Date("not-a-date") }), CONTEXT);
      expect(fieldErrors(result)).toContain("incidentStartTime");
    });

    it("passes when a valid Date", () => {
      expect(validateRca(validRca(), CONTEXT).valid).toBe(true);
    });
  });

  describe("incidentEndTime", () => {
    it("fails when undefined", () => {
      expect(fieldErrors(validateRca(validRca({ incidentEndTime: undefined }), CONTEXT))).toContain(
        "incidentEndTime",
      );
    });

    it("fails when an invalid Date", () => {
      const result = validateRca(validRca({ incidentEndTime: new Date("garbage") }), CONTEXT);
      expect(fieldErrors(result)).toContain("incidentEndTime");
    });

    it("passes when a valid Date", () => {
      expect(validateRca(validRca(), CONTEXT).valid).toBe(true);
    });
  });

  describe("rootCauseCategory", () => {
    it("fails when undefined", () => {
      expect(fieldErrors(validateRca(validRca({ rootCauseCategory: undefined }), CONTEXT))).toContain(
        "rootCauseCategory",
      );
    });

    it("fails when an empty string", () => {
      expect(fieldErrors(validateRca(validRca({ rootCauseCategory: "" }), CONTEXT))).toContain(
        "rootCauseCategory",
      );
    });

    it("fails when whitespace only", () => {
      expect(fieldErrors(validateRca(validRca({ rootCauseCategory: "   " }), CONTEXT))).toContain(
        "rootCauseCategory",
      );
    });

    it("fails when not a member of the enum", () => {
      const result = validateRca(validRca({ rootCauseCategory: "ALIEN_INVASION" }), CONTEXT);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]?.field).toBe("rootCauseCategory");
        expect(result.errors[0]?.message).toContain("must be one of");
      }
    });

    it.each(ROOT_CAUSE_CATEGORIES)("passes for the %s category", (category) => {
      expect(validateRca(validRca({ rootCauseCategory: category }), CONTEXT).valid).toBe(true);
    });
  });

  describe.each(["rootCauseDescription", "fixApplied", "preventionSteps"] as const)("%s", (field) => {
    it("fails when undefined", () => {
      expect(fieldErrors(validateRca(validRca({ [field]: undefined }), CONTEXT))).toContain(field);
    });

    it("fails when whitespace only", () => {
      expect(fieldErrors(validateRca(validRca({ [field]: "        " }), CONTEXT))).toContain(field);
    });

    it("fails when a single character", () => {
      expect(fieldErrors(validateRca(validRca({ [field]: "x" }), CONTEXT))).toContain(field);
    });

    it(`fails at ${MIN_TEXT_FIELD_LENGTH - 1} characters (one under the minimum)`, () => {
      const result = validateRca(validRca({ [field]: "a".repeat(MIN_TEXT_FIELD_LENGTH - 1) }), CONTEXT);
      expect(fieldErrors(result)).toContain(field);
    });

    it(`passes at exactly ${MIN_TEXT_FIELD_LENGTH} characters (the minimum)`, () => {
      const result = validateRca(validRca({ [field]: "a".repeat(MIN_TEXT_FIELD_LENGTH) }), CONTEXT);
      expect(result.valid).toBe(true);
    });

    it("trims surrounding whitespace before checking length", () => {
      const padded = `   ${"a".repeat(MIN_TEXT_FIELD_LENGTH)}   `;
      expect(validateRca(validRca({ [field]: padded }), CONTEXT).valid).toBe(true);
    });

    it("passes with meaningful text well over the minimum", () => {
      expect(validateRca(validRca({ [field]: VALID_TEXT }), CONTEXT).valid).toBe(true);
    });
  });

  describe("incidentEndTime must be strictly after incidentStartTime", () => {
    it("fails when end equals start", () => {
      const start = new Date("2026-01-01T01:00:00.000Z");
      const result = validateRca(
        validRca({ incidentStartTime: start, incidentEndTime: new Date(start) }),
        CONTEXT,
      );
      expect(fieldErrors(result)).toContain("incidentEndTime");
    });

    it("fails when end is before start", () => {
      const start = new Date("2026-01-01T01:00:00.000Z");
      const end = new Date(start.getTime() - 1000);
      const result = validateRca(validRca({ incidentStartTime: start, incidentEndTime: end }), CONTEXT);
      expect(fieldErrors(result)).toContain("incidentEndTime");
    });

    it("passes when end is exactly one second after start", () => {
      const start = new Date("2026-01-01T01:00:00.000Z");
      const end = new Date(start.getTime() + 1000);
      const result = validateRca(validRca({ incidentStartTime: start, incidentEndTime: end }), CONTEXT);
      expect(result.valid).toBe(true);
    });
  });

  describe("incidentStartTime cannot precede the work item's first signal", () => {
    it("fails when start is before firstSignalAt", () => {
      const start = new Date(FIRST_SIGNAL_AT.getTime() - 1000);
      const result = validateRca(
        validRca({ incidentStartTime: start, incidentEndTime: new Date(start.getTime() + 3_600_000) }),
        CONTEXT,
      );
      expect(fieldErrors(result)).toContain("incidentStartTime");
    });

    it("passes when start equals firstSignalAt exactly", () => {
      const start = new Date(FIRST_SIGNAL_AT.getTime());
      const result = validateRca(
        validRca({ incidentStartTime: start, incidentEndTime: new Date(start.getTime() + 3_600_000) }),
        CONTEXT,
      );
      expect(result.valid).toBe(true);
    });

    it("passes when start is after firstSignalAt", () => {
      expect(validateRca(validRca(), CONTEXT).valid).toBe(true);
    });
  });

  describe("neither timestamp may be in the future", () => {
    it("fails when incidentStartTime is after now", () => {
      const start = new Date(NOW.getTime() + 1000);
      const result = validateRca(
        validRca({ incidentStartTime: start, incidentEndTime: new Date(start.getTime() + 1000) }),
        CONTEXT,
      );
      expect(fieldErrors(result)).toContain("incidentStartTime");
    });

    it("fails when incidentEndTime is after now", () => {
      const result = validateRca(validRca({ incidentEndTime: new Date(NOW.getTime() + 1000) }), CONTEXT);
      expect(fieldErrors(result)).toContain("incidentEndTime");
    });

    // start == now forces any valid (> start) end to also be in the future,
    // so this boundary can only be isolated by checking that START itself
    // isn't flagged — not by asserting overall validity.
    it("does not flag incidentStartTime as 'in the future' when it equals now exactly", () => {
      const start = new Date(NOW.getTime());
      const end = new Date(start.getTime() + 1000);
      const result = validateRca(validRca({ incidentStartTime: start, incidentEndTime: end }), CONTEXT);
      expect(fieldErrors(result)).not.toContain("incidentStartTime");
    });

    it("passes when incidentEndTime equals now exactly", () => {
      const end = new Date(NOW.getTime());
      const start = new Date(end.getTime() - 1000);
      const result = validateRca(validRca({ incidentStartTime: start, incidentEndTime: end }), CONTEXT);
      expect(result.valid).toBe(true);
    });
  });

  it("reports every failing field at once, not just the first", () => {
    const result = validateRca(
      {
        incidentStartTime: undefined,
        incidentEndTime: undefined,
        rootCauseCategory: "",
        rootCauseDescription: "",
        fixApplied: "",
        preventionSteps: "",
      },
      CONTEXT,
    );

    expect(fieldErrors(result).sort()).toEqual(
      [
        "fixApplied",
        "incidentEndTime",
        "incidentStartTime",
        "preventionSteps",
        "rootCauseCategory",
        "rootCauseDescription",
      ].sort(),
    );
  });
});
