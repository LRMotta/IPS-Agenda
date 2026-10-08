# Revisão Transporte S00–S22 — concluída localmente em 2026-10-08

## Parte A — Tabela de veredito

Evidências abaixo são do checkout **antes destes patches**, em `TransporteCodexConfig.gs` (arquivo físico que reúne os cinco marcadores BEGIN/END), salvo indicação. Não são evidência da implantação ativa ou de dados de produção. Alterações preexistentes em WebApp, Dashboard, auditoria e testes foram preservadas.

| ID | Veredito | Evidência: função, trecho, linha inicial | Risco da mudança | Depende de WebApp.gs? |
|---|---|---|---|---|
| S00 | PARCIAL | `gerarDocumentacaoTransporteCodex`, 124: `{apiToken: codexGetWebAppApiToken_(), payload: payload}` já correto; ping 166 idem. `doPost`, WebApp 166/177, usa envelope/importador privado existente. Global URL 96 ainda `= ''` incondicional. | baixo | sim |
| S01 | JÁ CORRIGIDO | `transporteNumber_`, 1226–1233: `codexMatBioFormulaNumber_(..., quantity === true)`; parser 1034 diferencia ponto decimal e milhar de tubos. | baixo | não |
| S02 | PARCIAL — defesa para dados externos/legados | `codexMatBioUnitKey_` possui fallback mL; validação estrita aplicada nas fronteiras de Transporte. A UI fixa unidade por tipo/courier e não permite escrevê-la. O fallback não constitui defeito confirmado no uso normal; endurecimento global seria regressivo. | condicionado a dados incompatíveis | sim |
| S03 | APLICÁVEL | `normalizarSlotTransporteCodex_`, 347: `return String(slot || '1')`; resolvedores 235/3253 usam fallback `courier1`. `transporteSetAgendaLink_`, 301, escreve antes de validar slot. | médio | sim |
| S04 | NÃO APLICÁVEL | `transportePdfManifesto_`, 3635–3640, compara texto; `transportePeticaoMaterialRows_`, 3031, já formata total. 0.3 e 0.1+0.2 produzem mesmo `0,30 mL`. Arredondamento global perderia precisão deliberada em 951. | alto | não |
| S05 | PARCIAL | `codexMatBioKey_`, 833: `indexOf(alias) >= 0`; `SharedMatBioTypes.html`, 62, equivalente. Igualdade no `typeConfig` e `key:'outro'` já preservam JSON estruturado. | médio | sim |
| S06 | PRECISA DE INFORMAÇÃO | `codexMatBioNumberFormatter_`, 1046: `new Intl.NumberFormat('pt-BR', ...)`. Node produz `1.234,50`; falta resultado do runtime remoto. | baixo | não |
| S07 | APLICÁVEL | `transporteMonitorarEnviosExecutar_`, 629–641, compara referência/data/anexos sem `message.getFrom()`. Trigger é `monitorarConfirmacoesCourierAgendadas`, WebApp 15627/15637. | médio | sim |
| S08 | PARCIAL | Monitor 619: `newer_than:30d`, até 500 threads. `transporteDocumentosSemEnvioPendencias_`, 490–497, não distingue operação antiga. Não há prova de necessidade de ampliar busca. | baixo | não |
| S09 | APLICÁVEL | `transporteRegistrarDocumentacaoGerada_`, 435–448, preserva envio só por agenda/slot. Headers 351–356 não têm hash; manifesto hash já existe 3643. | médio | sim |
| S10 | APLICÁVEL | `baixarPdfTransporte`, 3859–3864: write-ACL e `getFileById(fileId).getBlob()` sem MIME/vínculo. Front `downloadGeneratedPdf`, TransporteApp 809, usa RPC e fallback Drive. | médio | sim |
| S11 | PARCIAL | `imprimirTodasAbas`, 5406–5409: cópia na pasta final antes anonimizar; anonimização 5700–5710 só C3; finally 5476 só lixeira. Nome de cópia já é AWB/data/temp, não nome completo. | médio; alto para remoção definitiva | não |
| S12 | PARCIAL | Helpers 1462/1625 usam `setValue`; texto livre também chega em C3:C14 (2709), F30 (2750), ensaios (2800), responsável D32 (2853). Google documenta fórmula para prefixo `=`; não comprova `+/@` neste API. | médio | não |
| S13 | PARCIAL | Pasta CE 11, CNPJ 4775/5191/5244/5270, contatos 5278, G33 4213/4536 e pesos 4247 fixos. Scanner 5294 percorre abas selecionadas, não todas. Valores incorretos não demonstrados. | médio | sim |
| S14 | APLICÁVEL | `transporteHtmlDecode_`, 1514–1523: passes sequenciais e `fromCharCode`; reprodução `&#128512; → U+F600`, `&amp;#65; → A`. Chamador 1433 sanitiza duas vezes. | médio | não |
| S15 | PARCIAL | `transporteDraftStatus_`, 3831, ignora `ok:true` quando mensagem começa Erro; guard 4912 atribui outro responsável ao deployment. Guard estruturado em 4898 e anterior a createDraft (4763/4820) já existem. | baixo | sim |
| S16 | PARCIAL | `gerarPdfTransporte`, 3710, lock cobre export/Gmail. Depois da cópia ainda usa sourceSS 5704, CE 5450 e draft 4739. Upsert final 3790 não tem token de geração. Divisão proposta isoladamente insegura. | alto | sim |
| S17 | APLICÁVEL | Monitor: leituras por item 574–575/593–595, regex 530, config 640, auditoria por item 732, índices fixos 688/709/743, ausência de flush/invalidação antes retorno 747. Revalidação por versão sob lock 672 já correta. | médio | sim |
| S18 | APLICÁVEL | `getTransporteSpreadsheetCodex_`, 71, `openById(id)` em toda chamada. Configurador 42 não limpa caches de handle/abas/rótulos. | baixo | não |
| S19 | PARCIAL | `imprimirTodasAbas`, 5413, sleep 700; openWorkingCopy 5694 já espera apenas em falha. Scanner 5294 é restrito ao pacote. Não há sleeps 900/1200 neste fluxo nem medição remota para removê-los. | médio | não |
| S20 | PARCIAL | `transporteComunicadoEspecialFileMatches_`, 5159, substring `ce`; também exige alias do estudo 5164. Busca recursiva 5138 respeita pasta e profundidade 2. Busca global proposta perderia escopo. | baixo | não |
| S21 | PARCIAL | Aliases legados 3995–4012 e correção mojibake 4070–4122; getters concatenam. `manageSheetVisibilityUnified_`, 4575, é wrapper. Funções alegadas são nomes distintos, não colisões comprovadas no checkout. | médio | não |
| S22 | PARCIAL | `verificarEAtualizarG33Declaracao_`, 4231, e `atualizarPesoGeloDeclaracao_`, 4554, logam erro e seguem. UI 2129 só destaca falha de draft/Drive. Matriz de obrigatoriedade por courier não consta de contrato validado. | médio; alto para bloqueios novos | não |

