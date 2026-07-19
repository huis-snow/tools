# 언제표 온라인 취합방 Firebase 연결

온라인 취합방은 GitHub Pages에서 Firebase Web SDK로 Cloud Firestore에 직접 연결합니다. 서비스 계정 JSON이나 관리자 비공개 키는 사용하지 않습니다.

## 1. Firebase 프로젝트 만들기

1. [Firebase Console](https://console.firebase.google.com/)에서 새 프로젝트를 만듭니다.
2. 결제 정보가 필요 없는 Spark 요금제를 유지합니다.
3. 프로젝트에 웹 앱을 추가합니다. 별도의 Firebase Hosting 설정은 필요하지 않습니다.
4. 웹 앱 등록 후 표시되는 `firebaseConfig`에서 `apiKey`, `authDomain`, `projectId`, `appId`를 복사합니다.

## 2. 공개 웹 설정 연결하기

[`firebase-config.js`](./firebase-config.js)의 빈 값에 콘솔에서 복사한 공개 웹 설정을 넣습니다.

```js
root.EonjepyoFirebaseConfig = Object.freeze({
  apiKey: "콘솔의 apiKey",
  authDomain: "콘솔의 authDomain",
  projectId: "콘솔의 projectId",
  appId: "콘솔의 appId",
  appCheckSiteKey: "",
});
```

이 설정은 Firebase 프로젝트와 웹 앱을 식별하는 공개 값이므로 GitHub에 커밋해도 됩니다. `private_key`가 들어 있는 서비스 계정 JSON은 만들거나 입력하지 않습니다.

## 3. 익명 로그인 켜기

1. Firebase Console에서 **Authentication → Sign-in method**로 이동합니다.
2. **Anonymous(익명)** 공급자를 활성화합니다.
3. **Settings → Authorized domains**에 다음 도메인을 추가합니다.
   - 배포 사이트: `huis-snow.github.io`
   - 로컬 확인이 필요할 때: `localhost`

참여자에게 로그인 화면은 나타나지 않습니다. Firebase SDK가 브라우저별 익명 UID를 만들고, Firestore Rules가 그 UID로 자기 응답만 수정할 수 있게 검사합니다.

## 4. Firestore와 보안 규칙 연결하기

1. Firebase Console에서 **Firestore Database**를 만듭니다.
2. 데이터베이스 위치는 사용자와 가까운 지역을 고릅니다. 위치는 만든 뒤 바꾸기 어렵습니다.
3. Console의 **Firestore Database → Rules**에 저장소 루트의 [`firestore.rules`](../firestore.rules)를 붙여 넣고 게시합니다.

Firebase CLI를 사용한다면 저장소 루트에서 다음과 같이 배포할 수도 있습니다.

```bash
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

저장소의 [`firebase.json`](../firebase.json)은 Firestore Rules 경로만 관리하며, GitHub Pages 배포 방식에는 영향을 주지 않습니다.

보안 규칙은 다음을 서버에서 강제합니다.

- 로그인하지 않은 요청 거부
- 무작위 방 ID를 정확히 아는 사용자의 단일 방 읽기만 허용
- 전체 방 목록 조회 거부
- 방 생성자만 방 잠금·방 삭제·다른 사람 응답 삭제
- 참여자는 자기 익명 UID에 해당하는 응답만 추가·수정·삭제
- 참여자 최대 8명
- 잠긴 방의 참여자 수정 거부
- 닉네임 60자, 시간대 40자, 시간표 데이터 28자 제한

## 5. 온라인 방 확인하기

정적 서버로 저장소 루트를 연 뒤 다음 페이지를 확인합니다.

```bash
python3 -m http.server 8000
```

```text
http://localhost:8000/schedule-maker/room.html
```

다른 브라우저 프로필이나 시크릿 창에서 복사한 방 링크를 열면 서로 다른 익명 참여자로 테스트할 수 있습니다. 시크릿 창을 닫으면 그 익명 UID의 수정 권한을 잃을 수 있으므로 테스트 응답은 방장 브라우저에서 삭제합니다.

## 6. 무료 운영 전 확인하기

기본 기능과 보안 규칙을 먼저 확인한 다음 Firebase App Check에 웹 앱을 등록하고 reCAPTCHA Enterprise 사이트 키를 `appCheckSiteKey`에 넣을 수 있습니다. 사이트 키는 공개 값입니다.

처음에는 App Check 요청 지표를 확인하고, 정상 요청이 잡히는 것을 확인한 뒤 Firestore 강제 적용을 켭니다. 로컬 개발도 허용해야 하므로 강제 적용 전에 Firebase의 App Check 디버그 공급자 안내를 함께 확인합니다.

방 전체 목록 조회는 보안 규칙으로 막혀 있습니다. 일정이 끝난 방은 방장 화면의 **방 삭제**로 정리하고, 방장 권한이나 링크를 잃었다면 Firebase Console의 `rooms` 컬렉션에서 직접 삭제합니다.

Firestore의 자동 TTL 삭제는 Spark 무료 사용에 포함되지 않아 기본 구성에는 넣지 않았습니다. 공개 배포 뒤에는 Firebase Console의 Firestore **Usage** 화면에서 읽기·쓰기·저장량을 확인해 주세요. 현재 무료 한도와 TTL 과금 여부는 [Firestore 사용량 및 한도](https://firebase.google.com/docs/firestore/quotas)에서 확인할 수 있습니다.

## 데이터 구조

응답은 별도 컬렉션 8개가 아니라 방 문서 하나의 `responses` map에 저장됩니다.

```text
rooms/{22자 무작위 roomId}
  version
  title
  timezone
  startHour
  startDay
  ownerUid
  locked
  createdAt
  updatedAt
  responses
    {anonymousUid}
      nickname
      slots
      updatedAt
```

한 사람의 168칸 선택은 기존 언제표와 같은 21바이트, 28자 base64url 문자열로 저장됩니다.
