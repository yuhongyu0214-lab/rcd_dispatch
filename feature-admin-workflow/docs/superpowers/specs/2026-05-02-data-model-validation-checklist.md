# Data Model Validation Checklist

## 1. Goal

This checklist is used to validate the `feature/data-model` phase after the schema, migration, rollback script, and seed updates are in place.

It focuses on whether the current repository can:

- load the required environment correctly
- apply the data-model migration successfully
- seed minimum master data successfully
- expose the expected Prisma models
- return a healthy database status from `/api/health`
- keep a usable rollback path for the new schema additions

## 2. Preconditions

Before running this checklist, confirm all of the following:

- project root is `C:\Users\yhy\Desktop\人车单生态\feature-data-model`
- `.env.local` exists in the project root
- `.env.local` contains a real `DATABASE_URL`
- PostgreSQL is reachable from the current machine
- the target database user has permission to create tables, indexes, and enum types
- dependencies are installed with `pnpm install`

Recommended minimum `.env.local` keys:

```env
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<db>"
NEXTAUTH_SECRET="dev-secret"
AMAP_SERVER_KEY="dev-key"
```

## 3. Validation Steps

### 3.1 Environment validation

Run:

```bash
pnpm prisma validate
```

Pass when:

- Prisma can read `DATABASE_URL`
- schema validation succeeds with no environment-variable error

Fail signals:

- `Environment variable not found: DATABASE_URL`
- malformed connection string errors

### 3.2 Migration validation

Run:

```bash
pnpm db:migrate
```

Pass when:

- migration completes without SQL errors
- the new migration directory is accepted by Prisma
- no existing `User` data is destroyed

Manual checks:

- verify the database now contains:
  - `User`
  - `Store`
  - `Driver`
  - `Vehicle`
  - `Order`
  - `Assignment`
  - `OperationLog`

### 3.3 Seed validation

Run:

```bash
pnpm db:seed
```

Pass when:

- seed completes successfully
- admin user is upserted
- stores are upserted
- drivers are upserted
- vehicles are upserted

Expected minimum seed outcome:

- 1 admin user
- 2 stores
- 3 drivers
- 2 vehicles

### 3.4 Prisma Studio validation

Run:

```bash
pnpm db:studio
```

Pass when:

- Prisma Studio opens successfully
- the following models are visible:
  - `User`
  - `Store`
  - `Driver`
  - `Vehicle`
  - `Order`
  - `Assignment`
  - `OperationLog`

Data checks:

- `User.password` is no longer stored as plaintext
- `Store.code` is unique
- `Driver.phone` is unique
- `Vehicle.licensePlate` is unique

### 3.5 App runtime validation

Run:

```bash
pnpm dev
```

Then verify:

- `http://localhost:3000` returns `200`
- homepage renders normally

Pass when:

- the dev server starts successfully
- no startup crash occurs from Prisma client initialization

### 3.6 Health endpoint validation

With the dev server running, open:

```text
http://localhost:3000/api/health
```

Pass when the response is:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "db": "connected"
  },
  "error": null
}
```

Fail signals:

- authentication failed against database server
- connection refused
- missing `DATABASE_URL`

### 3.7 Rollback artifact validation

Check these files exist:

- `prisma/migrations/20260502120000_data_model_core/migration.sql`
- `prisma/migrations/20260502120000_data_model_core/rollback.sql`

Pass when:

- `rollback.sql` exists
- it only targets this phase's newly introduced tables and enums
- it does not drop `User`

### 3.8 Optional data-model expression validation

After migration and seed, optionally create a small manual scenario in Prisma Studio:

1. create one `Order` in `PENDING`
2. create one `Assignment`
3. point `Order.currentAssignmentId` to that assignment
4. create one `OperationLog`

Pass when:

- one order can reference multiple assignment-history records
- `currentAssignmentId` can point to the active assignment
- `OperationLog` can attribute the action to a `User`

## 4. Quick Pass Checklist

- [ ] `.env.local` exists
- [ ] `DATABASE_URL` is real and reachable
- [ ] `pnpm prisma validate` passes
- [ ] `pnpm db:migrate` passes
- [ ] `pnpm db:seed` passes
- [ ] `pnpm db:studio` opens
- [ ] `User` / `Store` / `Driver` / `Vehicle` / `Order` / `Assignment` / `OperationLog` all exist
- [ ] `pnpm dev` starts
- [ ] `/` returns `200`
- [ ] `/api/health` returns database-connected JSON
- [ ] `rollback.sql` exists and does not target `User`

## 5. Common Failure Map

### Symptom: `DATABASE_URL` not found

Likely cause:

- `.env.local` missing
- file name is wrong
- `DATABASE_URL` key missing from `.env.local`

### Symptom: database authentication failed

Likely cause:

- username or password in `DATABASE_URL` is wrong
- target database does not exist
- PostgreSQL service is not running

### Symptom: seed fails after migration succeeds

Likely cause:

- bcrypt dependency not installed correctly
- unique-key conflict caused by manual dirty data
- migration and schema are out of sync with the current database

### Symptom: `/api/health` fails but homepage works

Likely cause:

- Next.js runtime is healthy
- Prisma can compile
- actual database connectivity is still broken

## 6. Completion Standard

The `feature/data-model` phase can be considered locally validated when all items in the quick pass checklist are true.
