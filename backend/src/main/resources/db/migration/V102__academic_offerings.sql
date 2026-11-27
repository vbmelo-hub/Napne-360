CREATE TABLE academic_offering (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    subject_id BIGINT NOT NULL,
    period_id BIGINT NOT NULL,
    group_code VARCHAR(60) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_offering_subject FOREIGN KEY (subject_id) REFERENCES subject(id),
    CONSTRAINT fk_offering_period FOREIGN KEY (period_id) REFERENCES reference_entry(id),
    CONSTRAINT uk_offering_identity UNIQUE (subject_id, period_id, group_code),
    INDEX idx_offering_period_active (period_id, active)
);

CREATE TABLE academic_enrollment (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id BIGINT NOT NULL,
    offering_id BIGINT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_enrollment_offering FOREIGN KEY (offering_id) REFERENCES academic_offering(id),
    CONSTRAINT fk_enrollment_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT uk_enrollment_identity UNIQUE (student_id, offering_id),
    INDEX idx_enrollment_offering_active (offering_id, active)
);

CREATE TABLE teaching_assignment (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    teacher_id BIGINT NOT NULL,
    offering_id BIGINT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_teaching_offering FOREIGN KEY (offering_id) REFERENCES academic_offering(id),
    CONSTRAINT fk_teaching_user FOREIGN KEY (teacher_id) REFERENCES app_user(id),
    CONSTRAINT uk_teaching_identity UNIQUE (teacher_id, offering_id),
    INDEX idx_teaching_offering_active (offering_id, active)
);

ALTER TABLE student_assignment
    ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN period_id BIGINT,
    ADD COLUMN security_block BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT fk_student_assignment_period FOREIGN KEY (period_id) REFERENCES reference_entry(id),
    ADD CONSTRAINT uk_student_assignment_academic UNIQUE (student_id, user_id, subject_id, period_id),
    ADD INDEX idx_student_assignment_academic_lookup (subject_id, period_id, origin, active);

-- A revogação legada não tem motivo registrado. Preserva-se a decisão existente.
UPDATE student_assignment SET security_block = TRUE
WHERE assignment_type = 'TEACHER' AND active = FALSE;
