# Caixas especiais de transporte

No cadastro de Projeto, a seção **Caixas especiais de transporte**, abaixo de
**Couriers do projeto**, permite adicionar regras por courier, temperatura e
laboratório. O projeto é o próprio cadastro aberto. Os vínculos usam os IDs dos
cadastros; a resolução dos rótulos do Transporte exige combinação inequívoca.

| Caixa | Courier | Temperatura | Efeito |
| --- | --- | --- | --- |
| BioSystem | Marken | Ambiente | Rascunho para `operacoes.cs@marken.com`, Invoice com 2 kg e Fornecer caixa = Sim. |
| Sepio | Ocasa | Ambiente | Identificação da caixa na tela de Transporte, mantendo e-mail e documentos existentes. |

Não há inferência para temperaturas mistas nem substituição do comportamento de
transportes sem regra correspondente. Para Marken em temperatura Ambiente, o
campo de envio da caixa é automático: Sim para BioSystem e Não para a caixa
convencional, inclusive após trocar a combinação de um transporte já salvo.
O servidor revalida esse valor. No e-mail, somente o valor do campo original
"Enviar Caixa de Transporte" é preenchido, preservando rótulo, linhas e estilos
do modelo da courier. Não são acrescentadas linhas de caixa ao modelo.

## Persistência e histórico

- Projeto: campo opcional `Caixas especiais transporte (JSON)`. Leituras não criam
  schema. Payload legado que omite o campo preserva seu conteúdo.
- Transporte: snapshot na nota C15 do modelo, associado ao contexto do envio.
- Envios vinculados à Agenda: o snapshot confirmado também fica na nota da célula
  de temperatura do respectivo slot, com marcador `IPS_CAIXA_V1`, preservando o
  restante da nota. Isso permite recuperar o envio após outro transporte ocupar
  o modelo compartilhado.
- Salvar confirma a escolha, inclusive a ausência de caixa especial. Alterar a
  regra do projeto depois não reclassifica um envio confirmado com o mesmo
  contexto. Mudar a combinação exige nova resolução. Abrir um rascunho, por si
  só, não congela a regra.
- A caixa informada pelo cliente não é fonte de decisão. O servidor recupera o
  snapshot persistido ou resolve os cadastros dentro do lock de salvamento.
- O hash documental inclui o snapshot para impedir reaproveitamento silencioso
  de artefatos de outra embalagem.

## Validação local

`npm run verify` e `npm run test:ui`. Regressões específicas:
`tests/project-special-boxes.test.js`, `tests/transport-special-boxes.test.js` e
seus cenários em `tests/e2e/`. Serviços Google e rede são simulados/bloqueados.

Implementação local não configura projetos reais nem altera a implantação ativa.
