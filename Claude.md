# CLAUDE.md — Studio da Michele · Handoff para Claude Code

> Cole este arquivo na raiz do projeto. O Claude Code vai ler automaticamente ao iniciar cada sessão.

---

## Contexto do projeto

Sistema completo de agendamento para uma manicure chamada **Michele**, construído do zero.
O objetivo é substituir a agenda de papel dela por um sistema com três partes integradas:

1. **Página de agendamento** — cliente acessa pelo link da bio do Instagram e agenda sozinha
2. **Painel admin** — Michele vê a agenda no celular/desktop como um calendário
3. **Bot do WhatsApp** — cliente manda mensagem normal, bot responde, agenda e lembra

---

## Stack definitivo

| Camada | Tecnologia | Motivo |
|---|---|---|
| Frontend (agendamento + painel) | React + Vite | Simples, rápido |
| Banco de dados | Supabase (PostgreSQL) | API REST automática, realtime, gratuito |
| Bot WhatsApp | Evolution API (self-hosted) | Open source, gratuito, integração n8n nativa |
| Automação / orquestração | n8n (self-hosted Railway) | Visual, gratuito, tem node do Evolution API |
| Hosting frontend | Vercel | Free tier, deploy automático |
| Hosting infra (n8n + Evolution) | Railway | Free tier suficiente pro volume dela |

**Custo total: R$ 0/mês** no free tier. Railway cobra só se ultrapassar os limites (improvável pra uma manicure).

---

## Regras de negócio — CRÍTICO, leia com atenção

### Serviços e durações

| id | Serviço | Duração | Preço |
|----|---------|---------|-------|
| 1 | Esmaltação Completa | 90 min | R$ 40 |
| 2 | Pé Normal | 40 min | R$ 25 |
| 3 | Mão Normal | 45 min | R$ 20 |
| 4 | Banho de Gel | 150 min (2h30) | R$ 80 |
| 5 | Alongamento em Gel | 180 min (3h) | R$ 120 |

### Horários de funcionamento
- **Dias:** Segunda a Sexta apenas (sem sábado, sem domingo)
- **Horário:** 09:00 às 18:00
- **Slots:** de 30 em 30 minutos
- **Último slot possível:** depende da duração do serviço. Ex: Alongamento (3h) → último slot é 15:00 (termina às 18:00)

### Lógica de bloqueio de horários
- Quando um serviço é agendado, ele bloqueia todos os slots seguintes que caem dentro da sua duração
- Exemplo: Banho de Gel (2h30) agendado às 10:00 → bloqueia 10:00, 10:30, 11:00, 11:30, 12:00 (termina 12:30)
- A função `available_slots(date, service_id)` no Supabase já implementa isso corretamente
- No frontend, ao selecionar serviço + data, chamar essa função para mostrar só os horários livres

### Fluxo do bot (EXATO — não simplificar)
```
Cliente:   "oi michele, tem horario pra segunda?"
Bot:       "Oi! Qual serviço você quer fazer, meu bem? 😊
           1. Esmaltação Completa (1h30) - R$40
           2. Pé Normal (40min) - R$25
           3. Mão Normal (45min) - R$20
           4. Banho de Gel (2h30) - R$80
           5. Alongamento em Gel (3h) - R$120"

Cliente:   "banho de gel" (ou "4" ou "gel")
Bot:       "Certo! Para segunda, {data}, tenho esses horários disponíveis:
           🕐 09:00 | 13:00 | 15:00
           Qual você prefere?"

Cliente:   "13h" (ou "13:00" ou "da tarde")
Bot:       "Perfeito! Só confirmar seu nome completo 😊"

Cliente:   "Ana Lima"
Bot:       "Agendado, Ana! ✅
           📅 Segunda, {data}
           🕐 13:00 → 15:30
           ✨ Banho de Gel
           💰 R$ 80
           Vou te lembrar 2 dias antes, tá? 💅"

[2 dias antes, automático]
Bot:       "Oi Ana! Lembrando do seu agendamento amanhã:
           ✨ Banho de Gel às 13:00
           Qualquer coisa é só falar! 💅"
```

