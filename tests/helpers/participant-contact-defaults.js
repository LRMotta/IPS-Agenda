'use strict';

// CPF e telefone passaram a ser obrigatorios no cadastro de participantes.
// Fixtures antigas focadas em outras regras omitem esses campos; este adaptador
// completa somente as chaves ausentes, preservando a identidade da pessoa:
// reaproveita o CPF da linha editada ou da participacao de origem e, quando nao
// houver, gera um CPF valido ainda inexistente na aba. Valores enviados pelo
// teste (inclusive vazios) nunca sao substituidos.

function cpfCheckDigit(base, weight) {
  let total = 0;
  for (let i = 0; i < base.length; i++) total += Number(base[i]) * (weight - i);
  const rest = (total * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function validCpf(seed) {
  const base = String(800000000 + seed).slice(-9);
  const first = cpfCheckDigit(base, 10);
  return base + first + cpfCheckDigit(base + first, 11);
}

const onlyDigits = (value) => String(value == null ? '' : value).replace(/\D/g, '');

function withParticipantContactDefaults(context, getSheet) {
  const save = context.salvarDadosParticipante;
  let seed = 0;
  context.salvarDadosParticipante = function(data) {
    if (!data || typeof data !== 'object') return save(data);
    const payload = { ...data };
    if (!('telefone' in payload)) payload.telefone = '(54) 99999-0000';
    if (!('cpf' in payload)) {
      const sheet = getSheet();
      const rows = sheet ? sheet.rows || sheet.getDataRange().getValues() : [];
      const ref = (id) => id == null || String(id).trim() === '' ? null
        : rows.slice(1).find((row) => String(row[0]).trim() === String(id).trim());
      const source = ref(payload.id) || ref(payload.vincularPessoaCadastroId);
      let cpf = source ? onlyDigits(source[10]) : '';
      if (!cpf) {
        const used = new Set(rows.map((row) => onlyDigits(row[10])));
        do { cpf = validCpf(++seed); } while (used.has(cpf));
      }
      payload.cpf = cpf;
    }
    return save(payload);
  };
  return context;
}

module.exports = { validCpf, withParticipantContactDefaults };
