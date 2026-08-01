import { MechanicStrip } from "./MechanicStrip";
import { DataArchitecture } from "./DataArchitecture";
import { Lifecycle } from "./Lifecycle";
import { MeasuredNumbers } from "./MeasuredNumbers";
import { Stack } from "./Stack";
import { Footer } from "./Footer";

// Bundled into one lazy chunk (see LandingPage.tsx) rather than one per
// section — these six are always consumed together, on scroll, so one
// deferred request beats a waterfall of six.
export default function BelowFold(): JSX.Element {
  return (
    <>
      <MechanicStrip />
      <DataArchitecture />
      <Lifecycle />
      <MeasuredNumbers />
      <Stack />
      <Footer />
    </>
  );
}
