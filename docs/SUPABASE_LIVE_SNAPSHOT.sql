-- Chạy đoạn SQL này 1 lần trong Supabase SQL Editor để bật chế độ CẬP NHẬT REAL-TIME (mỗi 15 giây)
-- mà KHÔNG cần chờ Vercel build lại web mỗi lần dữ liệu NEO nhảy!

create table if not exists public.pori_live_snapshots (
  id text primary key,
  generated_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public.pori_live_snapshots enable row level security;

drop policy if exists "Public can read live snapshots" on public.pori_live_snapshots;
create policy "Public can read live snapshots"
  on public.pori_live_snapshots for select
  using (true);

grant usage on schema public to anon, authenticated, service_role;
grant select on public.pori_live_snapshots to anon, authenticated;
grant all on public.pori_live_snapshots to service_role;
