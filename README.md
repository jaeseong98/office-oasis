# 바탕화면 대청소 · Office Oasis

직장인의 어수선한 바탕화면을 **드래그&드롭으로 던져 넣으면 젤리처럼 떨어지는** 인터랙티브 정리 웹앱.

- Frontend: **React + Vite**
- Styling: **Tailwind CSS v4**
- Physics: **Matter.js**
- Icons: **lucide-react**
- Storage: **LocalStorage** (백엔드 없음, 100% 정적 호스팅 가능)

## 핵심 기능

| 기능 | 동작 |
| --- | --- |
| 드래그 앤 드롭 | 데스크톱 파일을 캔버스로 끌어다 놓으면 사각 블록으로 떨어짐 |
| 자동 분류 | 떨어뜨린 X 좌표에 따라 🔥 당장 할 일 / 🥶 컨펌 대기 / 🗑️ 퇴사시 삭제 |
| 마우스 드래그 | 쌓인 블록을 잡아서 흔들거나 던질 수 있음 |
| 상사 감지 모드 | `Space` 키 또는 우상단 버튼으로 평범한 엑셀 표 뷰로 즉시 전환 (Esc로 해제) |
| 영속성 | 새로고침해도 파일 메타데이터가 LocalStorage에 저장되어 블록이 복원됨 |
| 다운로드 | 엑셀 뷰에서 같은 세션 내 파일을 다시 다운로드 가능 |

> ⚠️ 새로고침 후에는 원본 파일 바이너리(Blob)가 사라지므로 다운로드는 같은 세션 내에서만 가능합니다. 메타데이터(이름·용량·분류)는 그대로 유지됩니다.

## 로컬 개발

```bash
npm install
npm run dev
```

`http://localhost:5173` 접속.

## 빌드

```bash
npm run build
npm run preview
```

빌드 결과는 `dist/` 폴더에 생성됩니다.

## Vercel에 무료 배포 (자동)

가장 빠른 방법은 **GitHub → Vercel** 연동입니다. 한 번 연결하면 이후 `git push` 할 때마다 자동으로 재배포됩니다.

### 1) GitHub 리포 만들고 푸시

```bash
git init
git add .
git commit -m "feat: office-oasis MVP"
git branch -M main

# https://github.com/new 에서 빈 리포를 만들고 URL을 복사한 뒤:
git remote add origin https://github.com/<YOUR_NAME>/office-oasis.git
git push -u origin main
```

### 2) Vercel에 연결

1. https://vercel.com 가입/로그인 (GitHub 계정으로 한 번에 가입 가능)
2. **Add New → Project** 클릭
3. 위에서 푸시한 `office-oasis` 리포 선택 → **Import**
4. Framework Preset이 자동으로 **Vite**로 잡힘
   - Build Command: `npm run build` (자동)
   - Output Directory: `dist` (자동)
5. **Deploy** 클릭 → 약 30~60초 뒤 `https://office-oasis-<해시>.vercel.app` URL 발급

이후 `git push` 한 번이면 Vercel이 자동으로 새 빌드를 만들어 같은 URL에 배포합니다 (Production). PR 브랜치는 Preview URL이 따로 발급됩니다.

### (선택) Vercel CLI로 한 줄 배포

```bash
npm i -g vercel
vercel login
vercel        # Preview 배포
vercel --prod # 프로덕션 배포
```

## 비용

- Vercel Hobby 플랜: **무료** (월 100GB 대역폭, 정적 호스팅 무제한)
- 백엔드/스토리지 비용: **0원** (LocalStorage만 사용)

## 폴더 구조

```
.
├── index.html
├── package.json
├── vite.config.js          # Tailwind v4 플러그인 등록
├── vercel.json             # SPA rewrite 설정
└── src/
    ├── main.jsx
    ├── index.css           # Tailwind import + 글로벌 스타일
    └── App.jsx             # Matter.js 캔버스 + UI 통합 컴포넌트
```
