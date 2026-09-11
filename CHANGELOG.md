# Changelog

Todas as mudanças deste projeto serão documentadas neste arquivo.

## Em desenvolvimento — 2026-09-11

- Backend Maven com autenticação, permissões por campus/vínculo, auditoria, casos, dossiês, documentos e PEI.
- MongoDB para agregados documentais e MySQL para estrutura acadêmica e permissões.
- Frontend com formulários de acompanhamento, administração e revisão humana de PEI.
- Revogação de sessões, restrição de laudos, validação de arquivos e preservação de versões.
- Atualização autorizada de Angular 19 para Angular 20.3 por correções de segurança; auditoria das dependências de produção sem achados em 10/09/2026.
- Testes de backend, navegação dos sete perfis e fluxo integrado de dossiê, registros, documentos, linha do tempo e PEI.
- Catálogos administrativos de períodos/categorias, modelos documentais, cursos, componentes, contas, perfis e vínculos.
- Limitação de tentativas de login, histórico comparável, versionamento de anexos e filtro da linha do tempo.
- Compose completo validado com migrations Flyway V1–V3, health checks e recuperação de MySQL, MongoDB e anexos exercitada.
- CI com Maven, lint, build, testes Angular, auditoria de produção e E2E.
- Alertas, notificações, relatórios gerenciais e dashboards excluídos do escopo.

## [0.1.0] - 2026-04-23
### Adicionado
- Criação inicial do repositório do projeto NAPNE 360
- README acadêmico do projeto
- Changelog

## [0.1.0] - 2026-04-24
### Alterado
- Configura Dev Container para usar Java 21
### Adicionado
- backend com Spring Boot
- Configuração de execução do backend (launch.json)
- SETUP.md
