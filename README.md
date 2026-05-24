# Office Oasis · 바탕화면 대청소

직장인의 바탕화면을 **진짜로** 청소해 주는 데스크톱 유틸리티.
거대 파일 · 묵은 파일 · 스크린샷 잔해 · 임시 파일 · 중복 파일 · 빈 폴더를
한 번에 찾아내고 휴지통으로 보냅니다. 모든 분석은 본인 PC에서만.

- **Stack**: Electron · React · Vite · Tailwind v4 · electron-builder · electron-updater
- **License**: MIT
- **Sites**: 랜딩 (Vercel) + 바이너리 (GitHub Releases) + 자동 빌드 (GitHub Actions)

## 사용자

설치 방법은 [INSTALL.md](./INSTALL.md) 참조.

## 개발

```bash
npm install
npm run dev
```

→ Vite + Electron 동시 실행. 코드 수정 시 HMR 적용.

빌드:
```bash
npm run build        # Vite 번들만
npm run dist         # 현재 OS 용 인스톨러 (release/ 폴더에 출력)
npm run dist:win     # Windows 인스톨러
```

## 배포 (1회 셋업)

### 1단계: GitHub 리포 만들기

```bash
# 1) https://github.com/new 에서 'office-oasis' 리포 생성 (공개로)
# 2) 로컬 코드를 푸시
git remote add origin https://github.com/<YOUR_USERNAME>/office-oasis.git
git push -u origin main
```

### 2단계: 코드에서 placeholder 교체

`jaeseong98` 을 본인 GitHub 사용자명으로 일괄 치환해야 합니다:

```bash
# package.json, web/index.html, INSTALL.md 등에 들어있음
git grep -l 'jaeseong98' | xargs sed -i 's/jaeseong98/<YOUR_USERNAME>/g'
git commit -am "chore: replace github username placeholder"
git push
```

(Windows PowerShell이라면 텍스트 에디터의 "전체 폴더 검색·치환" 기능을 쓰세요.)

### 3단계: Vercel에 랜딩 페이지 연결

1. https://vercel.com → GitHub 로그인 → **Add New → Project**
2. `office-oasis` 리포 선택
3. **Output Directory** 가 자동으로 `web` 으로 잡힘 (vercel.json 덕분)
4. **Deploy** → 60초 뒤 `https://office-oasis-xxxxx.vercel.app` 발급

이후 `git push` 마다 자동 재배포.

### 4단계: 첫 릴리즈 만들기

```bash
git tag v0.1.0
git push origin v0.1.0
```

→ GitHub Actions가 자동으로:
1. Windows · macOS · Linux 러너에서 동시 빌드
2. `release/` 폴더의 인스톨러를 GitHub Releases v0.1.0 에 업로드
3. 랜딩 페이지의 "Download" 버튼이 이 릴리즈를 가리키도록 자동 갱신

**소요 시간**: 약 8~12분 (3개 OS 빌드).

### 다음 릴리즈

```bash
# package.json 의 version 을 0.2.0 으로 올리고 커밋
git commit -am "release: v0.2.0"
git tag v0.2.0
git push && git push origin v0.2.0
```

기존 사용자의 앱이 시작될 때 자동 업데이트 알림이 뜹니다.

## 코드 서명 (선택)

서명되지 않은 앱은 Windows SmartScreen / macOS Gatekeeper에서 경고가 나옵니다.
경고 없는 매끈한 설치 경험을 원한다면:

- **Windows**: 코드 서명 인증서 (DigiCert/Sectigo, 연 20만 원~) → `CSC_LINK`, `CSC_KEY_PASSWORD` GitHub Secrets에 등록
- **macOS**: Apple Developer Program (연 13만 원) + 공증(notarization) → `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` GitHub Secrets

자세한 설정은 [electron-builder code signing 문서](https://www.electron.build/code-signing.html) 참조.

## 폴더 구조

```
.
├── web/                          # 랜딩 페이지 (Vercel 배포 대상)
│   ├── index.html
│   └── styles.css
├── .github/workflows/
│   └── release.yml               # 태그 푸시 시 자동 빌드 + 릴리즈 업로드
├── electron/
│   ├── main.cjs                  # 스캐너 + IPC + auto-updater
│   └── preload.cjs               # contextBridge
├── scripts/
│   └── run-electron.cjs          # ELECTRON_RUN_AS_NODE 우회 런처
├── src/
│   ├── App.jsx                   # 청소 대시보드 (React)
│   ├── main.jsx
│   └── index.css
├── package.json                  # electron-builder + publish 설정
├── vercel.json                   # 랜딩 페이지 배포 설정
└── vite.config.js
```
