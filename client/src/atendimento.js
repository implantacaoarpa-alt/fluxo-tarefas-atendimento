// Lógica pura do atendimento (testada sem navegador): agrupamento por data e estado da conversa.

const DIA = 86_400_000;
const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Rótulo do grupo na lateral, como no histórico de conversas: Hoje, Ontem, 7 e 30 dias, Mais antigos. */
export function grupoDaData(iso, agora = new Date()) {
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(new Date(iso))) / DIA);
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  if (dias <= 7) return "Últimos 7 dias";
  if (dias <= 30) return "Últimos 30 dias";
  return "Mais antigos";
}

/** Agrupa tickets (já ordenados do mais recente) mantendo a ordem: [{rotulo, tickets}]. */
export function agruparTickets(tickets, agora = new Date()) {
  const grupos = [];
  for (const t of tickets) {
    const rotulo = grupoDaData(t.updatedAt, agora);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.rotulo === rotulo) ultimo.tickets.push(t);
    else grupos.push({ rotulo, tickets: [t] });
  }
  return grupos;
}

/** Ticket aberto cuja última mensagem é do usuário: está esperando um agente responder. */
export function aguardandoAgente(ticket, mensagens) {
  if (!ticket || ticket.status !== "open") return false;
  const ultima = mensagens?.length ? mensagens[mensagens.length - 1] : ticket.lastMessage;
  return ultima?.role === "user";
}

/** Hora curta (14:05) para hoje; data curta (10/11 14:05) para outros dias. */
export function horaDaMensagem(iso, agora = new Date()) {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (inicioDoDia(d) === inicioDoDia(agora)) return hora;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}
