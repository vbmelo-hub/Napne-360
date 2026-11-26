# Arquitetura do NAPNE 360

Monólito modular Java 21/Spring Boot, organizado sob `br.edu.ifac.napne360` em identidade, segurança, estudantes, casos, documentos, PEI e auditoria. O backend segue a estrutura Maven; Angular é um cliente separado da API `/api/v1`.

| Fonte de verdade | Dados | Consistência |
| --- | --- | --- |
| MySQL | Contas, perfis, campus, cursos, componentes, estudantes, vínculos, casos e auditoria | Transações JPA, chaves estrangeiras e Flyway |
| MongoDB | Dossiê, registros de atendimento, versões de PEI, eventos e metadados de anexos | Controle otimista e índices; histórico do dossiê/atendimento junto ao agregado |
| Armazenamento de arquivos | Binários anexados | Nome por operação e SHA-256 com metadados no MongoDB |

A autorização consulta o vínculo relacional antes de liberar qualquer documento. Identificadores SQL presentes no MongoDB são referências, não cópias de cadastros. O frontend recebe DTOs de cadastro e projeções reduzidas conforme o perfil.

## Consistência entre armazenamentos

MySQL, MongoDB e o armazenamento de arquivos gravam separadamente. A linha do tempo e a auditoria das mutações são atualizadas em segundo plano a partir de pendências salvas com a mudança principal.

O PEI guarda as revisões em uma série por estudante, componente e código de período. Uma gravação condicional no MongoDB efetiva a aprovação e a substituição da versão vigente juntas. O token de versão da revisão protege ações enviadas a partir de uma tela desatualizada. Séries legadas preservam IDs, conteúdo autorizado e metadados históricos. Quando já existem vários rascunhos ou versões em revisão, vale a de maior número para o trabalho em andamento. A mesma regra identifica o vigente entre aprovados legados. As demais versões seguem consultáveis como substituídas.

A mesma gravação do PEI inclui a pendência de linha do tempo e auditoria no documento da série. A API devolve a revisão confirmada e a aplicação processa a pendência em segundo plano. Se uma gravação falhar, o processamento tenta novamente e remove a pendência após confirmar os dois registros. Cada registro usa a mesma chave da operação para impedir duplicação em novas tentativas. A versão da série protege o conteúdo de alterações concorrentes.

O intervalo da varredura é configurável em `NAPNE_PEI_PROJECTION_RETRY_DELAY_MS` e tem padrão de 30 segundos. As leituras de socket usam limites configuráveis em `NAPNE_SQL_SOCKET_TIMEOUT_MS` e `NAPNE_MONGO_SOCKET_TIMEOUT_MS`, ambos de 15 segundos por padrão. A recuperação cobre as operações que foram gravadas com a pendência na série.

O dossiê e o atendimento salvam conteúdo, histórico e pendência na mesma gravação versionada do documento. A transação MySQL dos casos inclui o histórico e a pendência. A publicação do caso começa após o commit. Nos três fluxos, a aplicação retoma pendências e confirma cada operação somente depois de gravar a linha do tempo e a auditoria. O intervalo de nova tentativa é configurável em `NAPNE_MUTATION_PROJECTION_RETRY_DELAY_MS`. A recuperação republica as pendências de cada operação confirmada. Após perda da resposta HTTP na abertura de um caso ou no cadastro de atendimento, consulte o estado gravado antes de enviar outro POST.

O upload reserva metadados no MongoDB antes de gravar o binário. O anexo fica disponível depois que a aplicação confirma o tamanho e o SHA-256. Se essa confirmação falhar, a aplicação pode retomar um envio cujo arquivo já esteja completo. O navegador reaproveita a chave `Idempotency-Key` ao repetir o mesmo envio na tela. Clientes que usam a API podem informar a chave para obter a mesma versão em novas tentativas. Envios sem a chave são tratados como operações distintas. O arquivamento preserva o binário e usa a mesma publicação em segundo plano.

Arquivos gravados pela versão anterior sem metadados podem ser identificados em um inventário. Em uma janela sem escritas, compare os nomes das entradas regulares de `/data/uploads` com `storedName` da coleção `attachments`, incluindo registros arquivados e pendentes. Arquivos sem correspondência exigem conferência antes de qualquer ação. Preserve o binário quando faltarem dados para determinar o vínculo e a versão.

## Execução

Compose oferece MySQL 8, MongoDB 7, backend e frontend. As portas dos bancos ficam restritas ao host local. O proxy do frontend encaminha `/api` ao backend. O perfil `dev` cria contas e estudante fictícios; `prod` exige segredos externos e desativa seed e OpenAPI.

`DocumentStorage` separa operações binárias de metadados e autorização. Existe implementação local. Um adaptador S3 ainda precisa ser implementado e validado antes de armazenamento externo.
