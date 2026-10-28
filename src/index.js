// src/index.js
require('dotenv').config();
const fs = require('fs');
const https = require('https');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Prisma } = require('@prisma/client');
const { identificarCertificado, exigirSessao } = require('./middleware/auth');

const app = express();

app.use(helmet());
app.use(express.json());

// Rate limiting global (por IP)
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_POR_MINUTO) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de requisições excedido. Tente novamente em instantes.' }
}));

// ==========================================
// ROTAS
// ==========================================
// Pública (health check): não exige certificado
app.get('/', (req, res) => res.json({ api: 'LabAccess API', status: 'online', autenticacao: 'mTLS' }));

// A partir daqui TUDO exige certificado de cliente válido (mTLS) associado a um usuário ativo
app.use(identificarCertificado);
app.use('/auth', require('./routes/auth')); // login (abre sessão) / logout / me

// A partir daqui exige também sessão ativa (login feito e não expirado)
app.use(exigirSessao);
app.use('/equipamentos', require('./routes/equipamentos'));
app.use('/usuarios', require('./routes/usuarios'));
app.use('/agendamentos', require('./routes/agendamentos'));

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// ==========================================
// TRATAMENTO DE ERROS
// ==========================================
// Express 5 encaminha automaticamente erros lançados em rotas async para cá
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição' });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: "Registro não encontrado" });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: `Valor já cadastrado: ${error.meta?.target}` });
    }
    if (error.code === 'P2003') {
      return res.status(400).json({ error: "Referência inválida (usuário ou equipamento inexistente)" });
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({ error: "Dados inválidos. Verifique os tipos dos campos." });
  }

  console.error(error);
  return res.status(500).json({ error: "Erro interno do servidor" });
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR (HTTPS + mTLS)
// ==========================================
function lerArquivoTLS(variavel) {
  const caminho = process.env[variavel];
  if (!caminho || !fs.existsSync(caminho)) {
    console.error(`Arquivo TLS não encontrado (${variavel}=${caminho}). Gere os certificados com: npm run certs`);
    process.exit(1);
  }
  return fs.readFileSync(caminho);
}

const opcoesTLS = {
  key: lerArquivoTLS('TLS_KEY_PATH'),
  cert: lerArquivoTLS('TLS_CERT_PATH'),
  ca: lerArquivoTLS('TLS_CA_PATH'),   // CA que assina os certificados de cliente
  requestCert: true,                   // o servidor PEDE o certificado ao cliente
  // false: o handshake não é derrubado se faltar certificado/for inválido; o middleware
  // identificarCertificado responde 401 em JSON (usa socket.authorized para decidir).
  rejectUnauthorized: false
};

const PORT = process.env.PORT || 3000;
https.createServer(opcoesTLS, app).listen(PORT, () => {
  console.log(`LabAccess API (HTTPS + mTLS) rodando na porta ${PORT}`);
});
