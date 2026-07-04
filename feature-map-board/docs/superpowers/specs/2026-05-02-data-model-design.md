# Data Model Design

## 1. Background

The current repository has completed the bootstrap baseline for runtime, database connectivity, authentication, and basic engineering structure. The next phase should establish the persistent business model needed for follow-up dispatch, order import, and operation tracking work.

The current codebase still only persists the `User` model in Prisma. However, the business documents already define stable terminology and workflow constraints for stores, drivers, vehicles, orders, assignment history, and operation logs. This phase should close that gap at the schema layer without prematurely introducing import APIs, map integration, or dispatch execution logic.

Relevant document inputs:

- `domain-glossary.md`
- `order-lifecycle.md`
- `import-template.md`

## 2. Goals

This phase is successful when all of the following are true:

- Prisma schema models the core business entities required by the current documents
- core enums align with documented terminology and order lifecycle states
- relations between stores, drivers, vehicles, orders, assignments, and operation logs are explicit
- the schema can generate a Prisma client successfully
- migration can be created and applied successfully
- seed data still creates the default admin account
- the seed can optionally include a minimal set of master data for local validation
- the current bootstrap login flow is not broken by schema changes

## 3. Non-Goals

The following work is explicitly out of scope for this phase:

- file upload or order import API implementation
- Excel or CSV parsing
- geocoding integration with AMap
- map board frontend features
- dispatch recommendation algorithms
- driver mobile workflow APIs
- driver location tracking tables and ingestion
- import batch result pages or import task orchestration

## 4. Recommended Approach

Three implementation approaches were considered:

### Approach A: Core model in one pass

Add the core business entities, enums, relations, indexes, migration, and minimum seed updates in a single schema pass.

Pros:

- aligns best with the reference repository direction
- keeps the model internally coherent from the first migration
- reduces churn from temporary intermediate schemas
- gives downstream work a stable persistence baseline

Cons:

- larger schema change in one phase

### Approach B: Minimal tables first

Only add `Store`, `Driver`, `Vehicle`, and `Order`, and defer `Assignment` and `OperationLog`.

Pros:

- smaller first migration

Cons:

- quickly causes follow-up schema churn
- does not fully support the documented assignment and audit requirements

### Approach C: Over-model for future features

Add core entities plus import, geolocation, and more speculative fields and tables.

Pros:

- may appear more complete upfront

Cons:

- introduces premature assumptions
- increases migration risk
- mixes this phase with later delivery stages

### Recommendation

Use Approach A. It best matches the current reference direction, keeps the schema useful for downstream work, and still respects the phase boundary by stopping at the data model itself.

## 5. Scope Boundary

This phase only covers the Prisma persistence layer and the minimum supporting seed changes required to keep local development usable.

Included deliverables:

- updated `prisma/schema.prisma`
- a migration for the new data model
- a matching `rollback.sql` alongside the migration
- updated `prisma/seed.js`
- compatible login-path updates if required to keep authentication working after password handling changes
- lightweight documentation adjustments only if needed to keep commands and expectations accurate

Not included:

- new route handlers for import
- new admin pages for import or dispatch
- map or coordinate-based business workflows
- service-layer business logic beyond what seed validation requires

## 6. Target Domain Model

The phase introduces six business-centered models around the existing `User` model.

### 6.1 User

`User` remains the authenticated back-office actor and preserves the current bootstrap login flow.

New responsibilities:

- creator of assignment records
- operator for manual actions recorded in logs

Expected relations:

- one-to-many to `Assignment` as `assignmentsCreated`
- one-to-many to `OperationLog` as `operationLogs`

### 6.2 Store

`Store` becomes the organizational root for dispatch operations.

Purpose:

- anchors ownership for drivers, vehicles, and orders
- supports same-store dispatch constraints
- provides a stable master-data reference for future import mapping

Expected relations:

- one-to-many to `Driver`
- one-to-many to `Vehicle`
- one-to-many to `Order`

### 6.3 Driver

`Driver` represents an operational executor under one store.

Purpose:

- stores the driver's master data and dispatch availability state
- acts as the assignee in assignment history

Expected relations:

- many-to-one to `Store`
- one-to-many to `Assignment`

Explicitly deferred:

- driver location history
- mobile account and device metadata

### 6.4 Vehicle

`Vehicle` represents a dispatchable asset under one store.

Purpose:

- stores master data for vehicles involved in orders
- supports vehicle availability and later pre-assignment workflows

Expected relations:

- many-to-one to `Store`
- one-to-many to `Order`

### 6.5 Order

`Order` is the central business work item in the system.

Purpose:

- captures the dispatchable business order
- stores lifecycle status, store ownership, schedule, and address fields
- optionally references the currently associated vehicle
- points to the current active assignment while retaining full assignment history

Expected relations:

- many-to-one to `Store`
- optional many-to-one to `Vehicle`
- one-to-many to `Assignment`
- optional one-to-one style pointer to current `Assignment`

### 6.6 Assignment

`Assignment` records each dispatch decision rather than overwriting assignment state on the order.

Purpose:

