-- Chạy đoạn SQL này 1 lần trong Supabase SQL Editor để bật chế độ CẬP NHẬT REAL-TIME (mỗi 30 giây)
-- mà KHÔNG cần chờ Vercel build lại web mỗi lần dữ liệu NEO nhảy!

create table if not exists public.pori_live_snapshots (
  id text primary key,
  generated_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public.pori_live_snapshots enable row level security;

-- Mọi người xem web chỉ được ĐỌC dữ liệu thị trường công khai; chỉ backend (service_role) mới được ghi đè
create policy "Public can read live snapshots"
  on public.pori_live_snapshots for select
  using (true);
