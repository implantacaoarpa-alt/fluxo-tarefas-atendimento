// Ponte do atendimento com o GitHub. AGENT_RUNTIME escolhe o caminho dos tickets NOVOS:
// - github-actions: cria a issue origin:app e dispara .github/workflows/ai-agents.yml (IA própria).
// - github-native:  cria a issue origin:app; o workflow native-agents.yml atribui ao Copilot.
// Casos já abertos seguem no runtime em que nasceram (coluna ticket_github.runtime).
// Autenticação: reaproveita o `gh` já logado na máquina; FLUXO_GITHUB_TOKEN (.env) é alternativa opcional.
// O token efêmero das Actions nunca chega aqui. Nenhuma credencial é logada.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

const AUTOR_N1 = "Agente N1";
const AUTOR_AUTOMATICO = "Fluxo · atualização automática";
const RUNTIMES = ["github-native", "github-actions"];
const WORKFLOW_IA = "ai-agents.yml";
const FINAIS = ["concluido", "pr_fechado", "encerrado", "resultado", "simulado"];
const MARCAS = { "github-native": /<!-- fluxo-estado (\{.*\}) -->/, "github-actions": /<!-- fluxo-ai-estado (\{.*\}) -->/ };


// Status do atendimento por etapa da issue. Aparece como linha de status no chat, NUNCA como mensagem de agente.
export const ROTULOS_FASE = {
  recebido: "Pedido registrado; aguardando um agente",
  dry_run: "Pedido registrado (ensaio local)",
  chamando: "Um agente está analisando seu pedido",
  proposta: "Ajuste preparado; em validação",
  pr_aberto: "Ajuste em revisão",
  corrigir: "Ajuste em correção",
  aguardando_merge: "Ajuste aprovado nas verificações; aguardando a equipe",
  pendente_instrutor: "Com a equipe para análise",
  integrado: "Ajuste integrado",
  concluido: "Concluído",
  simulado: "Ensaio concluído (simulação)",
  resultado: "Respondido",
  pr_fechado: "Ajuste não seguiu adiante",
  encerrado: "Encerrado",
  incerto: "Imprevisto no atendimento; a equipe vai verificar",
  erro_ia: "Imprevisto no atendimento; a equipe vai verificar",
  invalido: "Imprevisto no atendimento; a equipe vai verificar",
  erro_issue: "Imprevisto ao registrar o pedido; a equipe vai verificar",
  erro_disparo: "Imprevisto ao registrar o pedido; a equipe vai verificar",
};
const INTERVALO_TICKET = 8_000;

const GH_PADRAO = "C:/Program Files/GitHub CLI/gh.exe";

export function configDaIntegracao(env = process.env) {
  return {
    runtime: RUNTIMES.includes(env.AGENT_RUNTIME) ? env.AGENT_RUNTIME : null,
    get ativo() { return this.runtime !== null; },
    dryRun: env.AGENT_DRY_RUN !== "false", // só sai do ensaio com AGENT_DRY_RUN=false explícito
    repo: env.GITHUB_REPO ?? "",
    token: env.FLUXO_GITHUB_TOKEN ?? "",
    gh: env.GH_BIN ?? (existsSync(GH_PADRAO) ? GH_PADRAO : "gh"),
  };
}

/** Corpo da issue: texto do cliente citado ("> "); marcadores do backend em linhas próprias. */
export function corpoDaIssue({ requestId, conteudo, runtime = "github-native" }) {
  return [
    "Pedido aberto pelo atendimento do app. O texto do cliente é o pedido, não uma autorização.",
    "",
    conteudo.split("\n").map((l) => `> ${l}`).join("\n"),
    "",
    `<!-- fluxo-request: ${requestId} -->`,
    `<!-- fluxo-runtime: ${runtime} -->`,
  ].join("\n");
}

