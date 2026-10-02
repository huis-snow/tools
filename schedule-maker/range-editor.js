(function (root) {
  "use strict";

  function create({ document, getState, commit }) {
    const api = root.Eonjepyo;
    const form = document.querySelector("#timeRangeForm");
    if (!form) return null;
    const daysField = document.querySelector("#timeRangeDays");
    const startField = document.querySelector("#timeRangeStart");
    const endField = document.querySelector("#timeRangeEnd");
    const submit = document.querySelector("#timeRangeSubmit");
    const cancelButton = document.querySelector("#timeRangeCancel");
    const errorField = document.querySelector("#timeRangeError");
    const list = document.querySelector("#timeRangeList");
    let editing = null;
    let configuration = "";

    function cancel() {
      editing = null;
      submit.textContent = "시간 추가";
      cancelButton.hidden = true;
      errorField.textContent = "";
    }

    function dayLabel(day, state) {
      const date = api.calendarDateForDay(state.startDate, state.startDay, day);
      return date ? api.calendarDayHeader(date) : api.DAYS[day].short;
    }

    function render() {
      const state = getState();
      const { slots, startHour, startDay, readOnly } = state;
      const key = `${startHour}:${startDay}:${state.startDate || ""}`;
      if (key !== configuration) {
        cancel();
        configuration = key;
        daysField.replaceChildren();
        api.displayDayIndexes(startDay).forEach((day) => {
          const label = document.createElement("label");
          label.className = "range-day-option";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.value = String(day);
          input.checked = day < 5;
          const caption = document.createElement("span");
          caption.textContent = dayLabel(day, state);
          label.append(input, caption);
          daysField.append(label);
        });
        startField.replaceChildren();
        endField.replaceChildren();
        for (let hour = startHour; hour <= startHour + api.HOURS; hour += api.SLOT_STEP) {
          const option = document.createElement("option");
          option.value = String(hour);
          option.textContent = api.formatTimelineHour(hour, startHour);
          if (hour < startHour + api.HOURS) startField.append(option.cloneNode(true));
          if (hour > startHour) endField.append(option);
        }
        const defaultStart = startHour <= 19 ? 19 : startHour;
        startField.value = String(defaultStart);
        endField.value = String(Math.min(defaultStart + 4, startHour + api.HOURS));
      }
      const groups = new Map();
      api.displayDayIndexes(startDay).forEach((day) => {
        api.selectedRanges(slots, day, startHour).forEach(([start, end]) => {
          const key = `${start}:${end}`;
          if (!groups.has(key)) groups.set(key, { days: [], start, end });
          groups.get(key).days.push(day);
        });
      });
      // Undo, clearing, or painting can remove a range being edited.
      if (editing && !editing.days.every((day) => api.selectedRanges(slots, day, startHour).some(([start, end]) => start === editing.start && end === editing.end))) cancel();
      list.replaceChildren();
      if (!groups.size) {
        const empty = document.createElement("li");
        empty.className = "time-range-empty";
        empty.textContent = "요일과 시작·종료 시간을 골라 가능한 시간을 추가해 주세요.";
        list.append(empty);
      }
      groups.forEach((range) => {
        const item = document.createElement("li");
        item.className = "time-range-item";
        const caption = document.createElement("span");
        const description = `${range.days.map((day) => dayLabel(day, state)).join("·")} ${api.formatTimelineHour(range.start, startHour)}–${api.formatTimelineHour(range.end, startHour)}`;
        caption.textContent = description;
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "수정";
        edit.disabled = readOnly;
        edit.setAttribute("aria-label", `${description} 수정`);
        edit.addEventListener("click", () => {
          if (getState().readOnly) return;
          editing = range;
          daysField.querySelectorAll("input").forEach((input) => { input.checked = range.days.includes(Number(input.value)); });
          startField.value = String(range.start);
          endField.value = String(range.end);
          submit.textContent = "수정 저장";
          cancelButton.hidden = false;
          errorField.textContent = "";
          startField.focus();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.disabled = readOnly;
        remove.setAttribute("aria-label", `${description} 삭제`);
        remove.addEventListener("click", () => {
          if (getState().readOnly) return;
          cancel();
          commit(() => {
            const state = getState();
            api.rangeSlotIndexes(range.days, range.start, range.end, state.startHour).forEach((index) => api.setSelected(state.slots, index, false));
          }, `${description} 구간을 지웠습니다.`);
          submit.focus();
        });
        item.append(caption, edit, remove);
        list.append(item);
      });
      form.querySelectorAll("input, select, button").forEach((control) => { control.disabled = readOnly; });
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = getState();
      if (state.readOnly) return;
      try {
        const days = Array.from(daysField.querySelectorAll("input:checked"), (input) => Number(input.value));
        const indexes = api.rangeSlotIndexes(days, Number(startField.value), Number(endField.value), state.startHour);
        const original = editing;
        cancel();
        commit(() => {
          if (original) api.rangeSlotIndexes(original.days, original.start, original.end, state.startHour).forEach((index) => api.setSelected(state.slots, index, false));
          indexes.forEach((index) => api.setSelected(state.slots, index, true));
        }, original ? "가능한 시간 구간을 수정했습니다." : "가능한 시간 구간을 추가했습니다.");
        render();
      } catch (error) {
        errorField.textContent = error.message;
      }
    });
    cancelButton.addEventListener("click", cancel);
    return { render, cancel };
  }

  root.EonjepyoRangeEditor = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
