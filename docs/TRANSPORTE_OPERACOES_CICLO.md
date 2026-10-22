# Documentação e ciclo do transporte

`Transporte_Operacoes` guarda a documentação de cada slot da Agenda. PDF ou
rascunho histórico não comprova que o transporte continua ativo nem que foi
enviado. Retirar um slot da Agenda não cancela uma coleta na courier e não
remove rascunhos do Gmail.

Ao salvar uma edição completa da Agenda, sob lock, o sistema inativa as
operações de slots removidos ou cujo courier/temperatura documentada mudou.
Preserva PDF, rascunho, AWB e evidências de envio; registra motivo, data e
auditoria. Temperatura histórica ausente não comprova divergência. AWB
divergente continua sendo tratada pelo contrato de revisão do monitor.

As colunas aditivas são `Operacao_Estado`, `Inativacao_Motivo`, `Inativada_Em`
e `Vinculo_Iniciado_Em`. Estado vazio no legado equivale a operação ativa.
Os cabeçalhos são validados antes da escrita da Agenda; a expansão ocorre
somente na escrita do acompanhamento. Leituras não criam nem migram schema.

Pendências ignora slot sem courier válido, inclusive no legado ainda não
inativado. O monitor verifica existência antes de consultar Gmail e revalida
o slot e a versão da operação sob lock. Operações inativas não participam
de pendências, monitoramento ou cobranças; PDFs históricos continuam acessíveis.

Gerar documentação após inativação cria outra linha. O novo vínculo não
herda evidências anteriores, mesmo se o hash do PDF for idêntico. Exige uma
mensagem posterior ao início do vínculo e o marcador `Ger. IPS` da geração
atual, além dos controles de referência/hash existentes. O fluxo oficial
fornece esse identificador; geração legada sem ID em vínculo reutilizado
requer revisão manual. Regenerar dentro do vínculo conserva o contrato de
equivalência por hash. Cobranças do novo vínculo usam uma base própria sem
apagar ou liberar tentativas incertas do vínculo antigo.

Registros antigos de slots já removidos deixam de aparecer por validação
em memória. A próxima edição salva do agendamento persiste a inativação;
não há migração de dados reais durante leitura ou publicação do código.
