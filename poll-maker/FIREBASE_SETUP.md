# 익명 투표소 Firebase 연결

익명 투표소는 GitHub Pages 같은 정적 사이트에서 Firebase Web SDK로 Authentication과 Cloud Firestore에 직접 연결합니다. 별도의 애플리케이션 서버나 서비스 계정 키는 필요하지 않습니다.

기존 언제표·비스표·공대 파밍표와 같은 Firebase 프로젝트를 사용할 수 있습니다. 데이터는 별도 `pollRooms` 컬렉션에 저장되므로 다른 앱의 방과 섞이지 않습니다.

## 1. 공개 웹 설정 연결

Firebase Console의 **프로젝트 설정 → 내 앱 → 웹 앱**에 표시되는 값을 [`firebase-config.js`](./firebase-config.js)에 넣습니다.

```js
root.AnonymousPollFirebaseConfig = Object.freeze({
  apiKey: "콘솔의 apiKey",
  authDomain: "콘솔의 authDomain",
  projectId: "콘솔의 projectId",
  appId: "콘솔의 appId",
  appCheckSiteKey: "reCAPTCHA Enterprise 사이트 키 또는 빈 문자열",
});
```

`apiKey`, `authDomain`, `projectId`, `appId`와 App Check 사이트 키는 브라우저용 **공개 웹 설정**입니다. GitHub 공개 저장소에 커밋해도 Firebase 관리자 권한을 주는 비밀키가 아닙니다. 데이터 접근은 Authentication, Firestore Rules와 App Check로 제한합니다. 필요하다면 Google Cloud Console에서 API 키의 허용 웹 리퍼러와 사용 API도 제한할 수 있습니다.

`private_key`가 들어 있는 서비스 계정 JSON, Admin SDK 키, 관리자 비밀번호는 브라우저 소스나 저장소에 절대 넣지 마세요. 이 앱은 그런 키를 입력받지도 사용하지도 않습니다. 실수로 커밋했다면 파일만 삭제하지 말고 키를 즉시 폐기·교체합니다.

## 2. Google 로그인과 익명 로그인 활성화

1. Firebase Console의 **Authentication → Sign-in method**에서 `Google` 공급자를 활성화하고 지원 이메일을 선택합니다.
2. 같은 화면에서 `Anonymous(익명)` 공급자를 활성화합니다.
3. **Authentication → Settings → Authorized domains**에 배포 도메인을 추가합니다.
   - GitHub Pages: `huis-snow.github.io`
   - 로컬 확인: `localhost`
   - 사용자 지정 도메인을 연결했다면 해당 도메인

Google 로그인은 방 생성과 내 방 목록·결과 확인·마감 관리에 사용합니다. 참여자는 공유 링크를 열면 Firebase가 브라우저별 익명 UID를 만들기 때문에 Google 로그인이나 이름 입력이 필요하지 않습니다. 같은 브라우저에서 방장이 직접 투표하면 Google 계정의 Firebase UID로 자기 선택을 저장할 수 있습니다.

## 3. Firestore Rules와 인덱스 배포

Firebase Console에서 **Firestore Database**를 먼저 만듭니다. 데이터베이스 위치는 주 사용자와 가까운 지역을 고르며, 만든 뒤에는 바꾸기 어렵습니다.

Firebase CLI를 사용한다면 저장소 루트에서 전체 규칙과 인덱스를 함께 배포합니다.

