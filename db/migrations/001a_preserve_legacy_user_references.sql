-- Compatibility step before 002; 001/002/003 and their checksums remain unchanged.
-- A bare UUID from 001 is historical attribution, not a verified login identity.
ALTER TABLE donors ADD COLUMN legacy_assigned_board_member_id uuid;
ALTER TABLE import_batches ADD COLUMN legacy_importing_user_id uuid;
ALTER TABLE donor_merge_history ADD COLUMN legacy_authorized_actor_id uuid;
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    ALTER TABLE import_batches ALTER COLUMN importing_user_id DROP NOT NULL;
    ALTER TABLE donor_merge_history ALTER COLUMN authorized_actor_id DROP NOT NULL;
    UPDATE donors SET legacy_assigned_board_member_id=assigned_board_member_id,assigned_board_member_id=NULL
      WHERE assigned_board_member_id IS NOT NULL;
    UPDATE import_batches SET legacy_importing_user_id=importing_user_id,importing_user_id=NULL;
    UPDATE donor_merge_history SET legacy_authorized_actor_id=authorized_actor_id,authorized_actor_id=NULL;
  END IF;
END $$;
-- New application rows must still have real actor references. Only preserved
-- legacy rows may await reconciliation; no synthetic users are inserted.
ALTER TABLE import_batches ADD CONSTRAINT import_actor_attribution_required
  CHECK(importing_user_id IS NOT NULL OR legacy_importing_user_id IS NOT NULL);
ALTER TABLE donor_merge_history ADD CONSTRAINT merge_actor_attribution_required
  CHECK(authorized_actor_id IS NOT NULL OR legacy_authorized_actor_id IS NOT NULL);
