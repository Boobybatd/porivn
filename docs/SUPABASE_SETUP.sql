-- Chạy đoạn SQL này 1 lần duy nhất trong Supabase Dashboard -> SQL Editor
-- Dùng để lưu Danh mục mô phỏng & Lịch sử tác vụ của từng tài khoản Email

create table if not exists public.pori_user_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  positions jsonb not null default '{}'::jsonb,
  cash_vnd bigint not null default 100000000,
  target_capital_vnd bigint not null default 200000000,
  simulations jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.pori_user_workspaces enable row level security;

-- Mỗi người dùng chỉ xem, thêm, sửa dữ liệu của chính tài khoản Email của mình
create policy "Users can view own workspace"
  on public.pori_user_workspaces for select
  using (auth.uid() = user_id);

create policy "Users can insert own workspace"
  on public.pori_user_workspaces for insert
  with check (auth.uid() = user_id);

create policy "Users can update own workspace"
  on public.pori_user_workspaces for update
  using (auth.uid() = user_id);
