# Transporte integrado ao app: plano de implantação

Para: agente que vai implementar (Claude Sonnet 5.5). Escrito em 2026-11-09, com o código em `bf2d58d`.
Antes de começar, leia `AGENTS.md`, `CLAUDE.md` e este plano inteiro. O estado do repositório prevalece sobre as referências de linha abaixo.

## 1. Objetivo

Hoje o Transporte abre em outra janela (`?page=transporte`, `TransporteApp.html`) e depende da planilha "Documentação para Transporte de Amostras". O objetivo é:

- Transporte dentro do app principal, sem abrir janela, só para admin durante o piloto.
- Nova tela em tarefas, com um passo por vez, para quem tem limitações de atenção ou memória.
- Nada mais depende da planilha de Transporte, que será desativada.
- Preparações simultâneas permitidas.
- Formulário ANVISA gerado em HTML e novo status de peticionamento.

Mockup aprovado: https://claude.ai/artifact/PKLAYinyY5E2vV8SUvwTQV (privado do usuário; leia com a ação `read` da ferramenta Artifact, arquivos `project/Main.dc.html`, `project/Email.dc.html`, `project/Autorizados.dc.html`). Em caso de conflito, as decisões da seção 3 prevalecem sobre o mockup.

## 2. Como trabalhar

- Execute uma etapa por vez, na ordem. Ao final de cada etapa: `npm.cmd run verify`, validação de interface quando aplicável, resumo ao usuário e **pare**. Só avance com o ok do usuário.
- Commit só quando o usuário pedir. Publicação só quando o usuário pedir, por `npm.cmd run push`, seguindo `PUBLICACAO_SEGURA.md` até o gate no Chrome.
- **Pare e pergunte** nos pontos marcados com `PERGUNTAR`, e sempre que uma regra de negócio não estiver aqui. Não invente regra clínica nem regulatória.
- Não escreva em planilhas reais durante o desenvolvimento nem envie e-mail real. Testes usam `CodexExternalEffects.gs` e `tests/helpers/`.
- Testes e exemplos só com dados fictícios. Telemetria sem dado pessoal ou clínico.

Armadilhas conhecidas:

- `WebApp.gs` tem fins de linha mistos: edite trechos, nunca reescreva o arquivo, e confira `git diff --stat`.
- Apps Script não aceita `.gs` e `.html` com o mesmo nome base. O namespace é global nos `.gs` e também nos scripts do cliente.
- `TransporteApp.html` tem globais genéricos (`state`, `esc`, `norm`, `toast`, `setBusy`, `saveData`). Não inclua esse arquivo em `Index.html`. A tela nova tem arquivos e prefixo próprios (`transpCentral`, CSS `.tc-`).
- Regras nos blocos gerados de `AgendaServerRules.gs` e `SharedAgendaRules.html` são editadas em `tools/agenda-rules-core.js`, seguido de `npm.cmd run rules:generate`.
- `docs/` e `tests/` não devem levar `.js`/`.html` novos que o clasp possa enviar: confira `.claspignore`. Por isso a referência do formulário termina em `.js.txt`.
- O conversor HTML para PDF do Apps Script não imprime `background`; veja `transporteDocsGradeFundoSrc_` em `TransporteDocumentosGrade.gs` para o cinza das células.
- `test:ui` nesta máquina exige Chrome (preload com channel chrome, ver `PLAYWRIGHT.md`).
- A cota de Gmail é compartilhada com outros projetos da conta: e-mail pode falhar por cota. Falha de e-mail não pode perder estado nem duplicar envio.

## 3. Decisões do usuário (não reabrir)

### Tarefas

- Um envio vira tarefa **5 dias úteis** antes da data (sem fim de semana e feriados operacionais). Depois disso, fica em "Mais adiante".
- A equipe agenda perto do envio para reduzir cancelamentos: "Courier não agendada" é horizonte, não atraso.
- Unidade da tarefa é a visita. Uma visita com vários transportes é uma tarefa com um passo a passo por transporte.
- Preparações simultâneas são permitidas, mas não duas pessoas no mesmo transporte.
- Salva sozinho, retoma de onde parou, a ordem é decidida pelo sistema.
- Prazo: mesmo cálculo das Pendências (`prazoHorasPendenciaAgenda_`) e mesmos textos (`pendenciaPrazoLabel`): com 24 horas úteis ou menos, a tarefa fica vermelha com "Atrasada", "Agora", "Em 1h" ou "Em Xh". Sem cor antes disso.
- O tipo de transporte (Backup, Transporte I) só aparece na linha secundária, nunca no título.

