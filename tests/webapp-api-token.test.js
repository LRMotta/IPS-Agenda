'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFile, runFiles, readProjectFile } = require('./helpers/load-app-script');

const secret = 'SEGREDO_FICTICIO_PARA_TESTE';

function fixture(expected = secret) {
  const server = runFile('WebApp.gs', {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => expected }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value, encoding) => Array.from(crypto.createHash(algorithm).update(value, encoding).digest())
    }
  });
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: false, message: 'Sem identidade institucional' });
  server.codexJsonResponse_ = body => body;
  return server;
}

function event(action, body, token) {
  return { parameter: { action, token }, postData: { contents: JSON.stringify(body) } };
}

test('token em query string não autoriza doGet, doPost nem autorização institucional', () => {
  const server = fixture();
  // Usa a implementação real, com identidade ausente e sem consultar serviços externos.
  const real = runFile('WebApp.gs');
  server.codexAuthorizeWebAppRequest_ = real.codexAuthorizeWebAppRequest_;
  server.codexGetActiveUserEmail_ = () => '';
  server.codexShouldShowAuthDebug_ = () => false;
  server.codexGetIdentityAuthorizationUrl_ = () => '';
  server.codexAccessDeniedOutput_ = access => access;
  const request = event('importarCodex', {}, secret);
  assert.equal(server.codexAuthorizeWebAppRequest_(request).ok, false);
  assert.equal(server.doGet(request).ok, false);
  assert.equal(server.doPost(request).ok, false);
});

test('POST com credencial no corpo autoriza apenas ping e importação privada sob lock', () => {
  const server = fixture();
  let locked = false;
  let imports = 0;
  server.codexWithDocumentLock_ = (name, callback) => {
    assert.equal(name, 'importarCodex');
    locked = true;
    try { return callback(); } finally { locked = false; }
  };
  server.importarTransporteCodex = () => { throw new Error('Importador público indevido'); };
  server.importarTransporteCodexInterno_ = payload => {
    imports++;
    assert.equal(locked, true);
    assert.equal(payload.idAgenda, 'AG-SIMULADA');
    assert.equal(payload.apiToken, undefined);
    for (const method of ['codexAssertCanRead_', 'codexAssertCanWrite_', 'codexAssertAdmin_', 'getParticipantes']) {
      assert.throws(() => server[method](), /Sem identidade institucional/);
    }
    return { rascunho: true };
  };
  const body = { apiToken: secret, payload: { idAgenda: 'AG-SIMULADA' } };
  assert.equal(server.doPost(event('ping', body)).data, 'pong');
  assert.equal(imports, 0);
  assert.equal(server.doPost(event('importarCodex', body)).data.rascunho, true);
  assert.equal(imports, 1);
  for (const action of ['salvarUsuarioAdmin', 'excluirParticipante', '', 'outra']) {
    assert.equal(server.doPost(event(action, body)).ok, false);
  }
  assert.equal(imports, 1);
  assert.equal(locked, false);
});

test('token incorreto, ausente e envelope inválido não importam nem elevam perfil', () => {
  const server = fixture();
  server.importarTransporteCodexInterno_ = () => { throw new Error('Não deve importar'); };
  for (const body of [
    {}, { apiToken: '' }, { apiToken: 'errado', payload: {} },
    { apiToken: secret }, { apiToken: secret, payload: [] },
    { apiToken: { toString: secret }, payload: {} }, null, []
  ]) assert.equal(server.doPost(event('importarCodex', body)).ok, false);
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'readonly' });
  assert.equal(server.doPost(event('ping', { apiToken: 'errado', payload: {} })).ok, false);
});

test('POST institucional mantém payload legado e autorização do importador público', () => {
  const server = fixture();
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'user' });
  server.importarTransporteCodex = payload => ({ id: payload.idAgenda });
  assert.equal(server.doPost(event('importarCodex', { idAgenda: 'AG-LEGADO' })).data.id, 'AG-LEGADO');
  server.importarTransporteCodex = () => { throw new Error('Perfil somente leitura'); };
  assert.match(server.doPost(event('importarCodex', {})).error, /somente leitura/);
});

test('credencial revogada durante a espera do lock não grava Transporte', () => {
  const server = fixture();
  let imports = 0;
  server.importarTransporteCodexInterno_ = () => { imports++; };
  server.codexWithDocumentLock_ = (name, callback) => {
    server.PropertiesService.getScriptProperties = () => ({ getProperty: () => 'CREDENCIAL_ROTACIONADA' });
    return callback();
  };
  const result = server.doPost(event('importarCodex', { apiToken: secret, payload: {} }));
  assert.equal(result.ok, false);
  assert.match(result.error, /Acesso negado/);
  assert.equal(imports, 0);
});

