# Preparação dos próximos 7 dias — mockup

Prévia independente, com oito visitas e estudos fictícios. Abra `index.html` diretamente no navegador; não há dependências, serviços externos ou conexão com a Agenda. A pasta está excluída do envio ao Apps Script pela regra `**/tests/**` de `.claspignore`.

## Uso

- A tela inicia com a semana completa, de 05 a 11 de outubro de 2026.
- Selecione um dia, estudo, situação ou digite um participante/visita na busca.
- “Ver detalhes” seleciona a visita e mostra kit, requisição e transporte.
- “Ver visita na Agenda” abre uma demonstração local do destino; não navega para produção.
- “Limpar filtros” restaura a semana completa; os indicadores superiores sempre representam a semana completa.
- “Imprimir” usa a impressão do navegador, com a lista do recorte atual.
- A navegação lateral é apenas ilustrativa.

## Referência visual

`conceito.png` foi criado com a ferramenta integrada de geração de imagens. Briefing: tela completa do IPS | UCS em português, “Preparação dos próximos 7 dias”, aviso persistente de dados fictícios, resumo de oito visitas, faixa de sete dias, filtros por estudo/situação/busca, lista agrupada por dia e painel de detalhes de kit/requisição/transporte. Paleta azul `#1266f1`/`#0d47a1`, fundo `#eef1f7`, superfícies brancas, bordas discretas e tipografia Roboto com fallback Arial. Sem imagens decorativas ou dados reais.

`preview.png` é a captura da implementação em Chromium local a 1536 × 1024. Conceito e captura foram inspecionados com `view_image`: cabeçalho/navegação, paleta, título e hierarquia, indicadores, lista de visitas e detalhes. A implementação mantém a composição do conceito. Diferenças intencionais: a semana completa inicia sem um dia marcado, eliminando a ambiguidade do conceito que mostra segunda selecionada e também terça; controles de semana inteira e escopo explícito foram adicionados; ícones SVG locais; Roboto usa Arial quando não está instalado. No celular, os detalhes ficam abaixo da lista e a seleção rola até eles.

## Validação da prévia

O navegador interno abriu a página e confirmou o conteúdo pelo estado de acessibilidade, mas a captura falhou com “Unable to capture screenshot”. Playwright/Chromium local foi usado como fallback para captura e validação visual, após liberação da inicialização fora do sandbox (`spawn EPERM`).

| Verificação | Resultado |
| --- | --- |
| Identidade da página / título / conteúdo | Aprovado |
| Tela não vazia / ausência de overlay de erro | Aprovado |
| Console da execução final | Sem erros |
| Desktop 1536 × 1024 | Capturado e inspecionado |
| Celular 390 × 844 | Capturado e inspecionado; sem overflow horizontal |
| Dia → duas visitas → detalhes DEMO-004 → modal Agenda | Aprovado |
| Situação pronta → três visitas | Aprovado |
| Estudo Aurora → três visitas → busca DEMO-007 → uma visita | Aprovado |
| Busca sem resultado / sábado sem visitas / limpar filtros | Aprovado |
| Seleção DEMO-002 no celular → detalhes atualizados | Aprovado |
| Sintaxe JavaScript isolada | Aprovado |
| `npm.cmd run verify` | Aprovado; 896 testes, nove avisos de lint preexistentes em `WebApp.gs` |

Não há integração produtiva. As situações operacionais e a indicação de validade são exemplos visuais, sem cálculo clínico ou consulta de estoque real. O diálogo de Agenda é simulado; impressão nativa e outros navegadores não foram exercitados. Captura do celular e script de QA ficam no diretório temporário do sistema.
