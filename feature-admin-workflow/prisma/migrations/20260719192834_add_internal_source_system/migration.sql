-- Gate 3: Add INTERNAL source system for internally generated dispatch events
-- Forward migration — adds a value to the OrderSourceSystem enum.

BEGIN;

ALTER TYPE "OrderSourceSystem" ADD VALUE 'INTERNAL';

COMMIT;
