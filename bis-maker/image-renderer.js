(function (root) {
  "use strict";

  const core = root.BisTrackerCore || (typeof require === "function" ? require("./core.js") : null);
  if (!core) throw new Error("비스표 이미지에 필요한 데이터 모듈을 불러오지 못했습니다.");

  const STATUS_STYLE = Object.freeze({
    complete: Object.freeze({ label: "완료", background: "#dcebdd", foreground: "#24613d" }),
    upgrade: Object.freeze({ label: "보강 필요", background: "#f7ebc7", foreground: "#7b5b16" }),
    raid: Object.freeze({ label: "영식 필요", background: "#f8ddd4", foreground: "#9b422c" }),
    empty: Object.freeze({ label: "미입력", background: "#ebe9e0", foreground: "#7b837f" }),
  });

  function truncateText(context, value, maximumWidth) {
    const text = String(value ?? "");
    if (context.measureText(text).width <= maximumWidth) return text;
    let output = text;
    while (output && context.measureText(`${output}…`).width > maximumWidth) {
      output = output.slice(0, -1);
    }
    return `${output}…`;
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

  function fillTextCentered(context, text, x, y, width) {
    context.fillText(truncateText(context, text, width - 16), x + width / 2, y);
  }

  function distributionLines(room, members) {
    // 저장된 분배는 이후 장비 상태가 완료로 바뀌어도 그 주의 기록으로 남긴다.
    const plan = core.distributionPlan(room.distribution);
    const memberMap = new Map(members.map((member) => [member.seat, member]));
    const lines = [];
    core.DROP_TYPES.forEach((dropType) => {
      const count = room.distribution.dropCounts[dropType];
      if (!count) return;
      const assignments = plan.assignments.filter((item) => item.dropType === dropType);
      const unassigned = plan.unassignedDrops.filter((item) => item.dropType === dropType).length;
      const recipients = assignments.map((item) => {
        const member = memberMap.get(item.seat);
        return `${item.seat} ${member?.nickname || ""} · ${core.GEAR_LABELS[item.gearSlot]}`;
      });
      if (unassigned) recipients.push(`미분배 ${unassigned}개`);
      lines.push({
        label: core.DROP_SPECS[dropType].label,
        count,
        recipients: recipients.join(" / ") || "미분배",
      });
    });
    return lines;
  }

  function renderBisSummaryImage(roomValue, membersValue, options = {}) {
    const roomSource = { ...(roomValue || {}) };
    const roomId = String(roomSource.id || "");
    delete roomSource.id;
    const room = core.normalizeRoomSnapshot(roomSource, roomId);
    const members = core.normalizeMembers(membersValue);
    const createCanvas = options.createCanvas || (() => document.createElement("canvas"));
    const canvas = createCanvas();
    const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 2;
    const logicalWidth = 1480;
    const margin = 54;
    const labelWidth = 150;
    const memberWidth = (logicalWidth - margin * 2 - labelWidth) / core.SEATS.length;
    const headerHeight = 220;
    const memberHeaderHeight = 92;
    const rowHeight = 58;
    const tableHeight = memberHeaderHeight + core.GEAR_SLOTS.length * rowHeight;
    const lootLines = distributionLines(room, members);
    const lootHeight = lootLines.length ? 104 + lootLines.length * 46 : 0;
    const logicalHeight = headerHeight + tableHeight + lootHeight + 94;

    canvas.width = Math.round(logicalWidth * scale);
    canvas.height = Math.round(logicalHeight * scale);
    if (canvas.style) {
      canvas.style.width = `${logicalWidth}px`;
      canvas.style.height = `${logicalHeight}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("비스표 이미지를 그릴 수 없습니다.");
    context.scale(scale, scale);
    context.textBaseline = "middle";

    context.fillStyle = "#f4f1e8";
    context.fillRect(0, 0, logicalWidth, logicalHeight);
    context.fillStyle = "#153c34";
    context.fillRect(0, 0, logicalWidth, 12);

    context.fillStyle = "#d8522a";
    context.font = "700 17px ui-monospace, monospace";
    context.fillText("FFXIV · PARTY BIS", margin, 55);
    context.fillStyle = "#153c34";
    context.font = "800 38px system-ui, sans-serif";
    context.fillText(truncateText(context, room.title, 900), margin, 103);
    context.fillStyle = "#5f716a";
    context.font = "600 20px system-ui, sans-serif";
    context.fillText(`${room.tier} · ${room.week}주차`, margin, 145);

    const submittedCount = members.filter((member) => member.submitted).length;
    const completedCount = members.reduce((total, member) => {
      if (!member.submitted) return total;
      const gear = core.decodeGear(member.gear, { allowUnset: false });
      return total + core.GEAR_SLOTS.filter((slot) => gear[slot] === "complete").length;
    }, 0);
    const progressLabel = `${completedCount} / ${core.GEAR_SLOTS.length * core.SEATS.length}개 완료 · ${submittedCount} / 8명 입력`;
    context.fillStyle = "#153c34";
    context.font = "700 18px system-ui, sans-serif";
    context.textAlign = "right";
    context.fillText(progressLabel, logicalWidth - margin, 103);
    context.fillStyle = room.locked ? "#9b422c" : "#24613d";
    context.font = "700 15px system-ui, sans-serif";
    context.fillText(room.locked ? "입력 마감" : "입력 중", logicalWidth - margin, 145);
    context.textAlign = "left";

    const tableTop = headerHeight;
    const tableLeft = margin;
    const tableWidth = logicalWidth - margin * 2;
    context.fillStyle = "#153c34";
    context.fillRect(tableLeft, tableTop, tableWidth, memberHeaderHeight);
    context.fillStyle = "#f7f4e9";
    context.font = "700 16px system-ui, sans-serif";
    context.fillText("장비 부위", tableLeft + 18, tableTop + memberHeaderHeight / 2);

    members.forEach((member, memberIndex) => {
      const x = tableLeft + labelWidth + memberIndex * memberWidth;
      context.strokeStyle = "rgba(247,244,233,0.22)";
      context.beginPath();
      context.moveTo(x, tableTop);
      context.lineTo(x, tableTop + memberHeaderHeight);
      context.stroke();
      context.fillStyle = "#f9936d";
      context.font = "800 15px ui-monospace, monospace";
      context.textAlign = "center";
      context.fillText(member.seat, x + memberWidth / 2, tableTop + 22);
      context.fillStyle = "#fffdf5";
      context.font = "700 15px system-ui, sans-serif";
      fillTextCentered(context, member.nickname, x, tableTop + 49, memberWidth);
      context.fillStyle = "#b7c4be";
      context.font = "500 12px system-ui, sans-serif";
      fillTextCentered(context, member.job, x, tableTop + 71, memberWidth);
    });
    context.textAlign = "left";

    core.GEAR_SLOTS.forEach((gearSlot, rowIndex) => {
      const y = tableTop + memberHeaderHeight + rowIndex * rowHeight;
      context.fillStyle = rowIndex % 2 ? "#f7f4eb" : "#fffdf6";
      context.fillRect(tableLeft, y, tableWidth, rowHeight);
      context.strokeStyle = "#c6c7bf";
      context.strokeRect(tableLeft + 0.5, y + 0.5, tableWidth - 1, rowHeight - 1);
      context.fillStyle = "#294b43";
      context.font = "700 15px system-ui, sans-serif";
      context.fillText(core.GEAR_LABELS[gearSlot], tableLeft + 18, y + rowHeight / 2);

      members.forEach((member, memberIndex) => {
        const x = tableLeft + labelWidth + memberIndex * memberWidth;
        const status = member.submitted
          ? core.decodeGear(member.gear, { allowUnset: false })[gearSlot]
          : null;
        const style = STATUS_STYLE[status || "empty"];
        context.fillStyle = style.background;
        roundRect(context, x + 8, y + 10, memberWidth - 16, rowHeight - 20, 7);
        context.fill();
        context.fillStyle = style.foreground;
        context.font = "700 12px system-ui, sans-serif";
        context.textAlign = "center";
        fillTextCentered(context, style.label, x + 8, y + rowHeight / 2, memberWidth - 16);
      });
      context.textAlign = "left";
    });

    if (lootLines.length) {
      const lootTop = tableTop + tableHeight + 45;
      context.fillStyle = "#153c34";
      context.font = "800 23px system-ui, sans-serif";
      context.fillText(`${room.week}주차 드랍 분배`, tableLeft, lootTop);
      context.fillStyle = "#6a7772";
      context.font = "500 13px system-ui, sans-serif";
      context.fillText("분배표에 저장된 현재 권장안", tableLeft + 210, lootTop);
      lootLines.forEach((line, index) => {
        const y = lootTop + 40 + index * 46;
        context.fillStyle = index % 2 ? "#ece9df" : "#fffdf6";
        context.fillRect(tableLeft, y, tableWidth, 38);
        context.fillStyle = "#d8522a";
        context.font = "700 14px system-ui, sans-serif";
        context.fillText(`${line.label} × ${line.count}`, tableLeft + 14, y + 19);
        context.fillStyle = "#334f48";
        context.font = "600 13px system-ui, sans-serif";
        context.fillText(truncateText(context, line.recipients, tableWidth - 260), tableLeft + 230, y + 19);
      });
    }

    context.fillStyle = "#75817c";
    context.font = "500 12px system-ui, sans-serif";
    context.fillText("비스표 · huis-snow.github.io/tools/bis-maker/", margin, logicalHeight - 38);
    context.textAlign = "right";
    context.fillText("상태와 분배안은 공유 방의 현재 데이터 기준입니다.", logicalWidth - margin, logicalHeight - 38);
    context.textAlign = "left";
    return canvas;
  }

  const api = { STATUS_STYLE, renderBisSummaryImage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BisTrackerImage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
