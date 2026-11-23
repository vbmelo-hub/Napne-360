CREATE TABLE case_stage_configuration (
    id INT NOT NULL PRIMARY KEY,
    version BIGINT NOT NULL,
    stages_json LONGTEXT NOT NULL,
    CONSTRAINT chk_case_stage_configuration_singleton CHECK (id = 1)
);

INSERT INTO case_stage_configuration (id, version, stages_json) VALUES (1, 0, '[
    {"code":"RECEIVED","label":"Recebido"},
    {"code":"SCREENING","label":"Triagem"},
    {"code":"WELCOMING","label":"Acolhimento"},
    {"code":"CASE_STUDY","label":"Estudo de caso"},
    {"code":"GUIDANCE_ISSUED","label":"Orientações emitidas"},
    {"code":"ACTION_PLAN","label":"Plano de ação"},
    {"code":"PEI","label":"PEI"},
    {"code":"FOLLOW_UP","label":"Acompanhamento"},
    {"code":"CLOSED","label":"Encerrado"},
    {"code":"ARCHIVED","label":"Arquivado"}
]');

ALTER TABLE case_history ADD COLUMN from_stage_label LONGTEXT;
ALTER TABLE case_history ADD COLUMN to_stage_label LONGTEXT;
