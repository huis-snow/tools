import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  linkWithPopup,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  FieldPath,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js";

const core = globalThis.EonjepyoOnlineCore;

if (!core) throw new Error("온라인 방 데이터 모듈을 불러오지 못했습니다.");

const GOOGLE_PROVIDER_ID = "google.com";
const OWNED_ROOM_LIMIT = 30;

function publicFirebaseConfig(config) {
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
  };
}

function googleAccount(user) {
  return Boolean(user?.providerData?.some((provider) => provider.providerId === GOOGLE_PROVIDER_ID));
}

function timestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value?.seconds)) {
    return (value.seconds * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
  }
  return 0;
}

function authError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function createFirebaseRoomStore(config, options = {}) {
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
    // 저장소가 제한된 브라우저에서도 현재 탭의 인증은 계속 시도한다.
  }
  await auth.authStateReady();
  if (!auth.currentUser && options.ensureAnonymous === true) {
    await signInAnonymously(auth);
  }
  const database = getFirestore(app);
  let pendingGoogleCredential = null;

  function requireUser() {
    if (!auth.currentUser) {
      throw authError("auth/unauthenticated", "로그인이 필요합니다.");
    }
    return auth.currentUser;
  }

  function requireGoogleAccount() {
    const user = requireUser();
    if (!googleAccount(user)) {
      throw authError("auth/google-sign-in-required", "온라인 방을 만들려면 Google 로그인이 필요합니다.");
    }
    return user;
  }

  function roomReference(roomId) {
    return doc(database, "rooms", core.validateRoomId(roomId));
  }

  async function ensureParticipantSession() {
    if (auth.currentUser) return auth.currentUser;
    return (await signInAnonymously(auth)).user;
  }

  async function refreshIdentityToken(user) {
    try {
      await user.getIdToken(true);
    } catch (_error) {
      // 인증 전환은 이미 끝났으므로 UI의 사용자 상태를 먼저 갱신한다.
      // 네트워크가 복구되면 Firebase SDK가 토큰을 다시 새로고침한다.
    }
  }

  async function signInCreatorWithGoogle() {
    if (googleAccount(auth.currentUser)) return auth.currentUser;
    pendingGoogleCredential = null;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const result = auth.currentUser
        ? await linkWithPopup(auth.currentUser, provider)
        : await signInWithPopup(auth, provider);
      await refreshIdentityToken(result.user);
      return result.user;
    } catch (error) {
      if ([
        "auth/credential-already-in-use",
        "auth/email-already-in-use",
        "auth/account-exists-with-different-credential",
      ].includes(error?.code)) {
        pendingGoogleCredential = GoogleAuthProvider.credentialFromError(error);
      }
      throw error;
    }
  }

  function hasPendingGoogleAccount() {
    return Boolean(pendingGoogleCredential);
  }

  function clearPendingGoogleAccount() {
    pendingGoogleCredential = null;
  }

  async function switchToPendingGoogleAccount() {
    if (!pendingGoogleCredential) {
      throw authError("auth/missing-google-credential", "전환할 Google 로그인 정보가 없습니다.");
    }
    const credential = pendingGoogleCredential;
    pendingGoogleCredential = null;
    const result = await signInWithCredential(auth, credential);
    await refreshIdentityToken(result.user);
    return result.user;
  }

  async function signOutCreator(options = {}) {
    pendingGoogleCredential = null;
    await signOut(auth);
    if (options.ensureAnonymous === true) {
      return (await signInAnonymously(auth)).user;
    }
    return null;
  }

  async function createRoom(value) {
    const user = requireGoogleAccount();
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

  async function listOwnedRooms() {
    const user = requireGoogleAccount();
    const snapshot = await getDocs(query(
      collection(database, "rooms"),
      where("ownerUid", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(OWNED_ROOM_LIMIT),
    ));
    return snapshot.docs
      .map((roomDocument) => core.normalizeRoomSnapshot(roomDocument.data(), roomDocument.id))
      .sort((left, right) =>
        timestampMillis(right.updatedAt) - timestampMillis(left.updatedAt)
        || timestampMillis(right.createdAt) - timestampMillis(left.createdAt)
        || left.title.localeCompare(right.title, "ko"));
  }

  function subscribeRoom(roomId, onValue, onError) {
    requireUser();
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
    const user = requireUser();
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

  async function removeResponse(roomId, uid = "", options = {}) {
    const user = requireUser();
    const targetUid = String(uid || user.uid);
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
    requireUser();
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
    requireUser();
    await deleteDoc(roomReference(roomId));
  }

  return {
    get user() {
      return auth.currentUser;
    },
    isGoogleAccount() {
      return googleAccount(auth.currentUser);
    },
    ensureParticipantSession,
    signInCreatorWithGoogle,
    hasPendingGoogleAccount,
    clearPendingGoogleAccount,
    switchToPendingGoogleAccount,
    signOutCreator,
    createRoom,
    listOwnedRooms,
    subscribeRoom,
    saveResponse,
    removeResponse,
    updateRoom,
    removeRoom,
  };
}
