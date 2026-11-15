-- Provider acceptance and actual delivery must not be confused with human sends.
ALTER TABLE outreach_messages DROP CONSTRAINT outreach_messages_status_check;
ALTER TABLE outreach_messages ADD CONSTRAINT outreach_messages_status_check
 CHECK (status IN ('draft','approved','handed_off','sending','failed','sent','queued','delivered','bounced','suppressed'));
ALTER TABLE outreach_messages ADD CONSTRAINT provider_state_requires_approval
 CHECK (status NOT IN ('queued','delivered','bounced','suppressed') OR
  (approved_by IS NOT NULL AND approved_revision=revision AND approved_at IS NOT NULL));
ALTER TABLE outreach_delivery_history DROP CONSTRAINT outreach_delivery_history_status_check;
ALTER TABLE outreach_delivery_history ADD CONSTRAINT outreach_delivery_history_status_check
 CHECK (status IN ('handed_off','sending','failed','sent','queued','delivered','bounced','suppressed'));
