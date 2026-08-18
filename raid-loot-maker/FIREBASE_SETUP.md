# 공대 파밍표 Firebase 연결

공대 파밍표는 GitHub Pages 같은 정적 사이트에서 Firebase Web SDK로 Authentication과 Cloud Firestore에 직접 연결합니다. 별도의 애플리케이션 서버는 필요하지 않으며, 실제 접근 권한은 저장소의 Firestore 보안 규칙이 제한합니다.

기존 언제표·비스표와 같은 Firebase 프로젝트를 사용해도 됩니다. 공대 파밍표는 별도 `raidLootRooms` 컬렉션을 사용하므로 기존 방 데이터와 섞이지 않습니다.

## 1. 공개 웹 설정 연결

Firebase Console에서 **프로젝트 설정 → 내 앱 → 웹 앱**을 열고 [`firebase-config.js`](./firebase-config.js)에 다음 값을 넣습니다.

```js
root.RaidLootFirebaseConfig = Object.freeze({
  apiKey: "콘솔의 apiKey",
  authDomain: "콘솔의 authDomain",
  projectId: "콘솔의 projectId",
  appId: "콘솔의 appId",
  appCheckSiteKey: "reCAPTCHA Enterprise 사이트 키 또는 빈 문자열",
});
```

`apiKey`, `authDomain`, `projectId`, `appId`와 App Check 사이트 키는 브라우저가 Firebase 앱을 식별하기 위한 **공개 웹 설정**입니다. GitHub 공개 저장소에 커밋되어도 Firebase 관리자 권한을 주는 비밀키가 아닙니다. 데이터 보호는 Authentication, Firestore Rules와 App Check로 수행합니다. 필요하다면 Google Cloud Console에서 API 키의 허용 웹 리퍼러와 사용 API도 제한할 수 있습니다.

`private_key`가 들어 있는 서비스 계정 JSON, Admin SDK 키, 관리자 비밀번호는 브라우저 소스나 저장소에 절대 넣지 마세요. 이 앱은 그런 키를 입력받지도, 필요로 하지도 않습니다. 실수로 커밋했다면 파일만 지우지 말고 해당 키를 즉시 폐기·교체해야 합니다.

## 2. Google 로그인과 익명 로그인 활성화

Firebase Console에서 다음 항목을 설정합니다.

1. **Authentication → Sign-in method**에서 `Google` 공급자를 활성화하고 지원 이메일을 선택합니다.
2. 같은 화면에서 `Anonymous(익명)` 공급자를 활성화합니다.
3. **Authentication → Settings → Authorized domains**에 배포 도메인을 추가합니다.
   - GitHub Pages: `huis-snow.github.io`
   - 로컬 확인: `localhost`
   - 사용자 지정 도메인을 연결했다면 그 도메인도 추가

Google 로그인은 방 생성자와 관리자 권한에 사용합니다. 참여자는 공유 링크를 열 때 Firebase가 만든 브라우저별 익명 UID로 접속하므로 Google 계정이 필요하지 않습니다. 익명 상태에서 Google 로그인을 시작하면 가능한 경우 계정을 연결해 같은 UID를 유지하고, 이미 다른 Firebase 계정에 연결된 Google 계정이면 앱이 계정 전환 여부를 안내합니다.

## 3. Firestore Rules와 인덱스 배포

Firebase Console에서 **Firestore Database**를 먼저 만듭니다. 데이터베이스 위치는 주 사용자가 가까운 지역을 고르며, 생성 뒤에는 바꾸기 어렵습니다.

Firebase CLI를 사용한다면 저장소 루트에서 다음 명령을 실행합니다.

