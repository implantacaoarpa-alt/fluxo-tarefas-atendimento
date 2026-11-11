import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { criarApp } from "../src/app.js";
import { tituloDaMensagem } from "../src/tickets.js";

let base, servidor;
// Guarda o cookie do cliente como o navegador faz: os tickets agora pertencem a quem abriu.
let cookie = "";
const chamar = async (metodo, caminho, corpo) => {
  const r = await fetch(base + caminho, { method: metodo, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  cookie = r.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  return { status: r.status, dados: r.status === 204 ? null : await r.json() };
};

before(async () => {
  ({ servidor } = criarApp());
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

test("ticket de exemplo existe na primeira criação do banco, com prévia da última mensagem", async () => {
  const r = await chamar("GET", "/api/tickets");
  assert.equal(r.status, 200);
  const semente = r.dados.tickets.find((t) => t.id === "ticket-boas-vindas");
  assert.ok(semente);
  assert.equal(semente.lastMessage.role, "agent");
  const detalhe = (await chamar("GET", "/api/tickets/ticket-boas-vindas")).dados;
  assert.deepEqual(detalhe.messages.map((m) => m.role), ["user", "agent"]);
});

test("abrir ticket cria a primeira mensagem e tira o título dela", async () => {
  const r = await chamar("POST", "/api/tickets", { content: "  Não consigo mover cartões\nAparece um erro ao arrastar.  " });
  assert.equal(r.status, 201);
  assert.equal(r.dados.ticket.title, "Não consigo mover cartões");
  assert.equal(r.dados.ticket.status, "open");
  assert.equal(r.dados.messages.length, 1);
  assert.equal(r.dados.messages[0].role, "user");
  assert.equal(r.dados.messages[0].content, "Não consigo mover cartões\nAparece um erro ao arrastar.");
  assert.equal((await chamar("POST", "/api/tickets", { content: "   " })).status, 400);
  const lista = (await chamar("GET", "/api/tickets")).dados.tickets;
  assert.equal(lista[0].id, r.dados.ticket.id, "o mais recente vem primeiro");
});

test("conversa: usuário e agente escrevem; mensagem do usuário reabre ticket encerrado", async () => {
  const { ticket } = (await chamar("POST", "/api/tickets", { content: "Preciso de ajuda" })).dados;
  const resposta = await chamar("POST", `/api/tickets/${ticket.id}/messages`, { role: "agent", author: "Agente de suporte", content: "Claro, me conte mais." });
  assert.equal(resposta.status, 201);
  assert.equal(resposta.dados.message.author, "Agente de suporte");
  assert.equal((await chamar("POST", `/api/tickets/${ticket.id}/messages`, { role: "robo", content: "x" })).status, 400);

  assert.equal((await chamar("PATCH", `/api/tickets/${ticket.id}`, { status: "closed" })).dados.ticket.status, "closed");
  assert.equal((await chamar("PATCH", `/api/tickets/${ticket.id}`, { status: "talvez" })).status, 400);
  const reaberto = await chamar("POST", `/api/tickets/${ticket.id}/messages`, { content: "Voltou a acontecer" });
  assert.equal(reaberto.dados.ticket.status, "open");

  const detalhe = (await chamar("GET", `/api/tickets/${ticket.id}`)).dados;
  assert.deepEqual(detalhe.messages.map((m) => m.role), ["user", "agent", "user"]);
  assert.equal((await chamar("GET", "/api/tickets")).dados.tickets.find((t) => t.id === ticket.id).lastMessage.content, "Voltou a acontecer");
});

test("renomear e excluir ticket; mensagens caem junto", async () => {
  const { ticket } = (await chamar("POST", "/api/tickets", { content: "Para apagar" })).dados;
  assert.equal((await chamar("PATCH", `/api/tickets/${ticket.id}`, { title: "Novo nome" })).dados.ticket.title, "Novo nome");
  assert.deepEqual((await chamar("DELETE", `/api/tickets/${ticket.id}`)).dados, { ok: true });
  assert.equal((await chamar("GET", `/api/tickets/${ticket.id}`)).status, 404);
  assert.equal((await chamar("POST", `/api/tickets/${ticket.id}/messages`, { content: "x" })).status, 404);
});

test("título da mensagem: primeira linha não vazia, cortada em 80", () => {
  assert.equal(tituloDaMensagem("\n\n  Olá  \nresto"), "Olá");
  assert.equal(tituloDaMensagem("a".repeat(100)).length, 80);
});
