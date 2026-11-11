// Atendimento: tickets de suporte no formato de conversa. Contrato JSON em inglês, sem exigir login.
// Uma mensagem com role "agent" é a resposta de um agente; os agentes autônomos usarão a mesma rota.
import { randomUUID } from "node:crypto";
import { invalido, naoEncontrado, texto } from "./http.js";
import { transacao } from "./db.js";
import { usuarioDaSessao } from "./auth.js";
import { ROTULOS_FASE } from "./integracao-github.js";

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

const COOKIE_CLIENTE = "cliente";
const lerCookie = (req, nome) =>
  (req.headers.cookie ?? "").split(";").map((p) => p.trim()).find((p) => p.startsWith(`${nome}=`))?.slice(nome.length + 1) ?? null;

export function rotasDeTickets(app, db, integracao = null) {
  /** Dono do pedido: usuário logado ou, sem login, um cliente anônimo identificado por cookie. */
  const dono = ({ req, res }) => {
    const u = usuarioDaSessao(db, req);
    if (u) return `usuario:${u.id}`;
    const c = lerCookie(req, COOKIE_CLIENTE);
    if (c && /^[0-9a-f-]{36}$/.test(c)) return `cliente:${c}`;
    const novo = randomUUID();
    res.setHeader("set-cookie", `${COOKIE_CLIENTE}=${novo}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
    return `cliente:${novo}`;
  };
  // Só o dono lê o ticket. Tickets antigos, sem dono, continuam visíveis como antes.
  const buscarTicket = (id, donoId) => {
    const t = db.prepare("SELECT * FROM ticket WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)").get(id, donoId);
    if (!t) throw naoEncontrado("Ticket");
    return t;
  };
  /** Status do atendimento vindo da issue (fase sincronizada), mostrado como linha neutra no chat. */
  const progresso = (ticketId) => {
    const g = db.prepare("SELECT fase, atualizado_em FROM ticket_github WHERE ticket_id = ?").get(ticketId);
    return g ? { phase: g.fase, label: ROTULOS_FASE[g.fase] ?? g.fase, updatedAt: g.atualizado_em } : null;
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
  app.get("/api/tickets", (ctx) => ({
    tickets: db.prepare(
      `SELECT t.*,
         (SELECT role FROM ticket_message m WHERE m.ticket_id = t.id ORDER BY m.criado_em DESC, m.rowid DESC LIMIT 1) AS ultima_role,
         (SELECT content FROM ticket_message m WHERE m.ticket_id = t.id ORDER BY m.criado_em DESC, m.rowid DESC LIMIT 1) AS ultimo_conteudo
       FROM ticket t WHERE t.owner_id = ? OR t.owner_id IS NULL ORDER BY t.atualizado_em DESC, t.rowid DESC`,
    ).all(dono(ctx)).map(saidaTicket),
  }));

  // Abrir ticket = primeira mensagem do usuário. O título vem dela se não for informado.
  // Com AGENT_RUNTIME ligado, o ticket novo também abre a issue origin:app (ver integracao-github.js).
  // A issue é criada em segundo plano: o cliente não espera o GitHub; a mensagem do N1 chega pela atualização da conversa.
  app.post("/api/tickets", async (ctx) => {
    const { corpo } = ctx;
    const donoId = dono(ctx);
    const content = texto(corpo, "content", { max: 10_000 });
    const title = texto(corpo, "title", { max: 120, opcional: true }) ?? tituloDaMensagem(content);
    const id = transacao(db, () => {
      const agora = new Date().toISOString();
      const novo = randomUUID();
      db.prepare("INSERT INTO ticket (id, title, status, owner_id, criado_em, atualizado_em) VALUES (?, ?, 'open', ?, ?, ?)").run(novo, title, donoId, agora, agora);
      inserirMensagem(novo, { role: "user", author: "", content });
      return novo;
    });
    integracao?.aoAbrirTicket({ id, title, content }).catch((e) => console.error(`[atendimento] integração falhou: ${e.message}`));
    return { ticket: saidaTicket(buscarTicket(id, donoId)), messages: mensagens(id), progress: progresso(id) };
  });

  app.get("/api/tickets/:id", (ctx) => {
    const t = buscarTicket(ctx.params.id, dono(ctx));
    return { ticket: saidaTicket(t), messages: mensagens(t.id), progress: progresso(t.id) };
  });

  // Chat aberto ou botão "Atualizar": consulta a issue agora (com limite de frequência) e devolve a conversa.
  app.post("/api/tickets/:id/sincronizar", async (ctx) => {
    const donoId = dono(ctx);
    buscarTicket(ctx.params.id, donoId);
    const { sincronizadoEm } = (await integracao?.sincronizarTicket(ctx.params.id)) ?? { sincronizadoEm: null };
    const t = buscarTicket(ctx.params.id, donoId);
    return { ticket: saidaTicket(t), messages: mensagens(t.id), progress: progresso(t.id), sincronizadoEm };
  });

  app.patch("/api/tickets/:id", (ctx) => {
    const { corpo } = ctx;
    const donoId = dono(ctx);
    const t = buscarTicket(ctx.params.id, donoId);
    const title = texto(corpo, "title", { max: 120, opcional: true }) ?? t.title;
    const status = corpo.status ?? t.status;
    if (!STATUS.includes(status)) throw invalido(`status deve ser ${STATUS.join(" ou ")}.`);
    db.prepare("UPDATE ticket SET title = ?, status = ? WHERE id = ?").run(title, status, t.id);
    return { ticket: saidaTicket(buscarTicket(t.id, donoId)) };
  });

  app.delete("/api/tickets/:id", (ctx) => {
    const t = buscarTicket(ctx.params.id, dono(ctx));
    db.prepare("DELETE FROM ticket WHERE id = ?").run(t.id); // mensagens caem em cascata
    return { ok: true };
  });

  // Nova mensagem na conversa. Mensagem do usuário reabre um ticket encerrado.
  app.post("/api/tickets/:id/messages", (ctx) => {
    const { corpo } = ctx;
    const donoId = dono(ctx);
    const t = buscarTicket(ctx.params.id, donoId);
    const dados = lerMensagem(corpo);
    return transacao(db, () => {
      const message = inserirMensagem(t.id, dados);
      if (dados.role === "user" && t.status === "closed") db.prepare("UPDATE ticket SET status = 'open' WHERE id = ?").run(t.id);
      return { message, ticket: saidaTicket(buscarTicket(t.id, donoId)) };
    });
  });
}
