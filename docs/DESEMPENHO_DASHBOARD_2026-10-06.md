# Prazos de Pendências calculados sob demanda

## Diagnóstico e mudança local

`getDashboardPendencias_` construía a base com `prazoHoras` para cada evento
não cancelado, antes de verificar se havia uma pendência. O cálculo de horas
operacionais percorre os dias entre agora e a data do evento. Portanto, histórico
sem pendências também causava esse trabalho, proporcional à distância da data.

A base agora é construída apenas quando uma pendência precisa dela, uma vez
por linha. A seleção de couriers que precisam de agendamento ou confirmação
ocorre antes da construção do item. Backup e AWB enviados continuam classificados
antes do retorno por evento concluído; pós-visita mantém seu payload sem prazo.

A fase de documentos mantém seu cálculo independente e a associação à última
linha de um ID duplicado. Não há cache entre RPCs, mudança de leituras de Sheets,
permissões, schema, ordenação, feriados ou regras de elegibilidade.

## Evidência local

Em um cenário de 1.000 eventos históricos sem pendências, a versão anterior
chamava o cálculo de prazo 1.000 vezes; a versão nova chama zero vezes.
Uma visita com requisição, Backup e dois couriers calcula o prazo apenas uma vez.

Os cinco testes em `tests/dashboard-pending-deadline-performance.test.js` cobrem
histórico, múltiplas pendências por linha, feriado e horário, Backup/AWB históricos,
pós-visita, cancelamento, couriers sem ação, data inválida e documentação com IDs
duplicados. Uma comparação adicional contra a função de `HEAD`, com relógio fixo
e 300 eventos combinando status de evento e courier, produziu saída idêntica.

Validação: `npm.cmd run verify` aprovado (921 testes; lint sem erros, com nove
avisos de atribuições preexistentes). `npm.cmd run test:ui` aprovado (62 testes)
após repetir fora do sandbox, que havia bloqueado o início do Chromium.
A revisão independente do diff não encontrou problemas bloqueantes.

Esses resultados demonstram trabalho evitado, não redução de segundos no Web App.
A matriz formatada de SIV/Pendências permanece inteira: seus consumidores usam
campos no final do schema e exigem valores formatados.

## Medição após publicação autorizada

Comparar três atualizações completas do Dashboard, mantendo conta e condições
de cache. Observar RPC, total do servidor, `pending_classify_agenda`, `pending`
e `projects_siv`; as subetapas estão contidas nos totais e não devem ser somadas
novamente. Confirmar conteúdo e ordenação das pendências, além dos indicadores.
Esta etapa não inclui publicação nem afirma ganho de latência em produção.