## Parte B — Diffs, contratos e verificação

Implementação local concluída. [Diff integral exclusivo desta tarefa](TRANSPORTE_REVISAO_S00_S22.patch) contém os hunks por função, inclusive testes, sem incorporar alterações preexistentes de WebApp/Dashboard/auditoria. Os trechos abaixo resumem o diff de cada item; o patch integral é a referência exata. Todos os cinco arquivos de origem indicados pelos marcadores continuam no arquivo físico `TransporteCodexConfig.gs`; não houve separação de arquivos ou remoção de RPC pública.

**Validação:** `npm.cmd run verify` aprovado: rules:check, syntax, lint e **1.108 testes Node**. `npm.cmd run test:ui` aprovado: **72 testes de interface**, com RPCs simuladas e rede bloqueada nas fixtures de Transporte. Os 19 cenários de Transporte incluem telas de 390 e 1.280 px, ausência de erros de console, recuperação legada de Fezes, unidade desconhecida e avisos de geração. Capturas `transport-review-warning-390.png` e `transport-review-warning-1280.png` ficam em `%TEMP%/ips-agenda-playwright`. A primeira tentativa de iniciar Chromium no sandbox falhou com `spawn EPERM`; a execução autorizada do navegador local passou. Nenhum teste acessou Sheets/Drive/Gmail reais. Revisão independente identificou e corrigiu também o rascunho antigo enviado depois da regeneração. Sem commit, push ou implantação.

