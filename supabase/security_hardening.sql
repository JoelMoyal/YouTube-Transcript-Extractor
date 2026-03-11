-- Run this in Supabase SQL Editor after creating your account lifecycle tables.
-- Purpose: fix linter error "rls_disabled_in_public" for sensitive tables.
--
-- These tables are server-managed via the service role key in server.js.
-- We intentionally deny all direct PostgREST access from anon/authenticated roles.

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['deletion_reasons', 'deleted_accounts']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE NOTICE 'Skipping public.% because it does not exist', table_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);

    EXECUTE format('DROP POLICY IF EXISTS "No direct access" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "No direct access" ON public.%I
       FOR ALL
       TO public
       USING (false)
       WITH CHECK (false)',
      table_name
    );
  END LOOP;
END
$$;
