// Eventos operacionais do medicamento: o mesmo ledger, sempre append-only.
function farmaciaLifecycleData_(value) {
  value = value || {};
  var actions = ['dispense', 'return', 'transport_departure', 'transport_arrival', 'destination'];
  if (actions.indexOf(value.action) === -1) throw new Error('Selecione uma operação válida do ciclo do medicamento.');
  var result = { action: value.action, positionId: farmaciaText_(value.positionId, 'a entrada de estoque', 100),
    revision: farmaciaText_(value.revision, 'a revisão do estoque', 100),
    occurredOn: farmaciaDate_(value.occurredOn, 'a data da operação'),
    document: farmaciaText_(value.document, 'a referência documental', 200, value.action === 'dispense'),
    // No memorando o motivo já vem classificado; a observação só é exigida quando o motivo é "Outro".
    reason: farmaciaText_(value.reason, 'a observação', 500, value.action !== 'destination' ||
      (value.memoId !== undefined && value.memoId !== '' && value.reasonCategory !== 'other')) };
  if (value.action !== 'transport_arrival') {
    result.quantity = farmaciaQuantity_(value.quantity, true);
    if (!result.quantity) throw new Error('Informe uma quantidade positiva.');
  }
  if (value.action === 'dispense') {
    // Estoque Geral: o participante pode ser de qualquer estudo, identificado pelo estudo do cadastro.
    // Só as dispensações do Geral têm a chave; nelas visita e último dia de uso são opcionais.
    var general = value.participantStudyId !== undefined && value.participantStudyId !== '';
    result.participantId = farmaciaText_(value.participantId, 'o participante cadastrado', 120);
    result.participantLabel = farmaciaText_(value.participantLabel, 'o código do participante no estudo', 120, true);
    if (general) {
      result.participantStudyId = farmaciaText_(value.participantStudyId, 'o estudo do participante', 120);
      result.participantStudyLabel = farmaciaText_(value.participantStudyLabel, 'o estudo do participante', 200, true);
    }
    result.visit = farmaciaText_(value.visit, 'a visita ou ciclo informado', 120, general);
    result.prescription = farmaciaText_(value.prescription, 'a prescrição ou Documento Fonte', 200, true);
    // Transação no IRT / plataforma do estudo: opcional, porque nem todo estudo gera esse número.
    result.platformReference = farmaciaText_(value.platformReference, 'a transação no IRT / plataforma do estudo', 200, true);
    result.validThrough = general && (value.validThrough === undefined || value.validThrough === '') ? '' : farmaciaDate_(value.validThrough, 'o último dia previsto de uso');
    if (value.confirmed !== true || (result.validThrough && result.validThrough < result.occurredOn)) throw new Error('Confirme a conferência e o período previsto de uso.');
    result.confirmed = true;
    // Guia com mais de um medicamento: o mesmo identificador liga os itens gravados juntos.
    // Registros anteriores não têm a chave, e o replay os normaliza sem ela.
    if (value.guideId !== undefined && value.guideId !== '') {
      if (typeof value.guideId !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(value.guideId)) throw new Error('Guia de dispensação inválida.');
      result.guideId = value.guideId;
    }
  } else if (value.action === 'return') {
    if (value.confirmed !== true) throw new Error('Confirme a contagem e a segregação do material retornado.');
    result.confirmed = true;
    result.dispenseId = farmaciaText_(value.dispenseId, 'a dispensação vinculada', 100);
    // Material emprestado conferido volta à posição de origem (returnTo: 'stock'); sem a chave, o retorno é
    // segregado em quarentena, como sempre foi. Registros anteriores não têm a chave.
    if (value.returnTo !== undefined && value.returnTo !== '') {
      if (value.returnTo !== 'stock') throw new Error('Selecione o destino do material devolvido.');
      result.returnTo = 'stock';
    } else {
      var ref = value.locationRef || {};
      result.locationRef = { unitId: farmaciaText_(ref.unitId, 'o equipamento de quarentena', 100), position: farmaciaText_(ref.position, 'a posição segregada', 80) };
      // O rótulo é resolvido do catálogo antes de gravar; a leitura histórica o preserva.
      result.location = farmaciaText_(value.location, 'a localização segregada', 200, true);
    }
    if (value.adherence) result.adherence = farmaciaAdherenceData_(value.adherence);
  } else if (value.action === 'transport_departure') {
    result.dispenseId = farmaciaText_(value.dispenseId, 'a dispensação vinculada', 100, true);
    result.departureTime = farmaciaLifecycleTime_(value.departureTime);
    if (['preparation', 'administration', 'storage'].indexOf(value.operation) === -1) throw new Error('Selecione a finalidade do transporte.');
    // No armazenamento, origem e destino são derivados do cadastro de equipamentos antes de gravar.
    result.origin = farmaciaText_(value.origin, 'a origem', 200, value.operation === 'storage');
    result.destination = farmaciaText_(value.destination, 'o destino', 200, value.operation === 'storage');
    result.operation = value.operation;
    if (result.operation === 'storage') {
      var destinationRef = value.locationRef || {};
      result.locationRef = { unitId: farmaciaText_(destinationRef.unitId, 'o equipamento de destino', 100), position: farmaciaText_(destinationRef.position, 'a posição de destino', 80) };
      result.location = farmaciaText_(value.location, 'a localização de destino', 200, true);
    }
    result.thermometer = farmaciaText_(value.thermometer, 'o termômetro', 100);
    result.min = farmaciaLifecycleTemperature_(value.min);
    result.max = farmaciaLifecycleTemperature_(value.max);
    result.departureTemperature = farmaciaLifecycleTemperature_(value.departureTemperature);
    if (result.min > result.max) throw new Error('Confira a faixa de temperatura do produto.');
  } else if (value.action === 'transport_arrival') {
    result.departureId = farmaciaText_(value.departureId, 'o registro de saída', 100);
    result.arrivalTime = farmaciaLifecycleTime_(value.arrivalTime);
    result.currentTemperature = farmaciaLifecycleTemperature_(value.currentTemperature);
    result.minTemperature = farmaciaLifecycleTemperature_(value.minTemperature);
    result.maxTemperature = farmaciaLifecycleTemperature_(value.maxTemperature);
    if (result.minTemperature > result.maxTemperature || result.currentTemperature < result.minTemperature ||
        result.currentTemperature > result.maxTemperature || value.confirmed !== true) throw new Error('Confira as temperaturas e confirme a chegada.');
    result.confirmed = true;
  } else {
    if (['blocked', 'pending'].indexOf(value.from) === -1 || ['sponsor', 'disposal'].indexOf(value.destination) === -1) throw new Error('Selecione a situação e a destinação do produto.');
    result.from = value.from;
    result.destination = value.destination;
    result.authorization = farmaciaText_(value.authorization, 'a referência da autorização de destinação', 200);
    // Memorando de devolução / destruição: só os registros novos têm a chave; os antigos seguem sem ela.
    if (value.memoId !== undefined && value.memoId !== '') farmaciaDestinationMemoData_(value, result);
  }
  return result;
}