**Compatibilidade:** parâmetros existentes foram mantidos; `strict` e `pdfHash` são opcionais em helpers privados. Novos campos de resultado são aditivos (`warnings`, `draftErrorCode`, `conteudoPdfHash`). `PDF_Hash` é a 17ª coluna de Transporte_Operacoes: leitura de 16 colunas permanece sem migração; a primeira escrita verifica cabeçalhos/ocupação antes de adicionar a coluna. Conteúdo não é apagado para acomodar o novo schema. Leituras da Agenda mantêm tolerância legada. A regra histórica de Fezes recupera o rótulo em gramas sem alterar os números quando a unidade antiga é conhecida; `uL`, `µL` ou `mg` exigem revisão antes de gravar Transporte.

Os testes manuais abaixo são roteiro para **cópia de homologação**, com PDFs e rascunhos de teste; não foram executados no deployment remoto. Testes de envio exigem mensagem de teste enviada manualmente pelo operador. Não há autorização de publicação nesta entrega.

### S00 — origem CODEX_TransporteBridge.gs

```diff
-var TRANSPORTE_WEBAPP_URL_CODEX = '';
+var TRANSPORTE_WEBAPP_URL_CODEX = typeof TRANSPORTE_WEBAPP_URL_CODEX !== 'undefined' ? TRANSPORTE_WEBAPP_URL_CODEX : '';
```

Aplicada somente proteção contra sobrescrita. Envelope `{apiToken,payload}` e importador privado já existem; não se restaurou token em URL. Chamadores: `gerarDocumentacaoTransporteCodex`, `testarUrlWebAppTransporteCodex`, `getTransporteWebAppUrlCodex_`, `doPost`. Efeito: mantém modo acoplado e desacoplado existentes. Manual: configurar URL de homologação; executar ping com token no corpo → sucesso; token apenas em query → recusa. Executar importação de registro fictício com envelope → importação no alvo autorizado. URL declarada anteriormente permanece preservada.

### S02 — origem TransporteWebApp.gs; SharedMatBioCore.html; TransporteApp.html

```diff
-function codexMatBioUnitKey_(unit) {
+function codexMatBioUnitKey_(unit, strict) {
+  // Em strict, rejeita unidade desconhecida; vazio mantém default legado.
+  // A leitura e os chamadores sem strict preservam o fallback existente.
```

Chamadores afetados: validação de `salvarTransporteInterno_`, importação JSON, `matBioErrors`; helper equivalente do cliente. Chamadores preservados: `codexMatBioValidateAgendaPayload_`, `agendaValidarMaterialBioPayload_`, `agendaMaterialSummaryFromJson`, `salvarNovoEventoComFeriado`, `salvarNovoEventoCompleto`, `agendaSetCourierLinha`. Unidade raw desconhecida é recusada nas fronteiras de Transporte antes de normalização/importação. A leitura tolerante da Agenda permanece.

Esclarecimento de 2026-10-08: o formulário não recebe unidade escrita. Soro com fórmula `2x0,5` e courier em mL resulta em 1 mL; escrever `2x0,5 mL` é inválido. Os cenários uL/µL/mg em JSON são injeções artificiais de dados externos/legados, sem evidência de registros reais incompatíveis. Fezes com rótulo legado mL e `2x1` recupera 2 g conforme o contrato fixo do tipo, preservando números; Fezes uL artificial é bloqueada em Transporte. Trocar courier não converte números: a ação da UI mL→L é o botão explícito. Foram adicionados comentários e regressões desse contrato, sem mudar o funcionamento. O patch original deste relatório registra a implementação anterior; o esclarecimento posterior deve ser revisado separadamente.

### S03 — origem CODEX_TransporteBridge.gs e TransporteWebApp.gs

```diff
-function normalizarSlotTransporteCodex_(slot) {
+function normalizarSlotTransporteCodex_(slot, strict) {
+  // Entradas desconhecidas em strict lançam erro antes de escrever.
```

`montarContextoTransporteParaTransp_`, `montarPayloadTransporteParaTransp_`, `transporteAgendaCourierFromEvento_`, `transportePayloadFromCodex_`, `transporteSetAgendaLink_` e salvamento validam destino antes de escrever. `transporteAgendaLinkFromRef_`/leitura continuam tolerantes. `doGet`/bootstrap preservam assinatura; edição/geração é a fronteira estrita. Manual: testar `1`, ` i `, `transporte ii`, `3`, `b`, `backup` → destinos corretos; `4`, `x` → erro sem limpar C15 nem mudar Transporte I. Abrir vínculo histórico inválido → consulta não lança exceção; tentar salvar → exige revisão.

