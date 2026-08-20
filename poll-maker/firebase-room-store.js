import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  FieldPath,
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

const core = globalThis.AnonymousPollCore;

if (!core) throw new Error("익명 투표 데이터 모듈을 불러오지 못했습니다.");

const GOOGLE_PROVIDER_ID = "google.com";
const OWNED_ROOM_LIMIT = 30;
const CURRENT_BALLOT_ID = "current";

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
  if (value instanceof Date) return value.getTime();
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function authError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function createPollRoomStore(config, options = {}) {
  if (!core.firebaseConfigReady(config)) {
    throw new Error("Firebase 웹 설정이 아직 연결되지 않았습니다.");
  }

  const app = initializeApp(publicFirebaseConfig(config), "anonymous-poll-online-room");
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
      throw authError("auth/google-sign-in-required", "투표방을 만들고 관리하려면 Google 로그인이 필요합니다.");
    }
    return user;
  }

  function roomReference(roomId) {
    return doc(database, "pollRooms", core.validateRoomId(roomId));
  }

  function ballotReference(roomId) {
    return doc(roomReference(roomId), "ballots", CURRENT_BALLOT_ID);
  }

  function voteReference(roomId, voterUid) {
    return doc(roomReference(roomId), "votes", voterUid);
  }

  async function ensureParticipantSession() {
    if (auth.currentUser) return auth.currentUser;
    return (await signInAnonymously(auth)).user;
  }

  function subscribeAuthState(onValue, onError) {
    if (typeof onValue !== "function") {
      throw new TypeError("인증 상태를 받을 함수를 지정해 주세요.");
    }
    return onAuthStateChanged(auth, onValue, onError);
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
    const roomId = core.createRoomId();
    const batch = writeBatch(database);
    batch.set(roomReference(roomId), {
      version: room.version,
      agenda: room.agenda,
      description: room.description,
      resultVisibility: room.resultVisibility,
      ownerUid: user.uid,
      locked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(ballotReference(roomId), {
      votes: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return roomId;
  }

  async function listOwnedRooms() {
    const user = requireGoogleAccount();
    const snapshot = await getDocs(query(
      collection(database, "pollRooms"),
      where("ownerUid", "==", user.uid),
      orderBy("updatedAt", "desc"),
      limit(OWNED_ROOM_LIMIT),
    ));
    return snapshot.docs
      .map((roomDocument) => core.normalizeRoomSnapshot(roomDocument.data(), roomDocument.id))
      .sort((left, right) =>
        timestampMillis(right.updatedAt) - timestampMillis(left.updatedAt)
        || timestampMillis(right.createdAt) - timestampMillis(left.createdAt)
        || left.agenda.localeCompare(right.agenda, "ko"));
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
                room: core.normalizeRoomSnapshot(
                  snapshot.data({ serverTimestamps: "estimate" }),
                  normalizedId,
                ),
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

  function subscribeOwnVote(roomId, onValue, onError) {
    const user = requireUser();
    const normalizedId = core.validateRoomId(roomId);
    return onSnapshot(
      voteReference(normalizedId, user.uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        try {
          onValue(snapshot.exists()
            ? {
                vote: core.normalizeVoteSnapshot(
                  snapshot.data({ serverTimestamps: "estimate" }),
                ),
                fromCache: snapshot.metadata.fromCache,
                hasPendingWrites: snapshot.metadata.hasPendingWrites,
              }
            : {
                vote: null,
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

  function subscribeResults(roomId, onValue, onError) {
    requireUser();
    const normalizedId = core.validateRoomId(roomId);
    // Firestore authorizes the raw random-key ballot map; normalization only returns aggregate counts.
    return onSnapshot(
      ballotReference(normalizedId),
      { includeMetadataChanges: true },
      (snapshot) => {
        try {
          if (!snapshot.exists() && snapshot.metadata.fromCache) {
            onValue({
              result: null,
              missingFromCache: true,
              fromCache: true,
              hasPendingWrites: snapshot.metadata.hasPendingWrites,
            });
            return;
          }
          onValue(snapshot.exists()
            ? {
                result: core.normalizeResultSnapshot(
                  snapshot.data({ serverTimestamps: "estimate" }),
                ),
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

  async function castVote(roomId, value) {
    const user = requireUser();
    const normalizedId = core.validateRoomId(roomId);
    const vote = core.normalizeVoteDraft(value);
    const roomRef = roomReference(normalizedId);
    const ballotRef = ballotReference(normalizedId);
    const voteRef = voteReference(normalizedId, user.uid);

    return runTransaction(database, async (transaction) => {
      const roomSnapshot = await transaction.get(roomRef);
      if (!roomSnapshot.exists()) {
        throw authError("poll/not-found", "투표방을 찾을 수 없습니다.");
      }
      const room = core.normalizeRoomSnapshot(roomSnapshot.data(), normalizedId);
      if (room.locked) {
        throw authError("poll/locked", "마감된 투표입니다.");
      }

      const voteSnapshot = await transaction.get(voteRef);
      const previous = voteSnapshot.exists()
        ? core.normalizeVoteSnapshot(voteSnapshot.data())
        : null;
      if (previous?.choice === vote.choice) {
        return {
          choice: vote.choice,
          ballotKey: previous.ballotKey,
          changed: false,
          firstVote: false,
        };
      }

      const ballotKey = previous?.ballotKey || core.createBallotKey();
      if (previous) {
        transaction.update(voteRef, {
          choice: vote.choice,
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.set(voteRef, {
          choice: vote.choice,
          ballotKey,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      transaction.update(
        ballotRef,
        new FieldPath("votes", ballotKey),
        vote.choice,
        "updatedAt",
        serverTimestamp(),
      );
      return { choice: vote.choice, ballotKey, changed: true, firstVote: !previous };
    });
  }

  async function setLocked(roomId, locked) {
    requireGoogleAccount();
    if (typeof locked !== "boolean") throw new TypeError("투표 마감 상태가 올바르지 않습니다.");
    await updateDoc(roomReference(roomId), {
      locked,
      updatedAt: serverTimestamp(),
    });
  }

  return {
    get user() {
      return auth.currentUser;
    },
    isGoogleAccount() {
      return googleAccount(auth.currentUser);
    },
    subscribeAuthState,
    ensureParticipantSession,
    signInCreatorWithGoogle,
    hasPendingGoogleAccount,
    clearPendingGoogleAccount,
    switchToPendingGoogleAccount,
    signOutCreator,
    createRoom,
    listOwnedRooms,
    subscribeRoom,
    subscribeOwnVote,
    subscribeResults,
    castVote,
    setLocked,
  };
}
