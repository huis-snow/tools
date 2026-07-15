# 공용 기록 보관함

`vault-storage.js`는 빌드나 서버 없이 쓰는 브라우저 저장 계층입니다. 빠른 작업본은 `IndexedDB`에 두고, 사용자가 선택한 JSON 파일을 이식 가능한 백업으로 사용합니다. `IndexedDB`를 열 수 없으면 `localStorage`, 그것도 사용할 수 없으면 현재 탭 메모리로 단계적으로 전환합니다.

## 새 도구 연결

앱 스크립트보다 먼저 공용 스크립트를 불러옵니다.

```html
<link rel="stylesheet" href="../shared/vault-status.css" />
<script src="../shared/vault-storage.js" defer></script>
<script src="../shared/vault-status.js" defer></script>
<script src="app.js" defer></script>
```

기록 앱의 `.site-header`가 있는 페이지는 `vault-status.css`도 불러오면 브라우저 작업본과 파일 동기화 상태를 구분하는 공용 배지가 자동으로 붙습니다.

부팅 시 기존 키 이전을 마친 다음 동기식 `StorageLike`를 앱에 주입합니다. 키는 다른 도구와 겹치지 않도록 `small-tools:도구이름:v1` 형태로 만듭니다.

```js
async function prepareStorage() {
  const fallback = window.localStorage;
  try {
    await SmallToolsVault.ready;
    await SmallToolsVault.migrateKeys(["small-tools:example:v1"], { removeSource: true });
    return SmallToolsVault.storage;
  } catch {
    return fallback;
  }
}
```

`storage`는 `getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`를 제공합니다. 쓰기는 메모리에 즉시 반영되고 실제 영속화는 비동기로 이어지므로, 저장 완료를 표시하거나 페이지를 이동하기 전에는 `await SmallToolsVault.flush()`로 결과를 확인합니다. 다른 탭의 변경과 보관함 전체 교체는 `storage` 이벤트로 전달됩니다.

## 손상 보호와 복원 지점

각 앱은 `데이터 키:recovery`에 처음 읽지 못한 원문을 보존하고, 정상 백업을 복원하거나 사용자가 명시적으로 초기화하기 전까지 해당 데이터의 자동 저장을 잠급니다. 저장소 접근 자체가 실패한 경우와 JSON·스키마 손상은 구분해야 합니다.

보관함 전체 교체와 `storage.clear()` 전에는 복원 지점이 자동으로 만들어집니다. 앱별 삭제·초기화 전에는 다음 API를 먼저 호출합니다.

```js
await SmallToolsVault.createRecoveryPoint("예시 도구 전체 초기화 전");
```

`listRecoveryPoints()`, `restoreRecoveryPoint(id)`, `deleteRecoveryPoint(id)`로 최근 복원 지점 최대 5개를 관리합니다. 복원 지점은 IndexedDB 메타데이터 또는 별도 localStorage 키에 저장되며, 일반 보관함 항목과 JSON·휴대용 텍스트에는 포함하지 않습니다. 복원하면 현재 상태도 새 지점에 보존하고 파일 연결은 해제합니다.

## 파일 형식

- 포맷 이름: `huis-tools-vault`, 버전 1
- 안정적인 `vaultId`, 증가하는 `revision`, ISO 수정 시각
- 도구별 원문 문자열을 담는 `entries`
- 정렬된 payload의 SHA-256 체크섬
- 휴대용 텍스트: gzip 가능한 JSON을 base64url로 만든 `TOOLS1.` 형식

파일과 휴대용 텍스트는 암호화되지 않습니다. 체크섬은 우발적인 손상과 불완전한 파일을 확인하기 위한 값이며 비밀번호나 서명 역할을 하지 않습니다.

네이버 웨일에서는 저장된 `FileSystemHandle`의 권한 재요청 중 브라우저 프로세스가 종료될 수 있고, `showSaveFilePicker()`로 기존 파일을 다시 선택하면 파일이 검증 전에 비워질 수 있습니다. 따라서 File System Access 직접 연결을 비활성화하고 일반 JSON 파일 불러오기·다운로드 방식으로 자동 전환합니다. IndexedDB 작업본은 파일 작업과 별개로 유지됩니다.