### AWB

- MARKEN e DHL Ambiente: vêm de pacote recebido no início do estudo, específico por estudo. Mostrar a última AWB usada no estudo, filtrando `AWB_Utilizadas` por Projeto e Courier, em RPC própria no passo de AWB, sem lock (leitura medida em 0,5 s com 691 linhas).
- OCASA: gerada no site, pela guia modelo. "Gerar Pedido" já solicita a retirada; cancelar só por csbio@ocasa.com. Links das guias ficam fora por enquanto. A OCASA continua recebendo e-mail, por rastreabilidade.
- PINEX, duas fases: enviar o Formulário (PINEX Agendamento) por e-mail; a PINEX responde, por exemplo, `Confirmação de agendamento - Coleta: 78429 - Frete: 94624 - Protocolo: MB12C0224 - Data da coleta: 11/03/2026`. A pessoa cola essa linha. Coleta vai em PINEX COL. Nº (**aceitar 5 ou 6 dígitos**), Frete vai em AWB, Protocolo fica só em registro. Avisar se a data diferir da data do envio.
- Se a AWB já está na Agenda, o passo some e ela aparece em Conferir. Geralmente já existe.
- Transporte em trânsito sempre tem AWB.

### Materiais

- Informados pelo laboratório: bloqueados, com botão Editar.
- A edição atualiza a Agenda e deixa nota visível junto ao campo de material: "Material ajustado na preparação do transporte", com quem, quando e valor anterior. Não usar Observações. Usar `codexWriteAuditChanges_`.

### Fluxo internacional (OCASA com laboratório fora do Brasil, e PINEX)

1. Quem prepara gera os documentos, confere o formulário ANVISA e conclui.
2. O status passa para **Aguardando peticionamento** (GRU e extrato). O rascunho à courier fica guardado.
3. Sai e-mail automático com o formulário anexo para os autorizados.
4. Um autorizado salva GRU e extrato na pasta do envio no servidor e marca "GRU e extrato prontos" no app. O app não acessa o servidor.
5. A tarefa volta para "Para fazer": "Anexar a GRU e o extrato e enviar à courier".

### E-mail de peticionamento

- Assunto: `[PETICIONAMENTO] <estudo> - AWB <awb> - Envio dd/MM/yyyy`.
- Layout dos e-mails existentes, título "Peticionamento - Envio de Amostras". Tabela com data do transporte, dia da semana do **transporte**, protocolo, participante com iniciais, sexo, número de identificação, visita. Logística no padrão de `gerarHtmlCouriers_`, com material no resumo dos agendamentos (`Plasma: 2 tubo(s), 2,00 mL`), link para abrir o envio e rodapé "Solicitado por".
- Destinatários: lista em Configurações, grupo Transporte, chave `Autorizado a peticionar`, uma linha por pessoa: `lrmotta@ucs.br` e `agregor1@ucs.br` (Aline). Só eles veem e usam "GRU e extrato prontos".

### Formulário ANVISA (Petição de Fiscalização e Liberação Sanitária - Exportação)

Layout **aprovado como fiel** pelo usuário. Referência executável: `docs/PETICAO_FISCALIZACAO_REFERENCIA.js.txt`. Modelo em branco: `C:\Users\lrmotta\Downloads\Petição fiscalização e liberação sanitária - Exportação.doc`. É diferente da Petição de Anuência já gerada, que continua igual.

| Campo | Regra |
|---|---|
| Exportador | Fixo, em configuração: FUNDAÇÃO UNIVERSIDADE DE CAXIAS DO SUL, 88.648.761/0001-03, FRANCISCO GETÚLIO VARGAS, 1130, BL. S SALA 315, PETRÓPOLIS, 95070-560, CAXIAS DO SUL, RS, (54) 3218-2737, fax (54) 3218-2056 |
| E-mail do exportador | `ips@ucs.br` |
| Razão social e CNPJ | Aba Courier, campos Empresa (1) e CNPJ (1) |
| 01 | Remessa Expressa |
| 02 | Registro em branco; MAWB `-`; HAWB = AWB |
| 03 | `CE ` + N° CE da aba Projetos |
| 04 | `3 - PESQUISA CLÍNICA` |
| 05 | `2 - MATERIAL BIOLÓGICO HUMANO` |
| 06 | Nome completo do LabCentral, sempre |
| 07 | LabCentral é tratado como correto. Endereço inteiro em Rua/Avenida; Nº, Complemento, Bairro e e-mail `-`. Município e UF: separar Cidade na última vírgula; sem vírgula, UF `-`. CEP nas caixas, 5 antes do hífen e 3 depois |
| Telefone | Se começar por `+`, o código vai em DDD; senão, DDD pelo país (USA/Estados Unidos +1, Germany/Alemanha +49). Fax repete o telefone. Sem telefone: `-` e **aviso, sem bloquear** |
| 08 | Uma linha por material: `01. MATERIAL BIOLÓGICO HUMANO. SORO. QUANTIDADE: 2,00 mL` (maiúsculas, total do material no transporte, 2 casas, mL) |
| Bloqueios | Sem AWB, sem N° do CE, courier sem razão social ou CNPJ, mais de 6 materiais: não gerar e explicar |

