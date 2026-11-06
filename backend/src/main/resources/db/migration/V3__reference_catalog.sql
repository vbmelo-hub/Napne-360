CREATE TABLE reference_entry (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kind VARCHAR(30) NOT NULL,
    code VARCHAR(80) NOT NULL,
    label VARCHAR(180) NOT NULL,
    description VARCHAR(2000),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_reference_kind_code UNIQUE (kind,code)
);
INSERT INTO reference_entry(kind,code,label) VALUES
('NEED_CATEGORY','FISICA','Deficiência física'),
('NEED_CATEGORY','INTELECTUAL','Deficiência intelectual'),
('NEED_CATEGORY','VISUAL','Deficiência visual'),
('NEED_CATEGORY','AUDITIVA','Deficiência auditiva'),
('NEED_CATEGORY','SURDOCEGUEIRA','Surdocegueira'),
('NEED_CATEGORY','MULTIPLA','Deficiência múltipla'),
('NEED_CATEGORY','TEA','Transtorno do espectro autista'),
('NEED_CATEGORY','NEURODESENVOLVIMENTO','Outros transtornos do neurodesenvolvimento'),
('NEED_CATEGORY','ALTAS_HABILIDADES','Altas habilidades / superdotação'),
('NEED_CATEGORY','APRENDIZAGEM','Transtornos específicos de aprendizagem');
