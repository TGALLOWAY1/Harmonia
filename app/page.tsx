import Link from "next/link";
import { PianoRollDemo } from "@/components/piano-roll/PianoRollDemo";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-16 space-y-12">
        {/* Hero */}
        <section className="bg-surface border border-subtle rounded-2xl shadow-sm p-8 md:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-subtle px-3 py-1 text-xs font-medium text-muted mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            Harmonia · Music theory for producers
          </div>
          <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-4">
            Learn harmony visually.
          </h1>
          <p className="text-muted max-w-2xl mb-6">
            Harmonia helps you internalize scales, chords, and the circle of fifths
            using a piano-roll interface, spaced repetition, and producer–friendly
            examples for EDM and bass music.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/practice"
              className="inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium bg-foreground text-surface hover:-translate-y-0.5 hover:shadow-md transition"
            >
              Start practicing
            </Link>
            <Link
              href="/circle"
              className="inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium border border-subtle text-foreground bg-surface hover:bg-surface-muted transition"
            >
              Explore the circle of fifths
            </Link>
          </div>
        </section>

        {/* Launchpad */}
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-medium">What would you like to work on?</h2>
            <p className="text-xs text-muted">
              All core pages are accessible from here.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Curriculum / Learn */}
            <HomeNavCard
              href="/learn"
              title="Learn path"
              badge="Curriculum"
              description="Follow a structured path through notes, scales, chords, and the circle of fifths. Great when you want a clear next step."
            />

            {/* Flashcard practice */}
            <HomeNavCard
              href="/practice"
              title="Practice cards"
              badge="Daily SRS"
              description="Run through smart flashcards with spaced repetition to actually remember chord spellings, key signatures, and circle relationships."
            />

            {/* Circle of Fifths */}
            <HomeNavCard
              href="/circle"
              title="Circle of fifths"
              badge="Visualization"
              description="See how keys relate on the circle, view diatonic chords, and preview scales on the piano roll for any key."
            />

            {/* Chord progression generator */}
            <HomeNavCard
              href="/progression"
              title="Chord progression generator"
              badge="Generator"
              description="Generate 4-chord progressions by key and scale. Mood-biased Markov logic with sharps-only note output."
            />

            {/* Progress */}
            <HomeNavCard
              href="/progress"
              title="Progress & stats"
              badge="Analytics"
              description="Check accuracy, review load, and recent activity to see how your theory practice is trending over time."
            />
          </div>
        </section>
      </div>

      {/* Piano Roll Demo - wider container */}
      <div className="max-w-7xl mx-auto px-6 pb-16">
        <section className="space-y-4">
          <PianoRollDemo />
        </section>
      </div>
    </main>
  );
}

type HomeNavCardProps = {
  href: string;
  title: string;
  badge: string;
  description: string;
};

function HomeNavCard({ href, title, badge, description }: HomeNavCardProps) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-subtle bg-surface p-5 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="text-[10px] uppercase tracking-wide text-muted border border-subtle rounded-full px-2 py-0.5">
          {badge}
        </span>
      </div>
      <p className="text-sm text-muted leading-relaxed">{description}</p>
      <div className="mt-4 text-xs font-medium text-muted group-hover:text-foreground inline-flex items-center gap-1">
        Open
        <span aria-hidden="true">↗</span>
      </div>
    </Link>
  );
}

