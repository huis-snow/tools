import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  FieldPath,
  deleteDoc,
  deleteField,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js";

const core = globalThis.EonjepyoOnlineCore;

if (!core) throw new Error("온라인 방 데이터 모듈을 불러오지 못했습니다.");

function publicFirebaseConfig(config) {
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
  };
}

export async function createFirebaseRoomStore(config) {
  if (!core.firebaseConfigReady(config)) {
    throw new Error("Firebase 웹 설정이 아직 연결되지 않았습니다.");
  }

  const app = initializeApp(publicFirebaseConfig(config), "eonjepyo-online-room");
  if (String(config.appCheckSiteKey || "").trim()) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(String(config.appCheckSiteKey).trim()),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const auth = getAuth(app);
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (_error) {
    // 저장소가 제한된 브라우저에서도 현재 탭의 익명 로그인은 계속 시도한다.
  }
  await auth.authStateReady();
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  const database = getFirestore(app);

  function roomReference(roomId) {
    return doc(database, "rooms", core.validateRoomId(roomId));
  }

  async function createRoom(value) {
    const room = core.normalizeRoomDraft(value);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const roomId = core.createRoomId();
      try {
        await setDoc(roomReference(roomId), {
          ...room,
          ownerUid: user.uid,
          locked: false,
          responses: {},
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return roomId;
      } catch (error) {
        lastError = error;
        if (error?.code !== "permission-denied") throw error;
      }
    }
    throw lastError || new Error("온라인 방 주소를 만들지 못했습니다.");
  }

  function subscribeRoom(roomId, onValue, onError) {
    const normalizedId = core.validateRoomId(roomId);
    return onSnapshot(
      roomReference(normalizedId),
      { includeMetadataChanges: true },
      (snapshot) => {
        try {
          if (!snapshot.exists() && snapshot.metadata.fromCache) {
            onValue({
              room: null,
              missingFromCache: true,
              fromCache: true,
              hasPendingWrites: snapshot.metadata.hasPendingWrites,
            });
            return;
          }
          onValue(snapshot.exists()
            ? {
                room: core.normalizeRoomSnapshot(snapshot.data(), normalizedId),
                fromCache: snapshot.metadata.fromCache,
                hasPendingWrites: snapshot.metadata.hasPendingWrites,
              }
            : null);
        } catch (error) {
          onError?.(error);
        }
      },
      onError,
    );
  }

  async function saveResponse(roomId, value) {
    const response = core.normalizeResponse(value);
    await updateDoc(
      roomReference(roomId),
      new FieldPath("responses", user.uid),
      {
        ...response,
        updatedAt: serverTimestamp(),
      },
    );
  }

  async function removeResponse(roomId, uid = user.uid, options = {}) {
    const targetUid = String(uid || "");
    if (!targetUid || targetUid.length > 128) throw new Error("삭제할 참여자 정보가 올바르지 않습니다.");
    if (targetUid === user.uid && options.asOwner !== true) {
      await updateDoc(
        roomReference(roomId),
        new FieldPath("responses", targetUid),
        deleteField(),
      );
      return;
    }
    await updateDoc(
      roomReference(roomId),
      new FieldPath("responses", targetUid),
      deleteField(),
      "updatedAt",
      serverTimestamp(),
    );
  }

  async function updateRoom(roomId, changes) {
    const update = { updatedAt: serverTimestamp() };
    if (Object.prototype.hasOwnProperty.call(changes, "locked")) update.locked = changes.locked === true;
    if (Object.prototype.hasOwnProperty.call(changes, "title")) {
      update.title = core.normalizeRoomDraft({
        title: changes.title,
        timezone: "Asia/Seoul",
        startHour: 0,
        startDay: 0,
      }).title;
    }
    await updateDoc(roomReference(roomId), update);
  }

  async function removeRoom(roomId) {
    await deleteDoc(roomReference(roomId));
  }

  return {
    user,
    createRoom,
    subscribeRoom,
    saveResponse,
    removeResponse,
    updateRoom,
    removeRoom,
  };
}
