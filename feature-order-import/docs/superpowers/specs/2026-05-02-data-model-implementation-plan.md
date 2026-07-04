# Data Model Implementation Plan

> **Changelog**
> | Date | Note |
> |------|------|
> | 2026-05-02 | Initial version based on approved data-model design |

## 1. Plan Goal

This plan turns [2026-05-02-data-model-design.md](./2026-05-02-data-model-design.md) into executable implementation steps for the current repository.

The goal of this phase is to complete the first full business data model for `feature/data-model` without pulling import APIs, map workflows, or dispatch algorithms into scope.

This plan does include:

- Prisma schema expansion
- migration generation and review
- rollback SQL alongside the migration
- seed updates
- the minimum authentication updates required for bcrypt compatibility
- validation steps for schema, migration, seed, and bootstrap login regression

This plan does not include:

- order import APIs
- admin import pages
- dispatch recommendation services
- driver workflow APIs
- coordinate storage or geocoding logic

## 2. Execution Principles

- change the schema first, then generate migration artifacts, then update seed and auth compatibility
- keep the current bootstrap login path working throughout the phase
- implement only the persistence required by the approved design
- preserve history and auditability over convenience shortcuts
- prefer deterministic validation over broad speculative test scaffolding

## 3. Deliverables

This phase should produce:

- updated `prisma/schema.prisma`
- one new Prisma migration directory for the core data model
- `rollback.sql` inside that migration directory
- updated `prisma/seed.js`
- minimum auth-path updates needed for bcrypt verification
- any minimal script or README adjustment required to keep the workflow accurate

## 4. File Scope

### 4.1 Required edits

- `prisma/schema.prisma`
- `prisma/seed.js`

### 4.2 Conditional edits

- `package.json`
- `src/lib/auth.ts`
- `src/app/api/auth/[...nextauth]/route.ts`

Notes:

- `package.json` currently hardcodes `db:migrate` to `--name init-user`; if that blocks correct migration naming, it should be adjusted or bypassed with direct Prisma commands during implementation
- auth files only change as much as needed to keep seeded-user login working after password hashing moves to bcrypt

### 4.3 Generated artifacts

- `prisma/migrations/<timestamp>_data_model_core/migration.sql`
- `prisma/migrations/<timestamp>_data_model_core/rollback.sql`

### 4.4 Out of scope files

- order import routes
- admin order pages
- dispatch services
- map components
- driver mobile workflow code

## 5. Workstreams

### 5.1 Workstream A: Schema Expansion

Objective:

- evolve the repository from a bootstrap `User`-only schema to the approved core business model

Tasks:

- keep the existing `User` model and fields compatible
- add enums:
  - `DriverStatus`
  - `VehicleStatus`
  - `OrderType`
  - `OrderStatus`
  - `AssignmentType`
  - `AssignmentStatus`
  - `OperationEntityType`
  - `OperationAction`
- add models:
  - `Store`
  - `Driver`
  - `Vehicle`
  - `Order`
  - `Assignment`
  - `OperationLog`
- add relation names where Prisma would otherwise see ambiguity
- add default values, unique constraints, and indexes from the approved design

Key implementation notes:

- `Order.currentAssignmentId` and `Assignment.orderId` create two distinct relations between the same model pair, so both relations must be explicitly named
- `OperationLog` uses `entityType + entityId` instead of hard foreign keys to every target entity
- `vehicleType` remains `String`
- `UNIMPORTED` does not become a persisted enum value in this phase

Done when:

- Prisma schema validates without relation or enum errors

### 5.2 Workstream B: Migration and Rollback

Objective:

- convert the approved schema into a safe database migration with an explicit reversal path

Tasks:

- generate one migration for the core data model
- review `migration.sql` for enum creation order, table creation order, foreign keys, and indexes
- add `rollback.sql` to the migration directory
- ensure rollback removes the six new business tables and reverses new constraints in dependency-safe order

Key implementation notes:

- the migration must preserve the existing `User` table and data
- the rollback only covers this phase's new schema additions and should not drop bootstrap `User` data

Done when:

- migration applies successfully
- rollback SQL exists and is internally consistent with the generated migration

### 5.3 Workstream C: Seed Updates

Objective:

- keep the bootstrap admin usable while adding enough business master data for local validation

Tasks:

- preserve the default admin account
- hash the seeded admin password with bcrypt
- add minimal business seed data:
  - one or two stores
  - a small number of drivers
  - a small number of vehicles
- make the seed idempotent through `upsert` or equivalent patterns

Key implementation notes:

- do not seed heavy demo orders or full assignment chains
- seed data should validate relationships, not simulate the full business workflow

Done when:

- seed runs successfully on a migrated database
- the admin account still exists and can be used for login

### 5.4 Workstream D: Auth Compatibility for bcrypt

Objective:

