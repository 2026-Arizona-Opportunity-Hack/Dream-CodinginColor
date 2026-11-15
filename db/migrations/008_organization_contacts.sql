-- Additive only: never infer classifications or overwrite historical names.
ALTER TABLE donors ADD COLUMN organization_name text CHECK (length(organization_name) <= 300);
ALTER TABLE donors ADD COLUMN contact_person text CHECK (length(contact_person) <= 300);
