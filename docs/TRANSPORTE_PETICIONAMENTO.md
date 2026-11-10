# Peticionamento dos envios internacionais (GRU e extrato)

Vale para OCASA com laboratório fora do Brasil e para PINEX (fase de documentos). Código: `TransportePeticaoHtml.gs`
(formulário ANVISA) e `TransportePeticionamento.gs` (e-mail, status e ações).

## Fluxo

1. Quem prepara gera os documentos e, no passo **Formulário ANVISA**, confere e imprime o formulário. O formulário só é
   gerado depois da AWB. Sem AWB, sem N° do CE do estudo, courier sem razão social ou CNPJ, mais de 6 materiais ou
   laboratório desconhecido: não gera e explica. Laboratório sem telefone só avisa.
2. "Concluir e avisar quem peticiona": o PDF do formulário segue por e-mail aos autorizados e **só então** o status do
   transporte na Agenda passa a **Aguardando peticionamento**. Falha no e-mail mantém o status e o passo, com "Tentar de novo";
   a data do envio fica no registro (`peticionamentoEnviadoEm`), então repetir não reenvia.
3. Um autorizado salva a GRU e o extrato na pasta do envio, no servidor (o app não acessa o servidor), e marca
   **GRU e extrato prontos** em Acompanhar. O status volta a "Docs gerados" e a tarefa vira
   "Anexar a GRU e o extrato e enviar à courier".

## Autorização

- Lista em Configurações, grupo **Transporte**, chave **Autorizado a peticionar**, uma linha por pessoa
  (e-mail comparado em minúsculas). Hoje: `lrmotta@ucs.br` e `agregor1@ucs.br`.
- **Piloto: nada fora do admin.** As ações exigem perfil admin E presença na lista, conferidos no servidor (a lista de novo dentro do lock);
  a tela só mostra o botão ao admin que está na lista. Nenhum item de navegação é aberto a outros perfis por ora.
- Depois do piloto, a ideia é um item "Peticionamento" só para quem está na lista (sem exigir admin) mostrando apenas a seção de peticionamento; fica para a Etapa 9, com decisão do usuário.
- A formulário de Configurações só oferece chaves existentes: as primeiras linhas precisam nascer por rotina protegida e
  auditada, executada pelo usuário (pendente; ver "Pendências").

## Status "Aguardando peticionamento"

Chave própria `peticionamento` em `tools/agenda-rules-core.js`. Não conta como "não agendada", "aguardando confirmação",
"enviado" nem "pendente"; o monitor de e-mails não o promove; não gera cobrança ou lembrete; aparece na lista de
status da Agenda e como chip próprio. Revisados: Agenda, Pendências, Transporte (piloto) e os monitores.

## Pendências

- Rotina protegida (executada pelo usuário) para criar a chave `Autorizado a peticionar` com as duas linhas e para preencher
  Empresa e CNPJ da PINEX na aba Courier (hoje vazia). Sem Empresa e CNPJ, o formulário da PINEX não é gerado.
- HAWB = Frete na PINEX é suposição: confirmar no primeiro envio real.
- O PDF real pelo conversor do Apps Script só pode ser conferido em produção.
