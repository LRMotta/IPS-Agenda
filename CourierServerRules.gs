var CodexCourierRiskRules_ = (function() {
  // BEGIN GENERATED COURIER RULES — editar tools/courier-rules-core.js

  function norm(value) {
    return String(value == null ? '' : value).toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function isYes(value) {
    return ['SIM', 'S', 'YES', 'TRUE', '1', 'ATIVO'].indexOf(norm(value)) >= 0;
  }

  function dryIceTemperatures(values) {
    var list = Array.isArray(values) ? values : String(values || '').split(/[;,]/);
    return list.map(function(value) { return String(value || '').trim(); }).filter(function(value) {
      var temperature = norm(value);
      return temperature.indexOf('CONGEL') >= 0 || temperature.indexOf('FROZEN') >= 0;
    });
  }

  function parseIso(value) {
    var match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
    return date;
  }

  function iso(date) {
    return date.getUTCFullYear() + '-' + ('0' + (date.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + date.getUTCDate()).slice(-2);
  }

  function previousCalendarIso(value) {
    var date = parseIso(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() - 1);
    return iso(date);
  }

  function isAnnualHoliday(item) {
    var recurrence = norm(item && (item.recorrencia || item.recurrence));
    return recurrence === 'ANUAL' || recurrence === 'ANUAL DIA E MES' || recurrence === 'TODO ANO';
  }

  function createHolidayIndex(holidays) {
    var index = { specific: Object.create(null), annual: Object.create(null) };
    (holidays || []).forEach(function(item, order) {
      if (!item) return;
      var dateIso = String(item.dataIso || item.data || '').trim();
      if (!parseIso(dateIso)) return;
      if (Object.prototype.hasOwnProperty.call(item, 'ativo') && !isYes(item.ativo)) return;
      var annual = isAnnualHoliday(item);
      var map = annual ? index.annual : index.specific;
      var key = annual ? dateIso.slice(5) : dateIso;
      if (!map[key]) map[key] = [];
      map[key].push({ item: item, order: order, operational: !Object.prototype.hasOwnProperty.call(item, 'afetaOperacao') || isYes(item.afetaOperacao) });
    });
    return index;
  }

  function indexedHolidayItems(dateIso, index, operationalOnly) {
    // Manter a ordem original inclusive quando datas anuais e especificas se misturam.
    return (index.specific[dateIso] || []).concat(index.annual[dateIso.slice(5)] || [])
      .filter(function(entry) { return !operationalOnly || entry.operational; })
      .sort(function(a, b) { return a.order - b.order; })
      .map(function(entry) { return entry.item; });
  }

  function holidayIndex(holidays) {
    return Array.isArray(holidays) || !holidays ? createHolidayIndex(holidays) : holidays;
  }

  function holidayItemsForDate(dateIso, holidays, operationalOnly) {
    if (!parseIso(dateIso)) return [];
    return indexedHolidayItems(dateIso, holidayIndex(holidays), operationalOnly);
  }

  function activeHolidayMap(holidays, year) {
    // Sem ano, preservar o contrato legado. Com ano, expandir feriados anuais.
    var out = {};
    (holidays || []).forEach(function(item) {
      if (!item) return;
      var dateIso = String(item.dataIso || item.data || '').trim();
      if (!parseIso(dateIso)) return;
      if (Object.prototype.hasOwnProperty.call(item, 'ativo') && !isYes(item.ativo)) return;
      if (Object.prototype.hasOwnProperty.call(item, 'afetaOperacao') && !isYes(item.afetaOperacao)) return;
      if (year != null) {
        if (isAnnualHoliday(item)) dateIso = String(year) + dateIso.slice(4);
        else if (dateIso.slice(0, 4) !== String(year)) return;
        if (!parseIso(dateIso)) return;
      }
      if (!out[dateIso]) out[dateIso] = [];
      out[dateIso].push(item);
    });
    return out;
  }

  function operationalRisk(dateIso, courierRule, holidays) {
    courierRule = courierRule || {};
    var date = parseIso(dateIso);
    if (!date) return { risk: false, invalidDate: true, reasons: [], holiday: null, previousHoliday: null };
    var index = holidayIndex(holidays);
    var holiday = indexedHolidayItems(dateIso, index, true);
    var day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - 1);
    var previousIso = iso(date);
    var previousHoliday = indexedHolidayItems(previousIso, index, true);
    var reasons = [];
    if (holiday.length) reasons.push({ code: 'HOLIDAY_DATE', holidayIso: dateIso });
    if (day === 1 && isYes(courierRule.restricaoSegunda)) reasons.push({ code: 'MONDAY_RESTRICTION' });
    if (previousHoliday.length && isYes(courierRule.restricaoAposFeriado)) reasons.push({ code: 'DAY_AFTER_HOLIDAY', holidayIso: previousIso });
    return {
      risk: reasons.length > 0, invalidDate: false, reasons: reasons,
      holiday: holiday.length ? holiday : null,
      previousHoliday: previousHoliday.length ? previousHoliday : null
    };
  }
  // END GENERATED COURIER RULES

  return {
    norm: norm,
    isYes: isYes,
    dryIceTemperatures: dryIceTemperatures,
    parseIso: parseIso,
    previousCalendarIso: previousCalendarIso,
    isAnnualHoliday: isAnnualHoliday,
    createHolidayIndex: createHolidayIndex,
    holidayItemsForDate: holidayItemsForDate,
    activeHolidayMap: activeHolidayMap,
    operationalRisk: operationalRisk
  };
})();