### S05 — origem TransporteWebApp.gs; SharedMatBioTypes.html

```diff
-if (normalized.indexOf(alias) >= 0) return key;
+// Fallback por token completo, após as correspondências estruturadas/exatas.
```

Chamadores: `codexMatBioKey_`, `CodexMatBioTypes.key`, normalizadores Agenda/Transporte e seletores. Preservado `key:'outro'` com descrição livre. Efeito: descrição que contém só um fragmento de alias deixa de ser reclassificada. Sem atualização de registros históricos. Manual: `soro`, `amostra de soro` → Soro; `sorologia` → Outro; Outro descrito como `Lâminas de plasma` continua Outro; comparar saída cliente/servidor e ensaio preservado.

### S07 — origem CODEX_TransporteBridge.gs

```diff
+var remetentes = transporteMonitorRemetentes_();
+if (!transporteMonitorRemetenteElegivel_(from, remetentes)) return;
+// Reconsulta Users e revalida dentro do lock antes de gravar.
```

Chamadores: `transporteMonitorarEnviosPorEmail_`, RPC/trigger `monitorarConfirmacoesCourierAgendadas` e diagnóstico administrativo `testarMonitorConfirmacaoManual`. Aceita Users ativo e conta executora; recusa endereço externo/inativo/ambíguo. Evidência manual histórica já identificada conserva o caminho de promoção existente. Não altera autenticação do app nem dá acesso à caixa de outra pessoa. Manual: mesma referência/anexo em resposta de courier → pendente; mensagem de operador ativo → elegível; revogar operador durante busca → recusa no lock. Trigger só encontra mensagens visíveis em sua caixa.

### S08 — origem CODEX_TransporteBridge.gs

```diff
+// Pendências antigas explicam a janela de 30 dias de busca do Gmail.
```

Mantida busca paginada até 500 threads/30 dias; não foi ampliada sem medição. Chamadores: `transporteDocumentosSemEnvioPendencias_`, monitor e painel de pendências. Efeito: diagnóstico mais claro; uma operação antiga ainda pode ser confirmada por envio recente. Manual: geração há 31 dias sem evidência → aviso sobre mensagens antigas fora da janela; envio novo com referência/documento atual → pode confirmar. Mensagem de 31 dias continua fora da pesquisa.

### S09 — origem CODEX_TransporteBridge.gs e TransporteWebApp.gs; rascunho em TransporteCodexAutomacoes.gs

```diff
+'PDF_Hash' // coluna 17, append-only validado
-var evidenciaEnvio = existente ? [...] : [...];
+var mesmoDocumento = existente && pdfHash && existente.pdfHash === pdfHash;
+var evidenciaEnvio = mesmoDocumento ? [...] : ['', '', '', '', now];
+// Rascunho: Doc. IPS: <hash>; monitor exige o marcador exato quando há hash.
```

Chamadores: geração → manifesto → exportação → `criarRascunhoTransporte_`/`criarRascunhoEmail_` → `transporteRegistrarDocumentacaoGerada_` → monitor. Hash combina dados exatos relevantes e texto visível das abas efetivamente exportadas, incluindo modelo/configuração; não é hash binário do PDF e não cobre imagens/desenhos. Mesmo conteúdo mantém evidência; conteúdo diferente ou legado sem hash limpa evidência automática. Agenda já marcada manualmente não é rebaixada automaticamente. Operações sem hash mantêm filtro legado; mensagens novas para operação com hash precisam manter também `Doc. IPS:`. Recusa específica orienta revisão manual se o marcador sumir. Corte temporal de documento com hash é a geração, arredondada somente à resolução de segundos do Gmail; tolerância antiga de cinco minutos fica apenas no legado.

Manual: gerar Soro `1x0,5`, enviar rascunho de teste com marcadores → confirmar; regenerar conteúdo idêntico → manter evidência; mudar para `1x0,7` → limpar evidência; enviar **rascunho antigo depois da regeneração** → recusa; enviar novo → confirmar. Remover marcador do novo → pendente com motivo explícito. Mudar observações/peso/modelo → hash diferente. Alterar só ID do arquivo mantendo texto/dados → hash igual. Em cópia com 16 colunas, consulta não escreve; primeira geração acrescenta 17ª; coluna 17 ocupada sem cabeçalho → erro sem sobrescrita.

