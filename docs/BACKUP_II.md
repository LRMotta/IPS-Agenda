# Backup II na Agenda

O Backup II representa um segundo envio independente no mesmo agendamento. Pode
ter courier, laboratório, temperatura, materiais, status e destino diferentes do
Backup I, inclusive para separar amostras refrigeradas e congeladas. Nenhuma
temperatura é escolhida automaticamente para o segundo backup.

## Interface e agendamento

- O bloco vazio começa recolhido e abre pelo botão `Adicionar Backup II`.
- Um Backup II já preenchido aparece ao reabrir o registro, como o Backup I.
- Cada backup pode criar um novo Envio de amostras ou usar o Transporte II/III
  disponível em um agendamento futuro elegível do mesmo participante e projeto.
- A origem deve estar salva antes de vincular. Identidade, versões e
  disponibilidade são revalidadas no servidor sob lock.
- A AWB exibida vem do envio vinculado; o vínculo identifica também o slot.
- A pendência de cada backup com status `Não Agendado` permanece independente
  da realização da visita.

## Persistência e compatibilidade

O Backup I mantém suas colunas e referências existentes. O Backup II usa uma
coluna opcional identificada pelo cabeçalho `Backup II - Dados`, acrescentada
somente pelo caminho de escrita autorizado. Seu índice é resolvido pelo
cabeçalho; não ocupa posições fixas nem substitui colunas legadas.

A célula contém JSON com `nome`, `temperatura`, `status`, `awb`, `material`,
`destino`, `matBioJson` e `agendamentos`. As referências preservam o histórico e
o último vínculo é apresentado em `agendamento` no objeto retornado ao cliente.
Um vínculo atual sem AWB retorna AWB vazia, mesmo havendo números históricos.

Leituras sem a coluna retornam um segundo backup vazio sem alterar a planilha.
Payloads legados que omitem `backup2` preservam o segundo envio existente.
Referências enviadas pelo formulário não são aceitas como vínculos; estes são
gravados pelos fluxos de agendamento. O JSON integra versões, auditoria e
proteção de edição concorrente. JSON persistido inválido exige revisão e não é
substituído silenciosamente por dados vazios.

## Validação local

`npm.cmd run verify` e `npm.cmd run test:ui` usam simuladores e fixtures locais,
sem acesso a planilhas, e-mail ou Calendar reais. Há regressões específicas em
`tests/agenda-backup2.test.js`, `tests/agenda-backup2-awb.test.js`,
`tests/agenda-merge-backup2.test.js`, `tests/transport-backup2.test.js` e nos
cenários de Backup II em `tests/e2e/agenda-client.test.js`.
