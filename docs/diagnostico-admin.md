# Diagnostico administrativo

A pagina e exclusiva de Admin e faz leituras. A limpeza de caches permanece uma acao separada, com confirmacao e autorizacao no servidor. A pagina nao altera vinculos, cadastros, reservas ou documentos e nao dispara automacoes.

## Estados e alcance

- **OK**: a verificacao executada confirmou seu contrato limitado.
- **Atencao**: ha uma divergencia ou indicio que exige revisao.
- **Erro**: uma verificacao critica confirmou falha.
- **Nao verificado**: nao houve evidencia suficiente, a leitura falhou inesperadamente ou o resultado venceu.

O resumo inclui estrutura, integridade, configuracoes, perfis, automacoes, OAuth, planilha principal, permissoes Drive/Calendar, disponibilidade do Transporte, cota de e-mail e verificacoes basicas de cadastro. Uma falha inesperada em uma sonda preserva os resultados das demais. Leitura da pasta raiz/calendario padrao nao comprova acesso a todos os documentos/calendarios.

Sincronizacao cliente/servidor nao confirma a ultima entrega. A confirmacao de publicacao permanece **Nao verificado** nesta pagina e exige o gate de `PUBLICACAO_SEGURA.md`. Assim, mesmo sem erros nem alertas, o resumo pode permanecer **Nao verificado**. Os detalhes identificam a verificacao pendente.

Ainda nao sao verificados: saldos e reservas, conciliacao SoA, vinculos de documentos de Transporte/Backup e erros globais de execucao. A amostra textual da auditoria nao substitui os logs de execucao.

## Validade e concorrencia

O resultado tem validade de cinco minutos na sessao. Ao vencer, o estado passa a **Nao verificado**, sem gerar RPC automaticamente. Abrir novamente a pagina ou clicar em Atualizar inicia uma nova leitura. Reentradas comuns compartilham a consulta em andamento; uma atualizacao explicita invalida respostas anteriores. A limpeza tambem invalida leituras pendentes. Sucessos e falhas obsoletos nao substituem o resultado atual.

O resumo copiado inclui horario, alcance, validade, ocorrencias, evidencias e proximos passos. Resultados antigos permanecem identificados como vencidos.

## Automacoes

O inventario usa os gatilhos retornados para a conta atual; confira a conta responsavel antes de reinstalar gatilhos. O historico compartilhado nao identifica nem garante a cobertura de todos os proprietarios de gatilhos.

| Automacao | Intervalo configurado | Indicio de atraso apos |
| --- | --- | --- |
| Confirmacoes de courier | 15 minutos | 45 minutos |
| Lembretes de courier | 15 minutos | 45 minutos |
| Entregas DHL | 4 horas | 12 horas |

A margem e de tres intervalos. Atraso e um indicio para revisao, nao prova de falha. Sem historico ou durante uma execucao, o resultado e **Nao verificado**. Uma execucao ainda marcada como em andamento apos 30 minutos e sinalizada como possivel interrupcao. Datas invalidas/futuras e historico malformado sao sinalizados para revisao.

## Identidade e historico

O ID Cadastro Participante e autoritativo. Se explicito e inexistente, nao ha fallback pelo numero de identificacao. Se existente, divergencias entre numero/projeto do evento e cadastro sao apresentadas separadamente de vinculos orfaos. Eventos sem ID continuam com a verificacao legada por identificacao e projeto. Corrigir o diagnostico nao autoriza reinterpretar automaticamente o protocolo de um evento historico.

## Validacao local

`npm run verify` inclui regressao do servidor e de concorrencia do cliente. O teste `tests/e2e/diagnostics-reliability.test.js` verifica a interface real em 1280px e 390px com RPCs simuladas e rede bloqueada: atualizacao, alerta com referencia, copia, expiracao, falha de leitura, console e ausencia de rolagem horizontal. Esse teste nao comprova servicos reais nem a implantacao ativa.