### S10 — origem TransporteWebApp.gs

```diff
-codexAssertCanWrite_(...);
+codexAssertCanRead_(...);
+// Antes de getBlob: MIME PDF e vínculo registrado OU descendência da pasta de saída.
```

Chamador: `downloadGeneratedPdf` em TransporteApp. Continua sujeito à ACL do Drive; helper verifica origem por operação/pasta efetivamente configurada, sem criar pastas na leitura. Preserva PDF manual, PINEX e backup em subpastas. Teste de autorização agora exige guarda de leitura e proíbe mutação nesta RPC; as demais RPCs continuam exigindo escrita. Manual: usuário readonly autorizado baixa PDF gerado; Google Sheet/arquivo de outra pasta → recusa antes do blob; PDF manual na pasta correta → sucesso; acesso ao arquivo revogado → falha. Limite de 15 MB permanece.

### S11 — origem TransporteCodexAutomacoes.gs

```diff
-sourceFile.makeCopy(nome, pastaSaida);
+sourceFile.makeCopy('IPS-TEMP-PDF-' + Utilities.getUuid(), DriveApp.getRootFolder());
+// Torna privada, verifica ACL/owner, anonimiza e escaneia texto antes de exportar.
```

Chamadores: `imprimirTodasAbas`, preparação da working copy e `transportePdfAnonimizarParticipante_`. Cópia temporária no Drive da conta executora, nome opaco; verifica compartilhamento privado, owner e usuários explícitos antes do export. Scanner de valores visíveis impede nome completo conhecido no pacote exportado; mantém iniciais. `finally` envia cópia à lixeira em sucesso/falha. Falha de limpeza vira aviso. Exclusão definitiva foi diferida por política de retenção; não se promete inspeção de texto em imagens/desenhos/cabeçalhos. Manual: nome fictício longo em célula adicional visível → aborta sem PDF; iniciais → sucesso; aba interna oculta → não exportada; viewer externo na cópia → aborta; conferir lixeira após ambos os caminhos e pastas PINEX/backup.

### S12 — origem TransporteWebApp.gs e TransporteCodexAutomacoes.gs

```diff
+function transporteTextoLiteralParaCelula_(value) {
+  return typeof value === 'string' && value.charAt(0) === '=' ? "'" + value : value;
+}
```

Aplicado aos setters de texto, bloco C3:C14, Outro em F30, ensaios P30:P35, responsável D32 e contato. Chamadores: rich text/adjacent label, preenchimento de payload e automações. Numbers/dates/booleans não mudam. Não prefixa `+`, `-`, `@` sem evidência de fórmula no Range API; não toca fórmulas existentes dos modelos. Manual: observação/ensaio `=IMPORTXML(...)` → texto exibido, `getFormula()` vazio; `+Contato`, `@Equipe`, `-Texto` → texto original; números e datas continuam tipos nativos; fórmulas próprias do template permanecem.

### S13 — origem TransporteCodexConfig.gs e TransporteCodexAutomacoes.gs

```diff
+transporteConfigValue_(key, fallback);
+transporteConfigNumber_(key, fallback);
+transporteCnpjTexto_();
+// Contato usa marcador {{TRANSPORTE_CONTATO_EMERGENCIA}}, com fallback legado.
```

Chamadores: pasta CE, quatro caminhos de e-mail/CNPJ, atualização G33, pesos e contato de emergência. ConfigApp grupo **Transporte**, chaves: `Pasta de Comunicados Especiais ID`, `CNPJ do centro`, `Contato de emergência PINEX`, `Contato de emergência centro`, `Gelo MARKEN EUROFINS (kg)` (10), `Gelo PINEX (kg)` (2), `Gelo padrão (kg)` (4), `Peso MARKEN ambiente (kg)` (1), `Peso MARKEN refrigerado/congelado (kg)` (5), `Peso MARKEN misto (kg)` (6), `Peso PINEX congelado (kg)` (4), `Peso PINEX padrão (kg)` (1). Ausente/vazio mantém valores existentes; peso inválido mantém fallback com aviso. CNPJ valida 14 dígitos, sem inferir correção cadastral. Config lida por execução; não cria linhas automaticamente.

Manual: gerar sem novas chaves → mesmos valores; configurar peso MARKEN ambiente 2,5 → 2,5 kg; valor `abc`/negativo → fallback e aviso; CNPJ inválido → fallback; contato com `&` aparece literal/HTML escapado; modelo com marcador atualiza contato; modelo antigo reconhecido mantém fallback. Validar valores operacionais com a equipe antes de configurá-los em produção.

