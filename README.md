# LabAccess API

API REST para gerenciar o inventário, as reservas e a manutenção de equipamentos de laboratórios universitários e espaços maker, com autenticação por **mTLS (Mutual TLS)**.

> **Disciplina:** Técnicas de Integração de Sistemas · **Projeto:** AV2 — Autenticação em Sistemas Integrados
> **Equipe:** Davi Fontenele e Davi Rodrigues

## Sumário

1. [Apresentação do sistema](#1-apresentação-do-sistema)
2. [Autenticação: mTLS](#2-autenticação-mtls)
3. [Documentação de uso](#3-documentação-de-uso)
4. [Integração com API externa](#4-integração-com-api-externa)
5. [Deploy](#5-deploy)
6. [Estrutura do projeto](#6-estrutura-do-projeto)
7. [Divisão de responsabilidades](#7-divisão-de-responsabilidades)

---

## 1. Apresentação do sistema

### Descrição

Laboratórios guardam equipamentos caros e sensíveis (microscópios, espectrômetros, osciloscópios). O LabAccess centraliza o cadastro desses ativos, o agendamento de uso, a aprovação por um técnico e o controle de manutenção, tudo protegido por certificados digitais.

### Casos de uso principais

- Pesquisador consulta os equipamentos disponíveis e solicita um horário de uso.
- Técnico aprova ou rejeita as solicitações e registra observações técnicas.
- Técnico coloca um equipamento em manutenção.
- Administrador cadastra equipamentos e gerencia as contas e os certificados dos usuários.
- O sistema **bloqueia automaticamente** reservas de equipamentos sensíveis quando a previsão de umidade está acima do limite (integração com o OpenWeather).

### Tipos de usuários e permissões

| Operação | Pesquisador | Técnico | Administrador |
|---|:---:|:---:|:---:|
| Listar/consultar equipamentos | só os disponíveis | todos | todos |
| Cadastrar ou remover equipamento | ❌ | ❌ | ✅ |
| Alterar equipamento | ❌ | só o `status` | todos os campos |
| Consultar condições climáticas de um equipamento | ❌ | ✅ | ✅ |
| Solicitar agendamento | ✅ (sempre em seu nome) | ❌ | ✅ |
| Ver agendamentos | só os próprios | todos | todos |
| Aprovar/rejeitar agendamento | ❌ | ✅ | ✅ |
| Editar datas/finalidade de agendamento | só os próprios, enquanto `PENDENTE` | ❌ | qualquer um |
| Cancelar agendamento | só os próprios | ❌ | qualquer um |
| Gerenciar usuários | ❌ | ❌ | ✅ |

### Dados que o sistema gerencia

**Equipamento:** `id`, `nome`, `patrimonio` (único), `descricao`, `status` (`DISPONIVEL` ou `MANUTENCAO`), `localizacao`, `categoria`, `valorEstimado`, `sensivelUmidade`, `createdAt`.

**Agendamento:** `id`, `usuarioId`, `equipamentoId`, `dataInicio`, `dataFim`, `finalidade`, `statusAprovacao` (`PENDENTE`, `APROVADO` ou `REJEITADO`), `observacoesTecnico`, `umidade`, `temperatura`, `condicaoClimatica` (clima registrado no momento da solicitação), `createdAt`.

**Usuário:** `id`, `nome`, `email`, `matricula`, `perfil` (`PESQUISADOR`, `TECNICO` ou `ADMIN`), `certificadoCN`, `certificadoFingerprint`, `ativo`, `createdAt`.

**Sessão:** `fingerprint`, `usuarioId`, `expiraEm`, `criadoEm`.

Dados protegidos: dados pessoais dos usuários (somente o administrador acessa a gestão de usuários), histórico de agendamentos (cada pesquisador vê só o seu) e o vínculo entre certificado e usuário. Não há senhas no sistema.

```mermaid
erDiagram
    USUARIO ||--o{ AGENDAMENTO : solicita
    EQUIPAMENTO ||--o{ AGENDAMENTO : "é reservado em"
    USUARIO ||--o{ SESSAO_CERTIFICADO : possui
    USUARIO {
        string id
        string nome
        string email
        string matricula
        string perfil
        string certificadoCN
        string certificadoFingerprint
        boolean ativo
    }
    EQUIPAMENTO {
        string id
        string nome
        string patrimonio
        string descricao
        string status
        string localizacao
        string categoria
        float valorEstimado
        boolean sensivelUmidade
    }
    AGENDAMENTO {
        string id
        datetime dataInicio
        datetime dataFim
        string finalidade
        string statusAprovacao
        string observacoesTecnico
        int umidade
    }
    SESSAO_CERTIFICADO {
        string fingerprint
        datetime expiraEm
    }
```

### Tecnologias

Node.js, Express 5, PostgreSQL (hospedado no Neon), Prisma ORM, `helmet`, `express-rate-limit`, `node-forge` (geração de certificados) e a API pública do OpenWeather.

---

## 2. Autenticação: mTLS

### Como funciona

No HTTPS comum, somente o servidor apresenta um certificado. No **mTLS**, o cliente também precisa apresentar um certificado X.509, assinado pela Autoridade Certificadora (CA) do projeto. **Não há senha nem token**: a identidade do cliente é provada pela posse da chave privada que corresponde ao certificado, e essa chave nunca sai da máquina do cliente.

Passo a passo:

1. O cliente abre a conexão TLS com o servidor.
2. O servidor envia o certificado dele, e o cliente o valida contra a CA (`ca.crt`).
3. O servidor **solicita o certificado do cliente** (`requestCert: true`).
4. O cliente envia o certificado e uma assinatura feita com a chave privada dele.
5. O Node valida a cadeia contra a CA e a validade, e marca `socket.authorized`.
6. O middleware `identificarCertificado` calcula o **fingerprint SHA-256** do certificado e busca o usuário correspondente no banco. Se não houver certificado, ele for inválido ou o usuário não existir, responde **401**. Usuário desativado recebe **403**.
7. O cliente chama `POST /auth/login`, que abre uma **sessão** com prazo de validade.
8. Nas demais rotas, `exigirSessao` confere a sessão e `exigirPerfil` confere o perfil. Sem permissão, a resposta é **403**.
9. `POST /auth/logout` apaga a sessão.

```mermaid
sequenceDiagram
    participant C as Cliente com certificado e chave privada
    participant S as Servidor Node HTTPS
    participant M as Middlewares de autenticação
    participant DB as PostgreSQL
    C->>S: Inicia conexão TLS
    S-->>C: Certificado do servidor e pedido de certificado do cliente
    C->>S: Certificado do cliente e assinatura com a chave privada
    S->>S: Valida a cadeia contra a CA (socket.authorized)
    C->>M: POST /auth/login
    M->>DB: Busca usuário pelo fingerprint SHA-256
    DB-->>M: Usuário com perfil e status ativo
    M->>DB: Cria ou renova a sessão
    M-->>C: 200 com perfil e expiração da sessão
    C->>M: GET /equipamentos
    M->>DB: Confere certificado, sessão e perfil
    M-->>C: 200 com os dados, ou 401 ou 403
```

Ordem das camadas no servidor:

```mermaid
flowchart TD
    A[Requisição HTTPS] --> B[helmet e rate limit global]
    B --> C{GET /}
    C -->|sim| D[200 health check público]
    C -->|não| E[identificarCertificado]
    E -->|sem certificado ou inválido| F[401]
    E -->|usuário desativado| G[403]
    E -->|ok| H{rota /auth}
    H -->|sim| I[login, logout e me]
    H -->|não| J[exigirSessao]
    J -->|sem sessão ou expirada| F
    J -->|ok| K[exigirPerfil por rota]
    K -->|perfil sem permissão| G
    K -->|ok| L[Regra de negócio e resposta]
```

### Por que escolhemos o mTLS

- Não está entre as técnicas vistas em aula (Basic Auth, Bearer Token, OAuth 2.0 e API Key).
- É a técnica usada em ambientes corporativos e na comunicação entre sistemas, onde se exige identidade forte dos dois lados.
- Dispensa segredos que trafegam pela rede: não há senha, token ou chave de API para vazar ou ser interceptado.
- Combina com o contexto do sistema: um ambiente de laboratório, com poucos usuários cadastrados e equipamentos de alto valor.

### Pontos fortes

- Segurança criptográfica alta, com autenticação mútua (o cliente também confia no servidor).
- A autenticação acontece na camada de transporte, antes de qualquer lógica da aplicação.
- Sem senhas para armazenar, vazar ou adivinhar (inclusive por força bruta).
- Resistente a phishing e a replay de credenciais, já que a chave privada não trafega.

### Pontos fracos e quando não usar

- **Gestão de certificados:** emitir, distribuir, renovar e revogar dá trabalho, principalmente em larga escala.
- **Revogação:** aqui ela é feita pelo banco de dados (campo `ativo` e remoção de sessões). Não implementamos CRL nem OCSP, que são os mecanismos padrão de revogação.
- **Logout:** o mTLS puro não tem o conceito de sessão. Emulamos login e logout com a tabela de sessões.
- **Proxies que terminam o TLS:** plataformas como o Render encerram o TLS antes da aplicação, então o certificado do cliente nunca chega ao Node. É preciso hospedar em uma VM ou com um balanceador configurado para mTLS.
- **Chave da CA:** quem a possui consegue emitir certificados válidos.
- **Usabilidade:** instalar certificados em navegadores é incômodo para usuários finais.
- **Quando não usar:** APIs públicas com muitos usuários finais ou clientes baseados em navegador comum. Nesses casos, OAuth 2.0 ou tokens são mais adequados.

### Implementação

| Arquivo | Responsabilidade |
|---|---|
| `scripts/gerar-certs.js` | Gera a CA, o certificado do servidor e os três certificados de cliente |
| `src/index.js` | Servidor `https.createServer` com `requestCert: true` e ordem das camadas |
| `src/middleware/auth.js` | `identificarCertificado`, `exigirSessao` e `exigirPerfil` |
| `src/routes/auth.js` | Login, logout e `/auth/me` |
| `prisma/seed.js` | Associa o fingerprint de cada certificado ao usuário correspondente |

Trecho do servidor (`src/index.js`):

```js
const opcoesTLS = {
  key: lerArquivoTLS('TLS_KEY_PATH'),
  cert: lerArquivoTLS('TLS_CERT_PATH'),
  ca: lerArquivoTLS('TLS_CA_PATH'),   // CA que assina os certificados de cliente
  requestCert: true,                   // o servidor PEDE o certificado ao cliente
  rejectUnauthorized: false            // quem barra é o middleware (401/403 em JSON)
};
https.createServer(opcoesTLS, app).listen(PORT);
```

O `rejectUnauthorized: false` **não desativa a segurança**: ele só evita que o handshake seja derrubado antes do Express, para que a API responda 401 em JSON com uma mensagem clara. A decisão é tomada em `socket.authorized`.

Trecho do middleware (`src/middleware/auth.js`):

```js
async function identificarCertificado(req, res, next) {
  const cert = req.socket.getPeerCertificate();
  if (!cert || !cert.fingerprint256) {
    return res.status(401).json({ error: 'Certificado de cliente não apresentado (mTLS obrigatório)' });
  }
  if (!req.socket.authorized) {
    return res.status(401).json({ error: 'Certificado de cliente inválido', motivo: String(req.socket.authorizationError) });
  }
  const fingerprint = normalizarFingerprint(cert.fingerprint256);
  const usuario = await prisma.usuario.findUnique({ where: { certificadoFingerprint: fingerprint } });
  if (!usuario)        return res.status(401).json({ error: 'Certificado válido, mas não associado a nenhum usuário' });
  if (!usuario.ativo)  return res.status(403).json({ error: 'Usuário desativado' });
  req.usuario = usuario;
  next();
}
```

O usuário é identificado pelo **fingerprint SHA-256** do certificado, e o perfil vem do banco. O CN (Common Name) do certificado é apenas informativo: ele é um texto livre, enquanto o fingerprint identifica aquele certificado específico.

### Geração dos certificados

O script `scripts/gerar-certs.js` usa a biblioteca `node-forge` e funciona em Windows, Linux e macOS, sem depender de OpenSSL. Ele gera, na pasta `certs/`:

| Arquivo | Função |
|---|---|
| `ca.crt` e `ca.key` | CA própria (`basicConstraints: CA`), que assina todos os demais |
| `server.crt` e `server.key` | Identidade do servidor, com `serverAuth` e SAN para `localhost` e `127.0.0.1` |
| `admin`, `tecnico` e `pesquisador` (`.crt` e `.key`) | Certificados de cliente, com `clientAuth`, um por perfil |

Os certificados usam RSA de 2048 bits, assinatura SHA-256 e validade de 365 dias. As chaves privadas nunca são versionadas: o `.gitignore` ignora todo o conteúdo de `certs/`, exceto o `.gitkeep`.

### Segurança

- **Senhas:** não existem. A identidade é a posse da chave privada.
- **Expiração:** o certificado vale 365 dias e a sessão vale 60 minutos (`SESSAO_MINUTOS`), nunca excedendo a validade do certificado.
- **Revogação:** desativar o usuário (`ativo: false`) ou trocar o fingerprint apaga as sessões dele e bloqueia o acesso na requisição seguinte.
- **Rate limiting:** limite global de 120 requisições por minuto por IP (`RATE_LIMIT_POR_MINUTO`) e limite próprio de 30 tentativas a cada 15 minutos no login. Excedido o limite, a resposta é 429.
- **Validação de entrada:** campos obrigatórios, valores permitidos (perfil, status), datas coerentes e valores numéricos. O Prisma usa consultas parametrizadas, o que previne SQL injection.
- **Autorização:** o `usuarioId` de um agendamento vem do certificado, nunca do corpo da requisição.
- **Exposição de dados:** as listagens de agendamento mostram só `id`, `nome`, `email` e `perfil` do usuário, nunca o fingerprint.
- **Cabeçalhos:** `helmet` aplica cabeçalhos de segurança.

---

## 3. Documentação de uso

### Pré-requisitos

- Node.js 20 ou superior
- Um banco PostgreSQL (usamos o plano gratuito do [Neon](https://neon.tech))
- Uma chave gratuita da API do [OpenWeather](https://openweathermap.org/api)

### Rodando localmente

```bash
git clone https://github.com/davirodrigues222/LabAccess-API.git
cd LabAccess-API
npm install
cp .env.example .env        # no Windows (cmd): copy .env.example .env
# edite o .env (veja a tabela abaixo)
npm run certs               # gera a CA, o servidor e os 3 certificados de cliente
npx prisma db push          # cria as tabelas no banco
npm run seed                # popula usuários, equipamentos e agendamentos
npm run dev                 # sobe o servidor em https://localhost:3000
```

Em outro terminal, valide o ambiente com `npm run test:curl`. O resultado esperado é "Todos os testes passaram".

### Variáveis de ambiente

| Variável | Descrição | Exemplo |
|---|---|---|
| `DATABASE_URL` | String de conexão do PostgreSQL (use a conexão direta, com `sslmode=require`) | `postgresql://usuario:senha@host/neondb?sslmode=require` |
| `WEATHER_API_KEY` | Chave da API do OpenWeather | `abc123...` |
| `CIDADE_LABORATORIO` | Cidade consultada no OpenWeather | `Fortaleza` |
| `UMIDADE_MAXIMA` | Umidade (%) acima da qual equipamentos sensíveis têm a reserva bloqueada | `80` |
| `PORT` | Porta do servidor HTTPS | `3000` |
| `TLS_KEY_PATH` | Chave privada do servidor | `./certs/server.key` |
| `TLS_CERT_PATH` | Certificado do servidor | `./certs/server.crt` |
| `TLS_CA_PATH` | Certificado da CA que assina os certificados de cliente | `./certs/ca.crt` |
| `SESSAO_MINUTOS` | Duração da sessão após o login | `60` |
| `RATE_LIMIT_POR_MINUTO` | Limite global de requisições por minuto por IP | `120` |

O arquivo `.env` e a pasta `certs/` (exceto o `.gitkeep`) **não são versionados**.

### Usuários de teste (criados pelo seed)

| Perfil | E-mail | Certificado |
|---|---|---|
| Administrador | `admin@labaccess.local` | `certs/admin.crt` e `certs/admin.key` |
| Técnico | `tecnico@labaccess.local` | `certs/tecnico.crt` e `certs/tecnico.key` |
| Pesquisador | `pesquisador@labaccess.local` | `certs/pesquisador.crt` e `certs/pesquisador.key` |

O seed lê os certificados em `certs/` e grava o fingerprint de cada um no usuário. Se os certificados forem gerados novamente (`npm run certs -- --force`), rode `npm run seed` outra vez.

### Como autenticar e fazer requisições

Toda requisição (exceto `GET /`) precisa apresentar o certificado de cliente. Depois, é preciso fazer o **login** (`POST /auth/login`), que abre a sessão.

**Pelo script do projeto** (funciona em Windows, Linux e macOS):

```bash
npm run chamar -- <perfil> <METODO> <caminho> [corpo-json]

npm run chamar -- pesquisador POST /auth/login
npm run chamar -- pesquisador GET /equipamentos
npm run chamar -- admin GET /equipamentos/ID_DO_EQUIPAMENTO/condicoes
```

O perfil pode ser `admin`, `tecnico`, `pesquisador` ou `none` (sem certificado). Para apontar para outro servidor, defina `BASE` (por exemplo `https://IP:3000`) e `CERTS` (pasta com `ca.crt` e os certificados de cliente).

**Pelo curl** (Linux, macOS ou Git Bash; no PowerShell do Windows, `curl` é um apelido de outro comando, e o `curl.exe` pode não aceitar certificados PEM):

```bash
curl --cacert certs/ca.crt --cert certs/pesquisador.crt --key certs/pesquisador.key \
  -X POST https://localhost:3000/auth/login

curl --cacert certs/ca.crt --cert certs/pesquisador.crt --key certs/pesquisador.key \
  https://localhost:3000/equipamentos
```

**Pelo Bruno:** configure o certificado de cliente (`.crt`, `.key`) e a CA nas configurações do projeto, com `baseUrl` em `https://localhost:3000`. Execute `testes-bruno/00_Login.bru` antes das demais requisições.

### Endpoints

| Método e rota | Descrição | Perfis |
|---|---|---|
| `GET /` | Health check (**pública**, sem certificado) | todos |
| `POST /auth/login` | Abre a sessão (exige certificado válido) | todos |
| `POST /auth/logout` | Encerra a sessão | todos |
| `GET /auth/me` | Dados de quem está autenticado | todos |
| `GET /equipamentos` | Lista equipamentos (`?status=`) | todos (pesquisador vê só os disponíveis) |
| `GET /equipamentos/:id` | Consulta um equipamento | todos |
| `GET /equipamentos/:id/condicoes` | Equipamento combinado com clima atual e previsão (OpenWeather) | técnico, admin |
| `POST /equipamentos` | Cadastra equipamento | admin |
| `PUT /equipamentos/:id` | Atualiza equipamento | admin (técnico: só `status`) |
| `DELETE /equipamentos/:id` | Remove equipamento | admin |
| `GET /agendamentos` | Lista agendamentos (`?equipamentoId=&statusAprovacao=&usuarioId=`) | todos (pesquisador vê só os seus) |
| `GET /agendamentos/:id` | Consulta um agendamento | todos (pesquisador só o seu) |
| `POST /agendamentos` | Solicita agendamento (consulta o OpenWeather) | pesquisador, admin |
| `PUT /agendamentos/:id` | Edita ou aprova/rejeita | dono (enquanto pendente), técnico e admin (aprovação) |
| `DELETE /agendamentos/:id` | Cancela agendamento | dono, admin |
| `GET /usuarios`, `GET /usuarios/:id` | Consulta usuários | admin |
| `POST /usuarios`, `PUT /usuarios/:id`, `DELETE /usuarios/:id` | Gerencia usuários e certificados | admin |

### Exemplos de requisição e resposta

**Login (sucesso)**

```bash
npm run chamar -- pesquisador POST /auth/login
```
```json
{
  "mensagem": "Login realizado",
  "usuario": { "id": "...", "nome": "Pesquisador Teste", "perfil": "PESQUISADOR" },
  "certificado": { "cn": "pesquisador", "validoAte": "Oct 28 2027 ..." },
  "sessaoExpiraEm": "2026-10-29T15:30:00.000Z"
}
```

**Solicitar um agendamento (pesquisador)**

```bash
npm run chamar -- pesquisador POST /agendamentos '{"equipamentoId":"ID","dataInicio":"2026-11-10T14:00:00Z","dataFim":"2026-11-10T16:00:00Z","finalidade":"Análise de amostras"}'
```

Resposta `201` com o agendamento criado (`statusAprovacao: "PENDENTE"`) e, quando há previsão disponível, `umidade`, `temperatura` e `condicaoClimatica`.

**Aprovar um agendamento (técnico)**

```bash
npm run chamar -- tecnico POST /auth/login
npm run chamar -- tecnico PUT /agendamentos/ID '{"statusAprovacao":"APROVADO","observacoesTecnico":"Equipamento calibrado."}'
```

**Cadastrar um equipamento (admin)**

```bash
npm run chamar -- admin POST /equipamentos '{"nome":"Multímetro","patrimonio":"PAT-0100","descricao":"Bancada","localizacao":"Lab 01","categoria":"Eletrônica","valorEstimado":950,"sensivelUmidade":false}'
```

### Exemplos de erro

**401 — sem certificado**

```bash
npm run chamar -- none GET /equipamentos
```
```json
{ "error": "Certificado de cliente não apresentado (mTLS obrigatório)" }
```

**401 — certificado de uma CA desconhecida**

```json
{ "error": "Certificado de cliente inválido", "motivo": "DEPTH_ZERO_SELF_SIGNED_CERT" }
```

**401 — certificado válido, mas sem login**

```json
{ "error": "Sessão inexistente ou expirada. Faça login em POST /auth/login" }
```

**403 — perfil sem permissão**

```bash
npm run chamar -- pesquisador POST /equipamentos '{}'
```
```json
{ "error": "Acesso negado: esta operação exige perfil ADMIN", "seuPerfil": "PESQUISADOR" }
```

**409 — conflito de horário**

```json
{ "error": "Já existe um agendamento para este equipamento no período" }
```

**422 — reserva bloqueada pelo clima**

```json
{
  "error": "Reserva bloqueada: umidade prevista acima do limite para equipamento sensível",
  "clima": { "cidade": "Fortaleza", "umidade": 86, "temperatura": 28.4, "condicao": "nublado" },
  "limiteUmidade": 80
}
```

**429 — limite de requisições excedido**

```json
{ "error": "Limite de requisições excedido. Tente novamente em instantes." }
```

### Testes automatizados

`npm run test:curl` executa 14 cenários com os três perfis: rota pública, acesso sem certificado (401), sem login (401), login de cada perfil, acessos negados (403), criação de equipamento pelo admin (201), logout (204) e acesso após o logout (401).

---

## 4. Integração com API externa

**API usada:** [OpenWeather](https://openweathermap.org/api), consultada a partir de `src/services/clima.js`.

**Por que:** equipamentos como microscópios e espectrômetros são sensíveis à umidade. O sistema usa a previsão do tempo para evitar reservas em condições de risco.

**Dados consultados (duas requisições distintas):**

| Endpoint do OpenWeather | O que traz | Onde é usado |
|---|---|---|
| `/data/2.5/weather` | Clima atual da cidade do laboratório | `GET /equipamentos/:id/condicoes` |
| `/data/2.5/forecast` | Previsão para até 5 dias, em intervalos de 3 horas | `GET /equipamentos/:id/condicoes` e `POST`/`PUT /agendamentos` |

**Como os dados são combinados:**

- `GET /equipamentos/:id/condicoes` faz as duas chamadas em paralelo e devolve, em uma única resposta, o equipamento (banco local) junto com o clima atual, a previsão para a data pedida (`?data=`, por padrão daqui a 3 horas), o limite de umidade e o campo `risco`. O `risco` é verdadeiro quando o equipamento é sensível à umidade e a umidade (atual ou prevista) passa do limite.
- `POST /agendamentos` consulta a previsão para o horário solicitado. Se o equipamento tem `sensivelUmidade` e a umidade prevista passa de `UMIDADE_MAXIMA` (80% por padrão), a reserva é **bloqueada** com 422. Caso contrário, o clima é gravado no agendamento (`umidade`, `temperatura`, `condicaoClimatica`). Remarcar um agendamento passa pela mesma checagem.

**Resiliência:** as chamadas têm timeout de 5 segundos. Se o OpenWeather estiver indisponível, se a chave não estiver configurada ou se a data estiver além de 5 dias, a API **continua funcionando** e a reserva não é bloqueada. Essa é uma decisão consciente (*fail-open*) e uma limitação conhecida: sem dados climáticos, a proteção não é aplicada.

```bash
npm run chamar -- admin POST /auth/login
npm run chamar -- admin GET /equipamentos
npm run chamar -- admin GET /equipamentos/ID_DO_EQUIPAMENTO/condicoes
```

---

## 5. Deploy

**Link da versão deployada:** _a preencher (veja a situação abaixo)_

### Por que não usamos o Render

O mTLS exige que o certificado do cliente chegue até a aplicação. Plataformas como o Render **encerram o TLS no proxy deles** e repassam a requisição ao Node em HTTP simples, então o certificado do cliente nunca chega ao servidor. Por isso, o deploy precisa ser feito em um ambiente em que o próprio Node faça o TLS, como uma **máquina virtual** (AWS EC2, Azure ou similar).

### Situação atual

> **Importante:** o sistema foi desenvolvido e validado **localmente**, com o banco de dados hospedado no Neon e a integração com o OpenWeather funcionando. O deploy em VM foi planejado e documentado abaixo, mas **não foi concluído** pela equipe. Por isso a demonstração é feita com o servidor rodando localmente.

### Procedimento de deploy em VM (Ubuntu)

1. Crie a VM (por exemplo, AWS EC2 com Ubuntu 24.04) com um IP fixo. No grupo de segurança, libere a porta 22 (SSH, só para o seu IP) e a porta 3000 (API).
2. Instale o ambiente:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   git clone https://github.com/davirodrigues222/LabAccess-API.git
   cd LabAccess-API && npm install
   ```
3. Configure o `.env` com um **banco exclusivo da VM** (o seed grava os fingerprints dos certificados da máquina onde roda, então não compartilhe o banco com o ambiente local).
4. Gere os certificados com o IP da VM e prepare o banco:
   ```bash
   npm run certs -- --san IP:IP_DA_VM
   npx prisma db push
   npm run seed
   ```
5. Mantenha a API rodando em segundo plano:
   ```bash
   sudo npm install -g pm2
   pm2 start src/index.js --name labaccess
   pm2 save && pm2 startup
   ```
6. Baixe os certificados de cliente para a máquina de teste e rode o roteiro de testes contra a VM:
   ```bash
   scp -i chave.pem -r ubuntu@IP_DA_VM:~/LabAccess-API/certs certs-vm
   BASE=https://IP_DA_VM:3000 CERTS=certs-vm npm run test:curl
   ```

---

## 6. Estrutura do projeto

```
LabAccess-API/
├── prisma/
│   ├── schema.prisma          # modelos: Usuario, Equipamento, Agendamento, SessaoCertificado
│   └── seed.js                # dados iniciais; lê os certificados em certs/
├── scripts/
│   ├── gerar-certs.js         # gera CA, servidor e clientes (node-forge)
│   ├── testar.js              # 14 cenários de teste (401, 403, 200...)
│   └── chamar.js              # faz uma requisição com o certificado de um perfil
├── src/
│   ├── index.js               # servidor HTTPS com mTLS e ordem das camadas
│   ├── db.js                  # cliente do Prisma
│   ├── middleware/auth.js     # identificarCertificado, exigirSessao, exigirPerfil
│   ├── routes/                # auth, equipamentos, agendamentos, usuarios
│   └── services/clima.js      # integração com o OpenWeather
├── testes-bruno/              # coleção do Bruno
├── certs/                     # certificados gerados (não versionados)
├── .env.example
└── package.json
```

---

## 7. Divisão de responsabilidades

| Davi Rodrigues | Davi Fontenele |
|---|---|
| Modelagem do banco relacional (PostgreSQL) | Configuração do servidor HTTPS e do mTLS no Node.js |
| Rotas REST e CRUDs (equipamentos e agendamentos) | Middleware de extração e validação de certificados |
| Lógica de integração com a API externa (OpenWeather) | Documentação (README) e deploy |

O histórico de commits do repositório reflete as fases do desenvolvimento: autenticação, endpoints, integração, testes e documentação.