### Identificação de serviço no bot
O bot deve reconhecer variações informais:
- "esmaltação", "esmalte", "normal" → serviço 1
- "pé", "pezinho" → serviço 2
- "mão", "mãozinha" → serviço 3
- "gel", "banho de gel", "banho" → serviço 4
- "alongamento", "fibra", "unhas de fibra" → serviço 5

Usar prompt de classificação via Claude API ou simplesmente `ilike` com wildcards no n8n.

---

## O que já foi construído

### ✅ Página de agendamento (`/src/pages/Booking.jsx`)
- 5 passos: Serviço → Data → Horário → Dados → Confirmar
- Bloqueio de horários por duração (lógica local com mock data)
- Chips de resumo flutuantes
- Tela de sucesso com botão WhatsApp
- **TODO:** Substituir mock data por chamadas ao Supabase (`available_slots`)

### ✅ Painel admin (`/src/pages/Admin.jsx`)
- Visão semana e dia
- Blocos coloridos por serviço, altura proporcional à duração
- Linha do horário atual
- Cards de stats (atendimentos, faturamento, horas)
- Modal de detalhes com ação WhatsApp e cancelar
- **TODO:** Substituir mock data por Supabase, adicionar realtime subscription

### ✅ Schema Supabase (`/supabase/schema.sql`)
- Tabelas: `services`, `clients`, `appointments`
- View: `appointments_full` (join completo)
- Function: `available_slots(date, service_id)` — retorna slots livres
- Function: `create_appointment(...)` — upsert cliente + insere agendamento
- Triggers: `updated_at` automático
- RLS habilitado

---

## O que falta construir — próximas tasks

### Task 1 — Setup do projeto
```bash
npm create vite@latest studio-michele -- --template react
cd studio-michele
npm install @supabase/supabase-js react-router-dom
```
Criar `.env`:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxx
```
Criar `/src/lib/supabase.js`:
```js
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

### Task 2 — Conectar página de agendamento ao Supabase
- Substituir `getSlots()` local pela chamada `supabase.rpc('available_slots', { p_date, p_service_id })`
- Na confirmação, chamar `supabase.rpc('create_appointment', { ... })`
- Tratar erros: slot já ocupado (race condition), horário fora do expediente

### Task 3 — Conectar painel admin ao Supabase
- Substituir mock data por:
  ```js
  supabase.from('appointments_full').select('*').gte('date', weekStart).lte('date', weekEnd)
  ```
- Adicionar realtime:
  ```js
  supabase.channel('appointments').on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, handleChange).subscribe()
  ```
- Cancelar agendamento: `supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id)`

### Task 4 — Deploy Evolution API no Railway
1. Criar novo projeto no Railway
2. Deploy via template: `https://railway.app/template/evolution-api`
3. Configurar variáveis de ambiente:
   - `AUTHENTICATION_API_KEY` = chave aleatória forte
   - `DATABASE_PROVIDER` = postgresql (usar o Postgres do próprio Railway)
4. Criar instância: `POST /instance/create` com `{ "instanceName": "michele", "qrcode": true }`
5. Escanear QR com WhatsApp Business da Michele
6. Guardar `instanceName` e `apikey` para o n8n

### Task 5 — Deploy n8n no Railway
1. Railway → New Project → Deploy from template → n8n
2. Variáveis necessárias:
   - `N8N_ENCRYPTION_KEY` = string aleatória
   - `WEBHOOK_URL` = URL pública do Railway
3. Criar credentials no n8n:
   - Supabase: URL + service role key
   - Evolution API: URL + API key

### Task 6 — Fluxo n8n: receber mensagem e responder
Nodes em ordem:
```
[Evolution API Trigger]
      ↓
[IF] → mensagem de texto? (ignorar audio, imagem, etc)
      ↓ sim
[Code] → normalizar texto (lower, trim)
      ↓
[IF] → tem sessão ativa para esse número?
      ↓ não                    ↓ sim
[Set] iniciar sessão     [Switch] qual etapa da sessão?
      ↓                         ↓
[Evolution API]          (etapas abaixo)
enviar menu de serviços
```

