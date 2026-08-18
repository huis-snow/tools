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
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js";

const core = globalThis.BisTrackerCore;

if (!core) throw new Error("BiS 데이터 모듈을 불러오지 못했습니다.");

const GOOGLE_PROVIDER_ID = "google.com";
const OWNED_ROOM_LIMIT = 30;
const SEATS = Object.freeze(["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"]);
const DROP_TYPES = Object.freeze([
  "raid_weapon",
  "raid_head",
  "raid_body",
  "raid_hands",
  "raid_legs",
  "raid_feet",
  "raid_earrings",
  "raid_necklace",
  "raid_bracelets",
  "raid_ring",
  "upgrade_weapon",
  "upgrade_armor",
  "upgrade_accessory",
]);

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

function emptyDistribution(week) {
  return core.normalizeDistribution({
    week,
    dropCounts: Object.fromEntries(DROP_TYPES.map((dropType) => [dropType, 0])),
    assignments: Object.fromEntries(DROP_TYPES.map((dropType) => [dropType, ""])),
  });
}

function memberStorageDraft(member) {
  const identity = core.normalizeMemberDraft(member);
  return {
    seat: identity.seat,
    nickname: identity.nickname,
    job: identity.job,
    editorUid: "",
    gear: "X".repeat(11),
    submitted: false,
    updatedAt: serverTimestamp(),
  };
}

