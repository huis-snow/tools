# 비스표 Firebase 연결

비스표는 기존 언제표와 같은 Firebase 프로젝트와 공개 웹 설정을 사용합니다. 서비스 계정 키나 관리자 비공개 키는 필요하지 않습니다.

## 기존 프로젝트에 추가하기

1. Firebase Authentication의 `Google`과 `Anonymous` 로그인을 계속 활성화한 상태로 둡니다.
2. [`firebase-config.js`](./firebase-config.js)에 기존 웹 앱의 `apiKey`, `authDomain`, `projectId`, `appId`, App Check 사이트 키를 사용합니다. 이 값은 브라우저용 공개 식별자입니다.
3. 저장소 루트의 [`firestore.rules`](../firestore.rules)와 [`firestore.indexes.json`](../firestore.indexes.json)을 배포합니다.

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Firebase Console에서 직접 작업한다면 보안 규칙 전체를 **Firestore Database → Rules**에 게시하고, 다음 복합 색인을 추가합니다.

```text
Collection ID: bisRooms
Query scope: Collection
ownerUid: Ascending
createdAt: Descending
```

`bisRooms` 컬렉션과 각 방의 `members` 하위 컬렉션은 첫 방을 만들 때 자동으로 생성되므로 Console에서 미리 만들 필요가 없습니다.

## 보안 규칙이 강제하는 내용

- Google 계정으로만 8인 명단과 새 방 생성
- 추측하기 어려운 22자 방 ID를 아는 로그인 사용자만 방 읽기
- 8개 고정 자리 문서를 방과 함께 원자적으로 생성·삭제
- 익명 공대원은 빈 자리 하나만 선점하고 같은 UID로만 수정
- 장비 상태는 11개 고정 부위, 드랍 분배는 13개 고정 종류로 검증
- 입력 마감 중 공대원 수정 거절
- 방장만 입력 마감·자리 연결 해제·분배 저장·방 삭제

링크를 아는 사람은 공대원 닉네임·직업·장비 현황·저장된 분배안을 볼 수 있으므로 링크를 공개 게시물에 올리지 않는 것이 좋습니다.
