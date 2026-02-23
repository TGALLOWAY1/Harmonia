# Database Setup (PostgreSQL)

Harmonia uses PostgreSQL with Prisma ORM and the `@prisma/adapter-pg` driver.

## Required environment variables

```env
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
```

**Important:** `DATABASE_URL` must be a valid PostgreSQL connection string. The SQLite `file:./dev.db` format is no longer supported. For local development, use a local Postgres instance or a hosted provider (Neon, Supabase, Vercel Postgres).

Optional for connection pooling (e.g. serverless):

```env
DIRECT_URL="postgresql://user:password@host:5432/database?sslmode=require"
```

## Local development

1. Create a Postgres database (local or hosted).
2. Set `DATABASE_URL` in `.env`.
3. Run migrations and seed:

```bash
npm run db:generate
npm run db:migrate:dev
npm run seed:dev
```

4. Start the app:

```bash
npm run dev
```

## Build

`npm run build` requires `DATABASE_URL` to be set to a valid Postgres URL. The build will fail if it is missing or invalid (e.g. a leftover `file:./dev.db`).

## Scripts

| Script | Purpose |
|--------|---------|
| `db:generate` | Generate Prisma Client |
| `db:migrate:dev` | Run migrations in dev (creates new migrations if schema changed) |
| `db:migrate:deploy` | Apply pending migrations (production) |
| `seed:dev` | Destructive seed – wipes and reseeds (dev only) |
| `seed:prod` | Non-destructive seed – upserts baseline content only |

## Deploying on Vercel

1. **Connect a Postgres database** (Neon, Supabase, or Vercel Postgres).
2. **Set `DATABASE_URL`** in Vercel Project Settings → Environment Variables for Production/Preview.
3. **Add build step for migrations** in `vercel.json` or your build command. Run migrations before the Next.js build:
   ```bash
   npx prisma generate && npx prisma migrate deploy && npm run build
   ```
   Or add a `build` script that includes `prisma migrate deploy` before `next build`.
4. **Bootstrap with `seed:prod`** only for first-time setup. Do **not** run `seed:prod` on every deploy. Run it manually once after creating the database, or via a one-off script.
