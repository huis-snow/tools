export function firebaseErrorMessage(error, fallback = "Firebase 연결 중 문제가 생겼습니다.") {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) return "권한이 없습니다. 투표 상태가 바뀌었거나 Firebase 보안 규칙을 확인해 주세요.";
  if (code.includes("google-sign-in-required")) return "투표방을 만들거나 관리하려면 Google 로그인이 필요합니다.";
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "Google 로그인을 취소했어요.";
  if (code.includes("popup-blocked")) return "Google 로그인 창이 차단됐어요. 팝업을 허용한 뒤 다시 시도해 주세요.";
  if (code.includes("unauthorized-domain")) return "이 주소에서는 Google 로그인을 사용할 수 없어요. Firebase 승인 도메인을 확인해 주세요.";
  if (code.includes("operation-not-allowed")) return "Firebase Authentication에서 Google과 익명 로그인을 활성화해 주세요.";
  if (code.includes("credential-already-in-use") || code.includes("account-exists-with-different-credential")) {
    return "이 Google 계정은 이미 사용 중입니다.";
  }
  if (code.includes("unauthenticated")) return "익명 참여 연결이 끊겼어요. 페이지를 새로고침해 다시 연결해 주세요.";
  if (code.includes("unavailable") || code.includes("network-request-failed") || code.includes("network")) {
    return "네트워크에 연결할 수 없습니다. 연결 상태를 확인해 주세요.";
  }
  if (code.includes("resource-exhausted")) return "오늘의 Firebase 무료 사용 한도를 초과했습니다.";
  if (code.includes("not-found")) return "투표방을 찾지 못했습니다.";
  return error?.message || fallback;
}

export function setStatus(element, message, state = "") {
  if (!element) return;
  element.textContent = message;
  if (state) element.dataset.state = state;
  else delete element.dataset.state;
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.append(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

export function timestampDate(value) {
  if (typeof value?.toDate === "function") return value.toDate();
  if (Number.isFinite(value?.seconds)) return new Date(value.seconds * 1000);
  if (value instanceof Date) return value;
  return null;
}

export function formatTimestamp(value) {
  const date = timestampDate(value);
  if (!date || Number.isNaN(date.getTime())) return "수정 시각 확인 중";
  try {
    return `${new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)} 수정`;
  } catch (_error) {
    return `${date.toLocaleString()} 수정`;
  }
}

export function createToast(element) {
  let timer = 0;
  return (message) => {
    if (!element) return;
    window.clearTimeout(timer);
    element.textContent = message;
    element.classList.add("show");
    timer = window.setTimeout(() => element.classList.remove("show"), 2400);
  };
}