Dados PINEX extraídos dos modelos do próprio WebApp (`peticaoPinex`, `invoicePinex`): Transportes Brasil Cargo Express LTDA., 20.494.657/0001-60. A aba Courier está vazia para Pinex. HAWB = Frete é suposição: registrar que precisa de confirmação no primeiro envio real.

A geração eletrônica substitui "preencher": o passo mostra o documento pronto para conferir e imprimir, só depois da AWB.

## 4. Telas

Uma página nova no app, "Transporte", com quatro abas. Admin no piloto.

**Para fazer.** Cartão "Próxima tarefa" e lista "Depois desta, nesta ordem", por data. Tipos e títulos:

| Situação | Título |
|---|---|
| Sem documentos, um transporte | Preparar o transporte |
| Sem documentos, vários | Preparar N transportes |
| Documentos gerados, e-mail não enviado | Enviar a documentação à courier (linha cinza começa com "Rascunho de e-mail pronto") |
| PINEX (Agendamento) | Pedir a coleta à PINEX |
| PINEX aguardando colar números | Informar os números da PINEX |
| GRU e extrato prontos | Anexar a GRU e o extrato e enviar à courier |

Etiquetas: "Parou no passo N" e "Com <pessoa> agora". Rodapé: "N transportes mais adiante" e link para a aba.

**Passo a passo.** Ordem: Conferir → [AWB ou Números, se faltar] → Gerar → [ANVISA, se internacional] → Enviar. Painel lateral "Este envio" e botão "Sair e continuar depois".

- *Conferir:* uma tela só, com blocos Transporte (courier, temperatura, coleta, AWB se houver; botão Corrigir), Destino (nome e endereço; Corrigir) e Materiais (leitura; Editar). Botão "Sim, está tudo certo". Correção atualiza a Agenda. Aviso de caixa especial, com antecedência de 2 dias úteis. Em PINEX (Agendamento), escolher quem entrega as amostras.
- *AWB:* textos por courier conforme o mockup, com aviso de AWB já usada (`getTransporteAwbAviso`).
- *Gerar:* lista dos documentos; a pessoa pode sair enquanto gera.
- *ANVISA:* conferir e imprimir o formulário; concluir dispara o aviso.
- *Enviar:* itens para marcar. Quando a tarefa é só enviar, mostrar a explicação "Os documentos já foram gerados..." e três passos: abrir o rascunho no Gmail; conferir PDFs e destinatário; clicar em Enviar e voltar. Botão "Pronto, enviei". O app reconhece o envio pelo monitor atual. No fim, ir ao próximo transporte da visita, à próxima tarefa, ou "Tudo feito por agora".

**Acompanhar.** Aguardando peticionamento (com botão para autorizados), Aguardando confirmação da courier, Aguardando resposta da PINEX e Em trânsito.

Em trânsito reutiliza a regra do cartão `awbEnviadaNaoEntregue`: lupa `travel_explore` só com `trackingUrl`; "Confirmar entrega" com o mesmo modal de `modalConfirmarEntregaPendencia` e a RPC `confirmarEntregaTransportePendencia` (Transportes I a IV). Backup não tem tratamento especial aqui: quando enviado, aparece como o transporte do seu agendamento, normalmente Envio de Amostras. Não criar rótulo nem linha duplicada.

**Mais adiante.** Semanas em acordeão, uma aberta por vez, a primeira aberta. Cada linha: data, participante e visita, estudo, courier e temperatura, tipo de transporte, destino. "Viram tarefa a partir de <data>". Só consulta.

**Backups não agendados.** Mesmos dados e ordem do cartão `transporteBackupNaoAgendado`, incluindo Backup II, com o aviso de prazo. Botão "Abrir agendamento" leva ao registro na Agenda, onde já estão "Criar novo Envio de Amostras" e "Usar agendamento futuro". Não duplicar essas opções. Sem aviso no "Para fazer".

