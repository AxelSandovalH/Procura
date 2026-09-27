-- Límite de solicitudes (ventana fija) sin infraestructura extra: un contador por clave en Postgres.
-- Solo se accede por app.rate_limit_hit (SECURITY DEFINER); procura_app no toca la tabla.
create table if not exists rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0
);
alter table rate_limits enable row level security;
alter table rate_limits force row level security;

create or replace function app.rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns table (allowed boolean, remaining int, retry_after int)
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int; v_start timestamptz;
begin
  insert into rate_limits as r (key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    count        = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end
  returning r.count, r.window_start into v_count, v_start;
  return query select v_count <= p_max, greatest(p_max - v_count, 0),
    greatest(ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::int, 1);
end
$$;

-- Limpieza de ventanas vencidas (la llama el cron).
create or replace function app.rate_limit_gc()
returns int
language sql security definer
set search_path = public
as $$
  with d as (delete from rate_limits where window_start < now() - interval '1 day' returning 1) select count(*)::int from d
$$;

revoke all on function app.rate_limit_hit(text, int, int) from public;
revoke all on function app.rate_limit_gc() from public;
grant execute on function app.rate_limit_hit(text, int, int) to procura_app;
grant execute on function app.rate_limit_gc() to procura_app;
