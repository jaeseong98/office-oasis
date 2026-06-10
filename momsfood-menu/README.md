# 맘스푸드 식단 미러

[blog.naver.com/momsfood_](https://blog.naver.com/momsfood_) 의 주간식단표를 Supabase 에 미러링하고
Vercel 정적 페이지로 공개하는 사이드 프로젝트.

## 동작 원리

```
[Vercel Cron · 매일 23:00 UTC]
        ↓
   /api/sync 호출
        ↓
   Naver RSS → 식단 게시물 추림
        ↓
   DB 에 없는 logNo 만:
     · PostView.naver 에서 원본 이미지 URL 추출 (postfiles/blogfiles)
     · 이미지 fetch → Supabase Storage 업로드
     · menu_posts 테이블에 INSERT
        ↓
   [브라우저] → /api/cafeteria → DB 조회 → JSON 응답
        ↓
   index.html 렌더 → Storage 의 공개 이미지 URL 직접 로드
```

## 사이트 구조

| 경로 | 종류 | 설명 |
|------|------|------|
| `/` | 정적 HTML | 이번 주 식단 + 과거 이력 리스트 |
| `/api/cafeteria` | 서버리스 (read) | DB 조회. stale 시 sync 자동 트리거 |
| `/api/sync` | 서버리스 (write) | RSS → DB 동기화. cron 으로 자동 호출 |

## 1회 셋업

### 1) Supabase 마이그레이션
[supabase-migration.sql](./supabase-migration.sql) 을 Supabase SQL Editor 에 붙여넣고 실행:
```
https://supabase.com/dashboard/project/svefzwjnduykzwwuuknt/sql/new
```
- `menu_posts` 테이블 생성
- RLS: 누구나 read 가능, write 는 service_role 만
- `menu-images` 스토리지 버킷 (public)

### 2) Storage 버킷 확인
Dashboard → Storage → `menu-images` 버킷이 public 으로 만들어졌는지 확인.
SQL 로 안 만들어졌다면 직접 생성:
- New bucket → Name: `menu-images` → Public: ON

### 3) Vercel 프로젝트 생성

1. https://vercel.com → Add New → Project
2. `jaeseong98/office-oasis` 리포 import
3. **Root Directory** 를 `momsfood-menu` 로 설정 ← 핵심
4. Framework Preset: Other (자동 감지됨)
5. **Environment Variables** 추가:
   - `SUPABASE_URL` = `https://svefzwjnduykzwwuuknt.supabase.co`
   - `SUPABASE_ANON_KEY` = (Supabase Settings → API → anon public 키)
   - `SUPABASE_SERVICE_ROLE_KEY` = (Supabase Settings → API → service_role 키, **민감**)
6. Deploy

### 4) 첫 sync 트리거
배포 직후 DB 비어 있음. 한 번 수동으로:
```
https://<your-project>.vercel.app/api/sync
```
이후로는 매일 23:00 UTC (=한국 08:00) Vercel cron 이 자동 호출.

## 환경 변수

| 이름 | 값 | 용도 |
|------|----|----|
| `SUPABASE_URL` | `https://svefzwjnduykzwwuuknt.supabase.co` | 공개, 코드에 박혀도 OK |
| `SUPABASE_ANON_KEY` | (anon JWT) | 공개, 읽기 전용 |
| `SUPABASE_SERVICE_ROLE_KEY` | (service JWT) | **민감 · 서버 전용**. RLS 우회 가능 |

## 로컬 개발

Vercel CLI 로:
```bash
npm install -g vercel
cd momsfood-menu
vercel link
vercel env pull .env.local
vercel dev
```

## 폴더 구조

```
momsfood-menu/
├── api/
│   ├── cafeteria.js     # 읽기 엔드포인트
│   └── sync.js          # 동기화 엔드포인트
├── lib/
│   ├── naver.js         # RSS·블로그 크롤링 헬퍼
│   └── supabase.js      # Supabase 클라이언트
├── index.html           # 정적 페이지
├── styles.css
├── vercel.json          # cron 설정
├── package.json
└── supabase-migration.sql
```

## 알려진 한계

- **Vercel Hobby cron**: 하루 1회 제한. 더 자주 갱신하려면 Pro 필요 또는 외부 cron 서비스 (cron-job.org 등) 로 `/api/sync` 호출.
- **Naver 차단 가능성**: User-Agent + Referer 만으로 충분히 잘 동작하지만, 트래픽 너무 많으면 차단될 수 있음. 현재 cron 1회/일 정도면 문제 없음.
- **이미지 보존**: 블로그 글이 삭제되어도 Supabase Storage 에는 남음. 원본 보존 효과.
