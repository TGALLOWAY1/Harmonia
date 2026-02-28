# Database Setup (SQLite Local + Postgres Production)

Harmonia uses Prisma with an environment-driven provider.
`prisma.config.ts` selects `prisma/schema.prisma` (SQLite) or `prisma/schema.postgres.prisma` (Postgres) from `DATABASE_PROVIDER` / `DATABASE_URL`.

## Environment variables

```env
DATABASE_PROVIDER="sqlite"      # or "postgresql"
DATABASE_URL="file:./dev.db"    # local SQLite example
```

Production example:

```env
DATABASE_PROVIDER="postgresql"
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
```

## Local development (SQLite)

1. Set `.env`:
   - `DATABASE_PROVIDER=sqlite`
   - `DATABASE_URL=file:./dev.db`
2. Sync schema:
   - `npm run db:push`
3. Seed:
   - `npm run seed:dev`
4. Start app:
   - `npm run dev`

## Production / Vercel (Postgres)

1. Provision hosted Postgres (Neon, Supabase, Vercel Postgres).
2. Set env vars:
   - `DATABASE_PROVIDER=postgresql`
   - `DATABASE_URL=<hosted-postgres-url>`
3. Deploy with migration step:
   - `npx prisma generate && npx prisma migrate deploy && npm run build`
4. Bootstrap with seed once:
   - `npm run seed:prod`

## Migration workflow note

Prisma migration history is provider-specific.  
Use this split workflow:

- SQLite local: `prisma db push`
- Postgres production: `prisma migrate deploy`

## Scripts

| Script | Purpose |
|--------|---------|
| `db:generate` | Generate Prisma Client |
| `db:push` | Push schema to current datasource (SQLite local) |
| `db:migrate:dev` | Create/apply dev migrations (Postgres workflow) |
| `db:migrate:deploy` | Apply pending migrations (production Postgres) |
| `seed:dev` | Destructive seed – wipes and reseeds (dev only) |
| `seed:prod` | Non-destructive baseline seed upsert |