- keep the existing bootstrap sign-in flow working after switching stored passwords away from plaintext

Tasks:

- add bcrypt dependency if it is not already present
- update the credentials verification path to compare hashed passwords
- keep the existing login identifiers compatible with current behavior
- verify seeded admin login still reaches `/admin`

Key implementation notes:

- do not redesign auth architecture
- do not expand session or permission scope
- only change what is necessary for password hashing compatibility

Done when:

- seeded admin login still works through the current sign-in flow

### 5.5 Workstream E: Database-Level Workflow Validation

Objective:

- prove the schema can express the core order-to-assignment history required by the approved design

Validation actions:

- create one `PENDING` order
- create an initial assignment and move the order to `ASSIGNED`
- clear the current assignment and return the order to `PENDING` through a recycle path
- create a second assignment
- create a reassignment chain using `previousAssignmentId`
- write operation logs for the manual actions being modeled

Validation questions that must be answerable:

- which driver currently owns the order
- which assignment is the active one
- what the assignment history chain looks like
- which user created or operated on the actions
- whether recycle and reassignment are auditable from the database alone

Done when:

- the database can represent the workflow without schema workarounds

## 6. Recommended Execution Order

### Stage 1: Update schema

Files:

- `prisma/schema.prisma`

Steps:

- add enums
- add `Store`, `Driver`, and `Vehicle`
- add `Order`
- add `Assignment`
- add `OperationLog`
- resolve relation names and indexes

Exit condition:

- schema is complete and validates cleanly

### Stage 2: Generate migration artifacts

Files:

- `prisma/migrations/...`

Steps:

- generate the migration
- inspect generated SQL
- add `rollback.sql`
- re-run generation if schema adjustments are required

Exit condition:

- migration artifacts are usable and coherent

### Stage 3: Update seed and auth compatibility

Files:

- `prisma/seed.js`
- auth-related files only if needed

Steps:

- convert seeded password generation to bcrypt
- preserve default admin credentials from a user perspective
- add minimal store, driver, and vehicle seed records
- update auth comparison logic only as required

Exit condition:

- seed works and login still succeeds

### Stage 4: Run validation

Files:

- database and existing app/runtime flow

Steps:

- apply migration
- run seed
- validate models in Prisma Studio
- validate seeded admin sign-in
- perform a minimal database-level assignment history check

Exit condition:

- all required validation checks pass

## 7. Validation Checklist

### 7.1 Schema validation

- Prisma schema validation passes
- Prisma client generation passes
- no ambiguous relations remain

### 7.2 Migration validation

- migration applies successfully
- generated tables, enums, indexes, and foreign keys match the design
- `rollback.sql` exists and reflects the phase additions

### 7.3 Seed validation

- seed executes successfully
- admin account is present
- stores, drivers, and vehicles are present

### 7.4 Auth regression validation

- sign-in page still loads
- seeded admin credentials still authenticate
- successful sign-in still reaches `/admin`

### 7.5 Data-model validation

- orders support multiple assignments
- reassignment chains can be traversed
- operation logs remain attributable to a user

## 8. Risks and Controls

### 8.1 Relation ambiguity

Risk:

- Prisma rejects the schema because `Order` and `Assignment` relate through more than one path

Control:

- explicitly name the relations before migration generation

### 8.2 Migration naming drift

Risk:

- current scripts produce misleading migration names

Control:

- use a direct Prisma command or minimally adjust the script so the migration name reflects the data-model phase

### 8.3 Seed idempotency failure

Risk:

- rerunning seed fails on unique constraints

Control:

- use stable business keys and `upsert` patterns

### 8.4 Auth regression

Risk:

- bcrypt conversion breaks current login

Control:

- update seed and credential comparison together and validate the seeded admin path immediately

### 8.5 Rollback inconsistency

Risk:

- migration and rollback diverge, making local recovery unreliable

Control:

- review `rollback.sql` against the actual generated migration before considering the phase complete

### 8.6 Git environment instability

Risk:

- the current workspace appears to have a broken git worktree reference

Control:

- continue file-level work normally
- verify git health explicitly before any commit operation

## 9. Not Implemented in This Phase

- import batch tables
- import APIs
- geocoding
- coordinates on orders
- driver location tracking
- dispatch recommendation outputs
- driver-side acceptance/start/complete APIs
- admin UI for orders or assignments beyond existing bootstrap pages

## 10. Completion Criteria

This implementation phase is complete when all of the following are true:

- the approved schema is fully represented in `prisma/schema.prisma`
- one migration and one matching `rollback.sql` exist for the phase
- migration applies successfully
- seed runs successfully with bcrypt-hashed credentials
- minimal business master data is present
- the current bootstrap login flow still works
- the database can represent assignment history and audit logs without schema gaps
- no import, map, or dispatch-service work has been pulled into scope
