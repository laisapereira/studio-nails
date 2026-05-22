-- ============================================================
-- Studio da Michele — Schema Supabase
-- Execute no SQL Editor do Supabase (uma única vez)
-- ============================================================

-- Extensão necessária para o EXCLUDE (anti-double-booking)
create extension if not exists btree_gist;

-- ── Tabela: services ────────────────────────────────────────
create table if not exists services (
  id       serial primary key,
  name     text          not null,
  duration int           not null,           -- minutos
  price    numeric(10,2) not null,
  color    text          not null default '#d63384',
  emoji    text          not null default '💅',
  active   boolean       not null default true
);

insert into services (name, duration, price, color, emoji) values
  ('Esmaltação Completa', 90,  40.00,  '#ec4899', '💅'),
  ('Pé Normal',           40,  25.00,  '#f97316', '🦶'),
  ('Mão Normal',          45,  20.00,  '#8b5cf6', '✋'),
  ('Banho de Gel',        150, 80.00,  '#06b6d4', '✨'),
  ('Alongamento em Gel',  180, 120.00, '#d63384', '💎')
on conflict do nothing;

-- ── Tabela: clients ─────────────────────────────────────────
create table if not exists clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null unique,   -- formato: "5571999990000"
  created_at timestamptz default now()
);

-- ── Tabela: appointments ────────────────────────────────────
create table if not exists appointments (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  service_id    int  not null references services(id),
  date          date not null,
  start_time    time not null,
  end_time      time not null,
  status        text not null default 'confirmed'
                  check (status in ('pending','confirmed','cancelled','completed')),
  created_via   text not null default 'panel'
                  check (created_via in ('panel','bot','api')),
  reminder_sent boolean not null default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  -- Previne double-booking: dois agendamentos confirmados no mesmo intervalo
  constraint no_overlap exclude using gist (
    date with =,
    tsrange(
      (date::text || ' ' || start_time::text)::timestamp,
      (date::text || ' ' || end_time::text)::timestamp,
      '[)'
    ) with &&
  ) where (status <> 'cancelled')
);

-- ── Tabela: bot_sessions ────────────────────────────────────
-- Estado de cada conversa ativa do bot WhatsApp
create table if not exists bot_sessions (
  phone      text primary key,              -- "5571999990000"
  step       text not null default 'INIT',  -- etapa atual da conversa
  service_id int  references services(id),
  date       date,
  slot_time  time,
  name       text,
  updated_at timestamptz default now()
);

-- ── Trigger: updated_at ─────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger appointments_updated_at
  before update on appointments
  for each row execute function set_updated_at();

create trigger bot_sessions_updated_at
  before update on bot_sessions
  for each row execute function set_updated_at();

-- ── View: appointments_full ─────────────────────────────────
create or replace view appointments_full as
select
  a.id,
  a.date,
  a.start_time,
  a.end_time,
  a.status,
  a.reminder_sent,
  a.created_via,
  a.created_at,
  c.name  as client_name,
  c.phone as client_phone,
  s.id    as service_id,
  s.name  as service_name,
  s.duration  as service_duration,
  s.price     as service_price,
  s.color     as service_color,
  s.emoji     as service_emoji
from appointments a
join clients  c on c.id = a.client_id
join services s on s.id = a.service_id;

-- ── Function: available_slots ───────────────────────────────
-- Retorna slots de 30min disponíveis para um dia e serviço.
-- Chamada pelo frontend: supabase.rpc('available_slots', { p_date, p_service_id })
create or replace function available_slots(p_date date, p_service_id int)
returns table(slot_time time)
language plpgsql security definer as $$
declare
  v_duration int;
  v_dow      int;
  v_slot     time := '09:00';
  v_work_end time := '18:00';
  v_end      time;
begin
  -- Apenas dias úteis (1=Seg … 5=Sex, padrão ISO)
  v_dow := extract(isodow from p_date);
  if v_dow not between 1 and 5 then
    return;
  end if;

  -- Duração do serviço
  select duration into v_duration from services where id = p_service_id;
  if v_duration is null then return; end if;

  -- Percorre slots de 30 em 30 min
  loop
    v_end := v_slot + (v_duration || ' minutes')::interval;
    exit when v_end > v_work_end;

    -- Slot livre se não houver overlap com agendamentos não-cancelados
    if not exists (
      select 1 from appointments
      where date = p_date
        and status <> 'cancelled'
        and tsrange(
              (p_date::text || ' ' || start_time::text)::timestamp,
              (p_date::text || ' ' || end_time::text)::timestamp, '[)'
            ) &&
            tsrange(
              (p_date::text || ' ' || v_slot::text)::timestamp,
              (p_date::text || ' ' || v_end::text)::timestamp, '[)'
            )
    ) then
      slot_time := v_slot;
      return next;
    end if;

    v_slot := v_slot + '30 minutes'::interval;
  end loop;
end;
$$;

-- ── Function: create_appointment ────────────────────────────
-- Upsert do cliente + inserção do agendamento.
-- Chamada pelo frontend: supabase.rpc('create_appointment', { ... })
create or replace function create_appointment(
  p_client_name  text,
  p_phone        text,
  p_service_id   int,
  p_date         date,
  p_start_time   time,
  p_created_via  text default 'panel'
)
returns uuid
language plpgsql security definer as $$
declare
  v_client_id  uuid;
  v_duration   int;
  v_end_time   time;
  v_appt_id    uuid;
begin
  -- Upsert cliente (identifica por telefone)
  insert into clients (name, phone)
  values (p_client_name, p_phone)
  on conflict (phone) do update set name = excluded.name
  returning id into v_client_id;

  -- Calcula horário de fim
  select duration into v_duration from services where id = p_service_id;
  v_end_time := p_start_time + (v_duration || ' minutes')::interval;

  -- Insere agendamento (EXCLUDE vai lançar erro se houver conflito)
  insert into appointments (client_id, service_id, date, start_time, end_time, created_via)
  values (v_client_id, p_service_id, p_date, p_start_time, v_end_time, p_created_via)
  returning id into v_appt_id;

  return v_appt_id;
end;
$$;

-- ── RLS (Row Level Security) ────────────────────────────────
alter table services     enable row level security;
alter table clients      enable row level security;
alter table appointments enable row level security;
alter table bot_sessions enable row level security;

-- Serviços: leitura pública (page de agendamento), escrita só autenticado
create policy "services_read_all"   on services     for select using (true);
create policy "services_write_auth" on services     for all    using (auth.role() = 'authenticated');

-- Clientes: só usuário autenticado (admin) ou service_role (n8n)
create policy "clients_auth"        on clients      for all    using (auth.role() = 'authenticated');

-- Agendamentos: insert via anon (RPC create_appointment), resto autenticado
create policy "appts_insert_anon"   on appointments for insert  with check (true);
create policy "appts_read_auth"     on appointments for select  using (auth.role() = 'authenticated');
create policy "appts_update_auth"   on appointments for update  using (auth.role() = 'authenticated');

-- Bot sessions: service_role (n8n usa service key)
create policy "bot_sessions_service" on bot_sessions for all using (auth.role() = 'service_role');

-- A view herda as policies das tabelas base; concede acesso ao anon para
-- que o frontend possa ler (via service definer functions)
grant select on appointments_full to anon, authenticated;
grant execute on function available_slots(date, int)    to anon, authenticated;
grant execute on function create_appointment(text, text, int, date, time, text) to anon, authenticated;
