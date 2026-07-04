# Demo Data Reset Design

## Objective

Provide a repeatable, controlled way to restore the V1 demo data in the Supabase database before acceptance or live preview checks.

The reset is for demo stabilization only. It must not change Prisma schema, dispatch rules, page structure, or production business logic.

## Scope

The reset script manages only fixed demo records:

- Stores: `STORE_SH_HQ`, `STORE_HZ_XH`
- Drivers: `13800000001`, `13800000002`, `13800000003`
- Vehicles: `沪A12345`, `浙A67890`
- Orders: `DEMO-20260629-001`, `ORD-20260508-001`, `ORD-20260508-002`, `ORD-20260508-003`

It preserves unrelated users, orders, assignments, vehicles, drivers, and logs.

## Behavior

The script defaults to dry-run mode. It prints the current snapshot and the intended reset plan, but does not write to the database.

The script writes data only when called with `--apply`.

On apply, it:

1. Ensures the default admin account exists.
2. Ensures two stores, three drivers, and two vehicles exist.
3. Clears assignments and operation logs for the fixed demo orders.
4. Restores one `PENDING` order for dispatch acceptance.
5. Restores two `ASSIGNED` orders with active assignments for driver accept/complete testing.
6. Writes operation logs for import, assign, reassign, and withdraw search demonstrations.

## Safety Rules

- No full-table delete.
- No schema change.
- No migration.
- No write unless `--apply` is present.
- All reset writes are wrapped in a Prisma transaction.
- The command is intended for local operator use, not for a public UI button.

## Acceptance

After applying the reset:

- `/api/health` returns connected.
- `/admin/orders?mode=orders` has at least one pending order.
- `/admin/orders?mode=logs` can search `张伟`, `DEMO-20260629-001`, and `沪A12345`.
- Driver accept/complete can be tested against an assigned order.
- `pnpm test`, `pnpm lint`, and `pnpm build` pass.
