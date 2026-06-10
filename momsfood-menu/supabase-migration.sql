-- 맘스푸드 식단 미러 — Supabase 스키마
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run

/* ───────── TABLE ───────── */

create table if not exists public.menu_posts (
  id text primary key,                  -- Naver logNo
  title text not null,
  link text not null,
  pub_date timestamptz,
  text_content text,
  image_url text,                       -- Supabase Storage 공개 URL
  original_image_url text,              -- 원본 postfiles/blogfiles URL
  image_path text,                      -- Storage 경로 (예: "224296511624.png")
  created_at timestamptz not null default now()
);

create index if not exists menu_posts_pub_date_idx on public.menu_posts (pub_date desc);

/* ───────── RLS ───────── */

alter table public.menu_posts enable row level security;

-- 누구나 읽기 가능 (공개 식단 정보)
drop policy if exists "menu_posts_select_public" on public.menu_posts;
create policy "menu_posts_select_public" on public.menu_posts
  for select using (true);

-- 쓰기는 service_role 만 (RLS bypass) — anon/authenticated 는 차단
-- (별도 INSERT 정책 안 만들면 service_role 외에는 자동 거부)

/* ───────── STORAGE BUCKET ───────── */

-- 버킷 생성은 SQL 에서 직접 불가 — 아래 둘 중 하나:
--
-- A. Supabase Dashboard → Storage → "New bucket"
--    Name: menu-images
--    Public: ON
--
-- B. SQL 로 (PostgREST 권한 필요할 수 있음, 안 되면 A 로):
--    insert into storage.buckets (id, name, public) values ('menu-images', 'menu-images', true);

-- 공개 읽기 정책 (이미 public bucket 으로 만들면 자동, 안 됐을 때만 적용)
do $$ begin
  begin
    insert into storage.buckets (id, name, public)
      values ('menu-images', 'menu-images', true)
      on conflict (id) do update set public = true;
  exception when others then null;
  end;
end $$;

-- Storage 객체에 대한 공개 SELECT 정책 (이미 있으면 무시)
drop policy if exists "menu_images_public_read" on storage.objects;
create policy "menu_images_public_read" on storage.objects
  for select using (bucket_id = 'menu-images');