### S14 — origem TransporteWebApp.gs

```diff
-// Decodificação encadeada + String.fromCharCode(...)
+// Um único passe: entidades nomeadas/decimais/hexadecimais + String.fromCodePoint(...)
-// Sanitizar antes de chamar o parser que sanitiza novamente.
+// Parser recebe HTML raw; sanitização e decode acontecem uma vez.
```

Chamadores: `transporteHtmlDecode_`, parser rich text e setter adjacent label. Efeito: preserva Unicode suplementar e evita dupla interpretação de entidade aninhada; entidades desconhecidas/inválidas continuam texto. Manual no editor: `&#128512;` e `&#x1F600;` → 😀; `&amp;#65;` → `&#65;` literal; `&#x110000;`, surrogate e `&desconhecida;` → literal; `<b>A &amp; B</b>` mantém negrito e `A & B`; tags/atributos não permitidos não executam.

### S15 — origem TransporteWebApp.gs e TransporteCodexAutomacoes.gs

```diff
-var ok = draft.ok !== false && ...prefixo...;
+var ok = typeof draft.ok === 'boolean' ? draft.ok : ...prefixoLegado...;
+// Códigos distintos para responsável, solicitante e conta efetiva.
```

Chamadores: `transporteDraftStatus_`, `transporteDraftGuard_`, `criarRascunhoEmail_`, UI de resultado. Booleano estruturado é autoridade; string antiga mantém contrato. Conta ativa/efetiva divergente ainda impede createDraft; responsável/solicitante divergente recebe mensagem específica. Se draft já existe mas exige revisão, seu ID permanece disponível. Manual: `{ok:true,message:'Erro corrigido'}` → sucesso; `{ok:false,message:'Falhou'}` → falha; string `Erro...` → falha legada. Responsável diferente → recusa específica; active/effective diferentes → orientação de conta/deployment; draft criado em outra conta → aviso com draftId preservado.

### S16 — origem TransporteWebApp.gs/TransporteCodexAutomacoes.gs — divisão de lock diferida

Não foi aplicado o diff que libera lock logo após `makeCopy`: ele permite ler estado de outro envio e sobrescrever operação mais recente. O lock reentrante existente continua cobrindo reaplicação de payload, manifesto, exportação, draft e registro. Esta entrega também garante `flush()` antes de liberar o lock da geração.

Diff arquitetural recomendado para trabalho separado, após validar todos os consumidores:

```diff
-codexWithDocumentLock_(..., gerarTudoUsandoSourceSS);
+var frozen = codexWithDocumentLock_(..., salvarValidarCopiarEReservarGeracao);
+var exported = exportarERascunharSomenteComContextoCongelado(frozen);
+codexWithDocumentLock_(..., function() {
+  // Registrar somente se token de geração ainda for o reservado; flush antes de sair.
+});
```

O contexto precisa incluir registro, payload, configuração, nomes para anonimização, pacote/abas, manifesto, PDFs/anexos/CE, destinatários, HTML/assinatura, autorização/conta e token por agenda/slot. `transporteReadRegistro_`, anonimização, `transporteCeStatus_`, anexos e composição do draft ainda consultam dados originais. Também precisa revalidar autorização/token antes do efeito Gmail e definir destino de uma geração superseded. Chamadores: `gerarPdfTransporte`, `imprimirTodasAbas`, `criarRascunhoEmail_`, registro de operações. Manual para implementação futura: iniciar A e B no mesmo slot; completar A depois de B → A não substitui registro de B; alterar planilha/CE após snapshot → A exporta e rascunha apenas seu contexto; falha/retry não duplica draft. No código entregue, executar duas gerações concorrentes deve manter serialização existente, ainda com possível espera de até 30 s. Não foi alegado ganho de latência deste item.

### S17 — origem CODEX_TransporteBridge.gs; dependências WebApp.gs

```diff
-// getValue e setValue por operação; regex/config e auditoria por mensagem.
+// Snapshot da Agenda por fase, regex por referência, config por courier/fase.
+// RangeList para status, evidências em grupos contíguos, auditoria batch.
+// Revalidar versão, remetente e regra de anexo sob lock; invalidar cache; flush.
```