var FARMACIA_DESTINATION_REASONS_ = ['expired', 'participant_return', 'study_close', 'excursion', 'recall', 'damaged', 'other'];
var FARMACIA_DESTINATION_CONDITIONS_ = ['intact', 'partial', 'empty', 'mixed'];

function farmaciaDestinationMemoData_(value, result) {
  if (typeof value.memoId !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(value.memoId)) throw new Error('Memorando inválido.');
  result.memoId = value.memoId;
  // Número legível atribuído pelo servidor dentro do lock; o replay só confere o formato.
  if (typeof value.memoNumber !== 'string' || !/^MEM-(R-)?\d{4}-\d{3,6}$/.test(value.memoNumber)) throw new Error('Número do memorando inválido.');
  result.memoNumber = value.memoNumber;
  if (FARMACIA_DESTINATION_REASONS_.indexOf(value.reasonCategory) === -1) throw new Error('Selecione o motivo da devolução / destruição.');
  result.reasonCategory = value.reasonCategory;
  if (FARMACIA_DESTINATION_CONDITIONS_.indexOf(value.condition) === -1) throw new Error('Selecione a condição de cada item.');
  result.condition = value.condition;
  result.itemNote = farmaciaText_(value.itemNote, 'a observação do item', 200, value.condition !== 'mixed');
  if (result.destination === 'sponsor') {
    result.carrier = farmaciaText_(value.carrier, 'a transportadora', 120, true);
    result.awb = farmaciaText_(value.awb, 'o AWB / conhecimento', 80, true);
    result.packages = farmaciaText_(value.packages, 'os volumes e lacres', 200, true);
    result.logger = farmaciaText_(value.logger, 'o registrador de temperatura', 120, true);
    result.shipTo = farmaciaText_(value.shipTo, 'o destino da devolução', 300, true);
  } else {
    result.company = farmaciaText_(value.company, 'a empresa responsável pela destruição', 160);
    result.method = farmaciaText_(value.method, 'o método de destruição', 120);
    result.certificate = farmaciaText_(value.certificate, 'o certificado de destruição / MTR', 120, true);
  }
  var study = value.memoStudy || {};
  result.memoStudy = {};
  ['code', 'sponsor', 'cro', 'site', 'investigator'].forEach(function(key) {
    result.memoStudy[key] = farmaciaText_(study[key], 'o dado do estudo', 300, true);
  });
}

function farmaciaLifecycleTime_(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Informe um horário válido.');
  return value;
}

function farmaciaLifecycleTemperature_(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -200 || value > 200 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error('Informe uma temperatura válida, com até duas casas decimais.');
  return value;
}

function farmaciaAdherenceData_(value) {
  if (value.confirmedFixedDose !== true) throw new Error('Confirme que o período informado teve dose diária fixa, sem pausas.');
  var result = { dailyDose: farmaciaQuantity_(value.dailyDose, true), firstDose: farmaciaDate_(value.firstDose, 'a primeira dose'),
    lastDose: farmaciaDate_(value.lastDose, 'a última dose'), confirmedFixedDose: true };
  if (!result.dailyDose || result.lastDose < result.firstDose) throw new Error('Confira a dose diária e a ordem das datas.');
  return result;
}

