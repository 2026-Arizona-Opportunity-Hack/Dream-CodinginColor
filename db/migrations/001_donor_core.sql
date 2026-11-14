-- Authentication tables and user foreign keys await Teammate 2's schema contract.
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE donors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_type text NOT NULL CHECK (donor_type IN ('person', 'organization')),
  first_name text, last_name text,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 300),
  normalized_email text CHECK (normalized_email = lower(trim(normalized_email))),
  phone text, company text,
  assigned_board_member_id uuid,
  custom_data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(custom_data) = 'object'),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Shared email addresses are allowed; identity review happens in the import layer.
CREATE INDEX donors_email_idx ON donors (normalized_email);
CREATE INDEX donors_active_idx ON donors (created_at DESC, id) WHERE archived_at IS NULL;
CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL, file_hash text NOT NULL, source text NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'confirmed', 'expired')),
  importing_user_id uuid NOT NULL,
  validation_counts jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  confirmed_at timestamptz
);
CREATE TABLE donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid NOT NULL REFERENCES donors(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  donation_date date NOT NULL,
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 100),
  external_transaction_id text CHECK (length(external_transaction_id) BETWEEN 1 AND 300),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE RESTRICT,
  program text,
  import_batch_id uuid REFERENCES import_batches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_transaction_id)
);
CREATE INDEX donations_history_idx ON donations (donor_id, donation_date DESC, id);
CREATE TABLE import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
  row_number integer NOT NULL CHECK (row_number > 0),
  normalized_data jsonb,
  result text NOT NULL CHECK (result IN ('pending', 'invalid', 'imported', 'duplicate')),
  error_details jsonb NOT NULL DEFAULT '[]',
  donor_id uuid REFERENCES donors(id), donation_id uuid REFERENCES donations(id),
  processed_at timestamptz,
  UNIQUE (import_batch_id, row_number)
);
CREATE TABLE donor_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_donor_id uuid NOT NULL REFERENCES donors(id) ON DELETE RESTRICT,
  alias_donor_id uuid UNIQUE REFERENCES donors(id) ON DELETE RESTRICT,
  original_name text NOT NULL,
  source text, source_identifier text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (alias_donor_id IS NULL OR alias_donor_id <> canonical_donor_id),
  CHECK ((source IS NULL) = (source_identifier IS NULL)),
  UNIQUE (source, source_identifier)
);
CREATE INDEX donor_aliases_name_idx ON donor_aliases (lower(original_name));
CREATE TABLE donor_merge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_donor_id uuid NOT NULL REFERENCES donors(id),
  merged_donor_id uuid NOT NULL REFERENCES donors(id),
  authorized_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  audit_details jsonb NOT NULL,
  CHECK (canonical_donor_id <> merged_donor_id)
);
CREATE TABLE custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$' AND key NOT IN ('constructor', 'prototype', '__proto__')),
  label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text', 'number', 'boolean', 'date', 'select')),
  validation_rules jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE program_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id),
  program text NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