Chamadores: monitor, `codexWriteAuditChangesBatch_` (fallback compatível à individual), `agendaInvalidateDateIndexCache_`, configuração courier. Índices da evidência derivam do header. Duas fases independentes: snapshot da busca e snapshot novo protegido. Não cacheia autorização/saldo/decisão de promoção. Manual: dois eventos elegíveis → ambos promovidos e auditados; cancelar/trocar courier durante Gmail → recusa do alterado; mudar exigência de anexo ou revogar operador → recusa no lock; recarregar Agenda → status novo; evento já concluído → execução repetida não duplica promoção. Testes medem redução de chamadas, não latência de produção.

### S18 — origem TransporteCodexConfig.gs

```diff
+// Memo do handle e ID somente nesta execução.
+if (TRANSPORTE_SPREADSHEET_HANDLE_ID_ === id && TRANSPORTE_SPREADSHEET_HANDLE_) return TRANSPORTE_SPREADSHEET_HANDLE_;
+// Configurador zera handle, lookup de abas e cache de rótulos adjacentes.
```

Chamadores: `getTransporteSpreadsheetCodex_`, `configurarPlanilhaTransporteCodex`, todas as automações. Não guarda valores/autorizações entre usuários e não adiciona CacheService. Manual: duas chamadas no mesmo script → mesmo handle/um openById; reconfigurar para outra planilha na mesma execução → novo handle; execução seguinte → abertura nova; configuração inválida continua recusada. Medida local: chamadas evitadas, sem promessa de milissegundos no Google.

### S19 — origem TransporteCodexAutomacoes.gs

```diff
+// Telemetria por estágio: working_copy_open, working_copy_prepare, pdf_fetch.
```

Mantidos sleep 700 ms e retry de open em falha por consistência do Drive. Varredura do contato permanece restrita às abas do pacote; marcador introduzido em S13. Chamadores: `imprimirTodasAbas`, `transportePdfOpenWorkingCopy_` e contato. Manual: coletar tempos dos três estágios em homologação para 5 PDFs/courier e tentativas; confirmar nenhuma linha de telemetria contém participante/estudo/AWB; comparar falhas de open/export antes de discutir remoção da espera. Sleeps de ReqExames pertencem a outro fluxo e não foram alterados.

### S20 — origem TransporteCodexAutomacoes.gs

```diff
-// substring ce em nome do arquivo
+// Token CE ou comunicado especial, ainda exigindo alias do estudo.
```

Chamadores: `transporteComunicadoEspecialFileMatches_`, `transporteCeStatus_`, busca/anexos CE. Mantida pasta configurada, profundidade 2 e links explícitos; busca global Drive foi rejeitada por perder o escopo. Manual: `CE Estudo A.pdf` → match; `Comunicado Especial Estudo A.pdf` → match; `Receita Estudo A.pdf` → não match só por conter `ce`; CE de outro estudo → não match; arquivo com link explícito do projeto continua consultado pela sua rota.

### S21 — origem TransporteCodexAutomacoes.gs

```diff
+// Dedup de aliases exatos preserva ordem e aliases legados.
+// Texto sem indicadores de mojibake retorna sem a cadeia de reparação.
+atualizarPesoGeloDeclaracao_ -> verificarEAtualizarG33Declaracao_ // mantém ambos os wrappers
```

Chamadores: lookup/visibilidade/exports e composição de e-mails. Não removeu aliases corrompidos, wrappers públicos ou helpers globais genéricos: há compatibilidade histórica e não há colisão comprovada. Manual: aba UTF-8 e variante legada continuam encontradas; lista retornada sem duplicatas exatas e mesma prioridade; texto correto com acentos não muda; texto mojibake conhecido é reparado; ambas as funções de gelo produzem mesma matriz de valores.

### S22 — origem TransporteCodexConfig.gs/TransporteCodexAutomacoes.gs; TransporteApp.html

```diff
-Logger.log(exception.toString()); // nos catches de automações revisados
+transporteRegistrarAviso_('codigo_de_estagio');
+// Resultado warnings + mensagem segura; UI mostra warn.
```