function farmaciaCalculateAdherence_(dispensed, returned, value) {
  var data = farmaciaAdherenceData_(value);
  var days = Math.round((Date.parse(data.lastDose + 'T12:00:00Z') - Date.parse(data.firstDose + 'T12:00:00Z')) / 86400000) + 1;
  if (returned > dispensed || !Number.isInteger(dispensed) || !Number.isInteger(returned)) throw new Error('Confira as quantidades para o cálculo de adesão.');
  var expected = data.dailyDose * days;
  return { days: days, consumed: dispensed - returned, expected: expected, percent: (dispensed - returned) / expected * 100 };
}

// No estudo: participantes do próprio estudo. No estoque Geral: participantes de todos os estudos do catálogo,
// cada um com o estudo do cadastro (só código, nunca nome ou dados pessoais).
function farmaciaLifecycleParticipantRows_(context) {
  var common = context.studyId === FARMACIA_COMMON_SCOPE_;
  // Vínculo fresco dentro do lock: não reutilizar o cache de linhas de outra RPC.
  var sheet = context.ss.getSheetByName('Participantes');
  var rows = sheet && sheet.getLastRow() ? sheet.getDataRange().getValues() : [];
  if (!rows.length) return [];
  var headers = rows[0].map(function(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); });
  var projectColumn = headers.findIndex(function(header) { return ['projetoid', 'idprojeto', 'studyid'].indexOf(header) !== -1; });
  var catalog = codexFarmaciaStudyCatalog_();
  var ids = {};
  rows.slice(1).forEach(function(row) { var id = String(row[0] || '').trim(); if (id) ids[id] = (ids[id] || 0) + 1; });
  function studyOf(row) {
    if (projectColumn >= 0 && String(row[projectColumn] || '').trim()) return String(row[projectColumn]).trim();
    // O vínculo legado explícito só resolve quando há exatamente um projeto com esse nome/ID.
    var link = String(row[5] || '').trim();
    var matches = catalog.filter(function(study) { return study.id === link || study.nome === link; });
    return matches.length === 1 ? matches[0].id : '';
  }
  var result = [];
  rows.slice(1).forEach(function(row) {
    var id = String(row[0] || '').trim();
    if (!id || ids[id] !== 1) return;
    var studyId = studyOf(row);
    var study = common && catalog.find(function(item) { return item.id === studyId; });
    if (common ? !study : !studyId || studyId !== context.studyId) return;
    var item = { id: id, label: String(row[4] || '').trim() || id };
    if (common) {
      item.studyId = study.id;
      item.studyLabel = String(study.nome || '').trim() || String(study.codigo || '').trim() || study.id;
    }
    result.push(item);
  });
  return result;
}

function getFarmaciaParticipantes(studyId, restricted) {
  // No Geral a lista reúne participantes de todos os estudos: só para quem registra dispensações no Geral.
  var context = farmaciaContext_(studyId, restricted, studyId === FARMACIA_COMMON_SCOPE_ ? 'operate' : 'read');
  return { participants: farmaciaLifecycleParticipantRows_(context) };
}

function farmaciaLifecycleRecord_(ledger, id, action) {
  var record = ledger.movements.find(function(item) { return item.id === id && item.type === 'LIFECYCLE' && item.data.action === action; });
  if (!record) throw new Error('Operação vinculada não encontrada neste estudo e classe de acesso.');
  return record;
}

function farmaciaDispenseOutstanding_(ledger, dispenseId) {
  var dispense = farmaciaLifecycleRecord_(ledger, dispenseId, 'dispense');
  var returned = 0, inTransit = 0, arrived = {};
  ledger.movements.forEach(function(item) {
    if (item.type === 'LIFECYCLE' && item.data.action === 'transport_arrival') arrived[item.data.departureId] = true;
  });
  ledger.movements.forEach(function(item) {
    if (item.type !== 'LIFECYCLE') return;
    if (item.data.action === 'return' && item.data.dispenseId === dispenseId) returned += item.data.quantity;
    if (item.data.action === 'transport_departure' && item.data.dispenseId === dispenseId && !arrived[item.id]) inTransit += item.data.quantity;
  });
  return Math.round((dispense.data.quantity - returned - inTransit) * 1000) / 1000;
}

// Entram no ciclo os medicamentos do patrocinador e os materiais do patrocinador entregues ou emprestados ao participante.
// No estoque Geral, os mesmos tipos de produto, mas próprios do IPS (compras).
function farmaciaCycleProductEligible_(data, common) {
  return !!data && data.supplySource === (common ? 'site' : 'sponsor') && (data.category === 'medicine' ||
    (data.category === 'material' && (data.materialUse === 'participant' || data.materialUse === 'loan')));
}

// No estoque Geral o ciclo é só dispensação ao participante e retorno; transporte e destinação não se aplicam
// (perdas e vencidos saem pelo ajuste de quantidade).
var FARMACIA_COMMON_LIFECYCLE_ACTIONS_ = ['dispense', 'return'];

