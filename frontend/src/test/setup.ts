import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount anything a test rendered, so the next test starts from a clean DOM
// (and timers/effects from the previous component don't leak across tests).
afterEach(() => {
  cleanup();
});