export async function createBisRoomStore(config, options = {}) {
  if (!core.firebaseConfigReady(config)) {
    throw new Error("Firebase 웹 설정이 아직 연결되지 않았습니다.");
  }

  const app = initializeApp(publicFirebaseConfig(config), "bis-tracker-online-room");
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
      throw authError("auth/google-sign-in-required", "BiS 방을 만들려면 Google 로그인이 필요합니다.");
    }
    return user;
  }

  function roomReference(roomId) {
    return doc(database, "bisRooms", core.validateRoomId(roomId));
  }

  function memberReference(roomId, seat) {
    const normalizedSeat = core.normalizeSeat(seat);
    return doc(roomReference(roomId), "members", normalizedSeat);
  }

  async function ensureParticipantSession() {
    if (auth.currentUser) return auth.currentUser;
    return (await signInAnonymously(auth)).user;
  }

  async function refreshIdentityToken(user) {
    try {
      await user.getIdToken(true);
    } catch (_error) {
      // 로그인 전환 자체는 끝났으므로 네트워크 복구 뒤 SDK의 자동 갱신에 맡긴다.
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

  async function signOutCreator(signOutOptions = {}) {
    pendingGoogleCredential = null;
    await signOut(auth);
    if (signOutOptions.ensureAnonymous === true) {
      return (await signInAnonymously(auth)).user;
    }
    return null;
  }

  async function createRoom(value) {
    const user = requireGoogleAccount();
    const room = core.normalizeRoomDraft(value);
    if (!Array.isArray(room.roster) || room.roster.length !== SEATS.length) {
      throw new Error("8명의 공대원 명단이 필요합니다.");
    }
    const members = room.roster.map(memberStorageDraft);
    if (members.some((member, index) => member.seat !== SEATS[index])) {
      throw new Error("공대원 자리는 MT부터 D4까지 순서대로 필요합니다.");
    }

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const roomId = core.createRoomId();
      const batch = writeBatch(database);
      batch.set(roomReference(roomId), {
        version: room.version,
        title: room.title,
        tier: room.tier,
        week: room.week,
        ownerUid: user.uid,
        locked: false,
        distribution: emptyDistribution(room.week),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      members.forEach((member) => {
        batch.set(memberReference(roomId, member.seat), member);
      });
      try {
        await batch.commit();
        return roomId;
      } catch (error) {
        lastError = error;
        if (error?.code !== "permission-denied") throw error;
      }
    }
    throw lastError || new Error("BiS 방 주소를 만들지 못했습니다.");
  }

  async function listOwnedRooms() {
    const user = requireGoogleAccount();
    const snapshot = await getDocs(query(
      collection(database, "bisRooms"),
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

  function subscribeMembers(roomId, onValue, onError) {
    requireUser();
    const normalizedId = core.validateRoomId(roomId);
    const membersQuery = query(
      collection(roomReference(normalizedId), "members"),
      orderBy("seat", "asc"),
      limit(SEATS.length),
    );
    return onSnapshot(
      membersQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        try {
          const members = snapshot.docs
            .map((memberDocument) => core.normalizeMemberSnapshot(
              memberDocument.data(),
              memberDocument.id,
            ))
            .sort((left, right) => SEATS.indexOf(left.seat) - SEATS.indexOf(right.seat));
          onValue({
            members,
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
          });
        } catch (error) {
          onError?.(error);
        }
      },
      onError,
    );
  }

  async function saveMember(roomId, seat, value, saveOptions = {}) {
    const user = requireUser();
    const normalizedSeat = core.normalizeSeat(seat);
    const progress = core.normalizeMemberUpdate(value);
    let expectedGear = null;
    if (Object.prototype.hasOwnProperty.call(saveOptions, "expectedGear")) {
      expectedGear = String(saveOptions.expectedGear || "");
      core.decodeGear(expectedGear, { allowUnset: true });
    }
    const reference = memberReference(roomId, normalizedSeat);
    await runTransaction(database, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error("선택한 공대원 자리를 찾을 수 없습니다.");
      const editorUid = String(snapshot.data().editorUid || "");
      if (editorUid && editorUid !== user.uid) {
        throw authError("permission-denied", "이미 다른 사람이 편집 중인 자리입니다.");
      }
      const currentGear = String(snapshot.data().gear || "");
      if (expectedGear !== null && currentGear !== expectedGear) {
        const error = authError("bis/conflict", "다른 탭에서 이 자리의 장비 상태를 먼저 저장했습니다.");
        error.currentGear = currentGear;
        throw error;
      }
      transaction.update(reference, {
        editorUid: user.uid,
        gear: progress.gear,
        submitted: progress.submitted,
        updatedAt: serverTimestamp(),
      });
    });
  }

  async function updateMember(roomId, seat, value) {
    requireGoogleAccount();
    const progress = core.normalizeMemberUpdate(value);
    await updateDoc(memberReference(roomId, seat), {
      gear: progress.gear,
      submitted: progress.submitted,
      updatedAt: serverTimestamp(),
    });
  }

  async function releaseMember(roomId, seat) {
    requireGoogleAccount();
    await updateDoc(memberReference(roomId, seat), {
      editorUid: "",
      updatedAt: serverTimestamp(),
    });
  }

  async function updateRoom(roomId, changes) {
    requireGoogleAccount();
    const metadata = core.normalizeRoomMetadataUpdate(changes);
    const update = { ...metadata };
    if (Object.prototype.hasOwnProperty.call(metadata, "week")) {
      update.distribution = emptyDistribution(metadata.week);
    }
    await updateDoc(roomReference(roomId), {
      ...update,
      updatedAt: serverTimestamp(),
    });
  }

  async function saveDistribution(roomId, value) {
    requireGoogleAccount();
    await updateDoc(roomReference(roomId), {
      distribution: core.normalizeDistribution(value),
      updatedAt: serverTimestamp(),
    });
  }

  async function removeRoom(roomId) {
    requireGoogleAccount();
    const normalizedId = core.validateRoomId(roomId);
    const batch = writeBatch(database);
    SEATS.forEach((seat) => batch.delete(memberReference(normalizedId, seat)));
    batch.delete(roomReference(normalizedId));
    await batch.commit();
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
    subscribeMembers,
    saveMember,
    updateMember,
    releaseMember,
    updateRoom,
    saveDistribution,
    removeRoom,
  };
}
