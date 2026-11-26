CREATE TABLE case_projection_outbox (
    projection_key VARCHAR(128) NOT NULL PRIMARY KEY,
    payload LONGTEXT NOT NULL
);
