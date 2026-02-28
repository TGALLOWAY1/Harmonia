# Chord Flashcard Dataset Plan (chords_v1)

## Goal
Add a deterministic beginner chord flashcard dataset for:
- `notes_from_chord` (Chord name -> Notes)
- `chord_from_notes` (Notes -> Chord name)

Scope includes triads and common seventh chords, seeded into `CardTemplate` and compatible with local SQLite and production Postgres.

## Repo Audit Findings

### 1. CardTemplate seed/create paths
- `prisma/seed-shared.ts`: central seed logic for both `seed.dev.ts` and `seed.prod.ts`.
- `lib/cards/seedTemplates.ts`: static + advanced template definitions and option generation.
- `prisma/seed.dev.ts`: destructive dev seed entrypoint.
- `prisma/seed.prod.ts`: non-destructive prod seed entrypoint.

### 2. Existing chord card kinds
- `notes_from_chord`
- `chord_from_notes`

Defined/used in:
- `lib/cards/cardKinds.ts`
- `lib/cards/seedTemplates.ts`

### 3. Practice UI card contract
- `GET /api/cards/next` returns:
  - `question`
  - `options` (4 strings)
  - `correctIndex`
  - `meta`
- Source: `app/api/cards/next/route.ts`
- Consumed by:
  - `app/practice/PracticeClient.tsx`
  - `components/practice/FlashcardRenderer.tsx`
  - `components/flashcards/Flashcard.tsx`

### 4. Milestone filtering wiring
- `/practice?milestone=TRIADS` -> `/api/cards/next?milestoneKey=TRIADS`
- Implemented in `app/practice/PracticeClient.tsx`
- API filtering implemented in `app/api/cards/next/route.ts` with `where: { milestoneKey }`.

### 5. Pitch-class spelling policy
- Canonical internal pitch classes are sharps-only (`C, C#, D, ...`).
- Source: `lib/theory/midiUtils.ts` (`PitchClass`, `PITCH_CLASSES`).
- Flat labels are allowed for display-only distractors; internal `meta.notes` remains sharps-only.

### 6. Hard constraints discovered
- Runtime DB was previously SQLite adapter-locked in `lib/db.ts`.
- Prisma provider mismatch exists in repo history:
  - `prisma/schema.prisma` had SQLite provider
  - `prisma/migrations/migration_lock.toml` tracks PostgreSQL
  - This breaks `prisma migrate` cross-provider.
- `buildSeventhFromRoot` was missing; `/api/theory/chord` returned empty note sets for seventh qualities.

## Implemented Design

### Dataset generator
- New module: `lib/flashcards/chordCardGenerator.ts`
- Export: `generateChordCardTemplates(): Prisma.CardTemplateCreateInput[]`
- Deterministic loops:
  - Triads: 12 roots x 4 qualities x 2 directions = 96
  - Sevenths: 12 roots x 3 qualities x 2 directions = 72
  - Total: 168
- Milestones:
  - Triads -> `TRIADS`
  - Sevenths -> `SEVENTH_CHORDS`

### Theory source of truth
- Triads: `buildTriadFromRoot`
- Sevenths: `buildSeventhFromRoot`
- Symbols: `formatChordSymbol`

### Meta schema for `chords_v1`
- `dataset: "chords_v1"`
- `root`
- `quality`
- `notes` (sharps-only pitch classes)
- `degrees`
- `formula`
- `chordType` (`triad` or `seventh`)
- `display: { name, symbol }`

### Slug strategy
- `chords-v1-typeA-{rootSafe}-{quality}`
- `chords-v1-typeB-{rootSafe}-{quality}`
- `#` is encoded as `-sharp`.

### Deterministic distractors
- For `notes_from_chord`:
  1. Same root, different quality
  2. Same quality, root + 1 semitone
  3. One-note mutation (3rd for triads, 7th for sevenths)
- For `chord_from_notes`:
  1. Same root, different quality label
  2. Same quality, root + 2 semitones
  3. Enharmonic mislabeled trap (flat display label when possible)
- Fallback pool ensures:
  - 4 options always present
  - options are unique
  - deterministic ordering

## Seeding Integration
- Added `seedChordCards(mode)` in `prisma/seed-shared.ts`.
- Uses `generateChordCardTemplates()`.
- Dev mode:
  - Existing full wipe remains
  - `chords_v1` inserted during seed run
- Prod mode:
  - Deletes existing `chords-v1-` slug templates
  - Upserts regenerated templates idempotently
  - Leaves unrelated templates intact

No runtime/API route seeding was added.

## UI Reveal Enhancement
- Updated `components/flashcards/Flashcard.tsx`.
- For `notes_from_chord` and `chord_from_notes`, after reveal:
  - shows "Answer details"
  - chord name + symbol
  - notes (`C – E – G`)
  - formula string
- Existing `circle_` card rendering remains unchanged.

## Storage Compatibility

### Environment-driven provider
- `prisma.config.ts` now selects schema by environment:
  - SQLite -> `prisma/schema.prisma`
  - PostgreSQL -> `prisma/schema.postgres.prisma`
- `.env` local defaults:
  - `DATABASE_PROVIDER="sqlite"`
  - `DATABASE_URL="file:./dev.db"`

### Runtime adapter selection
- `lib/db.ts` now picks adapter by provider/URL:
  - SQLite -> `@prisma/adapter-better-sqlite3`
  - PostgreSQL -> `@prisma/adapter-pg`

### Package/script updates
- Added dependency in `package.json`:
  - `@prisma/adapter-pg`
- Added script:
  - `db:push` -> `prisma db push`

### Migration workflow note
- Local SQLite: use `prisma db push`
- Production Postgres: use `prisma migrate deploy`
- Reason: migration history is provider-specific.

## Verification Checklist

### Local (SQLite)
1. `npx prisma db push`
2. `npx prisma db seed`
3. Verify counts:
   - Triads: 96
   - Sevenths: 72
   - Total `chords_v1`: 168

### Spot checks
- C major triad -> `C – E – G`
- A minor 7 -> `A – C – E – G`
- G dominant 7 -> `G – B – D – F`

### Practice filtering
- `/practice?milestone=TRIADS` -> triad cards
- `/practice?milestone=SEVENTH_CHORDS` -> seventh cards
