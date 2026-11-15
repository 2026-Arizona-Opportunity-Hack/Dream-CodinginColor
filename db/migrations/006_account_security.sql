-- Additive account security. Existing password-only sessions cannot pass the new MFA gate.
ALTER TABLE users ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN totp_secret_ciphertext text;
ALTER TABLE users ADD COLUMN totp_pending_ciphertext text;
ALTER TABLE users ADD COLUMN totp_pending_expires_at timestamptz;
ALTER TABLE users ADD COLUMN totp_last_step bigint NOT NULL DEFAULT -1;
ALTER TABLE users ADD COLUMN recovery_hashes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(recovery_hashes)='array');
ALTER TABLE users ADD COLUMN credential_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(preferences)='object');
ALTER TABLE users ADD CONSTRAINT enrolled_totp_has_secret CHECK(NOT totp_enabled OR totp_secret_ciphertext IS NOT NULL);
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE sessions ADD COLUMN password_verified_at timestamptz;
ALTER TABLE sessions ADD COLUMN credential_version integer NOT NULL DEFAULT 0;
CREATE TABLE security_attempts (
 id uuid PRIMARY KEY, account_key text NOT NULL, network_key text NOT NULL,
 purpose text NOT NULL, attempted_at timestamptz NOT NULL
);
CREATE INDEX security_attempts_window ON security_attempts(attempted_at);
CREATE TABLE account_requests (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL,
 password_hash text, status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL, reviewed_at timestamptz,
 reviewed_by uuid REFERENCES users(id), user_id uuid REFERENCES users(id),
 CHECK(status<>'pending' OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX one_pending_account_request ON account_requests(lower(email)) WHERE status='pending';
