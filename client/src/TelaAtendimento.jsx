import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { aguardandoAgente, horaDaMensagem } from "./atendimento.js";
import { Icone } from "./componentes/Icone.jsx";
import { Menu } from "./componentes/Menu.jsx";

// Enquanto a conversa está aberta, buscamos respostas novas dos agentes de tempos em tempos.
const INTERVALO_ATUALIZACAO = 5000;

// Etapas em que nada está acontecendo agora (sem animação no status).
const ETAPAS_PARADAS = ["simulado", "resultado", "concluido", "encerrado", "pr_fechado", "pendente_instrutor", "aguardando_merge", "incerto", "erro_ia", "invalido", "erro_issue", "erro_disparo"];

const SUGESTOES = [
  "Não consigo mover um cartão entre listas",
  "Como organizar melhor meus quadros?",
  "Encontrei um erro na tela",
];

/** Caixa de escrita: cresce com o texto, Enter envia e Shift+Enter quebra a linha. */
function Compositor({ aoEnviar, enviando, placeholder, autoFocus, valorInicial = "", chave }) {
  const [texto, setTexto] = useState(valorInicial);
  const campo = useRef(null);

  useEffect(() => { setTexto(valorInicial); }, [chave, valorInicial]);

  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [texto]);

  useEffect(() => { if (autoFocus) campo.current?.focus(); }, [autoFocus, chave]);

  const vazio = !texto.trim();
  const enviar = async () => {
    if (vazio || enviando) return;
    const conteudo = texto.trim();
    setTexto("");
    const ok = await aoEnviar(conteudo);
    if (ok === false) setTexto(conteudo); // devolve o texto se não deu certo
    campo.current?.focus();
  };

  return (
    <form className="compositor" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <label className="sr-only" htmlFor={`compositor-${chave}`}>Mensagem</label>
      <textarea
        id={`compositor-${chave}`}
        ref={campo}
        className="compositor-campo"
        rows={1}
        value={texto}
        maxLength={10000}
        placeholder={placeholder}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void enviar();
          }
        }}
      />
      <button type="submit" className="compositor-enviar" disabled={vazio || enviando} aria-label="Enviar mensagem">
        <Icone nome="enviar" tamanho={18} />
      </button>
    </form>
  );
}

function Mensagem({ mensagem }) {
  if (mensagem.role === "user") {
    return (
      <div className="msg msg-usuario" data-pendente={mensagem.pendente ? "" : undefined}>
        <div className="msg-balao">{mensagem.content}</div>
        <span className="msg-hora">{mensagem.pendente ? "Enviando…" : horaDaMensagem(mensagem.createdAt)}</span>
      </div>
    );
  }
  return (
    <div className="msg msg-agente">
      <span className="msg-avatar" aria-hidden="true"><Icone nome="agente" tamanho={18} /></span>
      <div className="msg-corpo">
        <p className="msg-autor">
          {mensagem.author || "Suporte Fluxo"}
          <span className="msg-hora">{horaDaMensagem(mensagem.createdAt)}</span>
        </p>
        <div className="msg-texto">{mensagem.content}</div>
      </div>
    </div>
  );
}

