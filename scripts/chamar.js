// scripts/chamar.js
// Faz uma requisição à API usando o certificado de cliente de um perfil (substitui o curl, que no Windows dá problema).
// Uso:   npm run chamar -- <perfil> <METODO> <caminho> [corpo-json]
// Ex.:   npm run chamar -- admin POST /auth/login
//        npm run chamar -- admin GET /equipamentos
//        npm run chamar -- admin GET /equipamentos/ID/condicoes
// Perfis: admin | tecnico | pesquisador | none (sem certificado, para ver o 401)
// Contra a VM: defina BASE (ex.: https://IP:3000) e CERTS (pasta com ca.crt e os certificados)
const fs = require('fs');
const https = require('https');
const path = require('path');

const [perfil, metodo = 'GET', caminho = '/', corpo] = process.argv.slice(2);
if (!perfil) {
  console.error('Uso: npm run chamar -- <admin|tecnico|pesquisador|none> <METODO> <caminho> [corpo-json]');
  process.exit(1);
}

const BASE = new URL(process.env.BASE || 'https://localhost:3000');
const CERTS = path.resolve(process.env.CERTS || path.join(__dirname, '..', 'certs'));

const opcoes = {
  hostname: BASE.hostname,
  port: BASE.port || 443,
  path: caminho,
  method: metodo.toUpperCase(),
  ca: fs.readFileSync(path.join(CERTS, 'ca.crt')),
  agent: false,
  headers: corpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } : {}
};
if (perfil !== 'none') {
  opcoes.cert = fs.readFileSync(path.join(CERTS, `${perfil}.crt`));
  opcoes.key = fs.readFileSync(path.join(CERTS, `${perfil}.key`));
}

const req = https.request(opcoes, (res) => {
  let texto = '';
  res.on('data', (parte) => (texto += parte));
  res.on('end', () => {
    console.log(`HTTP ${res.statusCode}`);
    if (!texto) return;
    try { console.log(JSON.stringify(JSON.parse(texto), null, 2)); } catch { console.log(texto); }
  });
});
req.on('error', (e) => { console.error('Erro na requisição:', e.message); process.exit(1); });
if (corpo) req.write(corpo);
req.end();
