# Office Oasis 설치 가이드

## 다운로드

- **Windows**: [OfficeOasis-Setup.exe](https://github.com/jaeseong98/office-oasis/releases/latest/download/OfficeOasis-Setup.exe)
- **macOS**: [OfficeOasis.dmg](https://github.com/jaeseong98/office-oasis/releases/latest/download/OfficeOasis.dmg)
- **Linux**: [OfficeOasis.AppImage](https://github.com/jaeseong98/office-oasis/releases/latest/download/OfficeOasis.AppImage)

또는 [최신 릴리즈 페이지](https://github.com/jaeseong98/office-oasis/releases/latest)에서 직접 받기.

---

## Windows

1. `OfficeOasis-Setup.exe` 다운로드 후 실행
2. **"Windows의 PC 보호" 화면이 나옵니다** — 코드 서명되지 않은 인디 앱이라 SmartScreen이 한 번 멈춥니다.

   ![smartscreen]

   → **"추가 정보"** 클릭 → **"실행"** 버튼

3. 설치 마법사 진행 → 설치 위치 선택 → 완료
4. 시작 메뉴에 "Office Oasis" 등록, 바탕화면 바로가기 생성 (옵션)

> 한 번 실행한 뒤로는 SmartScreen이 다시 안 뜹니다.

## macOS

1. `OfficeOasis.dmg` 다운로드 후 더블클릭
2. Office Oasis 아이콘을 Applications 폴더로 드래그
3. **첫 실행 시 "확인되지 않은 개발자" 차단** — 코드 서명·공증되지 않아 Gatekeeper가 막습니다.

   → Applications 폴더에서 Office Oasis를 **우클릭** → **"열기"** → 경고 창에서 **"열기"** 클릭

4. 다음부터는 일반 앱처럼 더블클릭으로 실행

## Linux

1. `OfficeOasis.AppImage` 다운로드
2. 실행 권한 부여:
   ```bash
   chmod +x OfficeOasis.AppImage
   ```
3. 실행: `./OfficeOasis.AppImage`

---

## 권한

처음 실행 시 다음 폴더에 접근합니다 (사용자 데이터를 외부로 전송하지 않습니다):

- 바탕화면 (Desktop)
- 다운로드 (Downloads)
- 문서 (Documents)
- 사용자가 직접 추가한 폴더

모든 분석은 본인 PC에서만 일어나고, 파일을 삭제할 때는 **실제 삭제가 아닌 휴지통 이동**입니다 (복원 가능).

## 자동 업데이트

새 버전이 GitHub Releases에 올라오면 앱이 시작될 때 자동 감지·다운로드합니다. "재시작" 알림이 뜨면 한 번 누르면 적용됩니다.

## 제거

- **Windows**: 설정 → 앱 → "Office Oasis" → 제거
- **macOS**: Applications 폴더에서 휴지통으로 드래그
- **Linux**: `.AppImage` 파일 삭제
