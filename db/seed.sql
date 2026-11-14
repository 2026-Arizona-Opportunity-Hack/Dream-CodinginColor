-- Synthetic development data only. Explicit stable IDs make this repeatable.
INSERT INTO campaigns (id, name) VALUES
('10000000-0000-4000-8000-000000000001', 'Synthetic Learning Campaign') ON CONFLICT DO NOTHING;
INSERT INTO donors (id, donor_type, first_name, last_name, display_name, normalized_email) VALUES
('20000000-0000-4000-8000-000000000001', 'person', 'Example', 'Supporter', 'Example Supporter', 'supporter@example.invalid'),
('20000000-0000-4000-8000-000000000002', 'organization', NULL, NULL, 'Opportunity Hack Example', 'giving@example.invalid')
ON CONFLICT DO NOTHING;
INSERT INTO donations (id, donor_id, amount, donation_date, source, external_transaction_id, campaign_id) VALUES
('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 25.00, '2026-01-15', 'synthetic-seed', 'example-gift-1', '10000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
