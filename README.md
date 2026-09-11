# NAPNE 360

Plataforma de acompanhamento educacional inclusivo: cadastro e dossiê, atendimento, estudo de caso, orientações pedagógicas, plano de ação, devolutivas docentes, observações de tutoria e PEI por componente.

Entrega desenvolvida na branch `codex/implementacao-completa-napne-360`. A matriz de [rastreabilidade](docs/requirements-traceability.md) liga os requisitos à implementação e aos testes. Alertas, notificações, relatórios gerenciais e dashboards estão fora do escopo.

## Tecnologias

- Java 21, Spring Boot 3.5, Maven Wrapper.
- Angular 20.3 / TypeScript 5.9; Node 22 atualizado ou Node 24.15.
- MySQL 8: contas, permissões, vínculos, cadastros e auditoria.
- MongoDB 7: dossiês, registros, modelos, versões de PEI e metadados.
- Arquivos locais com validação, hash e acesso autorizado.

O Angular 19 originalmente previsto foi atualizado com autorização do usuário para corrigir vulnerabilidades. Veja [ADR 0002](docs/adr/0002-angular-security-update.md).

## Executar localmente

Com Docker disponível:

```sh
docker compose up -d --build --wait
```

Frontend: http://localhost:4200

API: http://localhost:9000
OpenAPI de desenvolvimento: http://localhost:9000/swagger-ui.html

O Compose contém configurações exclusivamente de desenvolvimento. As imagens, health checks, migrations e fluxos E2E foram validados em conjunto; isso não substitui homologação institucional de produção.

Para desenvolver com Java/Node locais, siga [SETUP.md](SETUP.md).

## Demonstração

Contas fictícias, criadas somente no perfil `dev`:

| Perfil | Conta |
| --- | --- |
| Administração | admin@napne.local |
| NAPNE | napne@napne.local |
| Professor | professor@napne.local |
| Tutor | tutor@napne.local |
| COTEP | cotep@napne.local |
| Coordenação | coordenacao@napne.local |
| Gestão | gestao@napne.local |

Senha de demonstração para essas contas: `Napne360!Demo`.

O estudante “Alex Exemplo” e os vínculos são fictícios. Administrador não recebe acesso automático ao dossiê. Docentes e tutores acessam somente atribuições autorizadas. Anexos clínicos ficam restritos à equipe NAPNE.

## Verificação

No backend:

```sh
./mvnw clean verify
```

No Windows, use `mvnw.cmd clean verify` com `JAVA_HOME` apontando para Java 21.

No frontend:

```sh
npm ci
npm run build
npm test -- --browsers=ChromeHeadless
npm run e2e
npm audit --omit=dev
```

E2E exige Chrome, API disponível na porta 9000 e seed de desenvolvimento. Os testes criam somente dados fictícios, identificados por matrícula `TEST-...`, e preservam o histórico.

## Documentação

- [Configuração](SETUP.md)
- [Arquitetura](docs/architecture.md)
- [Decisão de persistência](docs/adr/0001-persistencia-hibrida.md)
- [Segurança e privacidade](docs/security-and-privacy.md)
- [Backup e restauração](docs/backup-and-restore.md)
- [Registro de verificação](docs/verification.md)
- [Guia de uso](docs/user-guide.md)
- [Rastreabilidade e pendências](docs/requirements-traceability.md)
- [Changelog](CHANGELOG.md)

Não há integração ativa com SIGAA, SEI ou SSO. O PEI é um rascunho determinístico com revisão humana identificada; não faz diagnóstico nem recomenda tratamento.
