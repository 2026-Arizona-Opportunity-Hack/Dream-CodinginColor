-- Additive integration schema. Existing gifts retain unknown currency/status until verified.
CREATE TABLE roles (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE permissions (name text PRIMARY KEY);
CREATE TABLE role_permissions (
  role_id text REFERENCES roles(id) ON DELETE CASCADE,
  permission_name text REFERENCES permissions(name) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_name)
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  password_hash text NOT NULL, role_id text NOT NULL REFERENCES roles(id),
  active boolean NOT NULL DEFAULT true, board_member boolean NOT NULL DEFAULT false
);
CREATE VIEW user_roles AS SELECT id AS user_id, role_id FROM users;
CREATE TABLE sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE, csrf_token text NOT NULL, csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE login_attempts (
  id uuid PRIMARY KEY, account_key text NOT NULL, network_key text NOT NULL,
  attempted_at timestamptz NOT NULL
);
CREATE INDEX login_attempts_window_idx ON login_attempts(attempted_at);
ALTER TABLE donors ADD CONSTRAINT donor_board_user_fk FOREIGN KEY (assigned_board_member_id) REFERENCES users(id);
ALTER TABLE import_batches ADD CONSTRAINT import_user_fk FOREIGN KEY (importing_user_id) REFERENCES users(id);
ALTER TABLE donor_merge_history ADD CONSTRAINT merge_user_fk FOREIGN KEY (authorized_actor_id) REFERENCES users(id);
ALTER TABLE donors ADD COLUMN email_consent boolean NOT NULL DEFAULT false;
ALTER TABLE donors ADD COLUMN sms_consent boolean NOT NULL DEFAULT false;
ALTER TABLE donors ADD COLUMN opted_out boolean NOT NULL DEFAULT false;
ALTER TABLE custom_fields ADD COLUMN hidden boolean NOT NULL DEFAULT false;
ALTER TABLE donations ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE donations ADD COLUMN status text CHECK (status IN ('completed','pending','refunded','voided'));
CREATE TABLE board_assignments (
  id uuid PRIMARY KEY, donor_id uuid NOT NULL REFERENCES donors(id),
  assignee_id uuid NOT NULL REFERENCES users(id), active boolean NOT NULL,
  assigned_at timestamptz NOT NULL, assigned_by uuid REFERENCES users(id), ended_at timestamptz
);
CREATE UNIQUE INDEX one_active_assignment ON board_assignments(donor_id) WHERE active;
CREATE TABLE activities (
  id uuid PRIMARY KEY, donor_id uuid NOT NULL REFERENCES donors(id),
  type text NOT NULL CHECK (type IN ('call','meeting','email','text','note')),
  content text NOT NULL, occurred_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL
);
CREATE TABLE activity_history (
  history_id uuid PRIMARY KEY, activity_id uuid NOT NULL REFERENCES activities(id),
  donor_id uuid NOT NULL REFERENCES donors(id), type text NOT NULL, content text NOT NULL,
  occurred_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL,
  replaced_by uuid NOT NULL REFERENCES users(id), replaced_at timestamptz NOT NULL
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY, donor_id uuid NOT NULL REFERENCES donors(id),
  assignee_id uuid NOT NULL REFERENCES users(id), next_action text NOT NULL, description text NOT NULL DEFAULT '',
  due_at timestamptz NOT NULL, status text NOT NULL CHECK (status IN ('open','in_progress','completed','cancelled')),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, completed_at timestamptz, event_key text UNIQUE
);
CREATE TABLE message_templates (
  id text PRIMARY KEY, name text NOT NULL, channel text NOT NULL CHECK (channel IN ('email','sms')),
  requires_donation boolean NOT NULL, subject text NOT NULL, body text NOT NULL
);
CREATE TABLE outreach_messages (
  id uuid PRIMARY KEY, audience text NOT NULL CHECK (audience IN ('donor','board')),
  donor_id uuid REFERENCES donors(id), user_id uuid REFERENCES users(id),
  donation_id uuid REFERENCES donations(id), template_id text,
  channel text NOT NULL CHECK (channel IN ('email','sms')), subject text NOT NULL, body text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','approved','sending','failed','sent')),
  revision integer NOT NULL CHECK (revision > 0), approved_revision integer,
  approved_by uuid REFERENCES users(id), approved_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  sent_at timestamptz, provider_id text, outcome_unknown boolean NOT NULL DEFAULT false, event_key text UNIQUE,
  CHECK ((audience = 'donor' AND donor_id IS NOT NULL AND user_id IS NULL) OR
         (audience = 'board' AND user_id IS NOT NULL AND donor_id IS NULL)),
  CHECK (status NOT IN ('approved','sending','sent') OR
         (approved_by IS NOT NULL AND approved_revision = revision AND approved_at IS NOT NULL))
);
CREATE TABLE outreach_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES outreach_messages(id),
  revision integer NOT NULL, subject text NOT NULL, body text NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id), changed_at timestamptz NOT NULL,
  UNIQUE(message_id, revision)
);
CREATE TABLE outreach_approval_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES outreach_messages(id),
  revision integer NOT NULL, approved_by uuid NOT NULL REFERENCES users(id), approved_at timestamptz NOT NULL,
  UNIQUE(message_id, revision)
);
CREATE TABLE outreach_delivery_history (
  id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES outreach_messages(id), attempt_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('sending','failed','sent')), revision integer,
  subject text, body text, recipient text, approved_by uuid REFERENCES users(id), actor_id uuid REFERENCES users(id),
  provider_id text, code text, outcome_unknown boolean, occurred_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX one_delivery_outcome ON outreach_delivery_history(attempt_id, status);
CREATE TABLE retention_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  inactivity_months integer NOT NULL CHECK(inactivity_months BETWEEN 1 AND 120)
);
INSERT INTO retention_settings VALUES (true, 12);
CREATE TABLE retention_events (
  id uuid PRIMARY KEY, event_key text UNIQUE, type text NOT NULL, donor_id uuid REFERENCES donors(id),
  donation_id uuid REFERENCES donations(id), task_id uuid REFERENCES tasks(id), message_id uuid REFERENCES outreach_messages(id),
  actor_id uuid NOT NULL REFERENCES users(id), occurred_at timestamptz NOT NULL, details jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL,
  entity_id text NOT NULL, occurred_at timestamptz NOT NULL, details jsonb NOT NULL DEFAULT '{}'
);
-- History cannot be silently rewritten by normal service updates.
CREATE FUNCTION prevent_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History is append-only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION prevent_history_rewrite();
CREATE TRIGGER activity_history_immutable BEFORE UPDATE OR DELETE ON activity_history FOR EACH ROW EXECUTE FUNCTION prevent_history_rewrite();
CREATE TRIGGER delivery_history_immutable BEFORE UPDATE OR DELETE ON outreach_delivery_history FOR EACH ROW EXECUTE FUNCTION prevent_history_rewrite();
CREATE TRIGGER revision_history_immutable BEFORE UPDATE OR DELETE ON outreach_revisions FOR EACH ROW EXECUTE FUNCTION prevent_history_rewrite();
CREATE TRIGGER approval_history_immutable BEFORE UPDATE OR DELETE ON outreach_approval_history FOR EACH ROW EXECUTE FUNCTION prevent_history_rewrite();
