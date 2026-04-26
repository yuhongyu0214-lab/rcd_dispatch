# Repo Bootstrap Design

## 1. Background

This repository is currently a document-only workspace for the dispatch system. The current branch goal is to build a stable engineering foundation that supports follow-up feature work without introducing premature business complexity.

The user-provided bootstrap checklist defines five ordered delivery stages:

1. Runnable project
2. Database connectivity
3. Login flow
4. Clear directory structure
5. Stable engineering conventions

The implementation should strictly follow that sequence and stop short of full business modeling, map integration, complex component systems, or production-grade permission design.

## 2. Goals

This bootstrap work is successful when all of the following are true:

- `pnpm dev` starts successfully
- `http://localhost:3000` is reachable
- Prisma can connect to PostgreSQL
- seed data can create the default admin account
- `/api/health` returns a successful database status payload
- `/auth/signin` is reachable
- the default account can sign in and reach `/admin`
- the base project structure is clear and reusable
- linting and formatting rules are stable enough for follow-up work

## 3. Non-Goals

The following work is explicitly out of scope for this bootstrap:

- complete business table design
- dispatch engine implementation
- map frontend integration
- complex UI component system
- bcrypt or stronger password hashing in this phase
- production-grade RBAC or permission matrix
- full domain model implementation from the PRD documents

## 4. Recommended Approach

Three implementation approaches were considered:

### Approach A: Strict staged bootstrap

Build the repository in the exact order defined by the checklist, with each stage validated before moving to the next.

Pros:

- lowest delivery risk
- easiest to debug
- naturally aligns with staged acceptance
- minimizes cross-stage coupling

Cons:

- some supporting structure is deferred until later stages

### Approach B: Full skeleton upfront

Create app, database, auth, utility, and component scaffolding in one pass before validation.

Pros:

- structure appears complete early

Cons:

- harder to isolate failures
- higher refactor risk if an early assumption is wrong

### Approach C: Generate-first, reconcile-later

Use official generators first, then reshape files to match the checklist.

Pros:

- fastest initial scaffold

Cons:

- generated output may not match the planned structure
- later cleanup adds avoidable churn

### Recommendation

Use Approach A. It best matches the staged checklist, the user's preference for phased acceptance, and the requirement to keep scope tight.

## 5. Tooling Compatibility Baseline

The bootstrap should use a conservative, internally consistent stack rather than mixing the newest defaults from different ecosystems.

### 5.1 Core stack

- Next.js with App Router
- TypeScript
- Tailwind CSS
- ESLint
- Prettier
- Prisma
- PostgreSQL
- Auth.js with Credentials provider

### 5.2 Compatibility decisions

- Tailwind should follow the `tailwind.config.ts` pattern from the checklist, so the implementation should stay on the Tailwind v3-style configuration path.
- ESLint should follow the `.eslintrc.json` format from the checklist rather than switching to flat config during bootstrap.
- Prisma should be the single ORM and database access layer.
- Database access must be centralized through `src/lib/prisma.ts`.
- Auth setup must be internally consistent across route handlers, middleware, session handling, and environment variable usage.

### 5.3 Versioning principle

Use stable versions that work together cleanly. Do not optimize for newest syntax if it conflicts with the checklist structure or increases integration risk.

## 6. Target Architecture

The repository should evolve into a minimal but expandable application with four foundational layers:

### 6.1 App layer

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`
- route handlers under `src/app/api/...`
- auth pages under `src/app/auth/...`
- protected admin entry under `src/app/admin/...`

### 6.2 Infrastructure layer

- `src/lib/prisma.ts`
- `src/lib/auth.ts`
- `src/lib/logger.ts`
- `src/lib/api-response.ts`
- `src/lib/utils.ts`

### 6.3 Type layer

- `src/types/index.ts`

### 6.4 Data layer

- `prisma/schema.prisma`
- `prisma/seed.js`

This keeps framework concerns, infrastructure concerns, and persistence concerns separated from the start.

## 7. Stage Plan

### 7.1 Stage 1: Runnable project

Objective:

- make `pnpm dev` work
- make the homepage reachable

Files:

- `package.json`
- `tsconfig.json`
- `next.config.mjs`
- `tailwind.config.ts`
- `.eslintrc.json`
- `.prettierrc`
- `.gitignore`
- `.env.example`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`