**Pendências.** Sem mudança: o cartão "Courier não agendada" mostra todas as pendências. A janela de 5 dias úteis vale só na tela do Transporte (decisão do usuário em 2026-11-09, que reverteu a janela implantada na Etapa 1).

## 5. Etapas

### Etapa 1: ajustes independentes

- `pinexColeta` aceita `/^\d{5,6}$/` em `TransporteCodexConfig.gs` (~3121) e `TransporteApp.html` (~2180).
- Pendências: a janela de 5 dias úteis com "Ver seguintes" foi implantada e depois revertida por decisão do usuário (2026-11-09); o cartão mostra todas as pendências.

Testes: `tests/transport-numbers.test.js`, `tests/pendencias-*.test.js`, `tests/dashboard-*`.

### Etapa 2: registro por envio na planilha principal

Hoje o registro atual fica na planilha de Transporte (Folha C3:C15 e notas, Declaração), `transporteReadRegistro_` e `salvarTransporteInterno_`. Isso impede simultaneidade e precisa vir antes da tela.

- Nova aba `Transporte_Registros` na planilha principal: chave `agendaId|slot`, `Dados_JSON`, `Passo`, `Versao`, `Atualizado_Em`, `Atualizado_Por`, `Em_Preparo_Por`, `Em_Preparo_Desde`. Criação só em caminho de escrita; leitura nunca altera schema. Validar o limite de 50 mil caracteres por célula antes de gravar.
- Funções novas de leitura e gravação com conferência de versão, sem usar a planilha de Transporte.
- Tela antiga segue como está.
- Ler `docs/TRANSPORTE_OPERACOES_CICLO.md` e `docs/TRANSPORTE_IDEMPOTENCIA_LOCAL.md`. Não duplicar o que `Transporte_Operacoes` já guarda.
- `transporteDocsDados_(registro, opcoes)` deve gerar a partir desse registro para os 5 couriers de `TRANSPORTE_DOCS_MEMORIA_COURIERS_`.

Critério: um teste gera os dados de documentos de um registro novo com a abertura da planilha de Transporte bloqueada (`TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_`).

### Etapa 3: e-mails sem a planilha

`criarRascunhoEmail_` (~6072) lê abas e fórmulas: OCASA lê Declaração D38, D39 e N39; MARKEN lê Folha e `Excluir!B26`. Reescrever para gerar assunto, corpo e destinatários a partir do registro, um courier por vez.

- Regressão: comparar o texto novo com o atual para cada courier e temperatura, com fixtures fictícias.
- `Excluir!B26` vale sempre 1, mesmo em temperatura mista com 2 volumes na Invoice. `PERGUNTAR` se é defeito antes de mudar o comportamento.

### Etapa 4: lock por envio

Hoje `codexWithDocumentLock_` envolve salvar, gerar e concluir. Trocar por lock só nas escritas curtas: reserva de AWB, gravação do registro e marcação de `Transporte_Operacoes`. Geração de PDF e rascunho ficam fora do lock.

- Revalidar dentro do lock versão e dono do preparo. `Em_Preparo_Por` expira; o outro usuário vê "Com <pessoa> agora".
- Duas gerações simultâneas de envios diferentes não podem se misturar. Reexecução não duplica PDF nem rascunho (`generationRequestId`).
- Reserva de AWB continua única entre execuções simultâneas (`docs/AWB_UNICIDADE.md`).

Peça revisão independente desta etapa por um subagente (AGENTS.md).

### Etapa 5: página no app e Para fazer

- `ADMIN_ONLY_MODULES` em `SharedAccessRules.html` recebe a chave do módulo novo. O item antigo que abre a janela segue para os demais. Modelo de acesso e carga: Farmácia (`docs/FARMACIA_ACESSO.md`, `irPara` em `IndexCoreScripts.html`).
- Toda RPC nova usa `codexAssertAdmin_()` no servidor, salvo as de peticionamento (Etapa 8).
- RPC `getTransporteTarefas`, sem lock, com uma leitura só da Agenda e de `Transporte_Operacoes`; medir com `codexMeasurePerformance_`.
- Respostas fora de ordem não sobrescrevem a tela (AGENTS.md). Saída com alteração passa por `appConfirmNavigationIfDirty`.
- Atualizar `tests/frontend-contracts.test.js`.

### Etapa 6: passo a passo

Implementar a seção 4, passos Conferir, AWB, Gerar e Enviar, sobre as Etapas 2 a 4. Remover da tela nova qualquer "Gerar PDF" por planilha.

