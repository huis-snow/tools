(function (root) {
  "use strict";

  const core = root.RaidLootCore || (typeof require === "function" ? require("./core.js") : null);
  if (!core) throw new Error("공대 파밍표 이미지에 필요한 데이터 모듈을 불러오지 못했습니다.");

  const FONT_FAMILY = '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  const MONO_FONT_FAMILY = 'ui-monospace, "SFMono-Regular", Consolas, monospace';
  const LOGICAL_WIDTH = 1680;
  const HISTORY_LIMIT = 24;

  const STATUS_STYLE = Object.freeze({
    complete: Object.freeze({ label: "완료", background: "#dcebdd", foreground: "#24613d" }),
    upgrade: Object.freeze({ label: "보강 필요", background: "#f7ebc7", foreground: "#7b5b16" }),
    raid: Object.freeze({ label: "영식 필요", background: "#f8ddd4", foreground: "#9b422c" }),
    received: Object.freeze({ label: "수령 완료", background: "#cde9e2", foreground: "#126357" }),
    empty: Object.freeze({ label: "미입력", background: "#ebe9e0", foreground: "#7b837f" }),
  });

  const DECISION_LABELS = Object.freeze({
    recommended: "추천 분배",
    manual: "수동 분배",
    free: "자유 분배",
  });
  const SKIP_REASON_LABELS = Object.freeze({
    unclaimed: "희망자 없음",
    external: "외부 처리",
    deferred: "분배 보류",
  });

  function truncateText(context, value, maximumWidth) {
    const text = String(value ?? "");
    if (context.measureText(text).width <= maximumWidth) return text;
    const characters = Array.from(text);
    while (characters.length && context.measureText(`${characters.join("")}…`).width > maximumWidth) {
      characters.pop();
    }
    return `${characters.join("")}…`;
  }

  function roundRect(context, x, y, width, height, radius = 8) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  }

  function fillRoundedRect(context, x, y, width, height, radius, color) {
    context.fillStyle = color;
    roundRect(context, x, y, width, height, radius);
    context.fill();
  }

  function fillCenteredText(context, value, x, y, width, padding = 14) {
    context.fillText(truncateText(context, value, Math.max(0, width - padding * 2)), x + width / 2, y);
  }

  function normalizeRoom(roomValue) {
    const source = { ...(roomValue || {}) };
    const roomId = String(source.id || "");
    delete source.id;
    return core.normalizeRoomSnapshot(source, roomId);
  }

  function addUtcDays(dateString, offset) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date;
  }

  function compactDate(date) {
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function weekDateLabel(startDate, week) {
    const start = addUtcDays(startDate, (week - 1) * 7);
    const end = addUtcDays(startDate, (week - 1) * 7 + 6);
    return `${compactDate(start)}–${compactDate(end)}`;
  }

  function eventState(eventsValue) {
    const events = core.normalizeLootEvents(eventsValue || []);
    const active = core.activeLootEvents(events);
    const activeIds = new Set(active.map((event) => event.id));
    const undoneTargets = events.filter((event) => event.action !== "undo" && !activeIds.has(event.id));
    return { events, active, undoneTargets };
  }

  function effectiveGear(members, activeEvents, week) {
    const received = new Map();
    activeEvents.forEach((event) => {
      if (event.action !== "award" || event.week > week) return;
      const spec = core.DROP_SPECS[event.dropType];
      if (spec.consumesNeed) received.set(`${event.seat}@${event.gearSlot}`, event);
    });
    const gearBySeat = new Map(members.map((member) => [
      member.seat,
      core.decodeGear(member.gear, { allowUnset: !member.submitted }),
    ]));
    return { received, gearBySeat };
  }

  function weeklyCounts(activeEvents) {
    return Array.from({ length: core.FARMING_WEEKS }, (_unused, index) => {
      const week = index + 1;
      const events = activeEvents.filter((event) => event.week === week);
      return {
        week,
        awards: events.filter((event) => event.action === "award").length,
        skips: events.filter((event) => event.action === "skip").length,
      };
    });
  }

  function selectedHistory(activeEvents, members, week) {
    const memberBySeat = new Map(members.map((member) => [member.seat, member]));
    const grouped = new Map();
    activeEvents.filter((event) => event.week === week).forEach((event) => {
      let label;
      if (event.action === "award") {
        const member = memberBySeat.get(event.seat);
        const gear = event.gearSlot ? ` · ${core.GEAR_LABELS[event.gearSlot]}` : "";
        const fairness = event.countsForFairness ? "공정 집계" : "공정 집계 제외";
        label = `${core.DROP_SPECS[event.dropType].label} → ${event.seat} ${member?.nickname || ""}${gear} · ${DECISION_LABELS[event.decision]} · ${fairness}`;
      } else {
        label = `${core.DROP_SPECS[event.dropType].label} · 미배정 (${SKIP_REASON_LABELS[event.reason]})`;
      }
      const current = grouped.get(label) || { label, count: 0 };
      current.count += 1;
      grouped.set(label, current);
    });
    const rows = [...grouped.values()];
    if (rows.length <= HISTORY_LIMIT) return rows;
    const visible = rows.slice(0, HISTORY_LIMIT - 1);
    const hiddenCount = rows.slice(HISTORY_LIMIT - 1).reduce((sum, row) => sum + row.count, 0);
    visible.push({ label: `그 밖의 활성 이력 ${hiddenCount}건`, count: 1, summary: true });
    return visible;
  }

  function drawHeader(context, room, members, selectedWeek, progress) {
    const margin = 54;
    context.fillStyle = "#f4f1e8";
    context.fillRect(0, 0, LOGICAL_WIDTH, progress.logicalHeight);
    context.fillStyle = "#153c34";
    context.fillRect(0, 0, LOGICAL_WIDTH, 12);

    context.fillStyle = "#d8522a";
    context.font = `700 17px ${MONO_FONT_FAMILY}`;
    context.fillText("FFXIV · 8-WEEK RAID LOOT", margin, 48);
    context.fillStyle = "#153c34";
    context.font = `800 38px ${FONT_FAMILY}`;
    context.fillText(truncateText(context, room.title, 900), margin, 93);
    context.fillStyle = "#5f716a";
    context.font = `600 19px ${FONT_FAMILY}`;
    context.fillText(`${room.tier} · ${selectedWeek}주차 · ${weekDateLabel(room.startDate, selectedWeek)}`, margin, 134);

    context.textAlign = "right";
    context.fillStyle = "#153c34";
    context.font = `800 19px ${FONT_FAMILY}`;
    context.fillText(`${progress.completed} / ${core.GEAR_SLOTS.length * core.SEATS.length}개 완료`, LOGICAL_WIDTH - margin, 83);
    context.fillStyle = "#61736c";
    context.font = `600 15px ${FONT_FAMILY}`;
    context.fillText(`${progress.submitted} / 8명 입력 · 공정 집계 ${progress.fairAwards}개 · 기록 ${progress.recordedAwards}개`, LOGICAL_WIDTH - margin, 118);
    context.fillStyle = room.locked ? "#9b422c" : "#24613d";
    context.font = `700 14px ${FONT_FAMILY}`;
    context.fillText(room.locked ? "입력 마감" : "입력 중", LOGICAL_WIDTH - margin, 146);
    context.textAlign = "left";
  }

  function drawWeekStrip(context, room, counts, selectedWeek, top) {
    const margin = 54;
    const gap = 10;
    const width = (LOGICAL_WIDTH - margin * 2 - gap * (core.FARMING_WEEKS - 1)) / core.FARMING_WEEKS;
    context.fillStyle = "#153c34";
    context.font = `800 21px ${FONT_FAMILY}`;
    context.fillText("8주 파밍 흐름", margin, top + 18);
    counts.forEach((count, index) => {
      const x = margin + index * (width + gap);
      const y = top + 42;
      const selected = count.week === selectedWeek;
      fillRoundedRect(context, x, y, width, 86, 10, selected ? "#153c34" : "#fffdf6");
      context.textAlign = "center";
      context.fillStyle = selected ? "#f9936d" : "#d8522a";
      context.font = `800 15px ${MONO_FONT_FAMILY}`;
      context.fillText(`${count.week}주차`, x + width / 2, y + 22);
      context.fillStyle = selected ? "#fffdf5" : "#294b43";
      context.font = `700 14px ${FONT_FAMILY}`;
      context.fillText(`배정 ${count.awards}`, x + width / 2, y + 48);
      context.fillStyle = selected ? "#b7c4be" : "#75817c";
      context.font = `600 12px ${FONT_FAMILY}`;
      context.fillText(`${weekDateLabel(room.startDate, count.week)} · 미배정 ${count.skips}`, x + width / 2, y + 69);
    });
    context.textAlign = "left";
  }

  function drawGearTable(context, members, effective, top) {
    const margin = 54;
    const labelWidth = 142;
    const tableWidth = LOGICAL_WIDTH - margin * 2;
    const memberWidth = (tableWidth - labelWidth) / core.SEATS.length;
    const memberHeaderHeight = 94;
    const rowHeight = 54;

    context.fillStyle = "#153c34";
    context.fillRect(margin, top, tableWidth, memberHeaderHeight);
    context.fillStyle = "#f7f4e9";
    context.font = `700 15px ${FONT_FAMILY}`;
    context.fillText("장비 부위", margin + 18, top + memberHeaderHeight / 2);

    members.forEach((member, memberIndex) => {
      const x = margin + labelWidth + memberIndex * memberWidth;
      context.strokeStyle = "rgba(247,244,233,0.22)";
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, top + memberHeaderHeight);
      context.stroke();
      context.textAlign = "center";
      context.fillStyle = "#f9936d";
      context.font = `800 15px ${MONO_FONT_FAMILY}`;
      context.fillText(member.seat, x + memberWidth / 2, top + 21);
      context.fillStyle = "#fffdf5";
      context.font = `700 15px ${FONT_FAMILY}`;
      fillCenteredText(context, member.nickname, x, top + 49, memberWidth);
      context.fillStyle = "#b7c4be";
      context.font = `500 12px ${FONT_FAMILY}`;
      fillCenteredText(context, member.job, x, top + 72, memberWidth);
    });
    context.textAlign = "left";

    core.GEAR_SLOTS.forEach((gearSlot, rowIndex) => {
      const y = top + memberHeaderHeight + rowIndex * rowHeight;
      context.fillStyle = rowIndex % 2 ? "#f7f4eb" : "#fffdf6";
      context.fillRect(margin, y, tableWidth, rowHeight);
      context.strokeStyle = "#c6c7bf";
      context.strokeRect(margin + 0.5, y + 0.5, tableWidth - 1, rowHeight - 1);
      context.fillStyle = "#294b43";
      context.font = `700 15px ${FONT_FAMILY}`;
      context.fillText(core.GEAR_LABELS[gearSlot], margin + 18, y + rowHeight / 2);

      members.forEach((member, memberIndex) => {
        const x = margin + labelWidth + memberIndex * memberWidth;
        const received = effective.received.has(`${member.seat}@${gearSlot}`);
        const status = received ? "received" : (effective.gearBySeat.get(member.seat)[gearSlot] || "empty");
        const style = STATUS_STYLE[status];
        fillRoundedRect(context, x + 7, y + 9, memberWidth - 14, rowHeight - 18, 7, style.background);
        context.textAlign = "center";
        context.fillStyle = style.foreground;
        context.font = `700 12px ${FONT_FAMILY}`;
        fillCenteredText(context, style.label, x + 7, y + rowHeight / 2, memberWidth - 14, 8);
      });
      context.textAlign = "left";
    });
  }

  function drawFairness(context, statistics, top, selectedWeek) {
    const margin = 54;
    const gap = 10;
    const width = (LOGICAL_WIDTH - margin * 2 - gap * (core.SEATS.length - 1)) / core.SEATS.length;
    context.fillStyle = "#153c34";
    context.font = `800 21px ${FONT_FAMILY}`;
    context.fillText(`${selectedWeek}주차까지 공정성 집계`, margin, top + 18);
    context.fillStyle = "#6a7772";
    context.font = `500 13px ${FONT_FAMILY}`;
    context.fillText("‘공정 집계 제외’ 분배는 장비표에는 반영되지만 수령 수에는 더하지 않습니다.", margin + 250, top + 18);

    statistics.forEach((stat, index) => {
      const x = margin + index * (width + gap);
      const y = top + 42;
      fillRoundedRect(context, x, y, width, 106, 10, "#fffdf6");
      context.textAlign = "center";
      context.fillStyle = "#d8522a";
      context.font = `800 14px ${MONO_FONT_FAMILY}`;
      context.fillText(stat.seat, x + width / 2, y + 19);
      context.fillStyle = "#294b43";
      context.font = `700 14px ${FONT_FAMILY}`;
      fillCenteredText(context, stat.nickname, x, y + 42, width, 10);
      context.fillStyle = "#153c34";
      context.font = `800 15px ${FONT_FAMILY}`;
      context.fillText(`집계 ${stat.totalAwards}개`, x + width / 2, y + 67);
      context.fillStyle = "#75817c";
      context.font = `600 11px ${FONT_FAMILY}`;
      context.fillText(`제외 ${stat.excludedAwards} · 남은 필요 ${stat.remainingNeeds}`, x + width / 2, y + 89);
    });
    context.textAlign = "left";
  }

  function drawHistory(context, rows, undoneCount, top, selectedWeek) {
    const margin = 54;
    const gap = 20;
    const columnWidth = (LOGICAL_WIDTH - margin * 2 - gap) / 2;
    const rowHeight = 42;
    const rowCount = Math.max(1, Math.ceil(rows.length / 2));
    context.fillStyle = "#153c34";
    context.font = `800 21px ${FONT_FAMILY}`;
    context.fillText(`${selectedWeek}주차 활성 이력`, margin, top + 18);
    context.fillStyle = "#6a7772";
    context.font = `500 13px ${FONT_FAMILY}`;
    context.fillText(`되돌린 기록 ${undoneCount}건 제외 · 같은 내용은 묶어서 표시`, margin + 230, top + 18);

    if (!rows.length) {
      fillRoundedRect(context, margin, top + 42, LOGICAL_WIDTH - margin * 2, 62, 9, "#fffdf6");
      context.fillStyle = "#75817c";
      context.font = `600 14px ${FONT_FAMILY}`;
      context.fillText("이 주차에 활성 드랍 기록이 없습니다.", margin + 18, top + 73);
      return 116;
    }

    const firstColumnSize = Math.ceil(rows.length / 2);
    rows.forEach((row, index) => {
      const column = index < firstColumnSize ? 0 : 1;
      const rowIndex = column === 0 ? index : index - firstColumnSize;
      const x = margin + column * (columnWidth + gap);
      const y = top + 42 + rowIndex * rowHeight;
      context.fillStyle = rowIndex % 2 ? "#f0ede3" : "#fffdf6";
      context.fillRect(x, y, columnWidth, rowHeight - 4);
      context.fillStyle = row.summary ? "#75817c" : "#334f48";
      context.font = `${row.summary ? "600" : "700"} 13px ${FONT_FAMILY}`;
      const countSuffix = row.count > 1 ? ` × ${row.count}` : "";
      context.fillText(truncateText(context, `${row.label}${countSuffix}`, columnWidth - 28), x + 14, y + (rowHeight - 4) / 2);
    });
    return 52 + rowCount * rowHeight;
  }

  function renderRaidLootSummaryImage(roomValue, membersValue, eventsValue, options = {}) {
    const room = normalizeRoom(roomValue);
    const members = core.normalizeMembers(membersValue);
    const selectedWeek = core.normalizeWeek(options.week ?? room.currentWeek);
    const { active, undoneTargets } = eventState(eventsValue);
    const eventsThroughWeek = active.filter((event) => event.week <= selectedWeek);
    const statistics = core.cumulativeStatistics(members, eventsThroughWeek);
    const effective = effectiveGear(members, active, selectedWeek);
    const counts = weeklyCounts(active);
    const history = selectedHistory(active, members, selectedWeek);
    const selectedUndoneCount = undoneTargets.filter((event) => event.week === selectedWeek).length;

    let completed = 0;
    members.forEach((member) => {
      core.GEAR_SLOTS.forEach((gearSlot) => {
        if (effective.received.has(`${member.seat}@${gearSlot}`)
          || effective.gearBySeat.get(member.seat)[gearSlot] === "complete") completed += 1;
      });
    });
    const progress = {
      completed,
      submitted: members.filter((member) => member.submitted).length,
      fairAwards: statistics.reduce((sum, stat) => sum + stat.totalAwards, 0),
      recordedAwards: statistics.reduce((sum, stat) => sum + stat.recordedAwards, 0),
    };

    const headerTop = 0;
    const weekTop = 174;
    const tableTop = 324;
    const tableHeight = 94 + core.GEAR_SLOTS.length * 54;
    const fairnessTop = tableTop + tableHeight + 42;
    const historyTop = fairnessTop + 166;
    const historyRows = Math.max(1, Math.ceil(history.length / 2));
    const historyHeight = history.length ? 52 + historyRows * 42 : 116;
    const logicalHeight = historyTop + historyHeight + 78;
    progress.logicalHeight = logicalHeight;

    const createCanvas = options.createCanvas || (() => document.createElement("canvas"));
    const canvas = createCanvas();
    const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 2;
    canvas.width = Math.round(LOGICAL_WIDTH * scale);
    canvas.height = Math.round(logicalHeight * scale);
    if (canvas.style) {
      canvas.style.width = `${LOGICAL_WIDTH}px`;
      canvas.style.height = `${logicalHeight}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("공대 파밍표 이미지를 그릴 수 없습니다.");
    context.scale(scale, scale);
    context.textBaseline = "middle";

    drawHeader(context, room, members, selectedWeek, progress, headerTop);
    drawWeekStrip(context, room, counts, selectedWeek, weekTop);
    drawGearTable(context, members, effective, tableTop);
    drawFairness(context, statistics, fairnessTop, selectedWeek);
    drawHistory(context, history, selectedUndoneCount, historyTop, selectedWeek);

    context.fillStyle = "#75817c";
    context.font = `500 12px ${FONT_FAMILY}`;
    context.fillText("공대 파밍표 · huis-snow.github.io/tools/raid-loot-maker/", 54, logicalHeight - 36);
    context.textAlign = "right";
    context.fillText(`${selectedWeek}주차 종료 시점 · 활성 기록 기준`, LOGICAL_WIDTH - 54, logicalHeight - 36);
    context.textAlign = "left";
    return canvas;
  }

  const api = { STATUS_STYLE, renderRaidLootSummaryImage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RaidLootImage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
