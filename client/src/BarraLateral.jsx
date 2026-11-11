import { agruparTickets, aguardandoAgente } from "./atendimento.js";
import { Botao } from "./componentes/Botao.jsx";
import { Icone } from "./componentes/Icone.jsx";

const SECOES = [
  { id: "quadros", rotulo: "Quadros", icone: "colunas" },
  { id: "atendimento", rotulo: "Atendimento", icone: "conversa" },
  { id: "painel", rotulo: "Painel", icone: "painel" },
];
const CAMINHOS = { quadros: "/quadro", atendimento: "/atendimento", painel: "/painel" };

/** Lista de quadros com o atalho para criar um novo. */
function ListaQuadros({ quadros, quadroId, aoSelecionar, aoNovoQuadro, aoRenomear, aoExcluir }) {
  return (
    <>
      <div className="lateral-topo">
        <h2 className="lateral-titulo">Quadros</h2>
        <Botao variante="fantasma" icone="mais" aria-label="Criar quadro" onClick={aoNovoQuadro} />
      </div>

      {quadros === null ? (
        <p className="lateral-vazio">Carregando quadros…</p>
      ) : quadros.length ? (
        <ul className="lateral-lista">
          {quadros.map((quadro) => (
            <li key={quadro.id}>
              <div className="lateral-item" data-ativo={quadro.id === quadroId ? "" : undefined}>
                <button
                  type="button"
                  className="lateral-escolha"
                  aria-current={quadro.id === quadroId ? "page" : undefined}
                  onClick={() => aoSelecionar(quadro.id)}
                >
                  {quadro.title}
                </button>
                <span className="lateral-acoes">
                  <Botao variante="fantasma" icone="lapis" aria-label={`Renomear quadro ${quadro.title}`} onClick={() => aoRenomear(quadro)} />
                  <Botao variante="fantasma" icone="lixeira" aria-label={`Excluir quadro ${quadro.title}`} onClick={() => aoExcluir(quadro)} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lateral-vazio">Nenhum quadro ainda. Crie o primeiro para começar.</p>
      )}
    </>
  );
}

/** Histórico de tickets agrupado por data, como a lista de conversas de um chat. */
function ListaTickets({ tickets, ticketId, aoSelecionar, aoNovo, aoRenomear, aoExcluir }) {
  return (
    <>
      <button type="button" className="ticket-novo" onClick={aoNovo} data-ativo={ticketId ? undefined : ""}>
        <Icone nome="nova-conversa" tamanho={18} />
        Novo ticket
      </button>

      {tickets === null ? (
        <p className="lateral-vazio">Carregando tickets…</p>
      ) : tickets.length ? (
        <div className="ticket-historico">
          {agruparTickets(tickets).map((grupo) => (
            <section key={grupo.rotulo} aria-label={grupo.rotulo}>
              <h2 className="ticket-grupo">{grupo.rotulo}</h2>
              <ul className="lateral-lista">
                {grupo.tickets.map((t) => (
                  <li key={t.id}>
                    <div className="lateral-item ticket-item" data-ativo={t.id === ticketId ? "" : undefined} data-fechado={t.status === "closed" ? "" : undefined}>
                      <button
                        type="button"
                        className="lateral-escolha"
                        aria-current={t.id === ticketId ? "page" : undefined}
                        onClick={() => aoSelecionar(t.id)}
                        title={t.title}
                      >
                        {aguardandoAgente(t) ? <span className="ticket-ponto" aria-label="Aguardando resposta" /> : null}
                        {t.status === "closed" ? <Icone nome="check" tamanho={14} rotulo="Resolvido" className="ticket-resolvido" /> : null}
                        <span className="ticket-item-titulo">{t.title}</span>
                      </button>
                      <span className="lateral-acoes">
                        <Botao variante="fantasma" icone="lapis" aria-label={`Renomear ticket ${t.title}`} onClick={() => aoRenomear(t)} />
                        <Botao variante="fantasma" icone="lixeira" aria-label={`Excluir ticket ${t.title}`} onClick={() => aoExcluir(t)} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="lateral-vazio">Nenhum ticket ainda. Descreva o que precisa e a gente responde por aqui.</p>
      )}
    </>
  );
}

/** Lateral: marca, menu de seções e o conteúdo da seção aberta (quadros ou tickets). */
export function BarraLateral({ secao = "quadros", aoNavegar, atendimento, ...quadros }) {
  return (
    <aside className="lateral" aria-label={{ atendimento: "Atendimento", painel: "Painel" }[secao] ?? "Quadros"}>
      <a className="marca" href="/" aria-label="Fluxo, voltar ao início" style={{ textDecoration: "none" }}>
        <span className="marca-simbolo" aria-hidden="true">
          <Icone nome="colunas" tamanho={18} />
        </span>
        <span className="marca-nome">Fluxo</span>
      </a>

      {aoNavegar ? (
        <nav className="lateral-nav" aria-label="Seções">
          {SECOES.map((s) => (
            <a
              key={s.id}
              href={CAMINHOS[s.id]}
              className="lateral-nav-item"
              aria-current={secao === s.id ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); aoNavegar(s.id); }}
            >
              <Icone nome={s.icone} tamanho={18} />
              {s.rotulo}
            </a>
          ))}
        </nav>
      ) : null}

      {secao === "painel" ? (
        <p className="lateral-vazio">Todos os tickets de atendimento, de todos os clientes, em modo leitura.</p>
      ) : secao === "atendimento" && atendimento ? <ListaTickets {...atendimento} /> : <ListaQuadros {...quadros} />}
    </aside>
  );
}