/** Tela inicial de um ticket novo: pergunta central, caixa de escrita e sugestões. */
function NovoTicket({ aoAbrir, enviando }) {
  const [sugestao, setSugestao] = useState({ texto: "", vez: 0 });
  const raiz = useRef(null);
  // Ao abrir (ou reabrir pelo botão "Novo ticket"), traz a caixa de escrita para a vista.
  useEffect(() => { raiz.current?.scrollIntoView({ block: "center" }); }, []);
  return (
    <div className="chat-inicio" ref={raiz}>
      <div className="chat-inicio-caixa">
        <span className="chat-inicio-icone" aria-hidden="true"><Icone nome="conversa" tamanho={24} /></span>
        <h1 className="chat-inicio-titulo">Como podemos ajudar?</h1>
        <p className="chat-inicio-texto">Descreva o problema ou a dúvida. Cada ticket vira uma conversa, e as respostas do suporte aparecem aqui.</p>
        <Compositor
          chave={`novo-${sugestao.vez}`}
          valorInicial={sugestao.texto}
          autoFocus
          enviando={enviando}
          placeholder="Escreva sua mensagem para o suporte"
          aoEnviar={aoAbrir}
        />
        <div className="chat-sugestoes">
          {SUGESTOES.map((s) => (
            <button key={s} type="button" className="chat-sugestao" onClick={() => setSugestao((v) => ({ texto: s, vez: v.vez + 1 }))}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TelaAtendimento({ ticketId, novoTicket = 0, versao, aoAbrirTicket, aoMudou, aoRenomear, aoExcluir, aoErro }) {
  const [conversa, setConversa] = useState(null); // {ticket, messages}
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [sincronia, setSincronia] = useState({ em: null, buscando: false });
  const atualizarAgora = useRef(null);
  const fim = useRef(null);
  const total = useRef(0);

  // Enquanto o chat está aberto, sincroniza com a issue do GitHub e traz cada mensagem do N1 assim que ela acontece.
  useEffect(() => {
    if (!ticketId) { setConversa(null); return; }
    let vivo = true;
    setCarregando(true);
    setSincronia({ em: null, buscando: false });
    const buscar = (primeira) => {
      setSincronia((s) => ({ ...s, buscando: true }));
      return api.tickets.sincronizar(ticketId)
        .then((dados) => {
          if (vivo) setSincronia({ em: dados.sincronizadoEm ?? new Date().toISOString(), buscando: false });
          if (!vivo) return;
          setConversa((atual) => {
            const pendentes = atual?.ticket?.id === ticketId ? atual.messages.filter((m) => m.pendente) : [];
            return { ...dados, messages: [...dados.messages, ...pendentes] };
          });
          if (!primeira && dados.messages.length !== total.current) aoMudou?.();
          total.current = dados.messages.length;
        })
        .catch((e) => { if (vivo && primeira) aoErro?.(e.message); })
        .finally(() => {
          if (!vivo) return;
          setSincronia((s) => ({ ...s, buscando: false }));
          if (primeira) setCarregando(false);
        });
    };
    atualizarAgora.current = () => buscar(false);
    void buscar(true);
    const relogio = setInterval(() => { if (document.visibilityState === "visible") void buscar(false); }, INTERVALO_ATUALIZACAO);
    return () => { vivo = false; clearInterval(relogio); };
  }, [ticketId, versao]);

  // Rola para a última mensagem quando chega algo novo.
  const qtd = conversa?.messages?.length ?? 0;
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [qtd, ticketId]);

  const abrir = async (conteudo) => {
    setEnviando(true);
    try {
      const dados = await api.tickets.abrir(conteudo);
      total.current = dados.messages.length;
      setConversa(dados);
      aoAbrirTicket(dados.ticket.id);
      aoMudou?.();
      return true;
    } catch (e) {
      aoErro?.(e.message);
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const responder = async (conteudo) => {
    const provisoria = { id: `pendente-${Date.now()}`, role: "user", content: conteudo, createdAt: new Date().toISOString(), pendente: true };
    setConversa((c) => ({ ...c, messages: [...c.messages, provisoria] }));
    setEnviando(true);
    try {
      const { message, ticket } = await api.tickets.responder(ticketId, conteudo);
      setConversa((c) => ({ ticket, messages: c.messages.map((m) => (m.id === provisoria.id ? message : m)) }));
      total.current += 1;
      aoMudou?.();
      return true;
    } catch (e) {
      setConversa((c) => ({ ...c, messages: c.messages.filter((m) => m.id !== provisoria.id) }));
      aoErro?.(e.message);
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const mudarStatus = async (status) => {
    try {
      const { ticket } = await api.tickets.editar(ticketId, { status });
      setConversa((c) => ({ ...c, ticket }));
      aoMudou?.();
    } catch (e) {
      aoErro?.(e.message);
    }
  };

  if (!ticketId) return <section className="chat" aria-label="Novo ticket"><NovoTicket key={novoTicket} aoAbrir={abrir} enviando={enviando} /></section>;

  const ticket = conversa?.ticket?.id === ticketId ? conversa.ticket : null;
  const progresso = ticket ? conversa.progress ?? null : null;
  const mensagens = ticket ? conversa.messages : [];
  const fechado = ticket?.status === "closed";

  return (
    <section className="chat" aria-label={ticket ? `Ticket: ${ticket.title}` : "Ticket"}>
      <header className="chat-topo">
        <div className="chat-topo-texto">
          <h1 className="chat-titulo">{ticket?.title ?? "Carregando ticket…"}</h1>
          {ticket ? (
            <span className="chat-status" data-status={ticket.status}>
              {fechado ? "Resolvido" : aguardandoAgente(ticket, mensagens) ? "Aguardando suporte" : "Em atendimento"}
            </span>
          ) : null}
        </div>
        {ticket ? (
          <div className="chat-topo-acoes">
          <span className="chat-sincronia" aria-live="polite">
            {sincronia.buscando ? "Sincronizando…" : sincronia.em ? `Atualizado às ${new Date(sincronia.em).toLocaleTimeString("pt-BR")}` : ""}
          </span>
          <button
            type="button"
            className="botao botao-fantasma chat-atualizar"
            onClick={() => atualizarAgora.current?.()}
            disabled={sincronia.buscando}
            aria-label="Atualizar mensagens"
          >
            <Icone nome="atualizar" tamanho={16} className={sincronia.buscando ? "girando" : ""} />
            Atualizar
          </button>
          <Menu
            rotulo="Ações do ticket"
            itens={[
              fechado
                ? { rotulo: "Reabrir ticket", icone: "atualizar", aoClicar: () => void mudarStatus("open") }
                : { rotulo: "Marcar como resolvido", icone: "check", aoClicar: () => void mudarStatus("closed") },
              { rotulo: "Renomear", icone: "lapis", aoClicar: () => aoRenomear(ticket) },
              { rotulo: "Excluir ticket", icone: "lixeira", perigo: true, aoClicar: () => aoExcluir(ticket) },
            ]}
          />
          </div>
        ) : null}
      </header>

      <div className="chat-rolagem">
        <div className="chat-mensagens" role="log" aria-live="polite" aria-busy={carregando}>
          {!ticket && carregando ? <p className="carregando-line" role="status">Carregando conversa…</p> : null}
          {mensagens.map((m) => <Mensagem key={m.id} mensagem={m} />)}
          {ticket && !fechado && (progresso || aguardandoAgente(ticket, mensagens)) ? (
            // Status do atendimento (vem da issue): linha neutra, sem avatar, para não parecer fala de um agente.
            <p className="chat-status-linha" role="status" data-ativo={progresso && !ETAPAS_PARADAS.includes(progresso.phase) ? "" : undefined}>
              <span className="chat-status-ponto" aria-hidden="true" />
              <span>{progresso ? progresso.label : "Aguardando um atendente"}</span>
              {progresso?.updatedAt ? <span className="chat-status-hora">{horaDaMensagem(progresso.updatedAt)}</span> : null}
            </p>
          ) : null}
          {fechado ? (
            <p className="chat-aviso-fechado"><Icone nome="check" tamanho={16} /> Ticket resolvido. Escreva abaixo se precisar reabrir.</p>
          ) : null}
          <div ref={fim} />
        </div>
      </div>

      <div className="chat-rodape">
        <Compositor
          chave={ticketId}
          autoFocus
          enviando={enviando || !ticket}
          placeholder={fechado ? "Escreva para reabrir o ticket" : "Responder ao suporte"}
          aoEnviar={responder}
        />
        <p className="chat-dica">Enter envia · Shift+Enter quebra a linha</p>
      </div>
    </section>
  );
}
