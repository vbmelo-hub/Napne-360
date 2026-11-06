# Arquitetura do NAPNE 360

Monólito modular Java 21/Spring Boot, organizado sob `br.edu.ifac.napne360` em identidade, segurança, estudantes, casos, documentos, PEI e auditoria. O backend segue a estrutura Maven; Angular é um cliente separado da API `/api/v1`.

| Fonte de verdade | Dados | Consistência |
| --- | --- | --- |
| MySQL | Contas, perfis, campus, cursos, componentes, estudantes, vínculos, casos e auditoria | Transações JPA, chaves estrangeiras e Flyway |
| MongoDB | Dossiê, registros de atendimento, versões de PEI, eventos e metadados de anexos | Controle otimista e índices; histórico do dossiê/atendimento junto ao agregado |
| Armazenamento de arquivos | Binários anexados | Chave aleatória e SHA-256; metadados no MongoDB |

A autorização consulta o vínculo relacional antes de liberar qualquer documento. Identificadores SQL presentes no MongoDB são referências, não cópias de cadastros. O frontend recebe DTOs de cadastro e projeções reduzidas conforme o perfil.

## Consistência entre armazenamentos

Não há transação distribuída. Uma falha entre a gravação do agregado, linha do tempo e auditoria pode deixar uma operação parcialmente registrada. O histórico embutido de dossiê e atendimento é salvo atomicamente com o documento; a linha do tempo é uma projeção separada. PEIs têm índice único por estudante/componente/período/revisão. A nova versão é persistida antes da marcação da anterior como substituída para preservar conteúdo.

Uma entrega institucional ainda exige outbox/reconciliação para eventos e auditoria entre bancos, teste de concorrência de PEI e tratamento de uploads órfãos. A infraestrutura atual não deve ser descrita como transacional entre MySQL, MongoDB e filesystem.

## Execução

Compose oferece MySQL 8, MongoDB 7, backend e frontend. As portas dos bancos ficam restritas ao host local. O proxy do frontend encaminha `/api` ao backend. O perfil `dev` cria contas e estudante fictícios; `prod` exige segredos externos e desativa seed e OpenAPI.

`DocumentStorage` separa operações binárias de metadados e autorização. Existe implementação local. Um adaptador S3 ainda precisa ser implementado e validado antes de armazenamento externo.
