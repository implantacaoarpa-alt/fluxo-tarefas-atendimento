import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { horaDaMensagem } from "./atendimento.js";
import { Botao } from "./componentes/Botao.jsx";
import { Icone } from "./componentes/Icone.jsx";

// O painel só lê: lista todos os tickets (de todos os donos) e se atualiza sozinho.
const INTERVALO = 10_000;

const FASES = {
  recebido: "Recebido", dry_run: "Ensaio local", chamando: "IA trabalhando", simulado: "Simulado (dry-run)",
  resultado: "Respondido", proposta: "Proposta pronta", pr_aberto: "PR aberto", aguardando_merge: "Aguardando merge",
  corrigir: "Em correção", pendente_instrutor: "Com o instrutor", integrado: "Integrado", concluido: "Concluído",
  pr_fechado: "PR fechado", encerrado: "Encerrado", incerto: "Incerto: retomar", erro_ia: "Erro na IA",
  invalido: "Resposta recusada", erro_issue: "Issue não criada", erro_disparo: "Disparo falhou", atribuido: "Com o Copilot",
};
const FASES_ALERTA = ["incerto", "erro_ia", "invalido", "erro_issue", "erro_disparo", "pendente_instrutor"];

const FILTROS = [
  { id: "todos", rotulo: "Todos", aceita: () => true },
  { id: "abertos", rotulo: "Abertos", aceita: (t) => t.status === "open" },
  { id: "aguardando", rotulo: "Aguardando suporte", aceita: (t) => aguardando(t) },
  { id: "resolvidos", rotulo: "Resolvidos", aceita: (t) => t.status === "closed" },
];

const aguardando = (t) => t.status === "open" && t.lastRole === "user";

function Situacao({ ticket }) {
  if (ticket.status === "closed") return <span className="painel-selo" data-tom="ok">Resolvido</span>;
  if (aguardando(ticket)) return <span className="painel-selo" data-tom="espera">Aguardando suporte</span>;
  return <span className="painel-selo">Em atendimento</span>;
}

function Automacao({ automacao, repo, completo = false }) {
  if (!automacao) return <span className="painel-meta">Sem automação</span>;
  const fase = FASES[automacao.phase] ?? automacao.phase;
  const base = repo ? `https://github.com/${repo}` : null;
  return (
    <span className="painel-automacao">
      <span className="painel-selo" data-tom={FASES_ALERTA.includes(automacao.phase) ? "alerta" : "info"}>{fase}</span>
      {automacao.issue && base ? (
        <a href={`${base}/issues/${automacao.issue}`} target="_blank" rel="noreferrer" className="painel-link">
          Issue #{automacao.issue}<Icone nome="externo" tamanho={12} />
        </a>
      ) : null}
      {automacao.pr && base ? (
        <a href={`${base}/pull/${automacao.pr}`} target="_blank" rel="noreferrer" className="painel-link">
          PR #{automacao.pr}<Icone nome="externo" tamanho={12} />
        </a>
      ) : null}
      {completo && automacao.runId && base ? (
        <a href={`${base}/actions/runs/${automacao.runId}`} target="_blank" rel="noreferrer" className="painel-link">
          Execução<Icone nome="externo" tamanho={12} />
        </a>
      ) : null}
    </span>
  );
}

