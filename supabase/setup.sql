-- Ejecutá esto en Supabase → SQL Editor → New query → Run
-- Una sola fila guarda todo el torneo (nombre, partidos, resultados).

create table if not exists public.dls_state (
  id text primary key default 'main',
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.dls_state enable row level security;

-- La clave "anon" va en el front: estas reglas permiten leer/escribir a usuarios anónimos.
-- Cualquiera con tu URL + anon key podría editar: no publiques el repo con datos sensibles
-- o reforzá después con Auth / claves por torneo.

create policy "anon_select_dls" on public.dls_state for select to anon using (true);
create policy "anon_insert_dls" on public.dls_state for insert to anon with check (true);
create policy "anon_update_dls" on public.dls_state for update to anon using (true) with check (true);

-- Fila inicial (opcional; la app también puede crearla con upsert)
insert into public.dls_state (id, data, updated_at)
values ('main', '{}', now())
on conflict (id) do nothing;
