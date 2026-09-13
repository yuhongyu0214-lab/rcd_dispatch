-- psql only. Run with a controlled DBA connection to rcd_v2_preprod.
-- Save the complete output in the release evidence directory before deploying.
-- Does NOT create users, reset passwords, reactivate drivers or run migrations.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'rcd_v2_preprod' THEN
    RAISE EXCEPTION 'Wrong database: preprod only';
  END IF;
  IF current_user = 'rcd_v2_preprod_app' THEN
    RAISE EXCEPTION 'Use a controlled DBA connection, not the app connection';
  END IF;
  IF NOT has_table_privilege('rcd_v2_preprod_app', 'public."User"', 'SELECT')
    OR NOT has_table_privilege('rcd_v2_preprod_app', 'public."Driver"', 'SELECT')
    OR NOT has_table_privilege('rcd_v2_preprod_app', 'public."Store"', 'SELECT') THEN
    RAISE EXCEPTION 'Baseline SELECT privileges missing; stop and investigate';
  END IF;
END
$guard$;

SELECT current_database() AS database_name, current_user AS db_actor,
       inet_server_addr() AS server_address, inet_server_port() AS server_port;

-- Determine which privileges are genuinely new; retain pre-existing privileges.
SELECT
  NOT has_table_privilege('rcd_v2_preprod_app', 'public."Driver"', 'INSERT') AS add_driver_insert,
  NOT has_column_privilege('rcd_v2_preprod_app', 'public."User"', 'driverId', 'UPDATE') AS add_driver_link_update,
  NOT has_column_privilege('rcd_v2_preprod_app', 'public."User"', 'updatedAt', 'UPDATE') AS add_user_updated_at
\gset workspace_

SELECT :'workspace_add_driver_insert'::boolean AS adding_driver_insert,
       :'workspace_add_driver_link_update'::boolean AS adding_driver_link_update,
       :'workspace_add_user_updated_at'::boolean AS adding_user_updated_at;

\if :workspace_add_driver_insert
GRANT INSERT ON TABLE public."Driver" TO rcd_v2_preprod_app;
\endif
\if :workspace_add_driver_link_update
GRANT UPDATE ("driverId") ON TABLE public."User" TO rcd_v2_preprod_app;
\endif
\if :workspace_add_user_updated_at
GRANT UPDATE ("updatedAt") ON TABLE public."User" TO rcd_v2_preprod_app;
\endif
DO $verify$
BEGIN
  IF NOT has_table_privilege('rcd_v2_preprod_app', 'public."Driver"', 'INSERT')
    OR NOT has_column_privilege('rcd_v2_preprod_app', 'public."User"', 'driverId', 'UPDATE')
    OR NOT has_column_privilege('rcd_v2_preprod_app', 'public."User"', 'updatedAt', 'UPDATE') THEN
    RAISE EXCEPTION 'Required workspace privileges missing; transaction aborted';
  END IF;
END
$verify$;
COMMIT;

SELECT has_table_privilege('rcd_v2_preprod_app', 'public."Driver"', 'INSERT') AS driver_insert,
       has_column_privilege('rcd_v2_preprod_app', 'public."User"', 'driverId', 'UPDATE') AS driver_link_update,
       has_column_privilege('rcd_v2_preprod_app', 'public."User"', 'updatedAt', 'UPDATE') AS user_updated_at;

-- Save these exact rollback statements from the FIRST successful application.
-- A repeat run is idempotent but cannot reconstruct the earlier baseline.
SELECT 'REVOKE INSERT ON TABLE public."Driver" FROM rcd_v2_preprod_app;' AS rollback_sql
WHERE :'workspace_add_driver_insert'::boolean
UNION ALL
SELECT 'REVOKE UPDATE ("driverId") ON TABLE public."User" FROM rcd_v2_preprod_app;'
WHERE :'workspace_add_driver_link_update'::boolean
UNION ALL
SELECT 'REVOKE UPDATE ("updatedAt") ON TABLE public."User" FROM rcd_v2_preprod_app;'
WHERE :'workspace_add_user_updated_at'::boolean;