function Detalhe({ id, repo, versao }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  useEffect(() => {
    let vivo = true;
    api.painel.detalhe(id).then((d) => { if (vivo) { setDados(d); setErro(null); } }).catch((e) => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, [id, versao]);

  if (erro) return <div className="painel-detalhe"><p className="painel-meta">{erro}</p></div>;
  if (!dados || dados.ticket.id !== id) return <div className="painel-detalhe"><p className="carregando-line">Carregando conversa…</p></div>;
  const t = dados.ticket;
  return (
    <div className="painel-detalhe">
      <header className="painel-detalhe-topo">
        <h2 className="painel-detalhe-titulo">{t.title}</h2>
        <div className="painel-detalhe-meta">
          <Situacao ticket={t} />
          <span className="painel-meta">{t.owner.rotulo}</span>
          <span className="painel-meta">Aberto em {horaDaMensagem(t.createdAt)}</span>
        </div>
        <Automacao automacao={t.automation} repo={dados.repo} completo />
        {t.automation?.requestId ? <p className="painel-meta painel-mono">requestId {t.automation.requestId}</p> : null}
      </header>
      <ol className="painel-conversa">
        {dados.messages.map((m) => (
          <li key={m.id} className="painel-msg" data-papel={m.role}>
            <p className="painel-msg-autor">
              {m.role === "user" ? "Cliente" : m.author || "Suporte Fluxo"}
              <span className="painel-meta">{horaDaMensagem(m.createdAt)}</span>
            </p>
            <div className="painel-msg-texto">{m.content}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TelaPainel({ ticketId, aoAbrir }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    const buscar = () =>
      api.painel.listar()
        .then((d) => { if (vivo) { setDados(d); setErro(null); } })
        .catch((e) => vivo && setErro(e.message));
    void buscar();
    const relogio = setInterval(() => {
      if (document.visibilityState === "visible") { void buscar(); setVersao((v) => v + 1); }
    }, INTERVALO);
    return () => { vivo = false; clearInterval(relogio); };
  }, []);

  const tickets = dados?.tickets ?? [];
  const contagem = useMemo(() => ({
    total: tickets.length,
    abertos: tickets.filter((t) => t.status === "open").length,
    aguardando: tickets.filter(aguardando).length,
    resolvidos: tickets.filter((t) => t.status === "closed").length,
  }), [tickets]);
  const termo = busca.trim().toLowerCase();
  const visiveis = tickets.filter((t) => FILTROS.find((f) => f.id === filtro).aceita(t) && (!termo || t.title.toLowerCase().includes(termo)));

  return (
    <section className="painel" aria-label="Painel de atendimento">
      <header className="painel-topo">
        <div>
          <h1 className="painel-titulo">Painel de atendimento</h1>
          <p className="painel-meta">Todos os tickets, de todos os clientes. Atualiza sozinho a cada 10 s.</p>
        </div>
        <Botao icone="atualizar" onClick={() => window.location.reload()}>Atualizar</Botao>
      </header>

      {erro ? <div className="aviso" role="alert"><span className="aviso-texto"><Icone nome="alerta" tamanho={18} /><span>{erro}</span></span></div> : null}

      <dl className="painel-numeros">
        <div><dt>Total</dt><dd>{dados ? contagem.total : "–"}</dd></div>
        <div><dt>Abertos</dt><dd>{dados ? contagem.abertos : "–"}</dd></div>
        <div data-tom="espera"><dt>Aguardando suporte</dt><dd>{dados ? contagem.aguardando : "–"}</dd></div>
        <div data-tom="ok"><dt>Resolvidos</dt><dd>{dados ? contagem.resolvidos : "–"}</dd></div>
      </dl>

      <div className="painel-filtros">
        <div className="painel-chips" role="group" aria-label="Filtrar por situação">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className="painel-chip" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.rotulo}</button>
          ))}
        </div>
        <label className="painel-busca">
          <span className="sr-only">Buscar por título</span>
          <input className="campo-entrada" type="search" placeholder="Buscar por título" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>

      <div className="painel-corpo">
        <div className="painel-lista" role="list">
          {!dados ? <p className="carregando-line">Carregando tickets…</p> : null}
          {dados && !visiveis.length ? <p className="painel-meta painel-vazio">Nenhum ticket neste filtro.</p> : null}
          {visiveis.map((t) => (
            <button
              key={t.id}
              type="button"
              role="listitem"
              className="painel-item"
              aria-current={t.id === ticketId ? "true" : undefined}
              onClick={() => aoAbrir(t.id)}
            >
              <span className="painel-item-linha">
                <span className="painel-item-titulo">{t.title}</span>
                <span className="painel-meta">{horaDaMensagem(t.updatedAt)}</span>
              </span>
              <span className="painel-item-linha">
                <Situacao ticket={t} />
                <Automacao automacao={t.automation} repo={dados.repo} />
              </span>
              <span className="painel-meta">{t.owner.rotulo} · {t.messageCount} mensage{t.messageCount === 1 ? "m" : "ns"}</span>
            </button>
          ))}
        </div>
        {ticketId ? (
          <Detalhe id={ticketId} repo={dados?.repo} versao={versao} />
        ) : (
          <div className="painel-detalhe painel-detalhe-vazio">
            <Icone nome="conversa" tamanho={28} />
            <p>Escolha um ticket para ver a conversa completa e a situação na automação.</p>
          </div>
        )}
      </div>
    </section>
  );
}
