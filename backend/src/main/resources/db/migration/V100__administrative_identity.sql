ALTER TABLE app_user ADD COLUMN cpf VARCHAR(11);
ALTER TABLE app_user ADD COLUMN institutional_registration VARCHAR(60);
ALTER TABLE app_user ADD COLUMN security_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_user ADD CONSTRAINT uk_app_user_cpf UNIQUE (cpf);

CREATE TABLE user_email_history (
    email VARCHAR(190) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    CONSTRAINT fk_email_history_user FOREIGN KEY (user_id) REFERENCES app_user(id)
);

INSERT INTO user_email_history (email, user_id)
SELECT LOWER(email), id FROM app_user;
