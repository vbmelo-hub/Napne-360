ALTER TABLE case_history ADD COLUMN from_source VARCHAR(80);
ALTER TABLE case_history ADD COLUMN to_source VARCHAR(80);
ALTER TABLE case_history ADD COLUMN from_summary VARCHAR(500);
ALTER TABLE case_history ADD COLUMN to_summary VARCHAR(500);
