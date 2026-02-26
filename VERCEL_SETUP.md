# Deploying Harmonia on Vercel

## 1. Create a Vercel Postgres Database

Because this app utilizes Prisma 7 and `@prisma/adapter-pg` in production, you must link it to a PostgreSQL database on Vercel:

1. Open your project dashboard in Vercel.
2. Navigate to the **Storage** tab.
3. Click **Create Database** and select **Postgres**.
4. Accept the defaults and click **Create**.
5. Once created, Vercel automatically maps the `POSTGRES_URL` to your app's environment variables. 
6. To make this work with Prisma, explicitly add a new environment variable named `DATABASE_URL` and set its value to your `POSTGRES_URL` (found in the Storage credentials tab).

*Note: For local testing, Harmonia is configured to use SQLite (`dev.db`). When deploying to Vercel, Prisma natively requires PostgreSQL due to the edge adapter setup.*

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
