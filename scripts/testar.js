// scripts/testar.js
// Roteiro de testes do mTLS e das permissões. Precisa do servidor rodando (npm run dev em outro terminal).
// Uso: npm run test:curl
// Contra o servidor da VM: defina BASE (ex.: https://IP:3000) e CERTS (pasta com ca.crt e os certificados de cliente)
const fs = require('fs');
const https = require('https');
const path = require('path');

const BASE = new URL(process.env.BASE || 'https://localhost:3000');
const CERTS = path.resolve(process.env.CERTS || path.join(__dirname, '..', 'certs'));
const ca = fs.readFileSync(path.join(CERTS, 'ca.crt'));

function req(perfil, metodo, caminho, corpo) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const opcoes = {
      hostname: BASE.hostname, port: BASE.port || 443, path: caminho, method: metodo, ca,
      agent: false, // sem reaproveitar conexão: cada requisição faz o handshake com o certificado do perfil
      headers: dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}
    };
    if (perfil !== 'none') {
      opcoes.cert = fs.readFileSync(path.join(CERTS, `${perfil}.crt`));
      opcoes.key = fs.readFileSync(path.join(CERTS, `${perfil}.key`));
    }
    const r = https.request(opcoes, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    if (dados) r.write(dados);
    r.end();
  });
}

let falhas = 0;
async function checa(descricao, esperado, promessa) {
  let obtido;
  try { obtido = await promessa; } catch (e) { obtido = `erro: ${e.message}`; }
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${descricao.padEnd(60)} esperado ${esperado} | obtido ${obtido} | ${ok ? 'ok' : 'FALHOU'}`);
}

(async () => {
  const novo = { nome: 'Osciloscópio Teste', patrimonio: `PAT-T${Date.now()}`, descricao: 'teste', localizacao: 'Lab', categoria: 'Eletrônica', valorEstimado: 100 };

  await checa('Rota pública / sem certificado', 200, req('none', 'GET', '/'));
  await checa('GET /equipamentos SEM certificado', 401, req('none', 'GET', '/equipamentos'));
  await checa('GET /equipamentos com certificado, SEM login', 401, req('pesquisador', 'GET', '/equipamentos'));
  await checa('POST /auth/login (pesquisador)', 200, req('pesquisador', 'POST', '/auth/login'));
  await checa('GET /equipamentos (pesquisador, logado)', 200, req('pesquisador', 'GET', '/equipamentos'));
  await checa('POST /equipamentos (pesquisador) -> sem permissão', 403, req('pesquisador', 'POST', '/equipamentos', novo));
  await checa('GET /usuarios (pesquisador) -> sem permissão', 403, req('pesquisador', 'GET', '/usuarios'));
  await checa('POST /auth/login (tecnico)', 200, req('tecnico', 'POST', '/auth/login'));
  await checa('POST /equipamentos (tecnico) -> sem permissão', 403, req('tecnico', 'POST', '/equipamentos', novo));
  await checa('POST /auth/login (admin)', 200, req('admin', 'POST', '/auth/login'));
  await checa('POST /equipamentos (admin)', 201, req('admin', 'POST', '/equipamentos', novo));
  await checa('GET /usuarios (admin)', 200, req('admin', 'GET', '/usuarios'));
  await checa('POST /auth/logout (pesquisador)', 204, req('pesquisador', 'POST', '/auth/logout'));
  await checa('GET /equipamentos (pesquisador) após logout', 401, req('pesquisador', 'GET', '/equipamentos'));

  console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
})();
