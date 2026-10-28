// src/index.js
require('dotenv').config();
const express = require('express');
const { Prisma } = require('@prisma/client');

const app = express();

app.use(express.json());

// ==========================================
// ROTAS
// ==========================================
// TODO (mTLS): o middleware de validação do certificado entra aqui, antes das rotas,
// buscando o Usuario por certificadoCN e anexando em req.usuario.
app.use('/equipamentos', require('./routes/equipamentos'));
app.use('/usuarios', require('./routes/usuarios'));
app.use('/agendamentos', require('./routes/agendamentos'));

app.get('/', (req, res) => res.json({ api: 'LabAccess API', status: 'online' }));

// ==========================================
// TRATAMENTO DE ERROS
// ==========================================
// Express 5 encaminha automaticamente erros lançados em rotas async para cá
app.use((error, req, res, next) => {
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
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
