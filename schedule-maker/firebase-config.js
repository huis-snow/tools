(function (root) {
  "use strict";

  // Firebase Console > 프로젝트 설정 > 내 앱 > 웹 앱의 공개 설정값을 붙여 넣으세요.
  // 이 값들은 프로젝트를 식별하는 공개 웹 설정이며 서비스 계정 키가 아닙니다.
  root.EonjepyoFirebaseConfig = Object.freeze({
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
    // App Check를 설정한 뒤 reCAPTCHA Enterprise 사이트 키를 넣습니다. 처음에는 비워도 됩니다.
    appCheckSiteKey: "",
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
