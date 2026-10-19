# Unicidade de AWB

A mesma AWB identifica uma remessa e nao pode ser atribuida a outra, independentemente
de courier, participante, data ou temperatura. A regra cobre Transportes I, II e III,
Backup e envios manuais do modulo Transporte.

- A comparacao usa maiusculas e caracteres alfanumericos, preservando zeros iniciais.
- Editar ou reagendar o mesmo envio permite conservar sua AWB.
- Cancelar o envio DHL Ambiente libera sua AWB para outro envio. O cancelamento
  pode ser do Transporte I, II ou III ou do agendamento inteiro e deve estar
  registrado no envio de origem na Agenda, inclusive para reservas historicas
  e espelhos de Backup. O historico permanece preservado.
- Nos demais couriers e temperaturas, cancelar nao libera o numero. Limpar ou
  substituir a AWB tambem nao libera o numero, inclusive em DHL Ambiente.
- Backup vinculado a outro agendamento/slot e o espelho da mesma remessa. A referencia
  nao conta como um segundo uso; referencia legada sem slot continua sendo Transporte I.
- Duplicidades preexistentes permitem outras correcoes e exibem aviso. Gerar novos
  documentos exige resolver a duplicidade. Nao ha exclusao ou correcao automatica.

As validacoes de Agenda, Transporte e atribuicao automatica por confirmacao de e-mail
executam no servidor, sob o mesmo document lock. Criacao e edicao validam as AWBs antes
de gravar os dados do evento. A geracao valida antes de alterar o formulario e produzir
PDF ou rascunho. O contexto em memoria vale somente durante o lock e e descartado ao sair.

`AWB_Utilizadas`, na planilha principal, e um historico permanente criado na escrita.
Na primeira reserva sao preservadas as AWBs encontradas na Agenda e nas referencias de
Backup; o formulario manual atual tambem e preservado antes de ser substituido ou limpo.
Consultas de aviso apenas leem o historico. Cabecalhos invalidos bloqueiam a gravacao.
Nao e possivel reconstruir usos antigos que ja tenham sido removidos de todas essas
fontes antes da implantacao desta regra.

Envios manuais usam uma identidade persistida na nota interna do formulario e mantida
no payload. Limpar o formulario encerra esse contexto; o proximo envio recebe outra
identidade. O historico da AWB permanece preservado.

No modal de PDF, Concluir fecha o resultado e mantem os dados. No topo do modulo,
Gerar novamente solicita explicitamente outros documentos com os dados atuais;
Limpar esvazia o formulario para iniciar outro envio, preservando os artefatos criados.
