'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE_EXTENSIONS = new Set(['.gs', '.html']);
const CONFLICT_MARKER = /^(<<<<<<<|=======|>>>>>>>)(?: .*)?$/m;

function lineOf(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function syntaxError(source, filename) {
  try {
    new vm.Script(source, { filename, displayErrors: true });
    return null;
  } catch (error) {
    return error.message;
  }
}

function removeAppsScriptTemplates(source) {
  return source.replace(/<\?(?:!=|=)?[\s\S]*?\?>/g, 'null');
}

function decodeHtml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (match, entity) => {
    const named = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    const radix = key.startsWith('#x') ? 16 : 10;
    const digits = key.replace(/^#x?/, '');
    return String.fromCodePoint(Number.parseInt(digits, radix));
  });
}

function findHtmlTagEnd(source, start) {
  let quote = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function isHtmlTagBoundary(character) {
  return !character || character === '/' || character === '>' || character === ' ' ||
    character === '\t' || character === '\n' || character === '\r' || character === '\f';
}

function hasHtmlAttribute(attributes, expectedName) {
  const source = String(attributes || '');
  const target = expectedName.toLowerCase();
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && (source[cursor] === '/' || /\s/.test(source[cursor]))) cursor += 1;
    const nameStart = cursor;
    while (cursor < source.length && source[cursor] !== '/' && source[cursor] !== '=' && !/\s/.test(source[cursor])) cursor += 1;
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = source.slice(nameStart, cursor).toLowerCase();
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] !== '=') {
      if (name === target) return true;
      continue;
    }
    cursor += 1;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor++] : '';
    if (quote) {
      while (cursor < source.length && source[cursor] !== quote) cursor += 1;
      if (source[cursor] === quote) cursor += 1;
    } else {
      while (cursor < source.length && !/\s/.test(source[cursor])) cursor += 1;
    }
    if (name === target) return true;
  }
  return false;
}

function findScriptBlocks(source) {
  const lowerSource = source.toLowerCase();
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf('<', cursor);
    if (opening < 0) break;
    if (lowerSource.startsWith('<!--', opening)) {
      const commentEnd = lowerSource.indexOf('-->', opening + 4);
      if (commentEnd < 0) break;
      cursor = commentEnd + 3;
      continue;
    }
    if (!lowerSource.startsWith('<script', opening)) {
      cursor = opening + 1;
      continue;
    }
    const nameEnd = opening + 7;
    const boundary = source[nameEnd];
    if (!isHtmlTagBoundary(boundary)) {
      cursor = nameEnd;
      continue;
    }
    const openingEnd = findHtmlTagEnd(source, opening);
    if (openingEnd < 0) break;

    let closing = lowerSource.indexOf('</script', openingEnd + 1);
    while (closing >= 0) {
      const closingBoundary = source[closing + 8];
      if (isHtmlTagBoundary(closingBoundary)) break;
      closing = lowerSource.indexOf('</script', closing + 8);
    }
    const closingEnd = closing < 0 ? -1 : findHtmlTagEnd(source, closing);
    const end = closingEnd < 0 ? source.length : closingEnd + 1;
    blocks.push({
      index: opening,
      end,
      attrs: source.slice(opening + 7, openingEnd),
      codeIndex: openingEnd + 1,
      code: source.slice(openingEnd + 1, closing < 0 ? source.length : closing),
      raw: source.slice(opening, end)
    });
    cursor = end;
  }
  return blocks;
}

function maskPreservingLineBreaks(value) {
  let masked = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    masked += character === '\r' || character === '\n' || character === '\u2028' || character === '\u2029'
      ? character
      : ' ';
  }
  return masked;
}