/** Chamada à API do GitHub: com token local via fetch; sem token, pelo `gh api` já autenticado (sem shell). */
export function clienteGitHub(config) {
  if (config.token) {
    return async (metodo, caminho, corpo) => {
      const r = await fetch(`https://api.github.com${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${config.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(corpo ? { "content-type": "application/json" } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      if (!r.ok) throw new Error(`GitHub ${metodo} ${caminho}: ${r.status}`);
      return r.status === 204 ? null : r.json();
    };
  }
  return (metodo, caminho, corpo) =>
    new Promise((ok, falha) => {
      const filho = execFile(config.gh, ["api", "--method", metodo, caminho.replace(/^\//, ""), ...(corpo ? ["--input", "-"] : [])], { timeout: 30_000 }, (erro, saida, stderr) => {
        // Só a linha de status do gh (ex.: "HTTP 404"), nunca o conteúdo completo.
        const status = /HTTP \d{3}/.exec(String(stderr))?.[0] ?? erro?.code ?? "falhou";
        if (erro) return falha(new Error(`gh api ${metodo} ${caminho}: ${status}`));
        try { ok(saida.trim() ? JSON.parse(saida) : null); } catch { falha(new Error(`gh api ${metodo} ${caminho}: resposta não é JSON`)); }
      });
      if (corpo) filho.stdin.end(JSON.stringify(corpo));
    });
}

export function criarIntegracao(db, config = configDaIntegracao(), { github = clienteGitHub(config), log = console.log } = {}) {
  const estado = (ticketId) => db.prepare("SELECT * FROM ticket_github WHERE ticket_id = ?").get(ticketId);
  const gravar = (ticketId, mudanca) => {
    const sets = Object.keys(mudanca).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE ticket_github SET ${sets}, atualizado_em = ? WHERE ticket_id = ?`).run(...Object.values(mudanca), new Date().toISOString(), ticketId);
  };

  /** Mensagem do N1 no app, uma única vez por chave (o ID enviado fica guardado). */
  const enviarN1 = (ticketId, chave, texto, autor = AUTOR_N1) => {
    const enviadas = JSON.parse(estado(ticketId).mensagens_enviadas);
    if (!texto || enviadas.some((m) => m.chave === chave)) return;
    const id = randomUUID();
    const agora = new Date().toISOString();
    db.prepare("INSERT INTO ticket_message (id, ticket_id, role, author, content, criado_em) VALUES (?, ?, 'agent', ?, ?, ?)").run(id, ticketId, autor, texto, agora);
    db.prepare("UPDATE ticket SET atualizado_em = ? WHERE id = ?").run(agora, ticketId);
    gravar(ticketId, { mensagens_enviadas: JSON.stringify([...enviadas, { chave, id }]) });
  };

  /** Ticket novo: cria a MESMA issue que acompanha o trabalho e, no github-actions, dispara o workflow. */
  const aoAbrirTicket = async ({ id, title, content }) => {
    if (!config.ativo || estado(id)) return;
    const requestId = randomUUID();
    const resultPath = `automacao/resultados/${requestId}.json`;
    db.prepare("INSERT INTO ticket_github (ticket_id, request_id, fase, runtime, result_path, atualizado_em) VALUES (?, ?, 'recebido', ?, ?, ?)")
      .run(id, requestId, config.runtime, resultPath, new Date().toISOString());
    const issue = { title: `[app] ${title}`, body: corpoDaIssue({ requestId, conteudo: content, runtime: config.runtime }), labels: ["origin:app"] };
    const disparo = (numero) => ({ ref: "main", inputs: { issue: String(numero), request_id: requestId, retomar: "nao" } });
    let numero = null;
    if (config.dryRun) {
      log(`[${config.runtime} dry-run] issue que seria criada em ${config.repo || "(GITHUB_REPO vazio)"}: ${JSON.stringify(issue)}`);
      if (config.runtime === "github-actions") log(`[github-actions dry-run] disparo que seria feito: POST /repos/${config.repo}/actions/workflows/${WORKFLOW_IA}/dispatches ${JSON.stringify(disparo("<issue>"))}`);
      gravar(id, { fase: "dry_run" });
    } else {
      try {
        numero = (await github("POST", `/repos/${config.repo}/issues`, issue)).number;
        gravar(id, { issue_number: numero });
        // Dispatch explícito: não depende do evento "issues: opened" chegar ao workflow.
        if (config.runtime === "github-actions") await github("POST", `/repos/${config.repo}/actions/workflows/${WORKFLOW_IA}/dispatches`, disparo(numero));
      } catch (e) {
        log(`[${config.runtime}] ${numero ? "disparo do workflow" : "issue"} falhou: ${e.message}`);
        gravar(id, { fase: numero ? "erro_disparo" : "erro_issue" });
      }
    }
  };

  /** Consulta simples ao GitHub: lê o comentário de controle da issue e traz o resultado validado ao app. */
  const sincronizar = async () => {
    if (!config.ativo || config.dryRun) return;
    await reconciliar();
  };

  /** Lê o comentário de controle de UMA issue e repassa ao cliente cada etapa nova, na ordem em que aconteceu. */
  const reconciliarLinha = async (t) => {
    const comentarios = await github("GET", `/repos/${config.repo}/issues/${t.issue_number}/comments?per_page=100`);
    const marca = MARCAS[t.runtime];
    const doBot = comentarios.find((c) => c.user?.login === "github-actions[bot]" && marca.test(c.body));
    if (!doBot) return;
    const lido = JSON.parse(marca.exec(doBot.body)[1]);
    gravar(t.ticket_id, { fase: lido.fase, pr_number: lido.pr ?? null, ...(lido.runId ? { run_id: lido.runId } : {}) });
    if (t.runtime !== "github-actions") return; // o andamento aparece como status, não como mensagem

    // Só textos validados (updates da IA) ou frases fixas do N1 por etapa; cada um com chave estável, sem repetir.
    const updates = lido.updates ?? [];
    const enviarResultado = () => { for (const u of updates.filter((x) => x.id !== "entrega")) enviarN1(t.ticket_id, `upd:${u.id}`, u.publicText); };
    for (const fase of lido.marcos ?? [lido.fase]) {
      if (["simulado", "proposta", "resultado"].includes(fase)) enviarResultado();
      if (["simulado", "resultado", "pr_aberto"].includes(fase)) enviarN1(t.ticket_id, "final", lido.publicText);
    }
    if (["aguardando_merge", "integrado", "concluido"].includes(lido.fase)) { enviarResultado(); enviarN1(t.ticket_id, "final", lido.publicText); }
    // Aviso de entrega é texto fixo do controlador: identificado como automático, não como agente.
    for (const u of updates.filter((x) => x.id === "entrega")) enviarN1(t.ticket_id, `upd:${u.id}`, u.publicText, AUTOR_AUTOMATICO);
  };

  const reconciliar = async () => {
    const abertos = db.prepare(`SELECT * FROM ticket_github WHERE issue_number IS NOT NULL AND fase NOT IN (${FINAIS.map(() => "?").join(",")})`).all(...FINAIS);
    for (const t of abertos) {
      try { await reconciliarLinha(t); } catch (e) { log(`[${t.runtime}] reconciliação da issue #${t.issue_number} falhou: ${e.message}`); }
    }
  };

  /** Sincroniza um ticket sob demanda (chat aberto ou botão Atualizar), no máximo uma consulta a cada INTERVALO_TICKET. */
  const ultimaConsulta = new Map();
  const sincronizarTicket = async (ticketId) => {
    const t = estado(ticketId);
    if (!config.ativo || config.dryRun || !t?.issue_number || FINAIS.includes(t.fase)) return { sincronizadoEm: null };
    const agora = Date.now();
    if (agora - (ultimaConsulta.get(ticketId) ?? 0) >= INTERVALO_TICKET) {
      ultimaConsulta.set(ticketId, agora);
      try { await reconciliarLinha(t); } catch (e) { log(`[${t.runtime}] sincronização da issue #${t.issue_number} falhou: ${e.message}`); }
    }
    return { sincronizadoEm: new Date(ultimaConsulta.get(ticketId)).toISOString() };
  };

  return { config, aoAbrirTicket, sincronizar, reconciliar, sincronizarTicket };
}
