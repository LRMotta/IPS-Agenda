'use strict';
/* global document */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A fixture bloqueia a rede, entao a Material Symbols do Google Fonts nao carrega e o nome do icone
// (ex.: "chevron_left") aparece como texto largo. Este helper e opt-in: injeta a fonte local, se existir,
// com a mesma definicao de classe do CSS do Google, para medir larguras e quebras como no app.
// Sem a fonte, limita o glifo a 1em por CSS (aproximacao). Consulte PLAYWRIGHT.md.
function materialIconFontPath() {
  return process.env.PLAYWRIGHT_ICON_FONT_PATH ||
    path.join(os.homedir(), 'Documents', 'IPS-Testes-Playwright', 'fonts', 'MaterialSymbolsOutlined.ttf');
}

const ICON_CLASS_CSS = '.material-symbols-outlined{font-family:"Material Symbols Outlined";font-weight:normal;font-style:normal;' +
  'font-size:18px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;' +
  'word-wrap:normal;direction:ltr;-webkit-font-feature-settings:"liga";font-feature-settings:"liga";' +
  '-webkit-font-smoothing:antialiased}';

// Retorna true quando a fonte real foi carregada; false quando usou a aproximacao por CSS.
async function installMaterialIcons(page) {
  const file = materialIconFontPath();
  let content;
  if (fs.existsSync(file)) {
    const data = fs.readFileSync(file).toString('base64');
    content = '@font-face{font-family:"Material Symbols Outlined";font-style:normal;font-weight:400;' +
      'src:url(data:font/ttf;base64,' + data + ') format("truetype")}' + ICON_CLASS_CSS;
  } else {
    content = '.material-symbols-outlined{display:inline-block;width:1em;height:1em;overflow:hidden;white-space:nowrap;font-size:18px;line-height:1}';
  }
  await page.addStyleTag({ content });
  if (!fs.existsSync(file)) return false;
  await page.evaluate(() => document.fonts.load('18px "Material Symbols Outlined"', 'chevron_left').then(() => document.fonts.ready));
  return page.evaluate(() => document.fonts.check('18px "Material Symbols Outlined"', 'chevron_left'));
}

module.exports = { installMaterialIcons, materialIconFontPath };
