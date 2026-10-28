// prisma/seed.js
// Popula o banco com 3 usuários (um por perfil), 4 equipamentos e 3 agendamentos.
// Os fingerprints dos usuários são lidos dos certificados em certs/ (gerados por: npm run certs),
// então cada pessoa/ambiente usa os próprios certificados. Pode ser executado várias vezes.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { X509Certificate } = require('crypto');
const prisma = require('../src/db');

const CERTS_DIR = path.join(__dirname, '..', 'certs');

function fingerprintDe(perfilArquivo) {
  const arquivo = path.join(CERTS_DIR, `${perfilArquivo}.crt`);
  if (!fs.existsSync(arquivo)) {
    console.error(`Certificado não encontrado: ${arquivo}\nGere os certificados antes com: npm run certs`);
    process.exit(1);
  }
  return new X509Certificate(fs.readFileSync(arquivo)).fingerprint256; // formato AB:CD:...
}

const dias = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function main() {
  const usuarios = [
    { nome: 'Administrador do Laboratório', email: 'admin@labaccess.local', matricula: 'ADM001', perfil: 'ADMIN', certificadoCN: 'admin' },
    { nome: 'Técnico de Laboratório', email: 'tecnico@labaccess.local', matricula: 'TEC001', perfil: 'TECNICO', certificadoCN: 'tecnico' },
    { nome: 'Pesquisador Teste', email: 'pesquisador@labaccess.local', matricula: 'PES001', perfil: 'PESQUISADOR', certificadoCN: 'pesquisador' }
  ];

  const criados = {};
  for (const u of usuarios) {
    const dados = { ...u, certificadoFingerprint: fingerprintDe(u.certificadoCN), ativo: true };
    criados[u.certificadoCN] = await prisma.usuario.upsert({
      where: { email: u.email },
      update: dados,
      create: dados
    });
  }

  const equipamentos = [
    { nome: 'Microscópio Óptico Trinocular', patrimonio: 'PAT-0001', descricao: 'Microscópio com câmera acoplada', status: 'DISPONIVEL', localizacao: 'Bloco B, Lab 05', categoria: 'Óptica', valorEstimado: 12500.9, sensivelUmidade: true },
    { nome: 'Osciloscópio Digital 100MHz', patrimonio: 'PAT-0002', descricao: 'Osciloscópio de 4 canais', status: 'DISPONIVEL', localizacao: 'Bloco A, Lab 02', categoria: 'Eletrônica', valorEstimado: 8200, sensivelUmidade: false },
    { nome: 'Espectrômetro UV-Vis', patrimonio: 'PAT-0003', descricao: 'Espectrômetro de bancada para análises ópticas', status: 'DISPONIVEL', localizacao: 'Bloco B, Lab 07', categoria: 'Óptica', valorEstimado: 31000, sensivelUmidade: true },
    { nome: 'Impressora 3D Industrial', patrimonio: 'PAT-0004', descricao: 'Impressora 3D de grande formato (espaço maker)', status: 'MANUTENCAO', localizacao: 'Espaço Maker', categoria: 'Eletrônica', valorEstimado: 18900, sensivelUmidade: false }
  ];

  const eq = {};
  for (const e of equipamentos) {
    eq[e.patrimonio] = await prisma.equipamento.upsert({
      where: { patrimonio: e.patrimonio },
      update: e,
      create: e
    });
  }

  // Agendamentos de exemplo só são criados se ainda não existir nenhum (evita duplicar ao rodar o seed de novo)
  if ((await prisma.agendamento.count()) === 0) {
    await prisma.agendamento.createMany({
      data: [
        { usuarioId: criados.pesquisador.id, equipamentoId: eq['PAT-0002'].id, dataInicio: dias(7), dataFim: dias(7.1), finalidade: 'Medição de sinais do projeto de iniciação científica', statusAprovacao: 'PENDENTE' },
        { usuarioId: criados.pesquisador.id, equipamentoId: eq['PAT-0001'].id, dataInicio: dias(8), dataFim: dias(8.1), finalidade: 'Análise de amostras de materiais', statusAprovacao: 'APROVADO', observacoesTecnico: 'Equipamento calibrado e liberado.' },
        { usuarioId: criados.admin.id, equipamentoId: eq['PAT-0003'].id, dataInicio: dias(9), dataFim: dias(9.1), finalidade: 'Validação do espectrômetro após instalação', statusAprovacao: 'REJEITADO', observacoesTecnico: 'Conflito com agenda de manutenção preventiva.' }
      ]
    });
  }

  console.log('Seed concluído: 3 usuários, 4 equipamentos, agendamentos de exemplo.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
