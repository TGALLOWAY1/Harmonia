# Deploying Harmonia on Vercel

## 1. Set `DATABASE_URL`

Add your PostgreSQL connection string in Vercel:

1. Open **Project Settings** → **Environment Variables**
2. Add `DATABASE_URL` for **Production** and **Preview**
3. Use a Postgres URL from Neon, Supabase, Vercel Postgres, or your provider  
   Example: `postgresql://user:password@host:5432/database?sslmode=require`

## 2. Run migrations in the build

Migrations must run before the Next.js build. In **Project Settings** → **Build & Development Settings** → **Build Command**, set:

```bash
npx prisma generate && npx prisma migrate deploy && npm run build
```

Alternatively, update `package.json`:

```json
"build": "prisma generate && prisma migrate deploy && next build"
```

## 3. Bootstrap with `seed:prod` (first time only)

For a new database, run the non-destructive prod seed **once** after deployment:

```bash
npm run seed:prod
```

This upserts baseline content (milestones, card templates). **Do not** run `seed:prod` on every deploy. Run it manually once after creating the database.