Chamadores: geração, funções atualizar/calcular, `getCellValueSafe`, limpeza da cópia e UI `saveAndRun`. Coletor nasce dentro do lock, limpa no finally e não guarda mensagens brutas/nome/célula/PII. Falhas antes silenciosas exibem aviso de revisão; erro de nome completo/ACL e entradas inválidas continua bloqueante. **Novos bloqueios de G33/peso foram diferidos**: faltam contratos de campo obrigatório por courier; valores opcionais não viram obrigatórios por suposição. Manual: simular falha de peso → resultado `warnings`, toast/status warn, sem participante no log/mensagem; segunda geração boa → warnings vazio; falha ao remover temporário → aviso; inspecionar PDF manualmente antes de usar se houver aviso. Interface em 390/1.280 px conserva ações e ausência de overflow.

### Versionamento e itens sem patch

WebApp.gs recebeu somente os três campos de versão desta tarefa: `2026.10.08-transporte-review-local`, `Revisão de integridade e segurança do Transporte`, `2026-10-08`. O restante do diff que já existia foi preservado. O badge ativo não foi consultado nem atualizado.

S01 já corrigido: regressão confirma decimais/ponto/milhares conforme quantidade versus volume. S04 rejeitado: formatação já estabiliza o manifesto, e arredondar a seis casas perde volumes pequenos; testar `0.1+0.2` versus `0.3` → mesmo texto e manter precisão de `2e-9`. S06 precisa saída Apps Script remota antes de remover Intl; conservar implementação é o resultado seguro. Não foi necessário pedir arquivos locais adicionais.

## Parte C — Ordem e rollback

1. Contratos/entrada: S00, S02, S03, S05, S14; preservar leitura legada e validar antes da primeira escrita.
2. Documento/acesso: S10, parte segura S11, S12; testar PDF manual, PINEX e backup.
3. Evidência: S07–S09 e S17, com migração append-only e revalidação sob lock.
4. Manutenção/configuração: S13, S18, partes seguras S20–S22.
5. S16 apenas com contexto integral congelado e token de geração; S06/S19 após diagnóstico remoto.

Rollback deve reverter somente os hunks desta tarefa, usando o patch específico anexado ao relatório; nunca restaurar WebApp/tests inteiros, pois já continham alterações de outras tarefas. Manter a coluna extra PDF_Hash e os dados históricos no rollback; código antigo lê apenas as primeiras 16 colunas. Não reconstruir evidências de envio apagadas por documento alterado. Para implantação futura, voltar ao deployment anterior sem migrar ou excluir dados automaticamente.

Por grupo: (1) reverter helpers/validações e equivalentes cliente em conjunto; (2) reverter preparação/download sem apagar PDFs existentes; (3) reverter hash/marcador/monitor juntos e conservar a 17ª coluna; (4) reverter parâmetros/warnings/memo sem apagar ConfigApp; (5) S16 não foi dividido e não requer reversão de arquitetura. Antes de aplicar rollback, executar `git apply --reverse --check docs/TRANSPORTE_REVISAO_S00_S22.patch` e revisar conflitos decorrentes de alterações futuras; após aplicar os hunks escolhidos, repetir verify/UI. A checagem reversa do patch completo foi aprovada nesta entrega. Não executar reverse automaticamente: esta instrução descreve recuperação caso solicitada.

## Parte D — Informações em aberto

- Runtime Apps Script: executar somente `Logger.log(codexMatBioFormatNumber_(1234.5, 2))` e registrar saída/locale; Node não comprova locale remoto.
- Política de retenção do domínio para exclusão definitiva da cópia; Drive v3 habilitado no manifest não comprova permissão institucional.
- Inventário de compartilhamento das pastas de saída e base de nomes/aliases dos modelos reais; scanner de valores não inspeciona imagens, desenhos ou cabeçalhos de impressão.
- Validar quais campos G33/pesos são obrigatórios por courier antes de transformar avisos em bloqueios.
- Acesso do Gmail do trigger aos envios de outros usuários: lê somente a caixa da conta executora; não há visibilidade automática das demais caixas.
- Sem arquivo local essencial faltante: Index, TransporteApp, WebApp, CadastroRules, AgendaServerRules, helpers/testes disponíveis. Configuração/dados/modelos remotos não foram consultados.

Fontes primárias: [Range.setValue/setValues e fórmulas](https://developers.google.com/apps-script/reference/spreadsheet/range), [Drive File.makeCopy](https://developers.google.com/apps-script/reference/drive/file), [Intl.NumberFormat no V8](https://v8.dev/features/intl-numberformat). Essas referências esclarecem APIs; não confirmam comportamento ou política do deployment deste usuário.
