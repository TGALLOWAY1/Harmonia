import { Suspense } from "react";
import PracticeClient from "./PracticeClient";

export default function PracticePage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <PracticeClient />
    </Suspense>
  );
}