function farmaciaApplyLifecycle_(ledger, record) {
  var data = record.data;
  var common = ledger.common === true;
  var position = ledger.positions.find(function(item) { return item.id === data.positionId; });
  var product = position && ledger.products.find(function(item) { return item.id === position.productId; });
  if (common && FARMACIA_COMMON_LIFECYCLE_ACTIONS_.indexOf(data.action) === -1) throw new Error('No estoque Geral, registre somente dispensações e retornos.');
  if (!position || !product || !farmaciaCycleProductEligible_(product.data, common)) throw new Error(common ? 'A dispensação do Geral exige medicamento próprio do IPS, ou material entregue / emprestado ao participante.' : 'O ciclo exige medicamento do patrocinador, ou material do patrocinador para o participante, identificado neste estudo.');
  // Dispensação do Geral sempre identifica o estudo do participante; a do estudo nunca tem essa chave.
  if (data.action === 'dispense' && common !== !!data.participantStudyId) throw new Error('Confira o estudo do participante.');
  var material = product.data.category === 'material';
  // O retorno não altera o saldo da origem: é validado pela dispensação (vínculo, acumulado e trânsito),
  // não pela revisão da entrada. A revisão continua avançando ao final para preservar o replay do histórico.
  if (data.action !== 'return' && data.revision !== position.revision) throw new Error('O saldo mudou. Atualize o estoque antes de registrar a operação.');
  var entryDate = position.receivedOn || position.countedOn;
  if (entryDate && data.occurredOn < entryDate) throw new Error('A operação não pode anteceder a entrada do produto.');
  // Última data por entrada, mantida durante o replay (evita varrer todos os movimentos a cada operação).
  var lastByPosition = ledger.lastLifecycleDate || (ledger.lastLifecycleDate = {});
  var lastDate = lastByPosition[position.id] || '';
  if (lastDate && data.occurredOn < lastDate) {
    // Retorno e chegada não reduzem o disponível da origem; só eles aceitam a data real do fato, com motivo.
    if (data.action !== 'return' && data.action !== 'transport_arrival') throw new Error('A operação não pode anteceder a última operação registrada nesta entrada.');
    if (!data.reason) throw new Error('Lançamento retroativo: a data é anterior à última operação desta entrada. Informe o motivo.');
    record.retroactive = true;
  }
  var quantity = data.action === 'transport_arrival' ? 0 : farmaciaQuantity_(data.quantity, ['mL', 'g'].indexOf(product.data.unit) !== -1);
  if (product.data.control === 'kit' && quantity && quantity !== 1) throw new Error('Kits individualizados exigem quantidade 1.');
  var reserved = position.transportReserved || 0;
  if (data.action === 'dispense') {
    // Material não tem período de uso a conferir contra a validade; só não pode sair vencido.
    if (position.returned || farmaciaExpiredOn_(position.expiry, data.occurredOn) || (!material && farmaciaExpiredOn_(position.expiry, data.validThrough)) ||
        quantity > Math.round((position.available - reserved) * 1000) / 1000) throw new Error('Saldo insuficiente, vencido, retornado ou indisponível para o período de uso.');
    if (data.platformReference && ledger.movements.some(function(item) { return item.type === 'LIFECYCLE' && item.data.action === 'dispense' && item.data.platformReference === data.platformReference &&
        item.data.positionId === data.positionId && item.data.participantId === data.participantId; })) throw new Error('Esta referência de dispensação já foi registrada para este item e participante.');
    position.available = Math.round((position.available - quantity) * 1000) / 1000;
    position.physical = Math.round((position.physical - quantity) * 1000) / 1000;
  } else if (data.action === 'return') {
    // Só material emprestado volta ao estoque; avariado ou incompleto segue a segregação de sempre.
    // No Geral, a sobra conferida de qualquer item volta ao estoque.
    if (data.returnTo === 'stock' && !common && !(material && product.data.materialUse === 'loan')) throw new Error('Só material emprestado volta ao estoque. Os demais retornos são segregados.');
    var dispense = farmaciaLifecycleRecord_(ledger, data.dispenseId, 'dispense');
    if (dispense.data.positionId !== position.id || data.occurredOn < dispense.data.occurredOn) throw new Error('Confira a dispensação e a data do retorno.');
    var totalReturned = ledger.movements.reduce(function(total, item) { return total + (item.type === 'LIFECYCLE' && item.data.action === 'return' && item.data.dispenseId === data.dispenseId ? item.data.quantity : 0); }, quantity);
    if (totalReturned > dispense.data.quantity + 0.000001) throw new Error('A quantidade retornada acumulada excede a dispensação vinculada.');
    if (quantity > farmaciaDispenseOutstanding_(ledger, data.dispenseId) + 0.000001) throw new Error('Conclua o transporte da dispensação antes de retornar a quantidade em trânsito.');
    if (data.adherence) {
      if (['comprimido', 'cápsula'].indexOf(product.data.unit) === -1 || product.data.control !== 'quantity' ||
          data.adherence.firstDose < dispense.data.occurredOn || data.adherence.lastDose > data.occurredOn) throw new Error('Adesão exige comprimidos/cápsulas e período compatível com a dispensação e o retorno.');
      record.adherenceResult = farmaciaCalculateAdherence_(dispense.data.quantity, totalReturned, data.adherence);
    }
    if (data.returnTo === 'stock') {
      // Volta ao disponível da posição de onde saiu, pronto para o próximo empréstimo.
      if (farmaciaExpiredOn_(position.expiry, data.occurredOn)) throw new Error('Material vencido não volta ao estoque. Segregue para destinação.');
      position.available = Math.round((position.available + quantity) * 1000) / 1000;
      position.physical = Math.round((position.physical + quantity) * 1000) / 1000;
    } else ledger.positions.push({ id: record.id, revision: record.id, productId: position.productId, lot: position.lot, kit: position.kit,
      expiry: position.expiry, physical: quantity, available: 0, pending: 0, blocked: quantity, initialBlocked: quantity,
      origin: 'return', returned: true, originalPositionId: position.id, dispenseId: dispense.id, participantId: dispense.data.participantId,
      locationRef: data.locationRef, location: data.location, countedOn: data.occurredOn,
      author: record.author, registeredAt: record.registeredAt });
  } else if (data.action === 'transport_departure') {
    var storage = product.data.storage || {};
    if (typeof storage.min !== 'number' || typeof storage.max !== 'number' || data.min !== storage.min || data.max !== storage.max) throw new Error('A faixa do transporte deve corresponder às condições documentadas do produto.');
    record.excursion = data.departureTemperature < data.min || data.departureTemperature > data.max;
    if (data.operation === 'storage') {
      if (data.dispenseId || quantity > Math.round((position.available - reserved) * 1000) / 1000 || position.returned || farmaciaExpiredOn_(position.expiry, data.occurredOn)) throw new Error('Quantidade indisponível para transporte de estoque ativo.');
      if ((position.locationRef && position.locationRef.unitId === data.locationRef.unitId && position.locationRef.position === data.locationRef.position) || position.location === data.location) throw new Error('Selecione uma posição de destino diferente da origem.');
      if (data.departureTemperature < data.min || data.departureTemperature > data.max) throw new Error('Temperatura de saída fora da faixa. Registre e avalie a ocorrência antes do transporte.');
      position.transportReserved = Math.round((reserved + quantity) * 1000) / 1000;
    } else {
      var linked = farmaciaLifecycleRecord_(ledger, data.dispenseId, 'dispense');
      if (linked.data.positionId !== position.id || data.occurredOn < linked.data.occurredOn || farmaciaExpiredOn_(position.expiry, data.occurredOn) ||
          quantity > farmaciaDispenseOutstanding_(ledger, data.dispenseId)) throw new Error('Confira a dispensação e a quantidade ainda não retornada ou em transporte.');
    }
  } else if (data.action === 'transport_arrival') {
    var departure = farmaciaLifecycleRecord_(ledger, data.departureId, 'transport_departure');
    if (departure.data.positionId !== position.id || data.occurredOn + 'T' + data.arrivalTime < departure.data.occurredOn + 'T' + departure.data.departureTime ||
        ledger.movements.some(function(item) { return item.type === 'LIFECYCLE' && item.data.action === 'transport_arrival' && item.data.departureId === departure.id; })) throw new Error('Confira o registro de saída, a data e o horário de chegada.');
    record.excursion = data.minTemperature < departure.data.min || data.maxTemperature > departure.data.max ||
      departure.data.departureTemperature < departure.data.min || departure.data.departureTemperature > departure.data.max;
    if (departure.data.operation === 'storage') {
      if (reserved < departure.data.quantity || position.available < departure.data.quantity) throw new Error('Reserva de transporte inconsistente.');
      position.transportReserved = Math.round((reserved - departure.data.quantity) * 1000) / 1000;
      position.available = Math.round((position.available - departure.data.quantity) * 1000) / 1000;
      position.physical = Math.round((position.physical - departure.data.quantity) * 1000) / 1000;
      // Uma posição nova expressa a transferência parcial; o saldo da origem não muda de local.
      ledger.positions.push({ id: record.id, revision: record.id, productId: position.productId, lot: position.lot, kit: position.kit,
        expiry: position.expiry, physical: departure.data.quantity, available: record.excursion ? 0 : departure.data.quantity,
        blocked: record.excursion ? departure.data.quantity : 0, initialBlocked: record.excursion ? departure.data.quantity : 0, pending: 0,
        origin: 'transport', originalPositionId: position.originalPositionId || position.id, sourcePositionId: position.id,
        transportId: departure.id, locationRef: departure.data.locationRef, location: departure.data.location,
        countedOn: data.occurredOn, author: record.author, registeredAt: record.registeredAt });
    }
  } else {
    if (reserved) throw new Error('Conclua o transporte em andamento antes da destinação.');
    // Vencimento é apurado na consulta. A baixa deve consumir os buckets históricos sem reescrevê-los.
    // Vencido na data informada, ou já vencido quando a destinação foi registrada (a consulta mostra todo o saldo como
    // bloqueado). A data do registro vem do próprio ledger, para o replay não depender do dia em que é lido.
    var registeredDay = farmaciaRegisteredDay_(record);
    if (farmaciaExpiredOn_(position.expiry, data.occurredOn) || (data.from === 'blocked' && farmaciaExpiredOn_(position.expiry, registeredDay))) {
      if (data.from !== 'blocked' || quantity > position.physical) throw new Error('Material vencido deve sair do saldo bloqueado.');
      var remaining = quantity;
      ['blocked', 'pending', 'available'].forEach(function(key) { var take = Math.min(position[key], remaining); position[key] = Math.round((position[key] - take) * 1000) / 1000; remaining = Math.round((remaining - take) * 1000) / 1000; });
    } else {
      if (quantity > position[data.from]) throw new Error('A quantidade excede o saldo segregado para destinação.');
      position[data.from] = Math.round((position[data.from] - quantity) * 1000) / 1000;
    }
    position.physical = Math.round((position.physical - quantity) * 1000) / 1000;
  }
  position.revision = record.id;
  if (data.occurredOn > lastDate) lastByPosition[position.id] = data.occurredOn;
  ledger.movements.push(record);
}