```bash
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

[`firebase.json`](../firebase.json)이 [`firestore.rules`](../firestore.rules)와 [`firestore.indexes.json`](../firestore.indexes.json)의 경로를 지정합니다. 보안 규칙은 GitHub Pages에 파일을 푸시하는 것만으로 배포되지 않으므로, 규칙을 수정한 뒤에는 위 명령을 다시 실행해야 합니다.

Firebase Console에서 직접 설정하려면 다음을 적용합니다.

1. **Firestore Database → Rules**에 저장소의 `firestore.rules` 전체 내용을 붙여 넣고 게시합니다.
2. **Firestore Database → Indexes → Composite**에 아래 복합 인덱스를 만듭니다.

```text
Collection ID: pollRooms
Query scope: Collection
ownerUid: Ascending
updatedAt: Descending
```

인덱스가 `Building` 또는 `색인 생성 중`이면 완료될 때까지 내 투표방 목록 조회가 실패할 수 있습니다. `pollRooms`, `ballots`, `votes` 컬렉션은 첫 방과 첫 투표를 저장할 때 자동으로 생성되므로 Console에서 미리 만들 필요가 없습니다.

## 4. 보안 규칙이 강제하는 내용

배포된 규칙은 화면의 버튼 표시와 별개로 Firestore 서버에서 다음을 검사합니다.

- 인증되지 않은 요청 거부
- Google 계정만 방 생성과 마감 상태 변경 허용
- Google 방장은 자신이 만든 최근 방만 최대 30개 조회
- 정확한 22자 무작위 방 ID를 아는 인증 사용자만 단일 안건 읽기
- 방을 만든 뒤 안건·설명·결과 공개 범위·방장 UID 변경 거부
- 투표가 열린 동안 자신의 UID와 같은 개별 투표 문서만 생성·수정
- 개별 투표 문서 목록 조회 거부, 다른 참여자와 방장의 개별 선택 읽기 거부
- 선택을 `agree`, `reject`, `neutral` 중 하나로 제한
- 첫 투표에 22자 무작위 투표 키를 요구하고, 선택 변경 때 같은 키를 유지하도록 강제
- 개별 투표 변경과 `ballots/current`의 해당 투표 키 하나만 같은 원자적 쓰기로 강제
- 첫 투표는 키 하나의 추가만, 선택 변경은 같은 키 하나의 값 변경만 허용하며 다른 키의 추가·수정·삭제 거부
- 투표함을 최대 100개의 무작위 키로 제한
- `ballots/current` 읽기는 방장에게 항상 허용하고, 새 방의 `resultVisibility` 값에 따라 링크 참여자 전체 또는 투표 문서가 있는 참여자에게도 허용
- 공개 범위 값이 없는 기존 버전 방은 계속 방장만 투표함을 읽도록 처리
- 앱은 읽은 투표함을 선택지별 합계로 표시하며 별도의 숫자 집계 문서는 저장하지 않음
- 클라이언트의 방·투표함·개별 투표 문서 삭제 거부

이 구조는 UID와 연결된 다른 사람의 선택 문서를 읽지 못하게 합니다. 다만 결과 열람 권한자는 이름·UID가 없는 가명 키별 선택 원본을 읽을 수 있고, Firebase 프로젝트 소유자·관리자는 Console이나 Admin SDK로 모든 원본 문서를 확인할 수 있습니다.

기본 앱은 투표방을 닫거나 다시 여는 기능만 제공하고 삭제는 제공하지 않습니다. 운영 중 방을 완전히 지워야 한다면 Firebase 프로젝트 관리자가 Console 또는 신뢰할 수 있는 관리자 환경에서 방의 `votes`, `ballots`, 상위 방 문서를 함께 정리합니다. Admin SDK 비밀키를 브라우저 앱에 넣어 삭제 기능을 만들면 안 됩니다.

## 5. 데이터 구조

```text
pollRooms/{22자 무작위 roomId}
  version                새 방 2, 공개 범위 없는 기존 방 1
  agenda                 안건
  description            안건 부연 설명
  resultVisibility       public | voters | owner
  ownerUid               Google 방장 Firebase UID
  locked                 마감 여부
  createdAt
  updatedAt

  ballots/current
    votes
      {22자 무작위 ballotKey}  agree | reject | neutral
    createdAt
    updatedAt

  votes/{voterUid}
    choice                agree | reject | neutral
    ballotKey             이 방에서만 쓰는 22자 무작위 투표 키
    createdAt
    updatedAt
