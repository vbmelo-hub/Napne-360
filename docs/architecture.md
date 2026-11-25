# Arquitetura do NAPNE 360

Monólito modular Java 21/Spring Boot, organizado sob `br.edu.ifac.napne360` em identidade, segurança, estudantes, casos, documentos, PEI e auditoria. O backend segue a estrutura Maven; Angular é um cliente separado da API `/api/v1`.

| Fonte de verdade | Dados | Consistência |
| --- | --- | --- |
| MySQL | Contas, perfis, campus, cursos, componentes, estudantes, vínculos, casos e auditoria | Transações JPA, chaves estrangeiras e Flyway |
| MongoDB | Dossiê, registros de atendimento, versões de PEI, eventos e metadados de anexos | Controle otimista e índices; histórico do dossiê/atendimento junto ao agregado |
| Armazenamento de arquivos | Binários anexados | Chave aleatória e SHA-256; metadados no MongoDB |

A autorização consulta o vínculo relacional antes de liberar qualquer documento. Identificadores SQL presentes no MongoDB são referências, não cópias de cadastros. O frontend recebe DTOs de cadastro e projeções reduzidas conforme o perfil.

## Consistência entre armazenamentos

Não há transação distribuída. Uma falha entre a gravação do agregado, linha do tempo e auditoria pode deixar uma operação parcialmente registrada. O histórico de dossiê e atendimento é salvo atomicamente com o documento. A linha do tempo é uma projeção separada.

O PEI guarda as revisões em uma série por estudante, componente e código de período. Uma gravação condicional no MongoDB efetiva a aprovação e a substituição da versão vigente juntas. O token de versão da revisão protege ações enviadas a partir de uma tela desatualizada. Séries legadas preservam IDs, conteúdo autorizado e metadados históricos. Quando já existem vários rascunhos ou versões em revisão, vale a de maior número para o trabalho em andamento. A mesma regra identifica o vigente entre aprovados legados. As demais versões seguem consultáveis como substituídas.

Outbox ou reconciliação de eventos e auditoria entre bancos e o tratamento de uploads órfãos permanecem pendentes. Uma repetição após conflito preserva o estado do PEI. Ela não recompõe um evento que falhou após a gravação.

## Execução

Compose oferece MySQL 8, MongoDB 7, backend e frontend. As portas dos bancos ficam restritas ao host local. O proxy do frontend encaminha `/api` ao backend. O perfil `dev` cria contas e estudante fictícios; `prod` exige segredos externos e desativa seed e OpenAPI.

`DocumentStorage` separa operações binárias de metadados e autorização. Existe implementação local. Um adaptador S3 ainda precisa ser implementado e validado antes de armazenamento externo.
