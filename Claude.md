# CLAUDE.md — venhagenda · Handoff para Claude Code

> Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão.
> Última atualização: reflete o estado real do código em 2026-07 (o projeto evoluiu bastante além do plano inicial — ver "Como isso diverge do plano original" no fim).

---

## Contexto do projeto

**venhagenda** é um sistema de agendamento multi-tenant (SaaS) para profissionais de estética (manicures, etc.), com três partes integradas:

1. **Página de agendamento pública** (`/book/:slug`) — cliente agenda sozinha
2. **Painel admin** (`/:slug/admin`) — cada estúdio vê sua própria agenda
3. **Bot do WhatsApp + notificações automáticas** — via n8n + UazAPI

O primeiro cliente/piloto do sistema é a **Michele** (manicure), mas a arquitetura já é multi-tenant: qualquer estúdio novo se cadastra em `/setup` e ganha seu próprio slug, serviços e configuração.

---

## Stack real (não é mais o plano original com Supabase)

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite + TypeScript + react-router-dom v7 |
| Backend | **Express + TypeScript próprio** (`/server`), rodando com `tsx` |
| Banco de dados | **PostgreSQL self-hosted** via Docker (`pg` puro, sem ORM, sem Supabase) |
| Auth admin | JWT (`jsonwebtoken`) + bcrypt, emitido por `/api/auth/login` |
| Auth cliente | lookup só por telefone (login formal futuro: `customers.email`/`password_hash`) |
| Bot WhatsApp | **UazAPI** (não é mais Evolution API) |
| Automação | n8n (self-hosted, container Docker) — fluxos em `/n8n/*.json` |
| Lembretes/resumos | **cron nativo no backend** (`node-cron`, ver `server/src/lib/scheduledNotifs.ts`) — não depende do n8n |
| Deploy | Docker Compose (`docker-compose.yaml`): postgres, n8n, redis, studio-api, studio-frontend |

`@supabase/supabase-js` ainda está no `package.json` do frontend mas **não é mais usado** — o frontend fala com a API Express própria via `src/lib/api.ts` (`fetch('/api/...')`), não com Supabase diretamente.

---

## Multi-tenancy e nomenclatura B2B2C

Nomenclatura das tabelas (desde a migration 003):
- `tenants` (era `studios`) = o **B** — a empreendedora/estúdio dona da agenda. Tem `plan` (`basic`/`premium`).
- `users` (era `admins`) = login administrativo da dona do estúdio.
- `customers` (era `clients`) = o **C** — cliente final. É **global** (phone UNIQUE) com `tenant_ids INT[]` — a mesma pessoa não duplica entre estúdios; agendar num estúdio novo faz `array_append` do tenant.
- `tenant_config` (era `studio_config`).
- **Exceção**: `bot_sessions` mantém a coluna `studio_id` — o fluxo n8n faz SQL direto nela; renomear só junto com o fluxo.
- **Contrato HTTP não mudou**: paths `/api/...`, bodies (`studio`, `studio_name`) e chaves JSON de resposta (`studio_name`, `service_id`, `all_services`...) continuam com os nomes antigos — n8n e frontend dependem deles. Só o interno (SQL, variáveis TS, claims JWT `tenant_id`/`tenant_slug`) foi renomeado.

- **RLS no Postgres** isola dados por `tenant_id`. O middleware `requireAuth` (`server/src/middleware/auth.ts`) faz `SET app.tenant_id` na sessão do pool logo após validar o JWT (aceita claims legados `studio_id` de tokens antigos). Em `customers` a policy usa `tenant_ids @> ARRAY[...]`.
- Onboarding de estúdio novo: `POST /api/auth/setup` (rota `/setup` no frontend) — cria `tenants` + `users` + `tenant_config` padrão (dias/horário de trabalho) + os 5 serviços padrão (seed).
- Rotas do admin são sempre prefixadas por slug: `/:slug/admin`, `/:slug/admin/services`.
- Rota pública de agendamento: `/book/:slug`.

---

## Regras de negócio — serviços padrão (seed no setup)

| id | Serviço | Duração | Preço |
|----|---------|---------|-------|
| 1 | Esmaltação Completa | 90 min | R$ 40 |
| 2 | Pé Normal | 40 min | R$ 25 |
| 3 | Mão Normal | 45 min | R$ 20 |
| 4 | Banho de Gel | 150 min (2h30) | R$ 80 |
| 5 | Alongamento em Gel | 180 min (3h) | R$ 120 |

Cada estúdio pode editar/adicionar serviços depois via `/:slug/admin/services` — isso não é mais fixo globalmente, é só o seed inicial.

