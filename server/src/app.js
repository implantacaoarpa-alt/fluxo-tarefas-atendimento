// Monta a aplicação: banco + rotas. Recurso novo entra aqui com uma linha.
import { criarRoteador } from "./http.js";
import { abrirBanco } from "./db.js";
import { rotasDeItens } from "./itens.js";
import { rotasDeQuadros } from "./quadros.js";
import { rotasDeAuth } from "./auth.js";
import { rotasDeTickets } from "./tickets.js";
import { configDaIntegracao, criarIntegracao } from "./integracao-github.js";

export function criarApp({ banco = ":memory:", env = process.env } = {}) {
  const db = abrirBanco(banco);
  const app = criarRoteador();
  app.get("/api/saude", () => ({ ok: true }));
  rotasDeAuth(app, db);
  rotasDeItens(app, db);
  rotasDeQuadros(app, db);
  const integracao = criarIntegracao(db, configDaIntegracao(env));
  rotasDeTickets(app, db, integracao);
  return { servidor: app.servidor, db, integracao };
}