Acceptance:

- `pnpm install` succeeds
- `pnpm dev` starts without boot errors
- homepage opens in the browser

Constraints:

- no database dependency yet
- no auth dependency yet
- keep UI minimal

### 7.2 Stage 2: Database connectivity

Objective:

- connect Prisma to PostgreSQL
- add the minimum persistent user model
- provide a health-check endpoint

Files:

- `prisma/schema.prisma`
- `prisma/seed.ts`
- `src/lib/prisma.ts`
- `src/app/api/health/route.ts`

Acceptance:

- `pnpm db:migrate` succeeds
- `pnpm db:seed` succeeds
- Prisma Studio can view the `User` table
- `/api/health` reports successful database connectivity

Constraints:

- only create the minimum `User` model
- do not add full business tables
- keep the API response shape stable from the first endpoint

### 7.3 Stage 3: Login flow

Objective:

- provide a working sign-in page
- allow the seeded admin user to sign in
- protect `/admin`

Files:

- `src/lib/auth.ts`
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/auth/signin/page.tsx`
- `src/app/admin/page.tsx`
- `src/middleware.ts`

Acceptance:

- `/auth/signin` opens
- default admin credentials can sign in
- successful sign-in redirects to `/admin`
- unauthenticated access to `/admin` is redirected to `/auth/signin`

Constraints:

- Credentials-based login only
- plaintext password comparison is acceptable in this phase
- no bcrypt yet
- no broad route protection beyond the minimum required scope

### 7.4 Stage 4: Clear directory structure

Objective:

- add shared infrastructure and type boundaries
- make future features easier to place correctly

Files:

- `src/lib/logger.ts`
- `src/lib/api-response.ts`
- `src/lib/utils.ts`
- `src/types/index.ts`
- minimal files under `src/components/layout/`
- optional minimal placeholder under `src/components/ui/`

Acceptance:

- common concerns are separated by responsibility
- future feature code has an obvious home

Constraints:

- do not introduce an oversized component architecture
- only add abstractions that are already justified by current code

Approved implementation direction for Stage 4 on 2026-04-25:

- keep Stage 4 as a lightweight boundary-setting pass rather than a broad refactor
- add only the shared files that already solve visible duplication or drift in the current repository
- use the new shared pieces immediately in existing pages and route handlers so the structure is proven, not theoretical
- keep README structure and stage documentation aligned with the landed repository state

Stage 4 file contracts:

- `src/lib/logger.ts`: single logging entry point backed by pino, configured via `LOG_LEVEL` environment variable
- `src/lib/api-response.ts`: helpers for the stable `{ success, data, error, traceId }` response envelope
- `src/lib/utils.ts`: small non-domain helpers only; start with class name composition and avoid generic utility dumping
- `src/types/index.ts`: shared transport and infrastructure-facing types only, not business-domain modeling
- `src/components/layout/page-shell.tsx`: reusable page-level shell for repeated width, spacing, and viewport layout
- `src/components/layout/section-card.tsx`: reusable content card for repeated bordered sections
- `src/components/ui/status-badge.tsx`: one minimal presentational primitive used by the bootstrap pages

Stage 4 integration rules:

- `src/app/page.tsx` and `src/app/admin/page.tsx` should consume the shared layout components
- `src/app/api/health/route.ts` should consume the API response helper and shared error logging entry point
- the sign-in page may stay specialized, but should remain compatible with the shared layout direction
- do not add a barrel-export layer during bootstrap
- do not add `shadcn/ui` or other new UI frameworks in this stage

### 7.5 Stage 5: Stable conventions

Objective:

- align documentation, environment variables, linting, and formatting

Files:

- `.env.example`
- `.eslintrc.json`
- `.prettierrc`
- `README.md`

Acceptance:

- `pnpm lint` passes
- README matches the actual commands and structure
- a new developer can bootstrap the project from the documented steps

Constraints:

- keep rules minimal and stable
- avoid style rules that create friction without immediate value

Approved implementation direction for Stage 5 on 2026-04-25:

- treat Stage 5 as a documentation and rules consolidation pass only
- align the written instructions with the repository exactly as landed after Stages 1 through 4
- keep the current ESLint and Prettier setup, but do not expand it with more tooling in this phase
- document the real bootstrap flow for a new developer from install through login verification

Stage 5 scope rules:

- allowed: clarifying `README.md`, refining `.env.example`, and tightening the wording in this main spec
- allowed: documenting the exact commands already present in `package.json`
- allowed: clarifying what is intentionally deferred to later branches
- not allowed: adding new lint scripts, format scripts, commit hooks, staged-file automation, or new dependencies
- not allowed: using Stage 5 as a reason to add more abstractions or refactor active application code

Stage 5 documentation contract:

- `README.md` must document the bootstrap steps in the same order as the staged implementation
- `README.md` must describe the actual default admin credentials, including both email and phone login
- `README.md` must describe the current repository structure without referencing files or tools that are not present
- `.env.example` must list the bootstrap baseline variables and remain safe to copy into `.env.local`
- `.eslintrc.json` and `.prettierrc` should remain intentionally small; their role should be explained rather than expanded

Stage 5 acceptance refinement:

- `pnpm lint` passes without requiring additional scripts
- a developer can follow `README.md` to install dependencies, configure `.env.local`, run migrations, seed the database, start the app, and verify the login flow
- Stage 5 documentation does not promise tooling that is not yet in the repository

## 8. Data Design for Bootstrap

Only one business-adjacent persistence model is needed in this phase: `User`.

### 8.1 Minimum `User` model intent

The user model must support Stage 2 seeding and Stage 3 credentials login without schema churn.

Recommended minimum fields:

- `id`
- `email`
- `name`
- `password`
- `role`
- `createdAt`
- `updatedAt`

### 8.2 Seed contract

The seed script should create a default administrator account:

- email: `admin@dispatch.dev`
- password: `admin123`

The login logic must validate against the same fields produced by the seed script. The seed and auth implementation must not diverge on field names or assumptions.

## 9. API Compatibility Rules

API behavior should become consistent starting with the first route handler added during Stage 2.

### 9.1 Response shape

Use a stable JSON response contract:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

### 9.2 Health endpoint

`/api/health` should verify:

- route handler execution works
- server-side code can access Prisma
- PostgreSQL connectivity is healthy

Recommended successful payload:

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

## 10. Authentication Compatibility Rules

Authentication must be treated as one connected slice rather than a set of separate files.

### 10.1 Required moving parts

- auth configuration in `src/lib/auth.ts`
- route handler export in `src/app/api/auth/[...nextauth]/route.ts`
- sign-in page in `src/app/auth/signin/page.tsx`
- middleware guard in `src/middleware.ts`
- session-aware admin page in `src/app/admin/page.tsx`

### 10.2 Hard rules

- only Credentials auth is in scope
- the seeded admin account is the source of truth for initial login
- middleware should only protect `/admin` in this phase
- implementation should avoid mixing incompatible old and new Auth.js patterns

### 10.3 Environment variables

The checklist explicitly expects:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `AMAP_SERVER_KEY`

To reduce integration risk, the auth implementation should keep `NEXTAUTH_SECRET` as a documented requirement for this bootstrap. If runtime compatibility requires aliasing or dual support later, that can be added without changing the documented baseline.

### 10.4 Stage 3 refinement approved on 2026-04-25

The Stage 3 login flow has the following confirmed implementation details:

- one identifier field must accept either email or phone
- the seeded admin account must support both login modes
- the minimum bootstrap `User` model must include `phone` as a required unique string field
- `/admin` is the only route protected by middleware in this stage
- plaintext password comparison remains acceptable for bootstrap validation
- logout UX, password reset, and broader account management remain out of scope

The bootstrap admin seed contract for Stage 3 is:

- email: `admin@dispatch.dev`
- phone: `13800000000`
- password: `admin123`

Stage 3 validation must confirm all of the following:

- `/auth/signin` renders successfully
- sign-in works with `admin@dispatch.dev` and `admin123`
- sign-in also works with `13800000000` and `admin123`
- successful sign-in reaches `/admin`
- unauthenticated access to `/admin` redirects to `/auth/signin`

## 11. Dependency Flow

The stages have strict forward-only dependencies:

- Stage 1 depends only on the app toolchain
- Stage 2 depends on Stage 1 plus PostgreSQL access
- Stage 3 depends on Stage 2 because login requires the seeded user and database connectivity
- Stage 4 depends on the earlier stages being behaviorally stable
- Stage 5 finalizes the rules and documentation that describe the working result

This means Stage 2 must not start before Stage 1 is validated, and Stage 3 must not start before the `User` model and seed script are proven to work.

## 12. Risks and Controls

### 12.1 Tailwind mismatch risk

Risk:

- installing a configuration style that does not match the planned `tailwind.config.ts` structure

Control:

- keep Tailwind on the configuration path expected by the checklist

### 12.2 ESLint config drift risk

Risk:

- switching to flat config while the repository and checklist expect `.eslintrc.json`

Control:

- keep the bootstrap on `.eslintrc.json`

### 12.3 Auth environment mismatch risk

Risk:

- auth files compile, but login fails because documented and runtime environment variables diverge

Control:

- treat `NEXTAUTH_SECRET` as the bootstrap baseline and keep auth file assumptions aligned with it

### 12.4 Schema churn risk

Risk:

- Stage 2 creates a `User` model that does not support Stage 3 login

Control:

- define the minimum login-compatible fields before writing the Prisma schema

### 12.5 Scope creep risk

Risk:

- adding domain models, map integration, or abstraction layers too early

Control:

- enforce the non-goals section and only build the minimum needed for each stage exit condition

## 13. External Inputs Required

The following user-provided information is required before or during execution:

- Stage 1: no additional input required
- Stage 2: a valid local PostgreSQL connection string for `DATABASE_URL`
- Stage 3: no extra input required if the seed account remains the default bootstrap account

## 14. Validation Strategy

Each stage should be validated before moving to the next one.

### 14.1 Stage 1 validation

- install dependencies
- run the dev server
- open the homepage

### 14.2 Stage 2 validation

- run database migration
- run seed script
- inspect data in Prisma Studio
- call `/api/health`

### 14.3 Stage 3 validation

- open `/auth/signin`
- sign in with the seeded account
- verify redirect to `/admin`
- verify middleware protection when signed out

### 14.4 Stage 4 validation

- verify the new shared files compile and are imported by active application code
- confirm homepage and admin page render correctly after extracting shared layout primitives
- confirm `/api/health` still returns the stable response contract through the shared helper
- confirm README directory structure matches the repository after the Stage 4 scaffold lands

### 14.5 Stage 5 validation

- run lint
- review `.env.example` against the variables actually documented for bootstrap
- confirm README matches real commands and files
- confirm README describes the dual-login bootstrap account and current scope limits

## 15. Final Implementation Rules

The bootstrap implementation should follow these rules throughout:

- build only what the current stage requires
- prefer stable compatibility over newest conventions
- keep data, auth, and API boundaries explicit
- centralize database and auth entry points
- use phased acceptance after each stage
- do not introduce business-domain complexity early

## 16. Decision Summary

The approved implementation direction is:

- PostgreSQL as the database
- phased acceptance after each stage
- strict stage order from runnable project to stable conventions
- conservative stack alignment to preserve compatibility
- minimal `User` model first, then credentials auth
- shared engineering rules introduced only when justified by active code
