(function (root) {
  "use strict";

  const TEST_TRIALS = 8;
  const PRACTICE_TRIALS = 1;
  const MIN_WAIT_MS = 1400;
  const MAX_WAIT_MS = 3000;
  const MAX_REACTION_MS = 1600;

  function median(values) {
    if (!Array.isArray(values) || values.length === 0) throw new TypeError("측정값이 필요합니다.");
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length !== values.length) throw new TypeError("측정값은 유한한 숫자여야 합니다.");
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function medianAbsoluteDeviation(values) {
    const center = median(values);
    return median(values.map((value) => Math.abs(value - center)));
  }

  function classifyGap(gap, jitter) {
    if (gap <= 0 || Math.abs(gap) <= Math.max(12, jitter)) {
      return {
        level: "uncertain",
        title: "차이가 측정 흔들림 안에 있어요",
        detail: "블루투스가 더 빠르게 나온 경우도 반응 편차일 수 있어요. 자세를 유지하고 한 번 더 재보세요.",
      };
    }
    if (gap < 40) {
      return {
        level: "small",
        title: "작은 지연 차이가 측정됐어요",
        detail: "현재 조건에서는 유선과 블루투스의 반응 차이가 비교적 작게 나타났어요.",
      };
    }
    if (gap < 80) {
      return {
        level: "medium",
        title: "느껴질 수 있는 차이가 있어요",
        detail: "리듬 게임이나 영상 편집처럼 타이밍이 중요한 상황에서 차이가 느껴질 수 있어요.",
      };
    }
    return {
      level: "large",
      title: "뚜렷한 지연 차이가 측정됐어요",
      detail: "게임·연주처럼 즉각적인 소리 반응이 중요한 용도에서는 유선 연결이 더 편할 수 있어요.",
    };
  }

  function calculateSummary(wiredValues, bluetoothValues) {
    const wiredMedian = median(wiredValues);
    const bluetoothMedian = median(bluetoothValues);
    const gap = Math.round(bluetoothMedian - wiredMedian);
    const wiredJitter = medianAbsoluteDeviation(wiredValues);
    const bluetoothJitter = medianAbsoluteDeviation(bluetoothValues);
    const jitter = Math.round(Math.max(wiredJitter, bluetoothJitter));
    const reliability = jitter <= 18 ? "high" : jitter <= 35 ? "medium" : "low";
    return {
      wiredMedian: Math.round(wiredMedian),
      bluetoothMedian: Math.round(bluetoothMedian),
      gap,
      jitter,
      reliability,
      verdict: classifyGap(gap, jitter),
    };
  }

  function randomWait(random = Math.random) {
    return Math.round(MIN_WAIT_MS + random() * (MAX_WAIT_MS - MIN_WAIT_MS));
  }

  function initApp(doc = document) {
    const elements = {
      setupView: doc.getElementById("setupView"),
      reactionView: doc.getElementById("reactionView"),
      switchView: doc.getElementById("switchView"),
      resultView: doc.getElementById("resultView"),
      phaseWired: doc.getElementById("phaseWired"),
      phaseBluetooth: doc.getElementById("phaseBluetooth"),
      phaseResult: doc.getElementById("phaseResult"),
      wiredSoundButton: doc.getElementById("wiredSoundButton"),
      bluetoothSoundButton: doc.getElementById("bluetoothSoundButton"),
      wiredSoundStatus: doc.getElementById("wiredSoundStatus"),
      bluetoothSoundStatus: doc.getElementById("bluetoothSoundStatus"),
      startWiredButton: doc.getElementById("startWiredButton"),
      startBluetoothButton: doc.getElementById("startBluetoothButton"),
      reactionDeviceLabel: doc.getElementById("reactionDeviceLabel"),
      trialLabel: doc.getElementById("trialLabel"),
      trialDots: doc.getElementById("trialDots"),
      reactionPad: doc.getElementById("reactionPad"),
      trialFeedback: doc.getElementById("trialFeedback"),
      cancelTestButton: doc.getElementById("cancelTestButton"),
      wiredMedianPreview: doc.getElementById("wiredMedianPreview"),
      gapResult: doc.getElementById("gapResult"),
      resultVerdict: doc.getElementById("resultVerdict"),
      wiredResult: doc.getElementById("wiredResult"),
      bluetoothResult: doc.getElementById("bluetoothResult"),
      wiredSamples: doc.getElementById("wiredSamples"),
      bluetoothSamples: doc.getElementById("bluetoothSamples"),
      reliabilityNote: doc.getElementById("reliabilityNote"),
      restartButton: doc.getElementById("restartButton"),
    };

    let audioContext = null;
    let currentTone = null;
    let toneTimer = 0;
    let missTimer = 0;
    let nextTimer = 0;
    let phase = "wired";
    let mode = "idle";
    let practiceIndex = 0;
    let trialIndex = 0;
    let scheduledAt = 0;
    let wiredValues = [];
    let bluetoothValues = [];

    function setView(viewName) {
      ["setup", "reaction", "switch", "result"].forEach((name) => {
        elements[`${name}View`].hidden = name !== viewName;
      });
    }

    function setPhaseTrack(active) {
      const order = ["wired", "bluetooth", "result"];
      const activeIndex = order.indexOf(active);
      order.forEach((name, index) => {
        const element = elements[`phase${name[0].toUpperCase()}${name.slice(1)}`];
        element.classList.toggle("is-current", index === activeIndex);
        element.classList.toggle("is-done", index < activeIndex);
        if (index === activeIndex) element.setAttribute("aria-current", "step");
        else element.removeAttribute("aria-current");
      });
    }

    function clearTimers() {
      window.clearTimeout(toneTimer);
      window.clearTimeout(missTimer);
      window.clearTimeout(nextTimer);
      toneTimer = 0;
      missTimer = 0;
      nextTimer = 0;
    }

    function stopCurrentTone() {
      if (!currentTone) return;
      try { currentTone.oscillator.stop(); } catch (_error) { /* already stopped */ }
      try { currentTone.oscillator.disconnect(); } catch (_error) { /* no-op */ }
      try { currentTone.gain.disconnect(); } catch (_error) { /* no-op */ }
      currentTone = null;
    }

    async function resetAudioContext() {
      stopCurrentTone();
      if (audioContext && audioContext.state !== "closed") {
        try { await audioContext.close(); } catch (_error) { /* browser owns lifecycle */ }
      }
      audioContext = null;
    }

    async function ensureAudioContext() {
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      if (!AudioContextClass) throw new Error("이 브라우저는 Web Audio를 지원하지 않습니다.");
      if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextClass({ latencyHint: "interactive" });
      if (audioContext.state === "suspended") await audioContext.resume();
      return audioContext;
    }

    async function createTone(delayMs, volume = 0.16) {
      const context = await ensureAudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const contextStart = context.currentTime + delayMs / 1000;
      const perfStart = performance.now() + delayMs;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, contextStart);
      gain.gain.setValueAtTime(0.0001, contextStart);
      gain.gain.exponentialRampToValueAtTime(volume, contextStart + 0.006);
      gain.gain.setValueAtTime(volume, contextStart + 0.065);
      gain.gain.exponentialRampToValueAtTime(0.0001, contextStart + 0.085);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(contextStart);
      oscillator.stop(contextStart + 0.09);
      currentTone = { oscillator, gain };
      oscillator.addEventListener("ended", () => {
        if (currentTone?.oscillator === oscillator) currentTone = null;
        try { oscillator.disconnect(); } catch (_error) { /* no-op */ }
        try { gain.disconnect(); } catch (_error) { /* no-op */ }
      }, { once: true });
      return perfStart;
    }

    async function checkSound(button, status) {
      button.disabled = true;
      status.textContent = "소리를 재생하고 있어요…";
      try {
        await createTone(60, 0.13);
        window.setTimeout(() => { status.textContent = "삐 소리가 들렸다면 준비됐어요."; }, 180);
      } catch (error) {
        status.textContent = error.message || "소리를 재생하지 못했어요.";
      } finally {
        window.setTimeout(() => { button.disabled = false; }, 240);
      }
    }

    function valuesForPhase() {
      return phase === "wired" ? wiredValues : bluetoothValues;
    }

    function isPractice() {
      return practiceIndex < PRACTICE_TRIALS;
    }

    function renderTrialProgress() {
      const practice = isPractice();
      elements.reactionDeviceLabel.textContent = phase === "wired" ? "WIRED · BASELINE" : "BLUETOOTH · WIRELESS";
      elements.trialLabel.textContent = practice ? `연습 ${practiceIndex + 1} / ${PRACTICE_TRIALS}` : `본 측정 ${trialIndex + 1} / ${TEST_TRIALS}`;
      elements.trialDots.innerHTML = Array.from({ length: TEST_TRIALS }, (_, index) => {
        const className = index < trialIndex ? "is-done" : index === trialIndex && !practice ? "is-current" : "";
        return `<i class="${className}" aria-hidden="true"></i>`;
      }).join("");
      elements.trialDots.setAttribute("aria-label", `본 측정 ${trialIndex}회 완료, 총 ${TEST_TRIALS}회`);
    }

    function showFeedback(kind, message) {
      elements.trialFeedback.className = `trial-feedback is-${kind}`;
      elements.trialFeedback.textContent = message;
      elements.reactionPad.dataset.state = kind;
    }

    function prepareNextTrial(delay = 650) {
      mode = "between";
      nextTimer = window.setTimeout(runTrial, delay);
    }

    async function runTrial() {
      clearTimers();
      stopCurrentTone();
      renderTrialProgress();
      elements.trialFeedback.textContent = "소리가 나올 때까지 기다리세요…";
      elements.trialFeedback.className = "trial-feedback";
      elements.reactionPad.dataset.state = "waiting";
      mode = "arming";

      try {
        const wait = randomWait();
        scheduledAt = await createTone(wait);
        mode = "waiting";
        toneTimer = window.setTimeout(() => {
          if (mode === "waiting") mode = "heard";
        }, Math.max(0, scheduledAt - performance.now()));
        missTimer = window.setTimeout(() => {
          if (mode !== "heard" && mode !== "waiting") return;
          mode = "between";
          showFeedback("miss", "놓쳤어요. 같은 회차를 다시 측정할게요.");
          prepareNextTrial(1000);
        }, Math.max(0, scheduledAt - performance.now()) + MAX_REACTION_MS);
      } catch (error) {
        mode = "idle";
        showFeedback("error", error.message || "소리를 재생하지 못했어요.");
      }
    }

    function completePhase() {
      clearTimers();
      stopCurrentTone();
      mode = "idle";
      if (phase === "wired") {
        elements.wiredMedianPreview.textContent = Math.round(median(wiredValues));
        setView("switch");
        setPhaseTrack("bluetooth");
        resetAudioContext();
        elements.switchView.querySelector("h3").focus({ preventScroll: true });
      } else {
        renderResult();
      }
    }

    function recordReaction() {
      const now = performance.now();
      if (mode === "arming" || (mode === "waiting" && now < scheduledAt)) {
        clearTimers();
        stopCurrentTone();
        showFeedback("early", "조금 빨랐어요. 이 회차는 기록하지 않고 다시 시작합니다.");
        prepareNextTrial(1050);
        return;
      }
      if (mode !== "heard" && mode !== "waiting") return;

      const reaction = Math.round(now - scheduledAt);
      if (reaction < 0) return;
      clearTimers();
      mode = "between";

      if (isPractice()) {
        practiceIndex += 1;
        showFeedback("success", `연습 완료 · ${reaction} ms — 이제 본 측정을 시작해요.`);
      } else {
        valuesForPhase().push(reaction);
        trialIndex += 1;
        showFeedback("success", `${reaction} ms · ${trialIndex}회 기록 완료`);
      }

      if (!isPractice() && trialIndex >= TEST_TRIALS) {
        window.setTimeout(completePhase, 850);
      } else {
        prepareNextTrial(780);
      }
    }

    async function startPhase(nextPhase) {
      clearTimers();
      phase = nextPhase;
      practiceIndex = 0;
      trialIndex = 0;
      if (phase === "wired") {
        wiredValues = [];
        bluetoothValues = [];
      } else {
        bluetoothValues = [];
      }
      try {
        await ensureAudioContext();
      } catch (error) {
        const status = phase === "wired" ? elements.wiredSoundStatus : elements.bluetoothSoundStatus;
        status.textContent = error.message || "오디오를 시작할 수 없어요.";
        return;
      }
      setView("reaction");
      setPhaseTrack(phase);
      renderTrialProgress();
      elements.reactionPad.focus({ preventScroll: true });
      runTrial();
    }

    function renderSampleStrip(element, values) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = Math.max(1, max - min);
      element.innerHTML = values.map((value) => {
        const height = 28 + ((value - min) / range) * 48;
        return `<i style="height:${height}%" title="${Math.round(value)} ms"><span class="sr-only">${Math.round(value)} ms</span></i>`;
      }).join("");
    }

    function renderResult() {
      const summary = calculateSummary(wiredValues, bluetoothValues);
      setView("result");
      setPhaseTrack("result");
      elements.gapResult.className = `gap-result is-${summary.verdict.level}`;
      elements.gapResult.innerHTML = `<span>${summary.gap >= 0 ? "+" : "−"}</span><strong>${Math.abs(summary.gap)}</strong><small>ms</small>`;
      elements.resultVerdict.innerHTML = `<strong>${summary.verdict.title}</strong><br />${summary.verdict.detail}`;
      elements.wiredResult.textContent = summary.wiredMedian;
      elements.bluetoothResult.textContent = summary.bluetoothMedian;
      renderSampleStrip(elements.wiredSamples, wiredValues);
      renderSampleStrip(elements.bluetoothSamples, bluetoothValues);

      const reliabilityText = summary.reliability === "high"
        ? `8회 측정의 흔들림이 작은 편이에요(중앙 절대 편차 ${summary.jitter} ms). 결과를 비교하기 좋은 상태입니다.`
        : summary.reliability === "medium"
          ? `반응 속도가 조금 흔들렸어요(중앙 절대 편차 ${summary.jitter} ms). 한 번 더 측정해 비슷한 값이 나오는지 확인해 보세요.`
          : `반응 속도 편차가 큰 편이에요(중앙 절대 편차 ${summary.jitter} ms). 잠시 쉬고 같은 자세로 다시 측정하는 편이 좋아요.`;
      elements.reliabilityNote.textContent = reliabilityText;
      elements.resultView.querySelector("h3").focus({ preventScroll: true });
    }

    function cancelTest() {
      clearTimers();
      stopCurrentTone();
      mode = "idle";
      if (phase === "wired") {
        setView("setup");
        setPhaseTrack("wired");
      } else {
        setView("switch");
        setPhaseTrack("bluetooth");
      }
    }

    function restart() {
      clearTimers();
      stopCurrentTone();
      resetAudioContext();
      mode = "idle";
      phase = "wired";
      wiredValues = [];
      bluetoothValues = [];
      elements.wiredSoundStatus.textContent = "";
      elements.bluetoothSoundStatus.textContent = "";
      setView("setup");
      setPhaseTrack("wired");
      elements.startWiredButton.focus({ preventScroll: true });
    }

    elements.wiredSoundButton.addEventListener("click", () => checkSound(elements.wiredSoundButton, elements.wiredSoundStatus));
    elements.bluetoothSoundButton.addEventListener("click", () => checkSound(elements.bluetoothSoundButton, elements.bluetoothSoundStatus));
    elements.startWiredButton.addEventListener("click", () => startPhase("wired"));
    elements.startBluetoothButton.addEventListener("click", () => startPhase("bluetooth"));
    elements.reactionPad.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      recordReaction();
    });
    elements.cancelTestButton.addEventListener("click", cancelTest);
    elements.restartButton.addEventListener("click", restart);

    doc.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || event.repeat || elements.reactionView.hidden) return;
      event.preventDefault();
      recordReaction();
    });
    doc.addEventListener("visibilitychange", () => {
      if (doc.visibilityState === "visible" || elements.reactionView.hidden || mode === "idle") return;
      clearTimers();
      stopCurrentTone();
      mode = "between";
      showFeedback("miss", "화면을 벗어나 측정을 멈췄어요. 같은 회차를 다시 시작합니다.");
      prepareNextTrial(1200);
    });
  }

  const api = {
    TEST_TRIALS,
    PRACTICE_TRIALS,
    MIN_WAIT_MS,
    MAX_WAIT_MS,
    median,
    medianAbsoluteDeviation,
    classifyGap,
    calculateSummary,
    randomWait,
    initApp,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AudioLatencyTool = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initApp(), { once: true });
    else initApp();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
