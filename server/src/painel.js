// Painel de atendimento (somente leitura): todos os tickets, de todos os donos, com a situação da automação.
// O app não tem login de administrador: o painel só responde a acessos da própria máquina (loopback).
import { ErroHttp, naoEncontrado } from "./http.js";

const LOCAL = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const apenasLocal = ({ req }) => {
  if (!LOCAL.includes(req.socket.remoteAddress)) throw new ErroHttp(403, "Painel disponível só na máquina local.");
};

/** Dono sem expor o identificador inteiro: tipo + 6 primeiros caracteres. */
const dono = (ownerId) => {
  if (!ownerId) return { tipo: "antigo", rotulo: "Sem dono (anterior)" };
  const [tipo, id] = ownerId.split(":");
  return { tipo, rotulo: `${tipo === "usuario" ? "Usuário" : "Cliente"} ${id.slice(0, 6)}` };
};

const saida = (t) => ({
  id: t.id,
  title: t.title,
  status: t.status,
  createdAt: t.criado_em,
  updatedAt: t.atualizado_em,
  owner: dono(t.owner_id),
  messageCount: t.total,
  lastRole: t.ultima_role,
  automation: t.request_id
    ? { runtime: t.runtime, phase: t.fase, issue: t.issue_number, pr: t.pr_number, runId: t.run_id, requestId: t.request_id }
    : null,
});

const CONSULTA = `
  SELECT t.*, g.request_id, g.runtime, g.fase, g.issue_number, g.pr_number, g.run_id,
    (SELECT COUNT(*) FROM ticket_message m WHERE m.ticket_id = t.id) AS total,
    (SELECT role FROM ticket_message m WHERE m.ticket_id = t.id ORDER BY m.criado_em DESC, m.rowid DESC LIMIT 1) AS ultima_role
  FROM ticket t LEFT JOIN ticket_github g ON g.ticket_id = t.id`;

export function rotasDoPainel(app, db, { repo = "" } = {}) {
  app.get("/api/painel/tickets", (ctx) => {
    apenasLocal(ctx);
    return { repo, tickets: db.prepare(`${CONSULTA} ORDER BY t.atualizado_em DESC, t.rowid DESC`).all().map(saida) };
  });

  app.get("/api/painel/tickets/:id", (ctx) => {
    apenasLocal(ctx);
    const t = db.prepare(`${CONSULTA} WHERE t.id = ?`).get(ctx.params.id);
    if (!t) throw naoEncontrado("Ticket");
    const messages = db.prepare("SELECT * FROM ticket_message WHERE ticket_id = ? ORDER BY criado_em, rowid").all(t.id)
      .map((m) => ({ id: m.id, role: m.role, author: m.author, content: m.content, createdAt: m.criado_em }));
    return { repo, ticket: saida(t), messages };
  });
}
