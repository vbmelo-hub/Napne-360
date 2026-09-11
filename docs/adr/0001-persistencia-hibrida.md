# ADR 0001 — MySQL para vínculos, MongoDB para documentos

Status: adotada na implementação em andamento.

A proposta de TCC sugeria NoSQL e a base existente usava JPA/MySQL. A instrução do usuário permite NoSQL onde houver vantagem concreta. Os vínculos de estudantes, contas, campus e componentes precisam de integridade referencial; formulários de atendimento e versões de PEI têm estruturas variáveis.

Decisão: preservar MySQL para agregados relacionais e auditoria, adotar MongoDB para documentos estruturados por grupos de campos, versões e linha do tempo. Binários ficam fora dos bancos, referenciados por metadados e hash.

Vantagens: constraints relacionais para autorização, evolução dos formulários sem tabelas esparsas, histórico por agregado. Custo: operar e restaurar dois bancos e arquivos; não existe atomicidade distribuída. É necessário interromper gravações durante backups coordenados e reconciliar falhas parciais.

Alternativas: apenas MySQL simplificaria a operação mas deslocaria formulários para colunas JSON; apenas MongoDB exigiria garantias de integridade acadêmica adicionais na aplicação. A escolha híbrida não autoriza duplicar laudos ou conteúdo clínico em cadastros, logs ou tokens.
