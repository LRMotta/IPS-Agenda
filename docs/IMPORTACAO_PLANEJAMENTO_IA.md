# Importação de planejamento extraído por IA

## Objetivo e fluxo

O operador fornece o protocolo à ferramenta de IA de sua escolha e usa as instruções disponíveis em **Importar calendário SoA → Baixar instruções para IA**. A IA entrega um JSON versionado. O IPS Agenda valida e prepara a prévia; a pessoa revisa as exceções e confirma o conjunto antes de aplicar ao cadastro SoA.

A primeira entrega não precisa estar completa: **Salvar rascunho** conserva o documento recebido, suas fontes e regras ainda não calculáveis. Os rascunhos podem ser recuperados no mesmo projeto. Um rascunho não cria braços, visitas, eventos de Agenda nem datas para participantes.

## Formatos

- Legado: `visitasComuns` e `variantesPorBraco`, preservando o fluxo existente.
- Prova de conceito: `ips-agenda-study-planning-poc`, versão `0.1.0`. Recebe `study` e `rules` para revisão e armazenamento. O exemplo BGB-43395-302 fornecido pelo usuário pertence a essa categoria; suas fontes não foram conferidas com o protocolo nesta implementação.
- Calendário estruturado: `ips-agenda-study-planning`, versão `1.0.0`, com estudo, braços e visitas explícitos. O importador converte apenas as regras de tempo suportadas e completas.

Versões desconhecidas exigem adequação explícita. O campo `approved_for_clinical_scheduling` vindo da IA não é autorização do usuário. `import_mode: "preview_only"` mantém o documento em rascunho. A aplicação depende de uma prévia atual, da confirmação na interface e da revalidação no servidor.

## Regras de preenchimento

1. Identificadores de braços, visitas e regras devem ser únicos e estáveis dentro do estudo. Nomes preservam a terminologia do protocolo; aliases servem apenas para equivalências documentadas.
2. `arm_ids: []` significa explicitamente que a visita é comum a todos os braços. Um braço desconhecido não pode ser convertido silenciosamente em visita comum.
3. `timing.offset_days` é o deslocamento em dias em relação ao marco; `window_before_days` e `window_after_days` são tolerâncias em torno dessa data-alvo. Todos são inteiros não negativos no contrato executável desta versão. `basis` explicita se a referência usa a data prevista (`planned`) ou realizada (`performed`); a extração não deve adivinhar essa escolha.
4. Os marcos calculáveis são `randomization_date`, `inclusion_date`, `last_dose`, `end_of_treatment_date`, `decision_to_permanently_discontinue`, `progression_date` ou `visit`; este último exige `anchor_visit_id`. Referências circulares, incompatíveis entre braços ou ausentes impedem a aplicação.
5. Um período permitido sem data-alvo explícita não deve ser convertido em uma data-alvo inventada. Regras como “entre zero e dois dias” devem permanecer na revisão até haver uma representação completa e suportada.
6. Uma regra compartilhada simples pode usar `kind: "visit_timing"`, com `timing`, `source` e `status: "extracted"`, vinculada por `rule_ids` na visita. Cada visita admite uma regra de tempo; duplicação conflitante bloqueia aplicação. Recorrências indefinidas, mudança de frequência por fase, condições clínicas e atividades com calendário próprio são preservadas para revisão. Uma atividade de imagem não deve se tornar automaticamente uma visita presencial.
7. Ausência, zero e não aplicável são diferentes. Não preencher lacunas com zero. Se a informação estiver incompleta, registrar a pendência e manter o documento como prévia.
8. Informar arquivo, página impressa e seção de origem. Não inventar localização. Quando a localização não estiver disponível, registrar a limitação.
9. Datas de marcos de participantes, inclusão, randomização, tratamentos ou braços individuais não são extraídas nem criadas por esse importador de protocolos.
10. O orçamento pode fornecer metadados e nomes complementares; divergências com o protocolo devem ser mostradas, não resolvidas silenciosamente. Valores financeiros não são importados nesta etapa.

## Persistência e compatibilidade

O JSON integral é arquivado em uma área própria de planejamento, separado do calendário operacional. O servidor divide documentos em trechos compatíveis com o tamanho das células e grava cada documento em lote. A mesma extração não gera rascunhos duplicados. A consulta e a prévia não criam nem alteram abas.

A importação executável reutiliza o SoA existente. O modo padrão adiciona sem duplicar; a atualização precisa ser escolhida explicitamente. O JSON original é arquivado antes de aplicar um planejamento. Fontes e metadados permanecem disponíveis no rascunho mesmo quando não possuem coluna equivalente no SoA.

## Validação do piloto

Usar o JSON real de prova de conceito para conferir regras, fontes e pendências, sem agendamento. Em seguida, usar uma extração completa e comparar braços, visitas, referências, intervalos e janelas com o protocolo. Medir o tempo de revisão e o número de decisões manuais. A aprovação estrutural do JSON não substitui a conferência do conteúdo extraído.

Os testes locais isolam Sheets, serviços externos e dados de participantes. Eles verificam o contrato e a interface; a publicação e o teste da implantação são etapas separadas.