// Rotina do dia a dia: nível Operação. Destinação final (e qualquer ação desconhecida) exige o Responsável.
function farmaciaLifecyclePermission_(action) {
  return ['dispense', 'return', 'transport_departure', 'transport_arrival'].indexOf(action) !== -1 ? 'operate' : 'manage';
}

function registrarCicloFarmacia(payload) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-lifecycle', function() {
    var context = farmaciaContext_(payload.studyId, payload.restricted, farmaciaLifecyclePermission_((payload.data || {}).action));
    // No Geral, por aqui só o retorno: a dispensação nasce pela guia.
    if ((context.studyId === FARMACIA_COMMON_SCOPE_ && (payload.data || {}).action !== 'return') || !context.ss) throw new Error('Selecione um estudo configurado para o ciclo do medicamento.');
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 100);
    farmaciaAssertRequestId_(requestId);
    // Itens de guia só nascem em registrarDispensacaoFarmacia, que os grava juntos.
    if (payload.data && payload.data.guideId !== undefined) throw new Error('Registre guias de dispensação pela própria guia.');
    if (payload.data && payload.data.memoId !== undefined) throw new Error('Registre devoluções e destruições pelo próprio memorando.');
    var ledger = farmaciaReadLedger_(context), data = farmaciaLifecycleData_(payload.data);
    var previous = ledger.records.find(function(item) { return item.requestId === requestId; });
    if (previous) {
      if (data.action === 'dispense') data.participantLabel = previous.data.participantLabel;
      if ((data.action === 'return' && !data.returnTo) || (data.action === 'transport_departure' && data.operation === 'storage')) data.location = previous.data.location;
      if (data.action === 'transport_departure' && data.operation === 'storage') {
        data.origin = previous.data.origin;
        data.destination = previous.data.destination;
      }
      if (previous.type !== 'LIFECYCLE' || previous.dataJson !== JSON.stringify(data)) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, id: previous.id, repeated: true };
    }
    if (data.occurredOn > farmaciaToday_()) throw new Error('A data da operação não pode ser futura.');
    if (data.action === 'dispense' || data.action === 'transport_departure') {
      var currentPosition = ledger.positions.find(function(item) { return item.id === data.positionId; });
      if (currentPosition && farmaciaExpiredOn_(currentPosition.expiry, farmaciaToday_())) throw new Error('Material vencido não pode ser dispensado ou transportado como estoque ativo.');
    }
    if (data.action === 'dispense') data.participantLabel = farmaciaDispenseParticipantLabel_(context, data.participantId);
    if ((data.action === 'return' && !data.returnTo) || (data.action === 'transport_departure' && data.operation === 'storage')) {
      var locations = farmaciaReadLocations_();
      var unit = locations.units.find(function(item) { return item.id === data.locationRef.unitId; });
      if (!unit || unit.deleted || unit.positions.indexOf(data.locationRef.position) === -1) throw new Error('Selecione equipamento e posição de destino cadastrados.');
      // A tela só oferece equipamentos ativos; o servidor aplica a mesma regra ao armazenar retorno ou transporte.
      if (unit.status !== 'active') throw new Error('O equipamento de destino está em manutenção ou indisponível. Escolha um equipamento ativo.');
      data.location = unit.code + ' → ' + data.locationRef.position;
      if (data.action === 'transport_departure') {
        var sourcePosition = ledger.positions.find(function(item) { return item.id === data.positionId; });
        if (sourcePosition) data.origin = sourcePosition.location;
        data.destination = data.location;
      }
    }
    var record = { id: 'FLC-' + Utilities.getUuid(), type: 'LIFECYCLE', data: data,
      author: context.access.userEmail, registeredAt: new Date().toISOString() };
    if (ledger.records.some(function(item) { return item.id === record.id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
    farmaciaApplyLifecycle_(ledger, record);
    var row = [record.id, record.type, JSON.stringify(context.studyId), context.restricted, requestId,
      JSON.stringify(record.registeredAt), JSON.stringify(record.author), JSON.stringify(data)];
    if (!ledger.sheet) throw new Error('Entrada de estoque não encontrada.');
    farmaciaAssertLedgerRowReplayable_(context, ledger, row);
    ledger.sheet.getRange(ledger.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { ok: true, id: record.id, repeated: false };
  });
}

function farmaciaDispenseParticipantLabel_(context, participantId) {
  return farmaciaDispenseParticipant_(context, participantId).label;
}

function farmaciaDispenseParticipant_(context, participantId) {
  var participant = farmaciaLifecycleParticipantRows_(context).find(function(item) { return item.id === participantId; });
  if (!participant) throw new Error('Participante não encontrado neste estudo. Confira o vínculo cadastrado.');
  // O código vem do cadastro e não é truncado: identificação alterada não é aceitável.
  if (participant.label.length > 120) throw new Error('O código do participante no cadastro excede 120 caracteres. Corrija o cadastro antes de registrar a dispensação.');
  return participant;
}

// Guia de dispensação: participante, visita, datas e referências informados uma vez, com um ou mais
// medicamentos (lote/kit + quantidade). Os itens são validados juntos e gravados numa única escrita:
// se um deles falhar, nenhum é gravado. Cada item continua sendo uma dispensação própria no ledger,
// com retorno e transporte vinculados a ele.
var FARMACIA_DISPENSE_GUIDE_MAX_ITEMS_ = 20;

function registrarDispensacaoFarmacia(payload) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-lifecycle', function() {
    var context = farmaciaContext_(payload.studyId, payload.restricted, farmaciaLifecyclePermission_('dispense'));
    if (!context.ss) throw new Error('Selecione um estudo configurado para o ciclo do medicamento.');
    // No Geral o participante pode ser de qualquer estudo: o estudo informado é conferido com o cadastro abaixo.
    var general = context.studyId === FARMACIA_COMMON_SCOPE_;
    // Cada item recebe "<guia>-<n>"; o limite deixa espaço para o sufixo dentro dos 100 caracteres.
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 90);
    farmaciaAssertRequestId_(requestId);
    var items = payload.items;
    if (!Array.isArray(items) || !items.length || items.length > FARMACIA_DISPENSE_GUIDE_MAX_ITEMS_) {
      throw new Error('Inclua de 1 a ' + FARMACIA_DISPENSE_GUIDE_MAX_ITEMS_ + ' medicamentos na guia.');
    }
    var common = payload.data || {}, seen = {};
    if (general && (typeof common.participantStudyId !== 'string' || !common.participantStudyId)) throw new Error('Selecione o estudo do participante.');
    var entries = items.map(function(item, index) {
      item = item || {};
      var data = farmaciaLifecycleData_({ action: 'dispense', positionId: item.positionId, revision: item.revision, quantity: item.quantity,
        occurredOn: common.occurredOn, document: common.document, reason: common.reason, participantId: common.participantId,
        participantLabel: common.participantLabel, participantStudyId: general ? common.participantStudyId : '', visit: common.visit, prescription: common.prescription,
        platformReference: common.platformReference, validThrough: common.validThrough, confirmed: common.confirmed,
        guideId: items.length > 1 ? requestId : '' });
      if (seen[data.positionId]) throw new Error('O mesmo lote / kit aparece mais de uma vez na guia. Informe a quantidade total em um único item.');
      seen[data.positionId] = true;
      return { requestId: requestId + '-' + (index + 1), data: data };
    });
    var ledger = farmaciaReadLedger_(context);
    var previous = entries.map(function(entry) { return ledger.records.find(function(item) { return item.requestId === entry.requestId; }); });
    if (previous.some(Boolean)) {
      // Repetição da mesma guia (ex.: resposta perdida): todos os itens já gravados, idênticos, e nenhum a mais.
      var extra = ledger.records.some(function(item) { return item.requestId === requestId + '-' + (entries.length + 1); });
      var same = !extra && previous.every(function(record, index) {
        if (!record || record.type !== 'LIFECYCLE') return false;
        entries[index].data.participantLabel = record.data.participantLabel;
        if (general) entries[index].data.participantStudyLabel = record.data.participantStudyLabel;
        return record.dataJson === JSON.stringify(entries[index].data);
      });
      if (!same) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, ids: previous.map(function(record) { return record.id; }), repeated: true };
    }
    if (entries[0].data.occurredOn > farmaciaToday_()) throw new Error('A data da operação não pode ser futura.');
    var participant = farmaciaDispenseParticipant_(context, entries[0].data.participantId), label = participant.label;
    if (general && participant.studyId !== entries[0].data.participantStudyId) throw new Error('O participante não pertence ao estudo selecionado. Atualize a lista e tente novamente.');
    var rows = entries.map(function(entry) {
      var data = entry.data;
      var currentPosition = ledger.positions.find(function(item) { return item.id === data.positionId; });
      if (currentPosition && farmaciaExpiredOn_(currentPosition.expiry, farmaciaToday_())) throw new Error('Material vencido não pode ser dispensado.');
      data.participantLabel = label;
      if (general) data.participantStudyLabel = participant.studyLabel.slice(0, 200);
      var record = { id: 'FLC-' + Utilities.getUuid(), type: 'LIFECYCLE', data: data,
        author: context.access.userEmail, registeredAt: new Date().toISOString() };
      if (ledger.records.some(function(item) { return item.id === record.id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
      // Aplicado em memória, em ordem: o saldo de um item já considera os anteriores da guia.
      farmaciaApplyLifecycle_(ledger, record);
      ledger.records.push(record);
      return [record.id, record.type, JSON.stringify(context.studyId), context.restricted, entry.requestId,
        JSON.stringify(record.registeredAt), JSON.stringify(record.author), JSON.stringify(data)];
    });
    if (!ledger.sheet) throw new Error('Entrada de estoque não encontrada.');
    farmaciaAssertLedgerRowsReplayable_(context, ledger, rows);
    ledger.sheet.getRange(ledger.sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { ok: true, ids: rows.map(function(row) { return row[0]; }), repeated: false };
  });
}

// Memorando de devolução ao patrocinador ou de destruição: dados comuns uma vez e um ou mais lotes / kits.
// Como na guia de dispensação, os itens são validados juntos e gravados numa única escrita. Cada item
// continua sendo uma destinação própria no ledger, ligada às demais pelo memorando.
var FARMACIA_DESTINATION_MEMO_MAX_ITEMS_ = 30;

// Cabeçalho do memorando: retrato do cadastro do estudo no momento do registro (aba Projetos).
function farmaciaDestinationMemoStudy_(studyId) {
  var sheet = getCodexSpreadsheet_().getSheetByName('Projetos');
  var empty = { code: '', sponsor: '', cro: '', site: '', investigator: '' };
  if (!sheet || sheet.getLastRow() < 2) return empty;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
  var matches = rows.filter(function(row) { return String(row[0] || '') === studyId; });
  if (matches.length !== 1) return empty;
  var row = matches[0];
  function cell(index) { return String(row[index] === undefined || row[index] === null ? '' : row[index]).trim().slice(0, 300); }
  return { code: cell(2), sponsor: cell(9), cro: cell(10), site: cell(8), investigator: cell(5) };
}

function farmaciaDestinationMemoNumber_(ledger, restricted, occurredOn) {
  var prefix = 'MEM-' + (restricted ? 'R-' : '') + occurredOn.slice(0, 4) + '-', seen = {};
  ledger.records.forEach(function(item) {
    var number = item.type === 'LIFECYCLE' && item.data && item.data.memoNumber;
    if (number && number.indexOf(prefix) === 0) seen[number] = true;
  });
  return prefix + ('00' + (Object.keys(seen).length + 1)).slice(-3);
}

function registrarDestinacaoFarmacia(payload) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-lifecycle', function() {
    var context = farmaciaContext_(payload.studyId, payload.restricted, farmaciaLifecyclePermission_('destination'));
    if (context.studyId === FARMACIA_COMMON_SCOPE_ || !context.ss) throw new Error('Selecione um estudo configurado para o ciclo do medicamento.');
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 90);
    farmaciaAssertRequestId_(requestId);
    var items = payload.items;
    if (!Array.isArray(items) || !items.length || items.length > FARMACIA_DESTINATION_MEMO_MAX_ITEMS_) {
      throw new Error('Inclua de 1 a ' + FARMACIA_DESTINATION_MEMO_MAX_ITEMS_ + ' lotes / kits no memorando.');
    }
    var common = payload.data || {}, seen = {}, ledger = farmaciaReadLedger_(context);
    var previous = items.map(function(item, index) { return ledger.records.find(function(record) { return record.requestId === requestId + '-' + (index + 1); }); });
    var repeated = previous.some(Boolean);
    // Na repetição, número e cabeçalho vêm do registro gravado; senão são atribuídos agora.
    var first = repeated ? (previous.find(Boolean) || {}).data || {} : null;
    var occurredOn = farmaciaDate_(common.occurredOn, 'a data da devolução / destruição');
    var memoNumber = first ? first.memoNumber : farmaciaDestinationMemoNumber_(ledger, context.restricted, occurredOn);
    var memoStudy = first ? first.memoStudy : farmaciaDestinationMemoStudy_(context.studyId);
    var entries = items.map(function(item, index) {
      item = item || {};
      var data = farmaciaLifecycleData_({ action: 'destination', positionId: item.positionId, revision: item.revision, quantity: item.quantity,
        from: item.from, condition: item.condition, itemNote: item.itemNote,
        occurredOn: occurredOn, document: common.document, reason: common.reason, destination: common.destination,
        authorization: common.authorization, memoId: requestId, memoNumber: memoNumber, reasonCategory: common.reasonCategory,
        carrier: common.carrier, awb: common.awb, packages: common.packages, logger: common.logger, shipTo: common.shipTo,
        company: common.company, method: common.method, certificate: common.certificate, memoStudy: memoStudy });
      if (seen[data.positionId]) throw new Error('O mesmo lote / kit aparece mais de uma vez no memorando. Informe a quantidade total em um único item.');
      seen[data.positionId] = true;
      return { requestId: requestId + '-' + (index + 1), data: data };
    });
    if (repeated) {
      var extra = ledger.records.some(function(record) { return record.requestId === requestId + '-' + (entries.length + 1); });
      var same = !extra && previous.every(function(record, index) { return record && record.type === 'LIFECYCLE' && record.dataJson === JSON.stringify(entries[index].data); });
      if (!same) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, ids: previous.map(function(record) { return record.id; }), memoNumber: memoNumber, repeated: true };
    }
    if (occurredOn > farmaciaToday_()) throw new Error('A data da operação não pode ser futura.');
    var rows = entries.map(function(entry) {
      var record = { id: 'FLC-' + Utilities.getUuid(), type: 'LIFECYCLE', data: entry.data,
        author: context.access.userEmail, registeredAt: new Date().toISOString() };
      if (ledger.records.some(function(item) { return item.id === record.id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
      // Aplicado em memória, em ordem: cada item já considera os anteriores do memorando.
      farmaciaApplyLifecycle_(ledger, record);
      ledger.records.push(record);
      return [record.id, record.type, JSON.stringify(context.studyId), context.restricted, entry.requestId,
        JSON.stringify(record.registeredAt), JSON.stringify(record.author), JSON.stringify(entry.data)];
    });
    if (!ledger.sheet) throw new Error('Entrada de estoque não encontrada.');
    farmaciaAssertLedgerRowsReplayable_(context, ledger, rows);
    ledger.sheet.getRange(ledger.sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { ok: true, ids: rows.map(function(row) { return row[0]; }), memoNumber: memoNumber, repeated: false };
  });
}
