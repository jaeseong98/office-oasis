-- Office Oasis · 팀 공유 노트 (workspaces / pages / members)
-- 한 번에 전체 복사해서 Supabase SQL Editor 에 붙여넣고 실행하세요.

create extension if not exists "pgcrypto";

/* ───────── TABLES ───────── */

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists workspaces_invite_code_idx on public.workspaces (invite_code);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  nickname text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')) default 'editor',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index if not exists members_workspace_idx on public.members (workspace_id);
create index if not exists members_user_idx on public.members (user_id);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default '제목 없음',
  body text not null default '',
  order_idx int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_nickname text
);
create index if not exists pages_workspace_idx on public.pages (workspace_id);

/* ───────── RLS HELPERS ───────── */

alter table public.workspaces enable row level security;
alter table public.members    enable row level security;
alter table public.pages      enable row level security;

create or replace function public.is_member(ws_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

create or replace function public.member_role(ws_id uuid)
returns text
language sql
security definer
stable
as $$
  select role from public.members
  where workspace_id = ws_id and user_id = auth.uid()
  limit 1;
$$;

/* ───────── POLICIES ───────── */

-- workspaces
drop policy if exists "workspaces_select" on public.workspaces;
create policy "workspaces_select" on public.workspaces
  for select using (public.is_member(id));

drop policy if exists "workspaces_insert" on public.workspaces;
create policy "workspaces_insert" on public.workspaces
  for insert with check (auth.uid() = created_by);

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner" on public.workspaces
  for update using (public.member_role(id) = 'owner');

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner" on public.workspaces
  for delete using (public.member_role(id) = 'owner');

-- members
drop policy if exists "members_select" on public.members;
create policy "members_select" on public.members
  for select using (public.is_member(workspace_id));

drop policy if exists "members_self_insert" on public.members;
create policy "members_self_insert" on public.members
  for insert with check (user_id = auth.uid());

drop policy if exists "members_self_update" on public.members;
create policy "members_self_update" on public.members
  for update using (user_id = auth.uid());

drop policy if exists "members_owner_update" on public.members;
create policy "members_owner_update" on public.members
  for update using (public.member_role(workspace_id) = 'owner');

drop policy if exists "members_self_delete" on public.members;
create policy "members_self_delete" on public.members
  for delete using (user_id = auth.uid());

drop policy if exists "members_owner_delete" on public.members;
create policy "members_owner_delete" on public.members
  for delete using (public.member_role(workspace_id) = 'owner');

-- pages
drop policy if exists "pages_select" on public.pages;
create policy "pages_select" on public.pages
  for select using (public.is_member(workspace_id));

drop policy if exists "pages_insert_editor" on public.pages;
create policy "pages_insert_editor" on public.pages
  for insert with check (public.member_role(workspace_id) in ('owner', 'editor'));

drop policy if exists "pages_update_editor" on public.pages;
create policy "pages_update_editor" on public.pages
  for update using (public.member_role(workspace_id) in ('owner', 'editor'));

drop policy if exists "pages_delete_editor" on public.pages;
create policy "pages_delete_editor" on public.pages
  for delete using (public.member_role(workspace_id) in ('owner', 'editor'));

/* ───────── RPC: 워크스페이스 생성 ───────── */

create or replace function public.create_workspace(
  p_name text,
  p_nickname text
)
returns table(workspace_id uuid, invite_code text)
language plpgsql
security definer
as $$
declare
  v_ws_id uuid;
  v_code text;
  v_attempt int := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- 고유 코드 생성 (충돌 시 재시도)
  loop
    v_attempt := v_attempt + 1;
    v_code := upper(
      substring(md5(random()::text || clock_timestamp()::text || v_attempt::text), 1, 4) || '-' ||
      substring(md5(random()::text || clock_timestamp()::text || v_attempt::text), 5, 4)
    );
    exit when not exists(select 1 from public.workspaces where invite_code = v_code) or v_attempt > 5;
  end loop;

  insert into public.workspaces (name, invite_code, created_by)
  values (p_name, v_code, auth.uid())
  returning id into v_ws_id;

  insert into public.members (workspace_id, user_id, nickname, role)
  values (v_ws_id, auth.uid(), p_nickname, 'owner');

  return query select v_ws_id, v_code;
end;
$$;

grant execute on function public.create_workspace to authenticated, anon;

/* ───────── RPC: 초대 코드로 참여 ───────── */

create or replace function public.join_workspace_by_code(
  p_invite_code text,
  p_nickname text
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select id into v_workspace_id from public.workspaces where invite_code = upper(p_invite_code);
  if v_workspace_id is null then
    raise exception 'invalid_code';
  end if;

  insert into public.members (workspace_id, user_id, nickname)
  values (v_workspace_id, auth.uid(), p_nickname)
  on conflict (workspace_id, user_id) do update set
    nickname = excluded.nickname,
    last_seen_at = now();

  return v_workspace_id;
end;
$$;

grant execute on function public.join_workspace_by_code to authenticated, anon;

/* ───────── REALTIME ───────── */

alter publication supabase_realtime add table public.workspaces;
alter publication supabase_realtime add table public.pages;
alter publication supabase_realtime add table public.members;
