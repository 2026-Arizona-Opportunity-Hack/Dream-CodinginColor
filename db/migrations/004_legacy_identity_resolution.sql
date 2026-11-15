CREATE TABLE legacy_user_identity_resolutions (
  legacy_user_id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  verified_by uuid NOT NULL REFERENCES users(id), verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER legacy_identity_immutable BEFORE UPDATE OR DELETE ON legacy_user_identity_resolutions
  FOR EACH ROW EXECUTE FUNCTION prevent_history_rewrite();
