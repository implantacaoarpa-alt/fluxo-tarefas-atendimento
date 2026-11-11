# Fluxo: o que o app faz e como usar

O Fluxo é um quadro de tarefas no estilo kanban (quadros, listas e cartões), com uma área de atendimento por tickets. Ele roda localmente: interface React/Vite, API Node e banco SQLite.

## Telas

| Endereço | O que tem |
|---|---|
| `/` | Página inicial com a apresentação do produto e o botão "Abrir meus quadros". |
| `/quadro` | Os quadros, com suas listas e cartões. |
| `/atendimento` | Os tickets de suporte, cada um como uma conversa. |

A barra lateral tem o menu **Quadros** / **Atendimento**.

## Quadros (como usar)

- **Quadro:** crie pelo "+" da lateral. Renomeie ou exclua pelos ícones ao lado do nome. Excluir um quadro apaga as listas e os cartões dele.
- **Lista:** use "Adicionar lista" no fim do quadro. O menu de opções da lista permite renomear e excluir; excluir apaga os cartões da lista.
- **Cartão:** use "Adicionar cartão" na lista. Pelo menu do cartão dá para editar o título e a descrição, excluir ou usar "Mover para" outra lista. O cartão também pode ser arrastado para outra lista ou posição. Cartões com descrição mostram o selo "Descrição".

## Atendimento (como usar)

- Use "Novo ticket", escreva a mensagem e aperte Enter. O título do ticket sai da primeira linha da mensagem.
- Enquanto a última mensagem for do usuário, a tela mostra "Aguardando suporte". A conversa é atualizada sozinha a cada 5 s.
- O menu ⋮ do ticket permite marcar como resolvido ou reabrir, renomear e excluir. Escrever num ticket resolvido reabre o ticket.
- Os agentes respondem pela API: `POST /api/tickets/:id/messages` com `{"role":"agent","author":"...","content":"..."}`.

## Limites conhecidos (não prometer além disso)

- A interface não tem login: todos que usam o app veem os mesmos quadros e tickets. As rotas de login existem na API, mas não são usadas pelas telas.
- Não há convite de equipe, permissões, anexos, etiquetas, datas de entrega, notificações nem app mobile nativo.
- Não existem preços, planos ou prazos definidos (ver `automacao/commercial-catalog.json`).

## Rodar localmente

- `npm install` e depois `npm run dev`: interface em http://127.0.0.1:5173, API em http://127.0.0.1:3001/api.
- `npm run build` gera a interface; `npm test` roda os testes.