```

새 방은 `version: 2`로 생성됩니다. 기존 `version: 1` 문서는 `resultVisibility`가 없는 정확한 이전 형식만 허용하며, 결과는 `owner`로 해석합니다. 새 버전에 공개 범위가 없거나 기존 버전에 공개 범위를 임의로 덧붙인 혼합 문서는 거부됩니다.

닉네임, Google 표시 이름과 이메일은 Firestore 투표 문서에 저장하지 않습니다. Firebase Authentication에는 공급자 로그인 처리를 위한 계정 정보가 존재합니다. 결과 열람 권한이 있는 계정은 `ballots/current`의 `무작위 키 → 선택` 원본을 기술적으로 읽을 수 있고 앱 UI는 그 원본을 합계로 변환해 표시합니다. 따라서 전체 공개 방의 링크 방문자, 투표자 공개 방의 투표자, 모든 방의 방장은 브라우저 개발자 도구나 Firebase SDK를 직접 사용하면 이름·UID 없는 개별 무작위 키의 선택을 볼 수 있습니다. 다만 UID가 문서 ID인 `votes` 목록은 각 본인 문서만 읽을 수 있어 무작위 키를 특정 참여자 계정과 연결할 수 없습니다. 무작위 키는 `crypto.getRandomValues()`로 방마다 새로 만들며 숫자 집계를 Firestore에 따로 저장하지 않습니다.

익명 참여 상태에서 브라우저 데이터 삭제, 시크릿 창 종료, 다른 프로필·기기 사용 뒤에는 새 익명 UID가 생길 수 있습니다. 따라서 한 사람이 여러 번 투표하는 것을 강하게 막는 공식 선거용 본인 인증 시스템은 아닙니다.

## 6. App Check 설정

공개 배포 뒤에는 Firebase Console의 **App Check**에서 웹 앱을 등록하고 reCAPTCHA Enterprise 사이트 키를 `appCheckSiteKey`에 넣는 것을 권장합니다.

1. **App Check → Apps**에서 웹 앱을 선택합니다.
2. reCAPTCHA Enterprise 공급자를 등록하고 GitHub Pages 도메인과 사용자 지정 도메인을 허용합니다.
3. 사이트 키를 `firebase-config.js`에 넣습니다. 사이트 키 자체는 공개 값입니다.
4. 먼저 App Check 요청 지표에서 정상 토큰이 들어오는지 확인합니다.
5. 확인한 뒤 Firestore 강제 적용을 켭니다.

로컬 개발에서 App Check를 강제하려면 Firebase가 발급한 웹 디버그 토큰을 Console에 등록해야 합니다. 디버그 토큰은 비밀값이므로 공개 저장소에 커밋하지 않습니다. App Check는 자동화된 오용을 줄이는 보조 장치이며, 익명 사용자를 실제 사람 한 명으로 인증하거나 Firestore Rules를 대신하지 않습니다.

정적 웹앱의 Rules만으로는 Google 방장별 방 생성 횟수나 IP별 투표 속도를 제한할 수 없습니다. 공개 이용자가 많아지면 Firebase Console에서 사용량과 예산 알림을 켜고, 더 강한 생성 한도·속도 제한·재귀 삭제가 필요할 때는 검증된 Cloud Function 같은 서버 경계를 추가하세요.

## 7. 연결 확인

저장소 루트에서 정적 서버를 실행합니다.

```bash
python3 -m http.server 8000
```

1. `http://localhost:8000/poll-maker/`에서 Google 로그인 후 투표방을 만듭니다.
2. 다른 브라우저 프로필이나 시크릿 창에서 공유 링크를 열어 익명으로 투표합니다.
3. 공개 범위별 방을 만들어 전체 공개 방은 링크 접속 직후, 투표자 공개 방은 자기 표를 저장한 뒤, 방장 공개 방은 방장 계정에서만 집계가 보이는지 확인합니다.
4. 각 결과 열람 화면에서 참여자가 자기 선택을 바꾸면 이전 항목이 1 감소하고 새 항목이 1 증가하는지 확인합니다.
5. 방장이 마감한 뒤 새 투표와 기존 선택 변경이 거절되는지 확인합니다.
6. 다른 Google 계정도 전체 공개 방은 읽을 수 있지만, 방장 공개 방의 결과와 마감 권한은 얻지 못하는지 확인합니다. 같은 방장 Google 계정으로 로그인하면 **내 투표방** 목록·집계·마감 권한이 보이는지 확인합니다.
