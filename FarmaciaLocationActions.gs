// Correções e exclusões lógicas mantêm IDs e referências históricas.
function farmaciaCatalogChangeData_(value, type) {
  value = value || {};
  if (['unit', 'probe'].indexOf(value.kind) < 0 || !Number.isInteger(value.revision) || value.revision < 1) throw new Error('Registro ou revisão inválida.');
  var data = {kind:value.kind,unitId:farmaciaText_(value.unitId,'o equipamento',100),probeId:farmaciaText_(value.probeId,'a sonda',100,value.kind === 'unit'),revision:value.revision};
  if (type === 'CATALOG_EDIT') {
    data.values = value.kind === 'unit' ? farmaciaLocationData_(value.values) : farmaciaProbeData_(value.values);
    if (value.kind === 'probe') delete data.values.calibration;
  }
  return data;
}

function farmaciaApplyCatalogChange_(units, data, type, author, at) {
  var unit = units.find(function(item) { return item.id === data.unitId; });
  var item = data.kind === 'unit' ? unit : unit && unit.probes.find(function(probe) { return probe.id === data.probeId; });
  if (!item || item.deleted || item.revision !== data.revision) throw new Error('O registro mudou. Atualize o catálogo.');
  if (type === 'CATALOG_DELETE') {
    if (data.kind === 'unit' && unit.probes.some(function(probe) { return !probe.deleted; })) throw new Error('Exclua as sondas vinculadas antes do equipamento.');
    item.deleted = true;
    if (data.kind === 'unit') item.status = 'unavailable';
  } else {
    if (data.kind === 'probe') {
      if (data.values.unitId !== unit.id) throw new Error('O equipamento da sonda não pode ser alterado.');
      if (farmaciaProbeDuplicate_(units.map(function(owner) { return {probes:owner.probes.filter(function(probe) { return probe.id !== item.id; })}; }),data.values)) throw new Error('Número interno ou série já cadastrado.');
    } else {
      if (data.values.status !== item.status) throw new Error('Use a alteração de situação com motivo.');
      if (units.some(function(owner) { return owner.id !== unit.id && owner.code.toLowerCase() === data.values.code.toLowerCase(); })) throw new Error('Código já cadastrado.');
      if (JSON.stringify(item.positions) !== JSON.stringify(data.values.positions)) throw new Error('Preserve as posições para manter os vínculos de estoque.');
    }
    Object.assign(item,data.values);
  }
  item.revision++; item.author = author; item.registeredAt = at;
}

function editarRegistroCatalogoFarmacia(payload) { return farmaciaWriteLocation_(payload,'CATALOG_EDIT'); }
function excluirRegistroCatalogoFarmacia(payload) { return farmaciaWriteLocation_(payload,'CATALOG_DELETE'); }
