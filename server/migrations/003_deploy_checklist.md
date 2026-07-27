# Checklist de deploy — Migration 003 (reestruturação B2B2C)

A migration renomeia tabelas que a API antiga usa, então **migration e deploy da API nova
têm que sair na mesma janela**. Ordem:

## Antes (ensaio obrigatório)

- [ ] `pg_dump` de produção → restore num banco de teste
- [ ] Rodar `psql "$TEST_DATABASE_URL" -f server/migrations/003_restructure.sql` — deve terminar em COMMIT
- [ ] Rodar os checks comentados no fim da migration (services JSONB sem nulos, zero órfãos,
      zero phones duplicados, available_slots retorna, RLS de customers com tenant errado retorna 0)
- [ ] Dimensionar a fusão de customers: `SELECT phone, COUNT(*) FROM clients GROUP BY phone HAVING COUNT(*) > 1;`
      (nomes divergentes ficam com o da linha mais antiga; o próximo booking atualiza)

## Janela de deploy

- [ ] Backup de produção (`pg_dump`)
- [ ] `psql "$DATABASE_URL" -f server/migrations/003_restructure.sql`
- [ ] Deploy da API + frontend novos (mesma janela — a API antiga quebra com as tabelas renomeadas)
- [ ] Smoke no tenant da Michele: login admin (token antigo ainda funciona via fallback de claims),
      agenda do dia, um booking de teste multi-serviço, cancelar o booking de teste

## n8n (logo depois)

- [ ] Editar o node **"Identificar estúdio"** do fluxo v5: `FROM studios` → `FROM tenants`
      (manter os aliases `AS studio_id/studio_slug/studio_name`). Até lá, a view compat
      `studios` criada pela migration segura o bot.
- [ ] Depois de editar o node: `DROP VIEW studios;`
- [ ] **Desativar/arquivar o fluxo `lembrete.json`** (legado Supabase) — o cron do backend agora
      marca `reminder_sent`; rodar os dois duplicaria lembretes
- [ ] `bot_sessions` não mudou — nada a fazer no restante do fluxo

## Depois

- [ ] Conferir `SELECT direction, kind, status FROM messages ORDER BY created_at DESC LIMIT 10;`
      após o primeiro booking — outbound sendo gravadas
- [ ] Em ~7 dias (expiração dos JWT antigos): remover o fallback de claims `studio_id`/`studio_slug`
      em `server/src/middleware/auth.ts`
