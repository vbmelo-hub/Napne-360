ALTER TABLE student
    ADD COLUMN archived_academic_status VARCHAR(30),
    ADD COLUMN status_reason VARCHAR(40);

CREATE TABLE student_status_history (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id BIGINT NOT NULL,
    action VARCHAR(30) NOT NULL,
    previous_status VARCHAR(30),
    new_status VARCHAR(30),
    reason VARCHAR(40),
    effective_date DATE NOT NULL,
    recorded_at TIMESTAMP(6) NOT NULL,
    observations VARCHAR(1000),
    author_id BIGINT NOT NULL,
    author_name VARCHAR(180) NOT NULL,
    CONSTRAINT fk_student_status_history_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT fk_student_status_history_author FOREIGN KEY (author_id) REFERENCES app_user(id),
    INDEX idx_student_status_history_recorded (student_id, recorded_at DESC, id DESC)
);
