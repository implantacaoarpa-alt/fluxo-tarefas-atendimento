# Automação do atendimento: progresso

## Etapa 00: projeto e acesso (2026-11-11)

**Cópia do projeto**
- URL: https://github.com/implantacaoarpa-alt/fluxo-tarefas-atendimento (pública; remote local `meu-github`, branch `main`)
- Original do professor: https://github.com/bittencourtthulio/App-Fluxo-Tarefas-V1 (remote `origin`, sem alterações)

**Ambiente**
- Node 26.13.0 (exige >= 22.13 por causa do `node:sqlite`); `npm run preflight`: "Ambiente pronto".
- Comandos do `package.json`: `dev`, `preflight`, `start`, `test`, `build`.
- `npm install`: concluído.

**Abrir o app**
- `npm run dev`: interface em http://127.0.0.1:5173 (atendimento em `/atendimento`), API em http://127.0.0.1:3001/api.

**Build**
- `npm run build`: ok (`✓ built in 826ms`, saída em `dist/`).

**Dados locais**
- O banco `server/dados/app.sqlite` foi preservado e fica fora do git (`.gitignore`). Na demonstração, usar somente dados fictícios.

**Acesso ao GitHub**
- Conta logada no `gh`: `implantacaoarpa-alt`.
- Actions no repositório: habilitadas (`allowed_actions: all`).
- Copilot: a conta tem só o **Copilot Free** (`free_limited_copilot`).
- **Pendência:** o Copilot cloud agent exige plano pago (Pro, Pro+, Business ou Enterprise). Sem ele, os arquivos dos agentes (`.github/agents/*.agent.md`) vão ser montados localmente, e a execução pelo cloud agent depende de habilitar o plano.

**Credenciais (separadas, valores nunca registrados aqui)**
- Backend local: hoje não usa nenhuma credencial (não há `.env`). Se passar a usar, ela fica em `.env` local, que já está no `.gitignore`.
- Actions: o secret `COPILOT_AGENT_TOKEN` vai ser usado só nos workflows. Ainda não foi criado (o repositório não tem nenhum secret).

**Ainda não feito (de propósito)**
- Nenhuma configuração remota.
- Nenhum ticket de teste aberto.

## Etapa 03: app, issue e coordenador (2026-11-11)

- Ticket novo pertence a quem abriu (usuário logado ou cookie `cliente`), e só o dono lê. Tickets antigos ficam sem dono e continuam visíveis.
- Com `AGENT_RUNTIME=github-native`, o backend (`server/src/integracao-github.js`) cria a issue `origin:app`, que é a mesma usada pelo Copilot, e guarda no SQLite (`ticket_github`) o requestId, a issue, o PR, a fase e os IDs das mensagens do N1 já enviadas.
- `.github/workflows/native-agents.yml` roda `automacao/controlador.mjs` da `main`: lê a origem, publica o resumo interno na issue e atribui ao `copilot-swe-agent[bot]` com `custom_agent=coordenador`. Ele acompanha issue e PR e pode ser retomado por `workflow_dispatch`.
- Credenciais: `FLUXO_GITHUB_TOKEN` (local, no `.env`) para o backend; secret `COPILOT_AGENT_TOKEN` só para a atribuição; `GITHUB_TOKEN` efêmero para o controle.
- Não havia motor antigo para suspender.
- Conferido localmente em dry-run, com dados fictícios: o dono lê (200) e outro cliente recebe 404; a mensagem do N1 foi gravada; a atribuição foi montada; houve 0 chamadas ao GitHub. `npm test` (26 ok) e `npm run build` ok.
- Pendente: plano pago do Copilot; criar a variável `AGENT_RUNTIME` e o secret `COPILOT_AGENT_TOKEN` no repositório; preencher o `.env` local; ensaio com `AGENT_DRY_RUN=false`.

## Etapa 03 (runtime github-actions, IA própria): 2026-11-11

- Ticket novo com `AGENT_RUNTIME=github-actions`: o backend cria a issue `origin:app` (com o requestId e o runtime no corpo) pelo `gh` já logado e faz o dispatch explícito de `ai-agents.yml`. O estado no SQLite guarda runtime, run_id e result_path.
- `.github/workflows/ai-agents.yml` + `automacao/ai-controlador.mjs`: valida a origem (autor = `APP_ISSUE_AUTHOR`, mais requestId e runtime), relê o estado (comentário de controle na issue) e faz 1 chamada à IA com timeout. A resposta é validada fora do modelo. O build da proposta roda num job sem segredos, e o PR é aberto só fora do dry-run, sem merge.
- O motor `github-native` está suspenso para tickets novos; casos nativos em andamento continuam sendo acompanhados.
- Verificação local (dados fictícios, GitHub simulado, 0 chamadas externas): dono 200 e outro cliente 404; entrada do coordenador e disparo montados; preparar → chamar (simulado) → registrar → aplicar; repetir o disparo não refaz nada; reconciliação gerou as mensagens do N1 no app sem duplicar. `npm test` 26 ok; `npm run build` ok.
- Pendente para o ensaio real:
  - informar o provedor de IA (e a API oficial dele) para habilitar o adaptador;
  - variáveis `AGENT_RUNTIME`, `APP_ISSUE_AUTHOR`, `AI_PROVIDER` e `AI_MODEL`;
  - secret `AI_API_KEY`;
  - habilitar "Allow GitHub Actions to create and approve pull requests";
  - `.env` local com `AGENT_RUNTIME=github-actions` e `GITHUB_REPO`;
  - enviar os arquivos para a `main`.
