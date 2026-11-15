-- Activation is explicit, audited and off by default; credentials stay in env.
ALTER TABLE retention_settings ADD COLUMN email_policy jsonb NOT NULL DEFAULT '{}'
 CHECK (jsonb_typeof(email_policy)='object');
