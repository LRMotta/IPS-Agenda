# Cobrança automática de confirmação

O cadastro de Courier oferece Desativada, Simulação e Automático, prazo em horas úteis, limite opcional no dia útil anterior e texto próprio. O prazo conta desde o envio comprovado; considera 08h–18h de segunda a sexta, excluindo feriados cadastrados na Agenda, no fuso America/Sao_Paulo. O limite D-1 antecipa o prazo, mas exige pelo menos uma hora útil de espera. Nunca envia no dia da coleta nem depois dela.

Para ativar, salvar a configuração da courier e, conectado na conta que recebe os e-mails, usar **Ativar monitor nesta conta**. A operação exige administrador e instala um gatilho de 15 minutos. **Pausar todas as cobranças** desliga o envio globalmente. A instalação/publicação do código não ativa couriers com campos legados vazios. Sugestão inicial: Marken em Simulação, 2 horas úteis, limite 15:00; após conferir o piloto, selecionar Automático. O piloto não muda de modo sozinho.

Somente documentos gerados após esta atualização recebem base de comparação em Courier_Lembretes. Registros antigos permanecem manuais: atribuir um ID depois não vincula e-mails antigos. A automação exige ID da Agenda único, slot, operação atual, referência explícita, autor original igual ao responsável registrado, destinatário presente no cadastro da courier e mensagem original acessível na conta monitorada. Cópia oculta e Reply-To divergente exigem revisão.

A mensagem é uma resposta a todos na conversa original, com assunto mantido. Os anexos originais ficam no histórico; não são reenviados. Qualquer mensagem posterior na conversa, inclusive uma cobrança manual, bloqueia a automação para revisão. Alterações nos dados do transporte, cancelamento, reagendamento ou confirmação impedem a cobrança. A interface mostra o motivo em Courier não confirmada, junto ao transporte I/II/III. AWB enviada não entregue também identifica o transporte.

Há no máximo uma tentativa automática por Agenda + slot e uma cobrança por conversa; regenerar documentos não libera nova tentativa depois de envio ou resultado incerto. O monitor reserva a tentativa de forma durável antes de chamar o Gmail. Timeout/falha depois dessa reserva exige revisão manual, sem repetição automática. Só mostra Cobrança enviada quando encontra a nova mensagem da própria conta no histórico. O log guarda estado, horário, IDs de conversa/mensagem e motivo, sem copiar corpos de e-mails.

Limites: até cinco candidatos por execução e três minutos de processamento. Consultas ao Gmail usam lock de usuário; a breve reserva relê a Agenda sob lock de documento. Gmail e Sheets não oferecem uma transação conjunta: uma resposta ou edição pode chegar no intervalo mínimo entre a última verificação e o envio. Falhas de autorização/serviço são registradas pelo rastreamento de automações, e falhas por item aparecem como revisão nas Pendências.

Testes locais isolam todos os efeitos externos. Nenhuma cobrança real é enviada pelos testes ou pelo smoke test de publicação.