- supports recommended assignment, manual assignment, and reassignment
- preserves historical chain of assignment decisions
- captures lifecycle timestamps for acceptance, withdrawal, recycle, and completion

Expected relations:

- many-to-one to `Order`
- many-to-one to `Driver`
- many-to-one to `User` as creator
- self-reference to previous assignment for reassignment chains

### 6.7 OperationLog

`OperationLog` captures manual and status-changing operational actions.

Purpose:

- preserves auditability for assign, reassign, withdraw, recycle, cancel, and related actions
- avoids creating separate log tables per entity type

Expected relations:

- many-to-one to `User` as operator
- polymorphic-style logical reference using `entityType + entityId`

## 7. Enum Strategy

Only enums that are already stable in the current business documents or the reference data-model direction should be introduced now.

### 7.1 DriverStatus

- `OFFLINE`
- `S1`
- `S2`
- `S3`
- `S4`
- `UNAVAILABLE`

### 7.2 VehicleStatus

- `AVAILABLE`
- `PRE_ASSIGNED`
- `IN_USE`
- `UNAVAILABLE`

### 7.3 OrderType

- `STORE_PICKUP`
- `STORE_RETURN`
- `DOOR_DELIVERY`
- `DOOR_PICKUP`

### 7.4 OrderStatus

Persisted statuses:

- `PENDING`
- `RECOMMENDING`
- `ASSIGNED`
- `ACCEPTED`
- `IN_PROGRESS`
- `COMPLETED`
- `RECYCLED`
- `CANCELLED`

Decision:

- `UNIMPORTED` is treated as a pre-ingestion logical state, not a persisted database enum in this phase

### 7.5 AssignmentType

- `MANUAL_ASSIGN`
- `RECOMMEND_ASSIGN`
- `REASSIGN`

### 7.6 AssignmentStatus

- `ACTIVE`
- `ACCEPTED`
- `WITHDRAWN`
- `RECYCLED`
- `COMPLETED`
- `CANCELLED`

### 7.7 OperationEntityType

- `ORDER`
- `ASSIGNMENT`
- `DRIVER`
- `VEHICLE`

### 7.8 OperationAction

- `ASSIGN`
- `REASSIGN`
- `WITHDRAW`
- `RECYCLE`
- `CANCEL`
- `ACCEPT`
- `START`
- `COMPLETE`

## 8. Field Design

### 8.1 User

Keep the existing bootstrap fields:

- `id`
- `email`
- `phone`
- `name`
- `password`
- `role`
- `createdAt`
- `updatedAt`

Constraints:

- `email` unique
- `phone` unique

Decision:

- the `password` column remains a string field, but this phase should switch seed and authentication handling from plaintext comparison to bcrypt hashing
- this keeps the persisted shape stable while resolving the known bootstrap-era security debt during the `feature/data-model` phase

### 8.2 Store

Minimum fields:

- `id`
- `code`
- `name`
- `isActive`
- `createdAt`
- `updatedAt`

Constraints:

- `code` unique

### 8.3 Driver

Minimum fields:

- `id`
- `storeId`
- `name`
- `phone`
- `status`
- `isActive`
- `createdAt`
- `updatedAt`

Constraints:

- `phone` unique

Meaning:

- `phone` serves both as a contact field and as a future-compatible login identifier for driver-facing workflows

### 8.4 Vehicle

Minimum fields:

- `id`
- `storeId`
- `licensePlate`
- `vehicleType`
- `status`
- `isActive`
- `createdAt`
- `updatedAt`

Constraints:

- `licensePlate` unique

Decision:

- `vehicleType` remains a string in this phase rather than a separate enum or master table

### 8.5 Order

Minimum fields:

- `id`
- `orderNo`
- `type`
- `status`
- `storeId`
- `vehicleId`
- `licensePlateSnapshot`
- `pickupAddress`
- `returnAddress`
- `scheduledAt`
- `currentAssignmentId`
- `createdAt`
- `updatedAt`

Constraints:

- `orderNo` unique
- `vehicleId` optional
- `currentAssignmentId` optional

Decisions:

- addresses are stored as text only in this phase
- coordinates are deferred to a later phase
- import channel and import batch fields are deferred until import work begins
- `importBatchId` is recognized as a documented order field but is intentionally deferred to the order-import phase rather than stored in this schema pass

### 8.6 Assignment

Minimum fields:

- `id`
- `orderId`
- `driverId`
- `type`
- `status`
- `previousAssignmentId`
- `createdByUserId`
- `assignedAt`
- `acceptedAt`
- `withdrawnAt`
- `recycledAt`
- `completedAt`

Constraints:

- `previousAssignmentId` optional

### 8.7 OperationLog

Minimum fields:

- `id`
- `entityType`
- `entityId`
- `action`
- `operatorUserId`
- `reason`
- `metadataJson`
- `createdAt`

Decisions:

- `reason` optional because not every action requires a free-text reason
- `metadataJson` optional for structured details without forcing early column explosion

## 9. Relation and Delete Strategy

The schema should favor history preservation over aggressive cascading deletion.

### 9.1 Store relations

