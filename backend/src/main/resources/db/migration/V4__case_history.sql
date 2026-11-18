CREATE TABLE case_history (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    version BIGINT NOT NULL,
    type VARCHAR(30) NOT NULL,
    from_stage VARCHAR(40),
    to_stage VARCHAR(40) NOT NULL,
    from_responsible_id BIGINT,
    from_responsible VARCHAR(160),
    to_responsible_id BIGINT NOT NULL,
    to_responsible VARCHAR(160) NOT NULL,
    actor_id BIGINT NOT NULL,
    actor VARCHAR(160) NOT NULL,
    occurred_at TIMESTAMP(6) NOT NULL,
    reason VARCHAR(500),
    CONSTRAINT fk_case_history_case FOREIGN KEY (case_id) REFERENCES napne_case(id),
    CONSTRAINT uq_case_history_version UNIQUE (case_id, version),
    INDEX idx_case_history_case_version (case_id, version, id)
);