### Horários de funcionamento
- Configurável por estúdio em `studio_config` (chaves `work_days`, `work_start`, `work_end`), com fallback padrão: seg–sex, 09:00–18:00, slots de 30 min.
- A function `available_slots(p_date, p_service_id, p_tenant_id, p_duration)` no Postgres (`server/schema.sql`) já respeita `work_days`/`work_start`/`work_end` por estúdio, além de `time_blocks` (bloqueios manuais de agenda) e conflitos de horário.
- Um agendamento pode ter **múltiplos serviços**: coluna `appointments.services JSONB` — snapshot `[{id, name, price, duration, emoji, color}]` **congelado no momento do booking** (mudar o preço do serviço depois não altera o histórico). `total_price` e `total_duration` são persistidos. Não existe mais `appointments.service_id` nem a tabela `appointment_services`; o `service_id` do JSON de resposta é derivado do 1º item do snapshot.
- Cada serviço tem `reminder_days_before` (default 2): quantos dias antes a cliente recebe o lembrete. No booking, `appointments.reminder_date = date - max(reminder_days_before dos serviços escolhidos)`.

### Bloqueio manual de agenda
- Tabela `time_blocks` agora usa **intervalo de datas** (`start_date`, `end_date`), não só um dia — dá pra bloquear "de 20/07 a 25/07" de uma vez (feriado, viagem, etc.).

---

## Notificações WhatsApp (via UazAPI, `server/src/lib/whatsapp.ts`)

Duas famílias de mensagem:
- **`notifyAppt`** → avisa a **dona do estúdio** (número em `studio_config.notification_phone`): novo agendamento, remarcação (mostra horário antigo vs novo), cancelamento (diferencia se foi a própria cliente que cancelou ou o studio).
- **`notifyClient`** → avisa a **cliente**: confirmação, remarcação, lembrete (2 dias antes), cancelamento.

Cron jobs automáticos (`server/src/lib/scheduledNotifs.ts`, roda dentro do próprio processo Express, `America/Sao_Paulo`):
| Horário | O que faz |
|---|---|
| 07:00 seg–sex | Resumo da agenda do dia pra dona do estúdio |
| 10:00 seg–sex | Quantos clientes ainda faltam hoje |
| 17:30 seg–sex | Quem é a última cliente do dia |
| 08:00 todo dia | Lembrete pra clientes: `reminder_date <= hoje AND date >= hoje AND NOT reminder_sent AND status = 'confirmed'` — marca `reminder_sent = true` após envio com sucesso |

### Tabela `messages` (histórico WhatsApp)
- Toda mensagem outbound enviada por `sendText()` é gravada em `messages` (tenant_id, customer_id, appointment_id, phone, direction, kind `bot|notification|reminder|summary`, body, whatsapp_instance, external_id do UazAPI, status). Mensagens inbound serão gravadas pelo n8n (futuro) — há UNIQUE parcial `(whatsapp_instance, external_id)` pra dedupe de webhook.
- `sendText(toPhone, text, meta)` recebe `meta.instance`: tenant **premium** envia pela `tenants.whatsapp_instance` própria; **basic** cai no número central (`UAZAPI_INSTANCE` do env).

O fluxo conversacional do bot (classificar serviço, pedir data, confirmar horário, pegar nome) vive nos fluxos n8n em `/n8n/` (`nailsbot-fluxo-completo-v5.json`), não em código do backend.

---

## Área da cliente (`/meus-agendamentos`)

- Lookup só por telefone (`POST /api/client/appointments`) — **sempre retorna 200**, mesmo se o telefone não existir, para não permitir enumeração de números.
- 3 seções: **próximos / passados / cancelados**.
- Cliente pode remarcar (mostra popup com horário antigo vs novo) ou cancelar o próprio agendamento — isso dispara `client_cancel` nas notificações, diferenciado do cancelamento feito pela dona do estúdio.
- Login formal futuro: `customers.email`/`customers.password_hash` (nullable) — a tabela `client_accounts` foi removida na migration 003 (nunca foi usada em runtime).

---

## Segurança já implementada

- CORS restrito por `ALLOWED_ORIGINS` (não é `*`).
- Rate limiting: `/api/auth` (20 req/15min) e `/api/client` (10 req/min) via `express-rate-limit`.
- JWT obrigatório nas rotas admin (`requireAuth`), com fallback pra bot via header `apikey`/`x-api-key` == `BOT_API_KEY`.
- RLS no Postgres por `tenant_id` (ver seção Multi-tenancy).
- `app.set('trust proxy', 1)` pro rate limiting funcionar certo atrás do proxy do Railway.
- Servidor recusa subir sem `JWT_SECRET` definido (`process.exit(1)` no boot).

---

## Estrutura real de pastas

