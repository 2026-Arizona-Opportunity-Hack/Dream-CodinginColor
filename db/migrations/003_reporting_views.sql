-- Evidence is recorded explicitly; gifts never imply a funded outcome.
CREATE TABLE verified_funder_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid NOT NULL REFERENCES donors(id),
  description text NOT NULL, verified_at timestamptz NOT NULL,
  evidence_reference text NOT NULL CHECK(length(trim(evidence_reference)) > 0),
  period_start date NOT NULL, period_end date NOT NULL CHECK(period_end >= period_start),
  program text, board_member_id uuid REFERENCES users(id)
);
CREATE VIEW reporting_gifts AS
  SELECT g.donor_id,g.donation_date AS donated_at,(g.amount*100)::bigint AS amount_cents,
         g.program,d.assigned_board_member_id AS board_member_id
  FROM donations g JOIN donors d ON d.id=g.donor_id
  WHERE g.status='completed' AND g.currency='USD' AND g.amount > 0
    AND NOT EXISTS(SELECT 1 FROM donor_aliases a WHERE a.alias_donor_id=d.id);
CREATE VIEW reporting_activities AS
  SELECT a.occurred_at,NULL::text AS program,d.assigned_board_member_id AS board_member_id
  FROM activities a JOIN donors d ON d.id=a.donor_id;
CREATE VIEW reporting_donors AS SELECT id,display_name AS name FROM donors;
CREATE VIEW reporting_outcomes AS SELECT * FROM verified_funder_outcomes;
