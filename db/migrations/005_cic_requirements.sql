-- Preserve existing donor, financial and attribution records.
ALTER TABLE donors ADD COLUMN secondary_email text CHECK (secondary_email = lower(trim(secondary_email)));
ALTER TABLE roles ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE activities ADD COLUMN program text;
ALTER TABLE activity_history ADD COLUMN program text;
CREATE OR REPLACE VIEW reporting_activities AS
  SELECT a.occurred_at,a.program,d.assigned_board_member_id AS board_member_id
  FROM activities a JOIN donors d ON d.id=a.donor_id;

ALTER TABLE outreach_messages DROP CONSTRAINT outreach_messages_status_check;
ALTER TABLE outreach_messages ADD CONSTRAINT outreach_messages_status_check
  CHECK (status IN ('draft','approved','handed_off','sending','failed','sent'));
ALTER TABLE outreach_messages ADD COLUMN handed_off_at timestamptz;
ALTER TABLE outreach_messages ADD COLUMN handed_off_by uuid REFERENCES users(id);
ALTER TABLE outreach_messages ADD COLUMN manual_send_reference text;
ALTER TABLE outreach_messages ADD CONSTRAINT handoff_requires_approval
  CHECK (status <> 'handed_off' OR (approved_by IS NOT NULL AND approved_revision=revision AND handed_off_at IS NOT NULL));
ALTER TABLE outreach_delivery_history DROP CONSTRAINT outreach_delivery_history_status_check;
ALTER TABLE outreach_delivery_history ADD CONSTRAINT outreach_delivery_history_status_check
  CHECK (status IN ('handed_off','sending','failed','sent'));

ALTER TABLE verified_funder_outcomes ADD COLUMN recorded_by uuid REFERENCES users(id);
ALTER TABLE verified_funder_outcomes ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT now();
