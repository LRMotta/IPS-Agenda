'use strict';

class FakeRange {
  constructor(sheet, row, column, numRows, numColumns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.numRows = numRows || 1;
    this.numColumns = numColumns || 1;
  }

  getValues() {
    const values = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numColumns; c++) {
        row.push((this.sheet.rows[this.row - 1 + r] || [])[this.column - 1 + c] ?? '');
      }
      values.push(row);
    }
    return values;
  }

  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return String(this.getValue() ?? ''); }

  setValues(values) {
    for (let r = 0; r < this.numRows; r++) {
      while (this.sheet.rows.length < this.row + r) this.sheet.rows.push([]);
      const target = this.sheet.rows[this.row - 1 + r];
      for (let c = 0; c < this.numColumns; c++) target[this.column - 1 + c] = values[r][c];
    }
    this.sheet.writes++;
    return this;
  }

  setValue(value) { return this.setValues([[value]]); }

  clearContent() {
    const blank = Array.from({ length: this.numRows }, () => Array(this.numColumns).fill(''));
    return this.setValues(blank);
  }

  setFontColor() { return this; }
  setFontLine() { return this; }
  setBackground() { return this; }
  setFontFamily() { return this; }
  setFontSize() { return this; }
  setFontWeight() { return this; }
  sort() { return this; }
}

class FakeSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = (rows || []).map((row) => row.slice());
    this.writes = 0;
  }

  getDataRange() {
    const columns = this.rows.reduce((max, row) => Math.max(max, row.length), 1);
    return new FakeRange(this, 1, 1, Math.max(this.rows.length, 1), columns);
  }

  getRange(row, column, numRows, numColumns) {
    return new FakeRange(this, row, column, numRows, numColumns);
  }

  appendRow(row) {
    this.rows.push(row.slice());
    this.writes++;
    return this;
  }

  getLastRow() { return this.rows.length; }
  deleteRow(row) { this.rows.splice(row - 1, 1); this.writes++; }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets || {}; }
  getSheetByName(name) { return this.sheets[name] || null; }
}

module.exports = { FakeRange, FakeSheet, FakeSpreadsheet };