Materiais: nova RPC só para edição explícita. Hoje `TransporteCodexConfig.gs` (~4265–4272) só grava se a Agenda estiver vazia; **não** mude a sincronização automática para sobrescrever. Exibir a nota na Agenda junto ao material (ver `agendaHistoricoItem_`).

Validar no navegador local cada courier: MARKEN, OCASA nacional e internacional, DHL ambiente e congelado, PINEX, PINEX (Agendamento), visita com vários transportes, sair e retomar, duas pessoas no mesmo envio.

### Etapa 7: Acompanhar, Mais adiante e Backups

Implementar as abas da seção 4 reaproveitando os dados de Pendências, sem segunda leitura desnecessária. Em trânsito usa o modal e a RPC existentes; se precisar levar o modal para a tela nova, não duplique a regra.

### Etapa 8: ANVISA e peticionamento

- `TransportePeticaoHtml.gs`: portar `docs/PETICAO_FISCALIZACAO_REFERENCIA.js.txt` (medidas, regras, bloqueios e avisos) sobre os helpers de `TransporteDocumentosHtml.gs`. Não incluir na lista de PDFs enviados à courier nem mexer na Petição de Anuência.
- Status `Aguardando peticionamento` em `tools/agenda-rules-core.js`. Revisar todos os consumidores de `courierStatusKey`: não pode contar como "não agendada", "aguardando confirmação" ou "enviado", nem disparar cobrança ou lembrete. Revisar Agenda, Dashboard, Pendências e monitores.
- Lista de autorizados via `getConfigAppValuesByKeys_`, com comparação de e-mail normalizada. O formulário de Configurações só oferece chaves existentes, então as primeiras linhas nascem por rotina protegida e auditada, executada pelo usuário.
- E-mail por `CodexExternalEffects_.sendEmail`, com anexo, idempotente: guardar data do envio no registro; falha mantém a tarefa com "Tentar de novo" e não muda o status sem o envio. Reaproveitar `gerarHtmlCabecalhoEmail_`, `gerarTabelaAgendaEmail_` (com `rotuloData`), `gerarHtmlCouriers_`, `gerarRodapeEmailAgenda_`, `extrairIniciais_`, `agendaDiaSemanaEmail_`. Conferir que a data e o dia da semana são os do transporte.
- RPC "GRU e extrato prontos": autorização no servidor pela lista, revalidação do status dentro do lock e auditoria.
- `PERGUNTAR` no início da etapa: a Aline é admin? No piloto o módulo é só de admin. Se não for, proponha o menor acesso possível à seção de peticionamento e aguarde a decisão.
- Rotina protegida para preencher Empresa e CNPJ da Pinex na aba Courier, e chaves de configuração, executada pelo usuário.

Testes: internacional e nacional, autorizado e não autorizado, reenvio sem duplicar, falha de e-mail, status nas regras e, em navegador local, o HTML comparado com a referência. O PDF real pelo conversor do Apps Script só pode ser conferido em produção: peça a conferência ao usuário.

### Etapa 9: abrir a todos e desativar a planilha

`PERGUNTAR` antes de iniciar. Só com autorização:

1. Comparar PDFs e e-mails novos com os atuais em envios reais (`diagnosticarDocsDadosLoteTransporteHtml*`).
2. Abrir o módulo aos demais perfis e retirar a janela antiga e o "Gerar PDF" pela planilha.
3. Remover as funções que usam `getTransporteSpreadsheetCodex_` (hoje 45 usos em `TransporteCodexConfig.gs`, `TransporteLayoutsModelo.gs` e `TransporteDocumentosGrade.gs`). Decidir com o usuário o destino dos layouts congelados e dos `diagnosticar*`.
4. Reescrever os mais de 100 testes da tela antiga que deixarem de valer, sem enfraquecer as regras.

## 6. Pendências que dependem do usuário

- Confirmar HAWB = Frete no primeiro envio PINEX real.
- Cadastro: "2 Tessender Drive" (exemplos: Tesseneer), "Covington, Ohio - KY", PPD Highland Heights sem telefone. O sistema segue o cadastro; só avise se aparecerem em documento gerado.
- Vários estudos sem N° do CE bloqueiam o formulário: informar a lista se isso afetar envios próximos.
- Limite de versões do Apps Script: conferir antes de publicar (eram 182 de 200 em 2026-11-04; pode ter mudado).

## 7. Definição de pronto de cada etapa

Comportamento implementado, `npm.cmd run verify` aprovado, `npm.cmd run test:ui` quando tocar a Agenda, cenários visuais validados, diff revisado, e resumo com arquivos alterados, verificações, limitações e o que falta. Fixtures locais não comprovam produção: diga o que só poderá ser verificado depois de publicar.
