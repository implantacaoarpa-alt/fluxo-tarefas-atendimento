import assert from "node:assert/strict";
import { test } from "node:test";
import { agruparTickets, aguardandoAgente, grupoDaData } from "../src/atendimento.js";

const agora = new Date(2026, 10, 11, 15, 0);
const em = (dias, hora = 10) => new Date(2026, 10, 11 - dias, hora, 0).toISOString();

test("grupoDaData separa hoje, ontem, 7 e 30 dias e mais antigos", () => {
  assert.equal(grupoDaData(em(0, 0), agora), "Hoje");
  assert.equal(grupoDaData(em(1, 23), agora), "Ontem");
  assert.equal(grupoDaData(em(5), agora), "Últimos 7 dias");
  assert.equal(grupoDaData(em(20), agora), "Últimos 30 dias");
  assert.equal(grupoDaData(em(90), agora), "Mais antigos");
});

test("agruparTickets mantém a ordem e junta vizinhos do mesmo grupo", () => {
  const tickets = [{ id: "a", updatedAt: em(0) }, { id: "b", updatedAt: em(0) }, { id: "c", updatedAt: em(1) }, { id: "d", updatedAt: em(40) }];
  assert.deepEqual(
    agruparTickets(tickets, agora).map((g) => [g.rotulo, g.tickets.map((t) => t.id)]),
    [["Hoje", ["a", "b"]], ["Ontem", ["c"]], ["Mais antigos", ["d"]]],
  );
  assert.deepEqual(agruparTickets([], agora), []);
});

test("aguardandoAgente: ticket aberto com a última fala do usuário", () => {
  const aberto = { status: "open" };
  assert.equal(aguardandoAgente(aberto, [{ role: "agent" }, { role: "user" }]), true);
  assert.equal(aguardandoAgente(aberto, [{ role: "user" }, { role: "agent" }]), false);
  assert.equal(aguardandoAgente({ status: "closed" }, [{ role: "user" }]), false);
  assert.equal(aguardandoAgente({ status: "open", lastMessage: { role: "user" } }), true);
  assert.equal(aguardandoAgente(null, []), false);
});