- `Store -> Driver`, `Store -> Vehicle`, and `Store -> Order` should use `Restrict` on delete

Reason:

- operational records should not disappear because a master record is removed

### 9.2 Assignment relations

- `Assignment -> Order`, `Assignment -> Driver`, and `Assignment -> User` should use `Restrict`

Reason:

- assignment history must remain intact

### 9.3 Vehicle relation from Order

- `Order -> Vehicle` should use `SetNull`

Reason:

- historical order readability is preserved through `licensePlateSnapshot`
- the order record should survive even if a vehicle master record is retired

### 9.4 Current assignment pointer

- `Order.currentAssignmentId` should reference `Assignment.id`
- the relation should allow null and use `SetNull`

Reason:

- the pointer is a convenience for current-state lookup, not the canonical history store
- dispatch locking remains an application-layer concern implemented through transactional writes plus active assignment state, not a separate database model in this phase

## 10. Index Strategy

Indexes should serve the known access patterns from the current documents without speculative over-optimization.

### 10.1 Driver

- `@@index([storeId, status])`

Supports:

- finding candidate drivers by store and status

### 10.2 Vehicle

- `@@index([storeId, status])`

Supports:

- store-level vehicle filtering

### 10.3 Order

- `@@index([storeId, status])`
- `@@index([status, scheduledAt])`
- `@@index([currentAssignmentId])`

Supports:

- pending pool by store
- time-ordered status views
- direct lookup of current assignment linkage

### 10.4 Assignment

- `@@index([orderId, status])`
- `@@index([driverId, status])`
- `@@index([assignedAt])`
- `@@index([previousAssignmentId])`

Supports:

- order assignment history
- active assignments per driver
- chronological audit and reassignment chain traversal

### 10.5 OperationLog

- `@@index([entityType, entityId])`
- `@@index([operatorUserId, createdAt])`
- `@@index([action, createdAt])`

Supports:

- audit lookup by entity
- audit lookup by operator
- action-level review

## 11. Seed Strategy

The seed must continue to support the bootstrap baseline while enabling lightweight validation of the new schema.

### 11.1 Must keep

- default admin account
- current login-compatible fields on `User`
- bcrypt-compatible password generation for seeded accounts

### 11.2 Should add

- one or two stores
- a small number of drivers
- a small number of vehicles

### 11.3 Should not add yet

- heavy demo orders
- full assignment chains
- import-specific sample data

Reason:

- keep seed execution stable and easy to reason about
- keep security-sensitive setup deterministic by hashing seeded passwords inside the seed script rather than storing plaintext fixtures

## 12. Migration Strategy

Use a single core migration to evolve the current schema from bootstrap user-only persistence to the first complete business data model.

Why a single migration:

- the new models are tightly related
- splitting into multiple temporary migrations would create short-lived intermediate states
- this phase is intentionally defined as the schema foundation for later work

Compatibility rule:

- preserve existing `User` fields and unique constraints so current authentication behavior remains valid

Rollback rule:

- the migration must include a sibling `rollback.sql`
- the rollback should remove the six newly introduced business tables for this phase and reverse any added indexes or foreign keys in dependency-safe order

## 13. Validation Strategy

The phase should be validated through a small, deterministic set of checks.

### 13.1 Required checks

- Prisma schema validates successfully
- Prisma client generation succeeds
- migration creation and application succeed
- seed execution succeeds
- `pnpm lint` succeeds

### 13.2 Manual checks

- verify `User`, `Store`, `Driver`, `Vehicle`, `Order`, `Assignment`, and `OperationLog` are visible in Prisma Studio
- verify store relations load correctly
- verify the schema supports multiple assignments per order
- verify `User`-to-log and `User`-to-assignment creator relations are intact

### 13.3 Regression guard

- the bootstrap sign-in path should remain functional because `User` stays compatible

## 14. Risks and Controls

### 14.1 Document mismatch risk

Risk:

- business documents and the reference repository are not identical in every detail

Control:

- persist only the fields and enums that are stable across the current evidence
- defer disputed or later-phase fields

### 14.2 Over-modeling risk

Risk:

- adding import or map-specific fields too early creates churn later

Control:

- keep this phase focused on core master data, orders, assignment history, and audit logs

### 14.3 Auth regression risk

Risk:

- schema changes accidentally break the current login baseline

Control:

- preserve the current `User` contract and keep seed compatibility
- update the login path and seed together when switching to bcrypt so runtime behavior and stored credentials do not diverge

### 14.4 Seed fragility risk

Risk:

- large seed scripts become hard to maintain and debug

Control:

- keep seed data minimal and master-data oriented

### 14.5 Git environment risk

Risk:

- the current workspace appears to have a broken git worktree reference, which may block normal commit operations

Control:

- continue design and implementation work at the file level
- verify git health before any required commit step

## 15. Final Decision Summary

The approved direction for this phase is:

- implement only the data model, not import APIs
- adopt the full core model in one pass
- preserve bootstrap authentication compatibility
- introduce the six core business models plus supporting enums
- use explicit relations and history-preserving delete policies
- keep seeds light and migration singular
- defer coordinates, import batches, driver locations, and speculative fields
