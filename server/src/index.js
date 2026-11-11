import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarApp } from "./app.js";

// Variáveis locais (AGENT_RUNTIME, AGENT_DRY_RUN, GITHUB_REPO, FLUXO_GITHUB_TOKEN) vêm do .env, se existir.
try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env")); } catch {}

const porta = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const banco = process.env.BANCO ?? join(dirname(fileURLToPath(import.meta.url)), "..", "dados", "app.sqlite");
const { servidor, integracao } = criarApp({ banco });
servidor.listen(porta, "127.0.0.1", () => {
  console.log(`API em http://127.0.0.1:${porta}/api`);
  const { ativo, dryRun, runtime } = integracao.config;
  if (ativo) console.log(`Atendimento ligado ao GitHub (${runtime})${dryRun ? " em dry-run: nada é enviado" : ""}.`);
});

// Acompanha as issues dos tickets e avisa o cliente no app (não faz nada em dry-run).
setInterval(() => void integracao.sincronizar(), 30_000).unref();
