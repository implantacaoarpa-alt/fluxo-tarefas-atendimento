// SQLite embutido do Node (node:sqlite). Migrações em ordem; cada uma roda uma única vez.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRACOES = [
  `CREATE TABLE item (
     id TEXT PRIMARY KEY,
     titulo TEXT NOT NULL,
     descricao TEXT NOT NULL DEFAULT '',
     concluido INTEGER NOT NULL DEFAULT 0,
     posicao INTEGER NOT NULL,
     criado_em TEXT NOT NULL,
     atualizado_em TEXT NOT NULL
   )`,
  `CREATE TABLE usuario (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     nome TEXT NOT NULL,
     senha_hash TEXT NOT NULL,
     criado_em TEXT NOT NULL
   );
   CREATE TABLE sessao (
     token_hash TEXT PRIMARY KEY,
     usuario_id TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
     expira_em TEXT NOT NULL
   )`,
  `CREATE TABLE board (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     criado_em TEXT NOT NULL
   );
   CREATE TABLE list (
     id TEXT PRIMARY KEY,
     board_id TEXT NOT NULL REFERENCES board(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     position INTEGER NOT NULL
   );
   CREATE TABLE card (
     id TEXT PRIMARY KEY,
     list_id TEXT NOT NULL REFERENCES list(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     position INTEGER NOT NULL
   )`,
  // Seeds rodam uma única vez (controlado pelo user_version), só na primeira criação do banco.
  `INSERT INTO board (id, title, criado_em) VALUES
     ('board-sprint', 'Sprint da semana', '2026-11-10T09:00:00.000Z'),
     ('board-ideias', 'Ideias do produto', '2026-11-10T09:00:01.000Z');
   INSERT INTO list (id, board_id, title, position) VALUES
     ('list-a-fazer', 'board-sprint', 'A fazer', 0),
     ('list-fazendo', 'board-sprint', 'Fazendo', 1),
     ('list-pronto', 'board-sprint', 'Pronto para revisar', 2),
     ('list-backlog', 'board-ideias', 'Backlog', 0);
   INSERT INTO card (id, list_id, title, description, position) VALUES
     ('card-requisitos', 'list-a-fazer', 'Levantar requisitos do quadro', 'O que o quadro precisa resolver antes da primeira versão.', 0),
     ('card-telas', 'list-a-fazer', 'Desenhar as telas do quadro', '', 1),
     ('card-api', 'list-fazendo', 'Montar a API de quadros', 'Boards, listas e cartões com movimentação entre listas.', 0),
     ('card-paleta', 'list-pronto', 'Escolher a paleta de cores', '', 0),
     ('card-metricas', 'list-backlog', 'Medir tempo por cartão', '', 0);`,
  // Atendimento: cada ticket é uma conversa. `role` diz quem escreveu: o usuário ou um agente
  // (os agentes autônomos vão responder pela mesma rota de mensagens, com role = 'agent').
  `CREATE TABLE ticket (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
     criado_em TEXT NOT NULL,
     atualizado_em TEXT NOT NULL
   );
   CREATE TABLE ticket_message (
     id TEXT PRIMARY KEY,
     ticket_id TEXT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
     author TEXT NOT NULL DEFAULT '',
     content TEXT NOT NULL,
     criado_em TEXT NOT NULL
   );
   CREATE INDEX ticket_message_por_ticket ON ticket_message (ticket_id, criado_em);
   INSERT INTO ticket (id, title, status, criado_em, atualizado_em) VALUES
     ('ticket-boas-vindas', 'Como convidar minha equipe para um quadro?', 'open', '2026-11-10T13:00:00.000Z', '2026-11-10T13:02:00.000Z');
   INSERT INTO ticket_message (id, ticket_id, role, author, content, criado_em) VALUES
     ('msg-boas-vindas-1', 'ticket-boas-vindas', 'user', '', 'Como convidar minha equipe para um quadro?', '2026-11-10T13:00:00.000Z'),
     ('msg-boas-vindas-2', 'ticket-boas-vindas', 'agent', 'Assistente Fluxo', 'Olá! Por enquanto os quadros são compartilhados por todos que usam o Fluxo, então sua equipe já enxerga o que você cria.

Se precisar de algo mais, é só escrever aqui neste ticket.', '2026-11-10T13:02:00.000Z');`,
  // Dono do ticket (usuário logado ou cliente anônimo por cookie) e o estado mínimo da ponte com o GitHub.
  // Tickets antigos ficam sem dono (NULL) e continuam como estavam.
  `ALTER TABLE ticket ADD COLUMN owner_id TEXT;
   CREATE TABLE ticket_github (
     ticket_id TEXT PRIMARY KEY REFERENCES ticket(id) ON DELETE CASCADE,
     request_id TEXT NOT NULL UNIQUE,
     issue_number INTEGER,
     pr_number INTEGER,
     fase TEXT NOT NULL,
     mensagens_enviadas TEXT NOT NULL DEFAULT '[]',
     atualizado_em TEXT NOT NULL
   )`,
  // Runtime de cada caso (casos github-native em andamento continuam no runtime deles),
  // a execução do workflow e o caminho do relatório.
  `ALTER TABLE ticket_github ADD COLUMN runtime TEXT NOT NULL DEFAULT 'github-native';
   ALTER TABLE ticket_github ADD COLUMN run_id INTEGER;
   ALTER TABLE ticket_github ADD COLUMN result_path TEXT`,
];

/** `caminho` = arquivo do banco; `:memory:` nos testes. */
export function abrirBanco(caminho = ":memory:") {
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const atual = db.prepare("PRAGMA user_version").get().user_version;
  for (let i = atual; i < MIGRACOES.length; i++) {
    db.exec("BEGIN");
    try { db.exec(MIGRACOES[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  return db;
}

/** Roda `fn` numa transação; desfaz tudo se ela lançar. */
export function transacao(db, fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}
