ALTER TABLE audit_event
    ADD COLUMN projection_key VARCHAR(128) NULL UNIQUE;