test('importador privado de máquina preserva mapeamento e modo rascunho sem sincronizar Agenda', () => {
  const server = runFile('TransporteCodexConfig.gs');
  const input = { idAgenda: 'AG-SIMULADA' };
  const mapped = { paciente: 'Participante simulado' };
  server.montarPayloadTransporteCodex = body => {
    assert.equal(body, input);
    return mapped;
  };
  server.salvarTransporte = () => { throw new Error('Não deve chamar RPC pública'); };
  server.salvarTransporteInterno_ = (payload, options) => {
    assert.equal(payload, mapped);
    assert.equal(options.rascunho, true);
    assert.equal(options.agendaEvento, null);
    return { rascunho: true };
  };
  assert.equal(server.importarTransporteCodexInterno_(input).rascunho, true);
});

test('JSON inválido não retorna trechos da credencial e falha de importação não deixa bypass', () => {
  const server = fixture();
  const result = server.doPost({ parameter: { action: 'ping' }, postData: { contents: '{"apiToken":"' + secret } });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  server.codexWithDocumentLock_ = (name, callback) => callback();
  server.importarTransporteCodexInterno_ = () => { throw new Error('Falha simulada'); };
  assert.match(server.doPost(event('importarCodex', { apiToken: secret, payload: {} })).error, /Falha simulada/);
  assert.throws(() => server.codexAssertCanWrite_(), /Sem identidade institucional/);
});

test('validação compara hashes SHA-256 e percorre os 32 bytes mesmo com diferença inicial', () => {
  const server = fixture();
  assert.equal(server.codexIsValidWebAppApiToken_(secret), true);
  for (const token of ['errado', secret + 'x', secret.slice(1), '', null, 1, 'x'.repeat(4097)]) {
    assert.equal(server.codexIsValidWebAppApiToken_(token), false);
  }
  assert.equal(fixture('').codexIsValidWebAppApiToken_(secret), false);
  const reads = [];
  let calls = 0;
  server.Utilities.computeDigest = () => {
    const index = calls++;
    return new Proxy(Array(32).fill(index), { get: (target, key) => {
      reads.push([index, Number(key)]);
      return target[key];
    } });
  };
  assert.equal(server.codexIsValidWebAppApiToken_(secret), false);
  assert.equal(calls, 2);
  assert.equal(reads.length, 64);
  assert.deepEqual(reads.slice(-2), [[0, 31], [1, 31]]);
});

test('envios de integração carregam credencial somente no corpo, sem query ou URL retornada', () => {
  const requests = [];
  const server = runFiles(['WebApp.gs', 'TransporteCodexConfig.gs'], {
    UrlFetchApp: { fetch: (url, options) => {
      requests.push({ url, options });
      return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
    } }
  });
  server.codexAssertAdmin_ = () => {};
  server.codexAssertCanWrite_ = () => {};
  server.codexGetWebAppApiToken_ = () => secret;
  server.getTransporteWebAppUrlCodex_ = () => 'https://example.invalid/exec';
  server.importarTransporteCodex = undefined;
  server.montarPayloadTransporteParaTransp_ = () => ({ idAgenda: 'AG-SIMULADA', courier: { awb: 'SIMULADO', nome: 'SIMULADO' } });
  server.codexCourierAssertDocumentAwb_ = () => {};
  server.gerarDocumentacaoTransporteCodex('AG-SIMULADA');
  const diagnosis = server.testarUrlWebAppTransporteCodex();
  assert.equal(diagnosis.url, 'https://example.invalid/exec');
  assert.equal(requests.length, 3);
  for (const { url, options } of requests) {
    assert.equal(url.includes(secret), false);
    assert.equal(url.includes('token='), false);
    if (options.method === 'post') {
      const body = JSON.parse(options.payload);
      assert.equal(body.apiToken, secret);
      assert.equal(typeof body.payload, 'object');
    }
  }
  assert.equal(server.codexGetWebAppApiTokenQuery_, undefined);
  assert.doesNotMatch(readProjectFile('WebApp.gs'), /CODEX_API_TOKEN_REQUEST_|codexGetWebAppApiTokenQuery_/);
  assert.doesNotMatch(readProjectFile('TransporteCodexConfig.gs'), /codexGetWebAppApiTokenQuery_/);
});

test('importação privada mantém lookup de LabCentral sem liberar a RPC nem alterar schema', () => {
  const server = runFiles(['WebApp.gs', 'TransporteCodexConfig.gs']);
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: false, message: 'Sem identidade institucional' });
  server.getLabCentralSheet_ = () => { throw new Error('Não pode alterar schema'); };
  server.getCodexSheetDataByName_ = name => {
    assert.equal(name, 'LabCentral');
    return [Array(10).fill('Cabecalho'), ['LAB-1', 'LAB TESTE', 'Lab Teste Completo', 'Rua Teste', 'Cidade', '01234', '0123', 'Contato', 'Pais', 'Permit']];
  };
  assert.equal(server.transporteLabCentralByDestino_('LAB TESTE').cep, '01234');
  assert.equal(server.transporteLabCentralDestinoPadrao_(), 'LAB TESTE');
  assert.throws(() => server.getLabCentral(), /Sem identidade institucional/);
});
