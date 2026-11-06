# Segurança e privacidade

## Acesso

| Perfil | Escopo | Conteúdo |
| --- | --- | --- |
| NAPNE | Campus da conta | Cadastro, caso, dossiê, documentos e acompanhamento |
| Professor | Estudantes e componentes vinculados | Orientações pedagógicas, devolutivas e PEIs |
| Tutor | Estudantes vinculados | Observações e conteúdo pedagógico autorizado |
| COTEP/coordenação | Estudantes explicitamente vinculados | Acompanhamento pedagógico e colaboração em PEI |
| Gestão | Estudantes explicitamente vinculados | Supervisão pedagógica de leitura |
| Administrador | Configuração técnica | Contas, estrutura e vínculos; sem acesso automático ao conteúdo estudantil |

A autorização ocorre no servidor. O frontend oculta navegação sensível, mas não é o controle de segurança. Para usuários pedagógicos, o dossiê livre é redigido: informações destinadas ao ensino devem ser registradas em orientações pedagógicas. Somente NAPNE acessa anexos; não existe liberação automática de laudos por vínculo docente. Nome social é priorizado; dados civis/contato são omitidos de DTOs pedagógicos.

## Autenticação

Senhas são armazenadas com BCrypt custo 12. Contas novas exigem pelo menos 12 caracteres. Tokens expiram, são renovados explicitamente e carregam uma versão de sessão confrontada com a conta. Logout, alteração de senha e inativação revogam versões anteriores. Logout encerra todas as sessões dessa conta.

O login limita cinco falhas por combinação conta/IP em quinze minutos e sessenta tentativas por IP em um minuto. A implementação é local à instância e adequada ao monólito inicial; uma implantação com várias réplicas deve mover os contadores para armazenamento compartilhado no perímetro ou em serviço dedicado.

O cliente guarda o token em `sessionStorage`, não em armazenamento persistente. Isso não elimina risco de XSS: é necessário manter dependências corrigidas, evitar HTML arbitrário e usar HTTPS em produção. CSRF está desativado porque a API autentica somente pelo cabeçalho Bearer, sem cookie de autenticação automaticamente anexado pelo navegador.

Produção exige `JWT_SECRET`, `DB_PASSWORD` e `MONGODB_URI` por ambiente. O seed e OpenAPI ficam desativados no perfil `prod`. O Compose fornecido é para desenvolvimento com credenciais fictícias públicas, não um manifesto de produção.

## Documentos e auditoria

Upload: até 10 MB, MIME permitido e assinatura de conteúdo, chave aleatória com extensão definida no servidor, hash SHA-256. DOCX tem limite de expansão/entradas e rejeita macros. Downloads usam `Content-Disposition: attachment`. Essa validação não é um antivírus e não garante que todo PDF seja inofensivo.

Auditoria registra ação, identificador, ator, data e resultado; não grava senha, token ou conteúdo de laudo. Consultas a estudantes são auditadas por rota-modelo sem parâmetros de busca. O histórico clínico não é copiado para logs.

## Operação institucional

A implantação exige política institucional de finalidade, responsáveis, concessão/revogação de vínculos e prazos de retenção por classe documental. A versão atual não automatiza expurgo. Arquivamento é lógico, preservando histórico; não se deve prometer eliminação automática.

Os scripts em `scripts/` criam e restauram um conjunto com MySQL, MongoDB e anexos, validado por SHA-256. O procedimento foi exercitado no ambiente de demonstração; em produção, backups devem ser criptografados, copiados para domínio de falha diferente e testados periodicamente. Consulte `backup-and-restore.md`.

A auditoria de dependências de produção do frontend não encontrou vulnerabilidades. A árvore de desenvolvimento contém avisos moderados em ferramentas do servidor de desenvolvimento Angular sem correção disponível na linha atual; elas não são copiadas para a imagem Nginx de produção. A instituição deve manter atualização e monitoramento contínuos.

Em suspeita de acesso indevido: inativar a conta afetada, preservar auditoria e backups, identificar o alcance, corrigir o controle e encaminhar a ocorrência ao responsável institucional por proteção de dados. Requisitos legais de comunicação devem ser avaliados pela instituição, sem inferência automática pelo sistema.