```bash
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

[`firebase.json`](../firebase.json)이 [`firestore.rules`](../firestore.rules)와 [`firestore.indexes.json`](../firestore.indexes.json)의 경로를 지정합니다. 이 배포 명령은 기존 앱의 규칙과 인덱스를 포함한 **저장소의 전체 정의**를 게시합니다.

Console에서 직접 설정하려면 다음을 적용합니다.

1. **Firestore Database → Rules**에 저장소의 `firestore.rules` 전체 내용을 붙여 넣고 게시합니다.
2. **Firestore Database → Indexes → Composite**에 아래 복합 인덱스를 만듭니다.

```text
Collection ID: raidLootRooms
Query scope: Collection
ownerUid: Ascending
updatedAt: Descending
```

인덱스가 `Building` 또는 `색인 생성 중`이면 완료될 때까지 내 방 목록 조회가 실패할 수 있습니다. `members.seat`, `events.createdAt` 정렬은 단일 필드 인덱스로 처리되므로 별도의 복합 인덱스가 필요하지 않습니다.

`raidLootRooms`, `members`, `events` 컬렉션은 첫 방과 기록을 저장할 때 자동으로 생성됩니다. Firestore 데이터 화면에서 미리 빈 컬렉션을 만들 필요는 없습니다.

## 4. 보안 규칙이 강제하는 내용

배포된 규칙은 화면의 버튼 표시와 무관하게 Firestore 서버에서 다음을 검사합니다.

- 인증되지 않은 요청 거부
- Google 계정만 방 생성·설정 변경·드랍 기록·방 삭제 허용
- Google 방장은 자신이 소유한 최근 방만 최대 30개 조회
- 정확한 22자 무작위 방 ID를 아는 로그인 사용자만 단일 방과 그 하위 데이터 읽기
- 방 생성 시 8개의 고정 자리 문서를 같은 배치로 생성
- 익명 참여자는 빈 자리 하나만 선점하고 같은 UID로 그 자리의 장비 상태만 수정
- 잠긴 방의 참여자 수정 거부, 방장만 자리 연결 해제
- 1~8주차, 1~4층, 17개 드랍 종류, 장비 부위와 직접 드랍 직업 조합 검증
- 이벤트 작성자는 방장 UID여야 하며, 저장된 이벤트의 수정 거부
- 되돌리기는 같은 방의 기존 `award` 또는 `skip`을 가리키는 새 `undo` 이벤트로만 생성
- 이벤트와 공대원 문서는 방 전체 삭제 배치에서만 직접 삭제

보안 규칙을 바꾼 뒤에는 GitHub Pages 파일만 배포해서는 적용되지 않습니다. 반드시 Rules를 다시 게시하거나 위 Firebase CLI 배포 명령을 실행해야 합니다.

## 5. App Check 설정

이 앱은 `ReCaptchaEnterpriseProvider`를 사용합니다. 공개 배포 후에는 Firebase Console의 **App Check**에서 웹 앱을 등록하고 reCAPTCHA Enterprise 사이트 키를 `appCheckSiteKey`에 넣는 것을 권장합니다.

1. Firebase Console **App Check → Apps**에서 해당 웹 앱을 선택합니다.
2. reCAPTCHA Enterprise 공급자를 등록하고 GitHub Pages 도메인과 사용자 지정 도메인을 허용합니다.
3. 발급된 사이트 키를 `firebase-config.js`의 `appCheckSiteKey`에 넣습니다. 사이트 키 자체는 공개 값입니다.
4. 먼저 App Check 요청 지표에서 정상 토큰이 들어오는지 확인합니다.
5. 확인 뒤 Firestore에 강제 적용을 켭니다.

강제 적용을 너무 먼저 켜면 도메인 설정이 빠진 배포 사이트나 로컬 개발 요청까지 거절됩니다. `localhost`에서 개발할 때는 Firebase App Check의 웹 디버그 공급자로 발급한 디버그 토큰을 Console에 등록하고, 그 토큰은 공개 저장소에 커밋하지 마세요. 설정하지 않을 동안에는 `appCheckSiteKey`를 빈 문자열로 두면 앱이 App Check를 초기화하지 않습니다.

App Check는 자동화된 오용을 줄이는 보조 장치이며 로그인이나 Firestore Rules를 대신하지 않습니다.

## 6. 데이터 구조와 개인정보

```text
raidLootRooms/{22자 무작위 roomId}
  version
  title
  tier
  startDate            1주차 시작일, YYYY-MM-DD
  currentWeek          1 … 8
  ownerUid             Google 방장 Firebase UID
  locked
  policy               분배 정책과 8자리 우선순위
  createdAt
  updatedAt

  members/{MT|ST|MH|SH|D1|D2|D3|D4}
    seat
    nickname
    job
    editorUid          이 자리를 연결한 익명 또는 Google UID
    gear               11개 부위를 나타내는 11자 상태 코드
    submitted
    createdAt
    updatedAt

  events/{22자 무작위 eventId}
    award               주차·층·드랍·수령자·부위·결정 방식·공정성 집계 여부
    또는 skip           주차·층·드랍·미배정 사유
    또는 undo           취소할 기존 eventId
    createdBy           Google 방장 Firebase UID
    createdAt
```

Google 표시 이름과 이메일은 위 Firestore 문서에 저장하지 않습니다. Firebase Authentication에는 공급자 로그인 처리를 위한 계정 정보가 존재하며, Firestore에는 권한 판별용 UID만 저장합니다. 방 링크를 아는 인증 사용자는 닉네임, 직업, 장비 상태와 드랍 이력을 볼 수 있으므로 실명이나 민감한 내용을 입력하지 않고 공유 링크를 비공개로 전달하는 편이 좋습니다.

이벤트는 수정 가능한 결과표가 아니라 append-only 원장입니다. 잘못된 `award`나 `skip`은 원문을 고치지 않고 그 ID를 가리키는 `undo`를 추가하며, 화면의 누적 통계는 취소되지 않은 활성 이벤트만 계산합니다.

모든 동작을 합친 이벤트 수는 방마다 최대 **480개**입니다. 이 제한 덕분에 방 삭제 시 이벤트 480개, 공대원 8개와 방 1개, 총 489개 삭제를 Firestore의 단일 500개 쓰기 배치에 담을 수 있습니다. 상한에 가까워진 방은 필요한 내역을 보관한 뒤 새 방을 만들어 이어서 사용하세요.

## 7. 연결 확인

저장소 루트에서 정적 서버를 실행합니다.

```bash
python3 -m http.server 8000
```

1. `http://localhost:8000/raid-loot-maker/`에서 Google 로그인 후 방을 만듭니다.
2. 다른 브라우저 프로필이나 시크릿 창에서 개인 입력 링크를 열어 익명 참여자로 자리를 저장합니다.
3. 방장 화면에서 실제 드랍을 기록하고, 되돌린 뒤 누적 통계가 원래대로 돌아오는지 확인합니다.
4. 다른 기기에서 같은 Google 계정으로 로그인해 **내 공대 파밍방** 목록과 관리 권한을 확인합니다.

시크릿 창을 닫거나 브라우저 데이터를 지우면 익명 UID의 자리 수정 권한을 잃을 수 있습니다. 테스트 후에는 방장 화면에서 해당 자리 연결을 해제하거나 방을 삭제하세요.
