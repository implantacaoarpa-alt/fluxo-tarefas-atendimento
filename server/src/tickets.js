// Atendimento: tickets de suporte no formato de conversa. Contrato JSON em inglês, sem exigir login.
// Uma mensagem com role "agent" é a resposta de um agente; os agentes autônomos usarão a mesma rota.
import { randomUUID } from "node:crypto";
import { invalido, naoEncontrado, texto } from "./http.js";
import { transacao } from "./db.js";

const ROLES = ["user", "agent"];
const STATUS = ["open", "closed"];

const saidaMensagem = (m) => ({ id: m.id, ticketId: m.ticket_id, role: m.role, author: m.author, content: m.content, createdAt: m.criado_em });
const saidaTicket = (t) => ({
  id: t.id, title: t.title, status: t.status, createdAt: t.criado_em, updatedAt: t.atualizado_em,
  ...(t.ultima_role !== undefined ? { lastMessage: t.ultima_role ? { role: t.ultima_role, content: t.ultimo_conteudo } : null } : {}),
});

/** Título a partir da primeira mensagem: primeira linha, até 80 caracteres. */
export const tituloDaMensagem = (conteudo) => {
  const linha = conteudo.split("\n").map((l) => l.trim()).find(Boolean) ?? "Novo ticket";
  return linha.length > 80 ? `${linha.slice(0, 79).trimEnd()}…` : linha;
};

export function rotasDeTickets(app, db) {
  const buscarTicket = (id) => {
    const t = db.prepare("SELECT * FROM ticket WHERE id = ?").get(id);
    if (!t) throw naoEncontrado("Ticket");
    return t;
  };
  const mensagens = (ticketId) =>
    db.prepare("SELECT * FROM ticket_message WHERE ticket_id = ? ORDER BY criado_em, rowid").all(ticketId).map(saidaMensagem);

  const inserirMensagem = (ticketId, { role, author, content }) => {
    const m = { id: randomUUID(), ticket_id: ticketId, role, author, content, criado_em: new Date().toISOString() };
    db.prepare("INSERT INTO ticket_message (id, ticket_id, role, author, content, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
      .run(m.id, m.ticket_id, m.role, m.author, m.content, m.criado_em);
    db.prepare("UPDATE ticket SET atualizado_em = ? WHERE id = ?").run(m.criado_em, ticketId);
    return saidaMensagem(m);
  };

  const lerMensagem = (corpo) => {
    const role = corpo.role ?? "user";
    if (!ROLES.includes(role)) throw invalido(`role deve ser ${ROLES.join(" ou ")}.`);
    return {
      role,
      author: texto(corpo, "author", { min: 0, max: 80, opcional: true }) ?? "",
      content: texto(corpo, "content", { max: 10_000 }),
    };
  };

  // Lista mais recente primeiro, com a última mensagem para a prévia na lateral.
  app.get("/api/tickets", () => ({
    tickets: db.prepare(
      `SELECT t.*,
         (SELECT role FROM ticket_message m WHERE m.ticket_id = t.id ORDER BY m.criado_em DESC, m.rowid DESC LIMIT 1) AS ultima_role,
         (SELECT content FROM ticket_message m WHERE m.ticket_id = t.id ORDER BY m.criado_em DESC, m.rowid DESC LIMIT 1) AS ultimo_conteudo
       FROM ticket t ORDER BY t.atualizado_em DESC, t.rowid DESC`,
    ).all().map(saidaTicket),
  }));

  // Abrir ticket = primeira mensagem do usuário. O título vem dela se não for informado.
  app.post("/api/tickets", ({ corpo }) => {
    const content = texto(corpo, "content", { max: 10_000 });
    const title = texto(corpo, "title", { max: 120, opcional: true }) ?? tituloDaMensagem(content);
    return transacao(db, () => {
      const agora = new Date().toISOString();
      const id = randomUUID();
      db.prepare("INSERT INTO ticket (id, title, status, criado_em, atualizado_em) VALUES (?, ?, 'open', ?, ?)").run(id, title, agora, agora);
      inserirMensagem(id, { role: "user", author: "", content });
      return { ticket: saidaTicket(buscarTicket(id)), messages: mensagens(id) };
    });
  });

  app.get("/api/tickets/:id", ({ params }) => {
    const t = buscarTicket(params.id);
    return { ticket: saidaTicket(t), messages: mensagens(t.id) };
  });

  app.patch("/api/tickets/:id", ({ params, corpo }) => {
    const t = buscarTicket(params.id);
    const title = texto(corpo, "title", { max: 120, opcional: true }) ?? t.title;
    const status = corpo.status ?? t.status;
    if (!STATUS.includes(status)) throw invalido(`status deve ser ${STATUS.join(" ou ")}.`);
    db.prepare("UPDATE ticket SET title = ?, status = ? WHERE id = ?").run(title, status, t.id);
    return { ticket: saidaTicket(buscarTicket(t.id)) };
  });

  app.delete("/api/tickets/:id", ({ params }) => {
    const t = buscarTicket(params.id);
    db.prepare("DELETE FROM ticket WHERE id = ?").run(t.id); // mensagens caem em cascata
    return { ok: true };
  });

  // Nova mensagem na conversa. Mensagem do usuário reabre um ticket encerrado.
  app.post("/api/tickets/:id/messages", ({ params, corpo }) => {
    const t = buscarTicket(params.id);
    const dados = lerMensagem(corpo);
    return transacao(db, () => {
      const message = inserirMensagem(t.id, dados);
      if (dados.role === "user" && t.status === "closed") db.prepare("UPDATE ticket SET status = 'open' WHERE id = ?").run(t.id);
      return { message, ticket: saidaTicket(buscarTicket(t.id)) };
    });
  });
}
