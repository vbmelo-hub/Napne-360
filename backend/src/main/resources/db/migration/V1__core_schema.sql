CREATE TABLE campus (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(160) NOT NULL,
    code VARCHAR(40) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
);

CREATE TABLE course (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    campus_id BIGINT NOT NULL,
    name VARCHAR(180) NOT NULL,
    code VARCHAR(60) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_course_campus FOREIGN KEY (campus_id) REFERENCES campus(id),
    CONSTRAINT uk_course_campus_code UNIQUE (campus_id, code)
);

CREATE TABLE subject (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    course_id BIGINT NOT NULL,
    name VARCHAR(180) NOT NULL,
    code VARCHAR(60) NOT NULL,
    workload_hours INT NOT NULL,
    syllabus TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_subject_course FOREIGN KEY (course_id) REFERENCES course(id),
    CONSTRAINT uk_subject_course_code UNIQUE (course_id, code)
);

CREATE TABLE app_user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    campus_id BIGINT,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_user_campus FOREIGN KEY (campus_id) REFERENCES campus(id)
);

CREATE TABLE user_role (
    user_id BIGINT NOT NULL,
    role VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, role),
    CONSTRAINT fk_role_user FOREIGN KEY (user_id) REFERENCES app_user(id)
);

CREATE TABLE student (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    campus_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    registration VARCHAR(60) NOT NULL,
    civil_name VARCHAR(180) NOT NULL,
    social_name VARCHAR(180),
    birth_date DATE,
    institutional_email VARCHAR(190),
    phone VARCHAR(40),
    status VARCHAR(30) NOT NULL,
    archived_at TIMESTAMP(6),
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_student_campus FOREIGN KEY (campus_id) REFERENCES campus(id),
    CONSTRAINT fk_student_course FOREIGN KEY (course_id) REFERENCES course(id),
    CONSTRAINT uk_student_registration UNIQUE (registration),
    INDEX idx_student_campus_status (campus_id, status),
    INDEX idx_student_course (course_id)
);

CREATE TABLE student_assignment (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    subject_id BIGINT,
    assignment_type VARCHAR(30) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_assignment_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT fk_assignment_user FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT fk_assignment_subject FOREIGN KEY (subject_id) REFERENCES subject(id),
    INDEX idx_assignment_user (user_id, active),
    INDEX idx_assignment_student (student_id, active)
);

CREATE TABLE napne_case (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id BIGINT NOT NULL,
    stage VARCHAR(40) NOT NULL,
    source VARCHAR(80) NOT NULL,
    opened_at TIMESTAMP(6) NOT NULL,
    closed_at TIMESTAMP(6),
    responsible_user_id BIGINT NOT NULL,
    summary VARCHAR(500),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_case_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT fk_case_responsible FOREIGN KEY (responsible_user_id) REFERENCES app_user(id),
    INDEX idx_case_student_stage (student_id, stage),
    INDEX idx_case_responsible (responsible_user_id)
);

CREATE TABLE audit_event (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    actor_user_id BIGINT,
    action VARCHAR(80) NOT NULL,
    resource_type VARCHAR(80) NOT NULL,
    resource_id VARCHAR(100),
    outcome VARCHAR(20) NOT NULL,
    ip_address VARCHAR(64),
    occurred_at TIMESTAMP(6) NOT NULL,
    details VARCHAR(500),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES app_user(id),
    INDEX idx_audit_resource (resource_type, resource_id),
    INDEX idx_audit_actor_time (actor_user_id, occurred_at)
);