Etapas da sessão (guardar em memória n8n ou tabela `bot_sessions` no Supabase):
- `WAITING_SERVICE` → classificar serviço → pedir data/dia
- `WAITING_DATE` → parsear data (hoje, amanhã, segunda, dd/mm) → buscar slots livres
- `WAITING_SLOT` → confirmar slot → pedir nome
- `WAITING_NAME` → salvar → confirmar agendamento → limpar sessão

### Task 7 — Fluxo n8n: lembrete automático
```
[Schedule Trigger] → todo dia às 08:00
      ↓
[Supabase] → SELECT * FROM appointments_full
             WHERE date = CURRENT_DATE + 2
               AND status = 'confirmed'
               AND reminder_sent = false
      ↓
[Loop] para cada agendamento:
      ↓
[Evolution API] → enviar mensagem de lembrete
      ↓
[Supabase] → UPDATE appointments SET reminder_sent = true WHERE id = ?
```

### Task 8 — Proteção do painel admin
- Adicionar Supabase Auth (email + senha para Michele)
- Rota `/admin` protegida por `<PrivateRoute>`
- Michele faz login uma vez, fica autenticada

### Task 9 — Deploy do frontend na Vercel
```bash
npm run build
vercel --prod
```
- Configurar variáveis de ambiente na Vercel
- Domínio customizado (opcional): `agendamichele.com.br`

---

## Estrutura de pastas sugerida

```
studio-michele/
├── public/
├── src/
│   ├── lib/
│   │   └── supabase.js          # cliente Supabase
│   ├── pages/
│   │   ├── Booking.jsx          # página pública de agendamento
│   │   ├── Admin.jsx            # painel da Michele
│   │   └── Login.jsx            # login da Michele
│   ├── components/
│   │   ├── ApptBlock.jsx        # bloco de agendamento no calendário
│   │   ├── ApptModal.jsx        # modal de detalhes
│   │   └── WeekStats.jsx        # cards de resumo semanal
│   ├── hooks/
│   │   └── useAppointments.js   # hook com query + realtime
│   └── App.jsx
├── supabase/
│   └── schema.sql               # rodar uma vez no Supabase SQL editor
├── .env                         # nunca commitar
├── .env.example
└── CLAUDE.md                    # este arquivo
```

---

## Convenções de código

- Componentes React: PascalCase, arquivo `.jsx`
- Hooks customizados: camelCase prefixado com `use`
- Todas as datas no banco em formato ISO: `YYYY-MM-DD`
- Horários no banco em formato `HH:MM:SS` (tipo `time` do PostgreSQL)
- Telefones armazenados sem formatação: `5571999990001`
- Telefones exibidos com máscara: `(71) 99999-0001`
- Sempre tratar erros do Supabase com `const { data, error } = await supabase...`

---

## Variáveis de ambiente necessárias

```bash
# Supabase
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Só no n8n (não expor no frontend)
SUPABASE_SERVICE_ROLE_KEY=
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE_NAME=michele
```

---

## Ordem recomendada de execução

1. Rodar `schema.sql` no Supabase SQL Editor
2. Setup do projeto Vite + instalar dependências
3. Conectar Booking.jsx ao Supabase
4. Conectar Admin.jsx ao Supabase + realtime
5. Deploy Evolution API no Railway + conectar WhatsApp
6. Deploy n8n no Railway + configurar credentials
7. Montar fluxo do bot no n8n (Task 6)
8. Montar fluxo de lembrete no n8n (Task 7)
9. Adicionar auth no painel (Task 8)
10. Deploy na Vercel (Task 9)

---

## Observações importantes

- **Michele não é técnica** — o painel precisa ser simples e funcionar no celular dela
- **Volume baixo** — ela atende em torno de 5-8 clientes por dia, free tiers são suficientes
- **WhatsApp Business** — ela já tem e usa, não precisa trocar de número
- **Sem sábado/domingo** — validar no frontend E no backend (a função `available_slots` já valida)
- **Race condition nos slots** — dois clientes podem tentar o mesmo horário ao mesmo tempo. A função `create_appointment` não tem lock ainda — considerar `SELECT FOR UPDATE` ou unique constraint em `(date, start_time)` para agendamentos confirmados

---

*Gerado em sessão de planejamento. Última atualização: estrutura completa pré-código.*
