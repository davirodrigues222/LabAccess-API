// scripts/gerar-certs.js
// Gera a CA, o certificado do servidor e os certificados de cliente (admin, tecnico, pesquisador) em certs/.
// Funciona em Windows/Linux/Mac, sem precisar de OpenSSL nem bash (usa a biblioteca node-forge).
//
// Uso:
//   npm run certs
//   npm run certs -- --force                       (recria tudo; invalida os certificados antigos)
//   npm run certs -- --san IP:203.0.113.10,DNS:meu.dominio.com   (deploy: IP/domínio do servidor)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const forge = require('node-forge');

const pki = forge.pki;
const CERTS_DIR = path.join(__dirname, '..', 'certs');
const DIAS = Number(process.env.DIAS) || 365;

const args = process.argv.slice(2);
const force = args.includes('--force') || process.env.FORCE === '1';
const idxSan = args.indexOf('--san');
const sanExtra = idxSan >= 0 ? args[idxSan + 1] : process.env.EXTRA_SAN;

if (fs.existsSync(path.join(CERTS_DIR, 'ca.crt')) && !force) {
  console.error('Já existem certificados em certs/. Use "npm run certs -- --force" para recriar (invalida os antigos).');
  process.exit(1);
}
fs.mkdirSync(CERTS_DIR, { recursive: true });

function altNames() {
  const itens = ['DNS:localhost', 'IP:127.0.0.1'];
  if (sanExtra) itens.push(...sanExtra.split(',').map((s) => s.trim()).filter(Boolean));
  return itens.map((item) => {
    const [tipo, valor] = [item.slice(0, item.indexOf(':')).toUpperCase(), item.slice(item.indexOf(':') + 1)];
    return tipo === 'IP' ? { type: 7, ip: valor } : { type: 2, value: valor };
  });
}

function emitir({ cn, chavePublica, chaveEmissor, emissor, extensoes }) {
  const cert = pki.createCertificate();
  cert.publicKey = chavePublica;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15)); // positivo e único
  cert.validity.notBefore = new Date(Date.now() - 5 * 60 * 1000); // tolera pequena diferença de relógio
  cert.validity.notAfter = new Date(Date.now() + DIAS * 24 * 60 * 60 * 1000);
  const subject = [{ name: 'commonName', value: cn }];
  cert.setSubject(subject);
  cert.setIssuer(emissor || subject);
  cert.setExtensions(extensoes);
  cert.sign(chaveEmissor, forge.md.sha256.create());
  return cert;
}

function salvar(nome, cert, chavePrivada) {
  fs.writeFileSync(path.join(CERTS_DIR, `${nome}.crt`), pki.certificateToPem(cert));
  fs.writeFileSync(path.join(CERTS_DIR, `${nome}.key`), pki.privateKeyToPem(chavePrivada));
}

console.log('>> Gerando chaves (pode levar alguns segundos)...');

// CA própria
const chavesCA = pki.rsa.generateKeyPair(2048);
const ca = emitir({
  cn: 'LabAccess CA',
  chavePublica: chavesCA.publicKey,
  chaveEmissor: chavesCA.privateKey,
  extensoes: [
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ]
});
salvar('ca', ca, chavesCA.privateKey);
const emissorCA = ca.subject.attributes;

// Servidor
const chavesServidor = pki.rsa.generateKeyPair(2048);
const servidor = emitir({
  cn: 'localhost',
  chavePublica: chavesServidor.publicKey,
  chaveEmissor: chavesCA.privateKey,
  emissor: emissorCA,
  extensoes: [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: altNames() }
  ]
});
salvar('server', servidor, chavesServidor.privateKey);
console.log('>> Servidor: ' + altNames().map((a) => a.value || a.ip).join(', '));

// Clientes (um por perfil)
console.log('>> Certificados de cliente (SHA-256):');
for (const perfil of ['admin', 'tecnico', 'pesquisador']) {
  const chaves = pki.rsa.generateKeyPair(2048);
  const cliente = emitir({
    cn: perfil,
    chavePublica: chaves.publicKey,
    chaveEmissor: chavesCA.privateKey,
    emissor: emissorCA,
    extensoes: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', clientAuth: true }
    ]
  });
  salvar(perfil, cliente, chaves.privateKey);
  const fp = new crypto.X509Certificate(fs.readFileSync(path.join(CERTS_DIR, `${perfil}.crt`))).fingerprint256;
  console.log(`   ${perfil.padEnd(12)} ${fp}`);
}

console.log('Pronto. Certificados em certs/ (não commite os arquivos .key).');
