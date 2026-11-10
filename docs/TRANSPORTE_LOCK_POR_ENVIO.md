# Lock por envio no Transporte integrado

Contrato das primitivas de `TransporteRegistros.gs` para o passo a passo da tela nova (Etapas 5 e 6).
A tela antiga continua com `gerarPdfTransporte` e o lock longo; nada aqui a altera.

## Regra

O lock do documento (`codexWithDocumentLock_`) cobre só escritas curtas. Geração de PDF, criação de
rascunho e envio de e-mail rodam fora dele, para que outro envio possa ser preparado enquanto um PDF gera.

| Escrita curta (com lock) | Função |
|---|---|
| Assumir ou renovar o preparo | `transporteEnvioReivindicar_` |
| Gravar o registro do envio | `transporteRegistroGravar_` |
| Liberar o preparo | `transporteEnvioLiberar_` |
| Reservar a AWB (`AWB_Utilizadas`), usando a AWB do registro gravado | `transporteAwbReservarEnvio_` |
| Marcar a documentação em `Transporte_Operacoes` | `transporteOperacaoRegistrarEnvio_` |

## Preparo por pessoa

- `Em_Preparo_Por` guarda o e-mail em minúsculas; `Em_Preparo_Desde` é o último sinal de atividade do dono.
- Reivindicar de novo ou gravar renova o sinal. Sem sinal por 15 minutos (`TRANSPORTE_PREPARO_EXPIRA_MS_`), o preparo expira.
- Preparo ativo de outra pessoa: reivindicar devolve `{ ok: false, emPreparoPor }` (a tela mostra "Com <pessoa> agora")
  e gravar lança `TRANSPORTE_REGISTRO_EM_PREPARO`. Envios diferentes não se bloqueiam.
- Reivindicar não muda `Versao`; ela conta só mudanças nos dados. Gravar confere dono e versão dentro do lock
  (`TRANSPORTE_REGISTRO_VERSAO` em conflito) e nada é escrito quando recusa.
- Quem grava depois da expiração não herda o dono antigo: a linha fica sem dono até alguém reivindicar.
  Se o próprio dono expirado grava, a resposta traz `perdeuPreparo: true` e a tela deve avisar e reivindicar de novo antes de gerar.
- Gravar não exige posse quando ninguém é dono (a versão protege os dados); reservar a AWB e registrar a operação
  recusam quando outra pessoa tem o preparo ativo.
- Sinal de atividade no futuro (além de 1 min de tolerância) conta como expirado. `agora`, `emPreparoPor` e `emPreparoDesde`
  não existem como opção de gravação; as RPCs da Etapa 5 não devem repassar `agora` do cliente.

## Ordem sugerida para gerar (Etapa 6)

1. Reivindicar o envio e gravar o registro (lock curto cada).
2. Reservar a AWB (lock curto); duplicidade bloqueia antes de qualquer arquivo.
3. Gerar dados e PDF em memória e criar o rascunho, **sem lock**, com `generationRequestId`
   (o mecanismo `transporteGeneration*` por token já impede PDF ou rascunho duplicado na reexecução).
4. Registrar em `Transporte_Operacoes` (lock curto, só para o dono; idempotente por Agenda ID e slot para o mesmo PDF)
   e atualizar o status na Agenda. A base de cobrança (leitura da Agenda inteira, ~13 s) roda depois, em lock próprio:
   o lock da gravação não a espera, mas ela ainda serializa com outras gravações enquanto roda.

## Limites

- A atualização do status na Agenda (`Docs gerados`) e a marcação em `Transporte_Operacoes` continuam
  sendo escritas separadas; se a segunda falhar, a reexecução com o mesmo token repete só o que faltou.
- O relógio do preparo é o do servidor Apps Script; não há renovação automática enquanto a tela está parada.
- Duas gerações do mesmo envio com tokens diferentes sobrescrevem a linha de `Transporte_Operacoes`; o preparo
  por pessoa é a proteção, não a idempotência do token.
- Fixtures locais não comprovam a concorrência real entre execuções do Apps Script.

## RPCs do passo a passo (Etapa 6, parte servidor)

Todas exigem administrador no servidor (`codexAssertAdmin_`). Arquivos: `TransporteEnvio.gs` e `TransporteEnvioGerar.gs`.

| RPC | Função |
|---|---|
| `getTransporteEnvio(agendaId, slot)` | Assume o preparo, monta o registro pela Agenda (preservando o que a pessoa preencheu) e devolve passos, versão e avisos. Outra pessoa recebe `{ ok: false, comPessoa }`. |
| `salvarTransporteEnvio(agendaId, slot, versao, campos, passo)` | Salva só campos permitidos (agendado por, janela, caixa, responsável pela entrega, números PINEX, AWB enquanto a Agenda não tem). |
| `registrarRespostaPinexEnvio(agendaId, slot, versao, texto)` | Lê a linha da PINEX: Coleta (5 ou 6 dígitos) em PINEX COL. Nº, Frete na AWB, Protocolo no registro; avisa se a data difere. HAWB = Frete segue como suposição a confirmar no primeiro envio real. |
| `getTransporteAwbUltima(projeto, courier)` | Última AWB do estudo e da courier em `AWB_Utilizadas`, sem lock e sem escrita. |
| `gerarDocumentosTransporteEnvio(agendaId, slot, versao, token)` | AWB e Agenda em lock curto; documentos, PDF e rascunho fora do lock com recuperação por token; depois `Transporte_Operacoes` e status da Agenda. |
| `sairEnvioTransporte` / `concluirEnvioTransporte` | Guardam o passo e liberam o preparo. |

Ainda fora desta parte: a interface do passo a passo, a edição explícita de materiais com a nota na Agenda e a
correção de transporte/destino (hoje, abrir o registro na Agenda). O passo ANVISA entra na Etapa 8.
