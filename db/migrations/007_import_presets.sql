CREATE INDEX campaigns_normalized_name ON campaigns(lower(btrim(name)));
CREATE TABLE import_presets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 source text NOT NULL CHECK(source IN ('generic','zeffy','benevity')),
 mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='object'),
 created_by uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_preset_name ON import_presets(source,lower(btrim(name)));