```
studio-nails/
├── src/
│   ├── lib/
│   │   ├── supabase.js         # não usado mais em runtime — pode ser removido
│   │   └── api.ts              # cliente HTTP pra API Express própria (fetch('/api/...'))
│   ├── pages/
│   │   ├── Booking.tsx         # agendamento público (/book/:slug)
│   │   ├── Admin.tsx           # painel da dona do estúdio (/:slug/admin)
│   │   ├── Services.tsx        # CRUD de serviços (/:slug/admin/services)
│   │   ├── Login.tsx           # login admin
│   │   ├── Setup.tsx           # onboarding de novo estúdio (/setup)
│   │   └── MyAppointments.tsx  # área da cliente (/meus-agendamentos)
│   ├── theme/terra.ts
│   └── App.tsx
├── server/
│   ├── schema.sql              # schema Postgres (instalações novas — via docker-entrypoint-initdb.d)
│   ├── migrations/             # migrations manuais p/ bancos existentes (001..003)
│   └── src/
│       ├── index.ts            # bootstrap Express, CORS, rate limit, rotas
│       ├── db.ts                # pool pg
│       ├── utils.ts             # resolveTenant(slug)
│       ├── middleware/auth.ts   # requireAuth, botAuth
│       ├── lib/
│       │   ├── whatsapp.ts          # sendText/notifyAppt/notifyClient via UazAPI + grava em messages
│       │   └── scheduledNotifs.ts   # cron jobs (resumos + lembrete por reminder_date)
│       └── routes/
│           ├── auth.ts          # setup, login, change-password
│           ├── appointments.ts
│           ├── services.ts
│           ├── slots.ts         # wrapper de available_slots()
│           ├── config.ts        # tenant_config (público + admin)
│           ├── blocks.ts        # time_blocks
│           ├── clientAuth.ts    # lookup da cliente por telefone
│           └── dashboard.ts
├── n8n/                         # fluxos exportados (bot, lembrete, resumo semanal)
├── docker-compose.yaml         # postgres + n8n + redis + studio-api + studio-frontend
└── Claude.md                   # este arquivo
```

---

## Convenções de código

- Componentes React: PascalCase, `.tsx`
- Datas no banco: `YYYY-MM-DD` (`DATE`); horários: `HH:MM:SS` (`TIME`)
- Telefones armazenados sem formatação, com `55` + DDD + número (ex: `5571999990001`); exibidos com máscara `(71) 99999-0001`
- Toda query ao Postgres via `pool.query` dentro de `server/src/`; erros tratados com try/catch por rota
- Slugs de estúdio: só minúsculas, números e hífen (`/^[a-z0-9-]+$/`)

---

## Variáveis de ambiente (nomes — valores reais em `.env`/`server/.env`, gitignorados)

```bash
# server/.env
DATABASE_URL=
API_PORT=
JWT_SECRET=
BOT_API_KEY=
ALLOWED_ORIGINS=
SITE_BASE_URL=
UAZAPI_URL=
UAZAPI_TOKEN=
UAZAPI_INSTANCE=

# .env (raiz, docker-compose)
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
N8N_PORT=
N8N_ENCRYPTION_KEY=
N8N_BASIC_AUTH_ACTIVE=
N8N_BASIC_AUTH_USER=
N8N_BASIC_AUTH_PASSWORD=
TIMEZONE=America/Sao_Paulo
```

---

## Observações importantes

- **Dona do estúdio não é técnica** — painel precisa ser simples e funcionar bem no celular.
- **Volume baixo por estúdio** (~5-8 clientes/dia) — free tiers / recursos modestos são suficientes.
- **Sem sábado/domingo por padrão** — mas isso agora é configurável por estúdio (`studio_config.work_days`), então não trate como regra fixa no código.
- `src/lib/supabase.js` está órfão (não é chamado por nada em runtime) — candidato a remoção quando alguém for limpar dependências.
- `bot_sessions` existe no schema mas o fluxo conversacional real do bot roda hoje via n8n, não via essa tabela diretamente — confirmar antes de assumir que ela está em uso ativo.

---

## Como isso diverge do plano original

Este arquivo já foi uma vez um plano pré-código pra um projeto single-tenant com Supabase + Evolution API. O que mudou, na prática:
- Supabase (Postgres gerenciado + API REST automática) → **Postgres self-hosted + Express próprio**, porque deu mais controle sobre RLS multi-tenant e lógica de negócio.
- Evolution API → **UazAPI** pra WhatsApp.
- Projeto single-tenant (só a Michele) → **multi-tenant** com onboarding self-service em `/setup`.
- Lembretes/resumos → não dependem só do n8n, viraram cron jobs nativos no backend (mais confiável, menos peça-de-infra pra manter no ar).

Se você (Claude) encontrar código ou comentários que ainda referenciam Supabase RPC, Evolution API, ou "um único estúdio", trate como desatualizado e prefira o que está de fato implementado em `server/src/` e `server/schema.sql`.