function validateHtml(filename, source, htmlNames) {
  const errors = [];
  let scriptCount = 0;
  let handlerCount = 0;
  let htmlWithoutScripts = '';
  let lastScriptEnd = 0;

  findScriptBlocks(source).forEach((script) => {
    htmlWithoutScripts += source.slice(lastScriptEnd, script.index);
    htmlWithoutScripts += maskPreservingLineBreaks(script.raw);
    lastScriptEnd = script.end;
    if (hasHtmlAttribute(script.attrs, 'src')) return;
    scriptCount += 1;
    const code = removeAppsScriptTemplates(script.code);
    const error = syntaxError(code, `${filename}:script-${scriptCount}`);
    if (error) errors.push(`${filename}:${lineOf(source, script.index)}: ${error}`);
  });
  htmlWithoutScripts += source.slice(lastScriptEnd);

  const handlerPattern = /\s(on[a-z][\w:-]*)\s*=\s*(["'])([\s\S]*?)\2/gi;
  let handler;
  while ((handler = handlerPattern.exec(htmlWithoutScripts))) {
    handlerCount += 1;
    const code = removeAppsScriptTemplates(decodeHtml(handler[3]));
    const wrapped = `(function (event) {\n${code}\n})`;
    const error = syntaxError(wrapped, `${filename}:${handler[1]}-${handlerCount}`);
    if (error) errors.push(`${filename}:${lineOf(htmlWithoutScripts, handler.index)} (${handler[1]}): ${error}`);
  }

  const includePattern = /\binclude\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  let include;
  while ((include = includePattern.exec(source))) {
    if (!htmlNames.has(include[2])) {
      errors.push(`${filename}:${lineOf(source, include.index)}: include '${include[2]}' nao possui ${include[2]}.html`);
    }
  }

  return { errors, scriptCount, handlerCount };
}

function validateProject(projectRoot) {
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  const sourceFiles = entries
    .filter((entry) => entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
  const htmlNames = new Set(sourceFiles.filter((name) => name.endsWith('.html')).map((name) => path.basename(name, '.html')));
  const errors = [];
  let gsCount = 0;
  let htmlCount = 0;
  let scriptCount = 0;
  let handlerCount = 0;

  for (const filename of sourceFiles) {
    const source = fs.readFileSync(path.join(projectRoot, filename), 'utf8');
    if (CONFLICT_MARKER.test(source)) errors.push(`${filename}: possui marcador de conflito Git nao resolvido`);
    if (filename.endsWith('.gs')) {
      gsCount += 1;
      const error = syntaxError(source, filename);
      if (error) errors.push(`${filename}: ${error}`);
    } else {
      htmlCount += 1;
      const result = validateHtml(filename, source, htmlNames);
      errors.push(...result.errors);
      scriptCount += result.scriptCount;
      handlerCount += result.handlerCount;
    }
  }

  for (const manifestName of ['appsscript.json', '.clasp.json']) {
    const manifestPath = path.join(projectRoot, manifestName);
    if (!fs.existsSync(manifestPath)) {
      if (manifestName === 'appsscript.json') errors.push('appsscript.json: arquivo obrigatorio ausente');
      continue;
    }
    try {
      const manifestSource = fs.readFileSync(manifestPath, 'utf8');
      if (CONFLICT_MARKER.test(manifestSource)) errors.push(`${manifestName}: possui marcador de conflito Git nao resolvido`);
      const parsed = JSON.parse(manifestSource);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') errors.push(`${manifestName}: o conteudo deve ser um objeto JSON`);
    } catch (error) {
      errors.push(`${manifestName}: JSON invalido: ${error.message}`);
    }
  }

  return { errors, gsCount, htmlCount, scriptCount, handlerCount };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const result = validateProject(root);
  if (result.errors.length) {
    console.error('Validacao sintatica integral falhou:');
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Sintaxe aprovada: ${result.gsCount} .gs, ${result.htmlCount} .html, ${result.scriptCount} blocos <script> e ${result.handlerCount} manipuladores inline.`);
  console.log('Manifestos, includes e marcadores de conflito tambem foram validados.');
}

module.exports = { decodeHtml, findScriptBlocks, hasHtmlAttribute, maskPreservingLineBreaks, removeAppsScriptTemplates, syntaxError, validateHtml, validateProject };

if (require.main === module) main();
