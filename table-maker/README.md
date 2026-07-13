# 반듯표

한글·한자·일본어·이모지가 포함되어도 폭이 흐트러지지 않는 브라우저 기반 ASCII 테이블 생성기입니다.

## 기능

- 한글/CJK/전각 문자를 터미널 기준 2칸으로 계산
- 결합 문자와 ZWJ 이모지 묶음 처리
- 탭, 쉼표(CSV), 세로줄 구분자 자동 감지
- 둥근 선, 기본 선, 굵은 선, ASCII, Markdown 출력
- 열별 왼쪽/가운데/오른쪽 정렬
- 텍스트 클립보드 복사와 TXT 저장
- Discord에 바로 붙여넣을 수 있는 고해상도 PNG 복사·저장
- 외부 서버 없이 브라우저에서만 데이터 처리

## 실행

빌드 과정이나 패키지 설치 없이 `index.html`을 열면 됩니다. 로컬 서버가 필요하면 다음처럼 실행할 수 있습니다.

```bash
python3 -m http.server 8000
```

테스트는 Node.js 18 이상에서 실행합니다.

```bash
node --test
```

## GitHub Pages 배포

1. 이 폴더를 GitHub 저장소에 push합니다.
2. 저장소의 **Settings → Pages**로 이동합니다.
3. **Deploy from a branch**를 고르고 배포 브랜치의 `/ (root)`를 선택합니다.

모든 파일이 정적 자산이라 별도의 빌드 워크플로는 필요하지 않습니다.

## 글꼴

결과 미리보기의 한글/영문 칸 비율을 맞추기 위해 NAVER의 D2Coding을 포함합니다. 글꼴은 [SIL Open Font License 1.1](fonts/OFL.txt)에 따라 배포됩니다.
