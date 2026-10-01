import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { GoogleAuthProvider, browserLocalPersistence, getAuth, linkWithPopup, onAuthStateChanged, setPersistence, signInAnonymously, signInWithCredential, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocFromServer, getFirestore, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js";

const core = globalThis.FarmPartyCore;
export async function createFarmStore(config) {
  const app = initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId }, "farm-party");
  if (config.appCheckSiteKey) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  const auth = getAuth(app);
  try { await setPersistence(auth, browserLocalPersistence); } catch { /* Restricted browsers can still use the current session. */ }
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const db = getFirestore(app);
  const isGoogle = (user = auth.currentUser) => Boolean(user?.providerData.some((provider) => provider.providerId === "google.com"));
  const requireUser = () => { if (!auth.currentUser) throw new Error("접속 정보를 확인해 주세요."); return auth.currentUser; };
  const requireGoogle = () => { const user = requireUser(); if (!isGoogle(user)) throw new Error("모집방을 만들고 관리하려면 Google 로그인이 필요합니다."); return user; };
  const reference = (id) => doc(db, "farmRooms", core.roomId(id));
  let pendingCredential = null;

  async function login() {
    if (isGoogle()) return auth.currentUser;
    pendingCredential = null;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const result = auth.currentUser?.isAnonymous ? await linkWithPopup(auth.currentUser, provider) : await signInWithPopup(auth, provider);
      await result.user.getIdToken(true);
      return result.user;
    } catch (error) {
      if (["auth/credential-already-in-use", "auth/email-already-in-use"].includes(error.code)) pendingCredential = GoogleAuthProvider.credentialFromError(error);
      throw error;
    }
  }
  async function switchAccount() {
    if (!pendingCredential) throw new Error("Google 로그인을 다시 시도해 주세요.");
    const credential = pendingCredential; pendingCredential = null;
    const result = await signInWithCredential(auth, credential);
    await result.user.getIdToken(true);
    return result.user;
  }
  async function logout() { await signOut(auth); return (await signInAnonymously(auth)).user; }
  function subscribeList(onValue, onError, owned = false) {
    const user = requireUser();
    if (owned && !isGoogle()) { onValue([]); return () => {}; }
    return onSnapshot(query(collection(db, "farmRooms"), owned ? where("ownerUid", "==", user.uid) : where("status", "in", ["open", "confirmed"]), orderBy("createdAt", "desc"), limit(30)), (snapshot) => {
      const rooms = [];
      for (const item of snapshot.docs) {
        try { rooms.push(core.room(item.data({ serverTimestamps: "estimate" }), item.id)); }
        catch { console.warn("Skipped an invalid farm room:", item.id); }
      }
      onValue(rooms);
    }, onError);
  }
  function subscribeRoom(id, onValue, onError) {
    return onSnapshot(reference(id), { includeMetadataChanges: true }, (snapshot) => {
      try { if (!snapshot.exists() && snapshot.metadata.fromCache) return; onValue(snapshot.exists() ? core.room(snapshot.data({ serverTimestamps: "estimate" }), id) : null, snapshot.metadata); } catch (error) { onError(error); }
    }, onError);
  }
  async function createRoom(value) {
    const owner = requireGoogle();
    const id = core.createRoomId();
    await setDoc(reference(id), { ...core.draft(value), ownerUid: owner.uid, status: "open", applicants: {}, assignments: {}, locks: {}, revision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return id;
  }
  async function apply(id, input) {
    const user = requireUser();
    const ref = reference(id);
    return transact(ref, async (transaction, snapshot) => {
      if (!snapshot.exists()) throw new Error("모집방을 찾지 못했습니다.");
      const value = core.room(snapshot.data(), id);
      const patch = core.applyApplication(value, user.uid, input, serverTimestamp());
      transaction.update(ref, { ...patch, revision: value.revision + 1, updatedAt: serverTimestamp() });
    });
  }
  async function manage(id, command, revision) {
    const user = requireGoogle();
    const ref = reference(id);
    return transact(ref, async (transaction, snapshot) => {
      if (!snapshot.exists()) throw new Error("모집방을 찾지 못했습니다.");
      const value = core.room(snapshot.data(), id);
      if (value.ownerUid !== user.uid) throw new Error("방장만 편성을 변경할 수 있습니다.");
      if (command.type === "confirm" && value.revision !== revision) throw new Error("신청 정보가 갱신됐습니다. 최신 편성을 확인한 뒤 다시 확정해 주세요.");
      transaction.update(ref, { ...core.manage(value, command), revision: value.revision + 1, updatedAt: serverTimestamp() });
    });
  }
  // Rules may reject a stale write before Firestore reports its transaction conflict.
  // Retry only after a server read proves that the document revision changed.
  async function transact(ref, mutate) {
    const accountUid = requireUser().uid;
    for (let attempt = 0; attempt < 4; attempt++) {
      let attemptedRevision;
      try {
        return await runTransaction(db, async (transaction) => {
          if (requireUser().uid !== accountUid) throw new Error("계정이 바뀌었어요. 다시 시도해 주세요.");
          const snapshot = await transaction.get(ref);
          attemptedRevision = snapshot.data()?.revision;
          return mutate(transaction, snapshot);
        });
      } catch (error) {
        if (error.code !== "permission-denied" || attemptedRevision == null || attempt === 3) throw error;
        const latest = await getDocFromServer(ref);
        if (!latest.exists() || latest.data().revision === attemptedRevision) throw error;
      }
    }
  }
  async function loadProfile() {
    const user = requireGoogle();
    const snapshot = await getDoc(doc(db, "farmProfiles", user.uid));
    return snapshot.exists() ? core.profile(snapshot.data()) : null;
  }
  async function saveProfile(value) {
    const user = requireGoogle();
    await setDoc(doc(db, "farmProfiles", user.uid), { ...core.profile(value), version: 1, updatedAt: serverTimestamp() });
  }
  return { currentUser: () => auth.currentUser, isGoogle, login, logout, switchAccount, hasPendingAccount: () => Boolean(pendingCredential), subscribeAuth: (callback) => onAuthStateChanged(auth, callback), subscribeList, subscribeRoom, createRoom, apply, manage, loadProfile, saveProfile };
}
