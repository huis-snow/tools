# 작은 도구함

설치 없이 브라우저에서 바로 사용하는 작은 웹 도구들을 모아두는 GitHub Pages 저장소입니다.

## 도구

- [반듯표](./table-maker/) — 한글·전각 문자를 지원하는 ASCII 테이블 생성기
- [언제표](./schedule-maker/) — 가능한 시간을 공유하고, 받은 일정을 저장·수정·취합하는 주간 일정표
- [언제표 취합](./schedule-maker/compare.html) — 여러 사람의 언제표 링크에서 겹치는 시간을 찾는 도구
- [꾸준표](./habit-maker/) — 목표량과 실천 정도를 기록하는 월간 습관 캘린더
- [공대표](./raid-maker/) — 주직업과 부직업 우선순위로 파이널판타지14 8인 공대를 구성하는 도구
- [하루기록](./daily-log/) — 식사·음주·컨디션과 메모를 날짜별로 남기는 생활 기록 달력

## 새 도구 추가

1. 저장소 루트에 새 도구 폴더를 만듭니다.
2. 폴더 안에 독립적으로 실행되는 `index.html`을 둡니다.
3. 루트 `index.html`의 `.tool-grid`에 해당 도구 카드를 추가합니다.

```text
/
├── index.html
├── hub.css
├── .nojekyll
├── table-maker/
├── schedule-maker/
├── habit-maker/
├── raid-maker/
├── daily-log/
└── next-tool/
```

GitHub Pages의 배포 원본은 `main` 브랜치의 `/ (root)`로 설정합니다.
