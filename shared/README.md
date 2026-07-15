# 공용 기록 보관함

`vault-storage.js`는 빌드나 서버 없이 쓰는 브라우저 저장 계층입니다. 빠른 작업본은 `IndexedDB`에 두고, 사용자가 선택한 JSON 파일을 이식 가능한 백업으로 사용합니다. `IndexedDB`를 열 수 없으면 `localStorage`, 그것도 사용할 수 없으면 현재 탭 메모리로 단계적으로 전환합니다.

## 새 도구 연결

앱 스크립트보다 먼저 공용 스크립트를 불러옵니다.

```html
<script src="../shared/vault-storage.js" defer></script>
<script src="app.js" defer></script>
```

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

## 파일 형식

- 포맷 이름: `huis-tools-vault`, 버전 1
- 안정적인 `vaultId`, 증가하는 `revision`, ISO 수정 시각
- 도구별 원문 문자열을 담는 `entries`
- 정렬된 payload의 SHA-256 체크섬
- 휴대용 텍스트: gzip 가능한 JSON을 base64url로 만든 `TOOLS1.` 형식

파일과 휴대용 텍스트는 암호화되지 않습니다. 체크섬은 우발적인 손상과 불완전한 파일을 확인하기 위한 값이며 비밀번호나 서명 역할을 하지 않습니다.

네이버 웨일에서는 저장된 `FileSystemHandle`의 권한 재요청 중 브라우저 프로세스가 종료될 수 있고, `showSaveFilePicker()`로 기존 파일을 다시 선택하면 파일이 검증 전에 비워질 수 있습니다. 따라서 File System Access 직접 연결을 비활성화하고 일반 JSON 파일 불러오기·다운로드 방식으로 자동 전환합니다. IndexedDB 작업본은 파일 작업과 별개로 유지됩니다.
