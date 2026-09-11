# Rastreabilidade de requisitos

Esta matriz corresponde à entrega da branch `codex/implementacao-completa-napne-360`. Alertas, notificações, relatórios gerenciais e dashboards (RF15–RF19) foram excluídos por solicitação do usuário.

| Requisito | Backend e dados | Interface | Evidência automatizada | Situação |
| --- | --- | --- | --- | --- |
| RF01 | `AuthController`, JWT, BCrypt, renovação, logout, troca/reset de senha e limitação de tentativas | Login e Minha conta | `JwtServiceTest`, `JwtAuthenticationFilterTest`, `LoginRateLimiterTest`, E2E de perfis | Implementado com autenticação local; SSO futuro depende do IFAC |
| RF02 | `RoleName` e contas com múltiplos perfis | Navegação adaptada aos sete perfis | `AccessGuardTest`, `profiles.spec.ts` | Implementado |
| RF03 | `AccessGuard`, campus e vínculos estudante/componente | Ações sensíveis ocultadas conforme perfil | `AccessGuardTest`, negações em `workflow-api.spec.ts` | Implementado e autorizado no servidor |
| RF04 | `AuditService`, interceptadores de leitura/admin e auditoria explícita de autenticação, permissões, upload/download | Consulta administrativa de auditoria via API | Contexto Maven e E2E das operações auditadas | Implementado para as operações existentes no escopo |
| RF05 | `StudentService` no MySQL e `DossierService` no MongoDB, com versão otimista | Cadastro, atualização e roteiro estruturado | E2E integrado | Implementado |
| RF06 | `CaseService`, etapas, responsável, datas e eventos | Abertura e mudança de etapa | E2E integrado | Implementado |
| RF07 | `DocumentStorage`, validação de MIME/assinatura/DOCX, SHA-256, versões e arquivamento | Upload, seleção de versão anterior e download | `LocalStorageServiceTest`; E2E de upload, download, versão e negação | Implementado com filesystem local; provedor externo é extensão operacional |
| RF08 | Catálogo SQL administrável e migration V3 | Administração de categorias | Migração real pelo Compose | Implementado e extensível |
| RF09 | Snapshots do dossiê, histórico de registros, versões do PEI e eventos | Comparação de versões do dossiê | `PeiServiceTest`, E2E integrado | Implementado |
| RF10 | `CareRecordService` e `TEACHER_FEEDBACK` estruturado | Formulário rápido por perfil | E2E docente | Implementado |
| RF11 | `TUTOR_OBSERVATION` com vínculo obrigatório | Formulário de observação | E2E tutor e `AccessGuardTest` | Implementado |
| RF12 | Eventos Mongo com visibilidade, filtro por tipo/período e limite; inclui casos, dossiê, registros, PEI e documentos | Linha do tempo com filtro por tipo | E2E integrado, inclusive documentos | Implementado |
| RF13 | Rascunho determinístico a partir de dados pedagógicos autorizados e modelos | Criação guiada por componente/docente/período | `PeiServiceTest`, E2E integrado | Implementado sem IA e sem decisão automática |
| RF14 | Revisões imutáveis, estados, substituição, autoria e aprovação humana identificada | Editor completo e inventário de habilidades | `PeiServiceTest`, teste de bloqueio de aprovação direta e E2E | Implementado |
| RNF01 | Segredos por ambiente, RBAC, minimização, upload seguro, auditoria, rate limit, backup/restore com hashes | CSP, mensagens não sensíveis e sessão no `sessionStorage` | Testes de segurança, `npm audit --omit=dev`, exercício real de recuperação | Implementado no escopo; política institucional de retenção continua externa |
| RNF02 | DTOs minimizados e validação | Português, responsividade, labels, foco visível, teclado e estados | `login.spec.ts`, testes Angular e E2E por perfil | Implementado; homologação formal WCAG requer avaliação institucional assistiva |
| RNF03 | Paginação de estudantes, índices SQL/Mongo, filtros e limites | Busca e filtros | Build, migrações e E2E | Implementado para os fluxos críticos; metas devem ser recalibradas com carga real |
| RNF04 | Flyway V1–V3, health checks, erros consistentes e scripts de recuperação | Estados de erro | Compose completo e restauração exercitada | Implementado |
| RNF05 | API stateless, agregados documentais e storage abstrato | Lazy loading de rotas | Builds de produção | Implementado para a escala inicial do monólito |
| RNF06 | Maven convencional, módulos por domínio, Angular estrito, ESLint, CI e documentação | Componentes standalone | Maven verify, lint, build, testes e workflow CI | Implementado |

## Limites externos explícitos

- SIGAA, SEI e SSO não possuem API/credenciais fornecidas; não há integração inventada. A autenticação local e os cadastros administrativos são o fallback funcional.
- O provedor de binários ativo é filesystem. `DocumentStorage` mantém o limite para uma futura implementação S3 compatível, que exigirá provedor, bucket, chaves e política institucional.
- Retenção, expurgo, RPO/RTO e resposta legal a incidentes dependem de decisão formal do IFAC; o sistema preserva histórico e oferece backup/restauração, mas não presume esses prazos.
- O Angular foi atualizado da linha 19 para 20.3 com autorização do usuário para remover vulnerabilidades de produção conhecidas.
