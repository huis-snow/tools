(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EonjepyoAvailabilityCandidates = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_COUNT = 7;
  const HOUR_COUNT = 24;
  const SLOT_COUNT = DAY_COUNT * HOUR_COUNT;
  const SLOT_BYTES = SLOT_COUNT / 8;
  const MAX_PARTICIPANTS = 200;
  const DEFAULT_DURATION = 3;

  function requireInteger(value, label, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new RangeError(`${label}은(는) ${minimum}부터 ${maximum} 사이의 정수여야 합니다.`);
    }
    return number;
  }

  function normalizeStartHour(value = 0) {
    return requireInteger(value, "시작 시각", 0, HOUR_COUNT - 1);
  }

  function normalizeStartDay(value = 0) {
    return requireInteger(value, "시작 요일", 0, DAY_COUNT - 1);
  }

  function slotIndex(hour, day) {
    return hour * DAY_COUNT + day;
  }

  function displayHours(startHour) {
    return Array.from({ length: HOUR_COUNT }, (_value, offset) => (
      (startHour + offset) % HOUR_COUNT
    ));
  }

  function displayDays(startDay) {
    return Array.from({ length: DAY_COUNT }, (_value, offset) => (
      (startDay + offset) % DAY_COUNT
    ));
  }

  function hasSlot(slots, index) {
    return Boolean(slots[index >> 3] & (1 << (index & 7)));
  }

  function normalizeParticipantCount(value) {
    return requireInteger(value, "참여자 수", 0, MAX_PARTICIPANTS);
  }

  function aggregateParticipantSchedules(participants, targetStartHour = 0) {
    if (!Array.isArray(participants)) throw new TypeError("참여자 일정은 배열이어야 합니다.");
    const participantCount = normalizeParticipantCount(participants.length);
    const startHour = normalizeStartHour(targetStartHour);
    const sources = participants.map((participant) => {
      if (!participant || typeof participant !== "object") {
        throw new TypeError("각 참여자는 일정 객체여야 합니다.");
      }
      if (!(participant.slots instanceof Uint8Array) || participant.slots.length !== SLOT_BYTES) {
        throw new TypeError(`선택 데이터는 ${SLOT_BYTES}바이트 Uint8Array여야 합니다.`);
      }
      return {
        slots: participant.slots,
        startHour: participant.startHour === undefined
          ? 0
          : normalizeStartHour(participant.startHour),
      };
    });

    const cells = Array.from({ length: SLOT_COUNT }, (_value, index) => {
      const hour = Math.floor(index / DAY_COUNT);
      const day = index % DAY_COUNT;
      const calendarDay = (day + (hour < startHour ? 1 : 0)) % DAY_COUNT;
      const participantIndexes = [];

      sources.forEach((source, participantIndex) => {
        const sourceDay = (
          calendarDay - (hour < source.startHour ? 1 : 0) + DAY_COUNT
        ) % DAY_COUNT;
        if (hasSlot(source.slots, slotIndex(hour, sourceDay))) {
          participantIndexes.push(participantIndex);
        }
      });

      return {
        index,
        hour,
        day,
        participantIndexes,
        count: participantIndexes.length,
      };
    });

    return { cells, participantCount, startHour };
  }

  function normalizeParticipantIndexes(value, expectedCount) {
    if (!Array.isArray(value)) throw new TypeError("시간 칸의 참여자 번호는 배열이어야 합니다.");
    const indexes = value.map((item) => requireInteger(
      item,
      "참여자 번호",
      0,
      MAX_PARTICIPANTS - 1,
    )).sort((left, right) => left - right);
    if (new Set(indexes).size !== indexes.length) {
      throw new Error("시간 칸에 같은 참여자가 중복되어 있습니다.");
    }
    if (expectedCount !== undefined && Number(expectedCount) !== indexes.length) {
      throw new Error("시간 칸의 참여자 수가 참여자 번호 목록과 다릅니다.");
    }
    return indexes;
  }

  function normalizeCells(cells) {
    if (!Array.isArray(cells) || cells.length !== SLOT_COUNT) {
      throw new TypeError(`취합 시간 칸은 ${SLOT_COUNT}개여야 합니다.`);
    }
    const normalized = new Array(SLOT_COUNT);
    let inferredParticipantCount = 0;

    cells.forEach((cell) => {
      if (!cell || typeof cell !== "object") throw new TypeError("취합 시간 칸이 올바르지 않습니다.");
      const hour = requireInteger(cell.hour, "시간", 0, HOUR_COUNT - 1);
      const day = requireInteger(cell.day, "요일", 0, DAY_COUNT - 1);
      const index = slotIndex(hour, day);
      if (cell.index !== undefined && Number(cell.index) !== index) {
        throw new Error("시간 칸 인덱스와 시간·요일 좌표가 다릅니다.");
      }
      if (normalized[index]) throw new Error("같은 시간 칸이 중복되어 있습니다.");
      const participantIndexes = normalizeParticipantIndexes(cell.participantIndexes, cell.count);
      if (participantIndexes.length) {
        inferredParticipantCount = Math.max(
          inferredParticipantCount,
          participantIndexes[participantIndexes.length - 1] + 1,
        );
      }
      normalized[index] = {
        index,
        hour,
        day,
        participantIndexes,
        count: participantIndexes.length,
      };
    });

    if (normalized.some((cell) => !cell)) throw new Error("일부 취합 시간 칸이 없습니다.");
    return { cells: normalized, inferredParticipantCount };
  }

  function looksLikeCellArray(value) {
    return Array.isArray(value)
      && value.length === SLOT_COUNT
      && value.every((item) => item && Array.isArray(item.participantIndexes));
  }

  function normalizeSource(source, options) {
    if (source === null || source === undefined) throw new TypeError("분석할 일정이 필요합니다.");

    const aggregateSource = looksLikeCellArray(source)
      ? { cells: source }
      : source && typeof source === "object" && Array.isArray(source.cells)
        ? source
        : null;

    if (aggregateSource) {
      const normalized = normalizeCells(aggregateSource.cells);
      const suppliedCount = options.participantCount
        ?? aggregateSource.participantCount
        ?? aggregateSource.participants?.length;
      const participantCount = suppliedCount === undefined
        ? normalized.inferredParticipantCount
        : normalizeParticipantCount(suppliedCount);
      if (participantCount < normalized.inferredParticipantCount) {
        throw new RangeError("참여자 수보다 큰 참여자 번호가 시간 칸에 있습니다.");
      }
      return {
        cells: normalized.cells,
        participantCount,
        startHour: normalizeStartHour(options.startHour ?? aggregateSource.startHour ?? 0),
      };
    }

    const participants = Array.isArray(source) ? source : source.participants;
    if (!Array.isArray(participants)) {
      throw new TypeError("취합 시간 칸 또는 참여자 일정 배열이 필요합니다.");
    }
    const startHour = normalizeStartHour(options.startHour ?? source.startHour ?? 0);
    return aggregateParticipantSchedules(participants, startHour);
  }

  function intersect(left, right) {
    const rightSet = new Set(right);
    return left.filter((value) => rightSet.has(value));
  }

  function includesEvery(container, required) {
    if (container.length < required.length) return false;
    const values = new Set(container);
    return required.every((value) => values.has(value));
  }

  function candidateKey(day, firstOffset, lastOffset, participantIndexes) {
    return `${day}:${firstOffset}-${lastOffset}:${participantIndexes.join(".")}`;
  }

  function buildCandidate({
    day,
    dayOrder,
    firstOffset,
    lastOffset,
    hours,
    participantIndexes,
    participantCount,
    startHour,
  }) {
    const duration = lastOffset - firstOffset + 1;
    const firstHour = hours[firstOffset];
    const timelineStartHour = startHour + firstOffset;
    const timelineEndHour = timelineStartHour + duration;
    const slotIndexes = hours
      .slice(firstOffset, lastOffset + 1)
      .map((hour) => slotIndex(hour, day));
    const attendees = new Set(participantIndexes);
    const missingParticipantIndexes = Array.from(
      { length: participantCount },
      (_value, participantIndex) => participantIndex,
    ).filter((participantIndex) => !attendees.has(participantIndex));

    return Object.freeze({
      id: candidateKey(day, firstOffset, lastOffset, participantIndexes),
      day,
      dayOrder,
      startOffset: firstOffset,
      endOffset: lastOffset + 1,
      startHour: firstHour,
      endHour: timelineEndHour % HOUR_COUNT,
      startDayOffset: Math.floor(timelineStartHour / HOUR_COUNT),
      endDayOffset: Math.floor(timelineEndHour / HOUR_COUNT),
      crossesMidnight: Math.floor(timelineStartHour / HOUR_COUNT)
        !== Math.floor(timelineEndHour / HOUR_COUNT),
      duration,
      participantIndexes: Object.freeze([...participantIndexes]),
      missingParticipantIndexes: Object.freeze(missingParticipantIndexes),
      attendeeCount: participantIndexes.length,
      count: participantIndexes.length,
      slotIndexes: Object.freeze(slotIndexes),
      firstIndex: slotIndexes[0],
      lastIndex: slotIndexes[slotIndexes.length - 1],
      screenOrder: dayOrder * HOUR_COUNT + firstOffset,
    });
  }

  function compareCandidates(left, right) {
    const ranked = right.attendeeCount - left.attendeeCount
      || right.duration - left.duration
      || left.screenOrder - right.screenOrder;
    if (ranked) return ranked;
    const leftParticipants = left.participantIndexes.join(",");
    const rightParticipants = right.participantIndexes.join(",");
    return leftParticipants < rightParticipants ? -1 : leftParticipants > rightParticipants ? 1 : 0;
  }

  function enumerateMaximalCandidates(cells, participantCount, startHour, startDay) {
    if (participantCount === 0) return [];
    const hours = displayHours(startHour);
    const days = displayDays(startDay);
    const unique = new Map();

    days.forEach((day, dayOrder) => {
      const rowParticipants = hours.map((hour) => cells[slotIndex(hour, day)].participantIndexes);
      for (let firstOffset = 0; firstOffset < HOUR_COUNT; firstOffset += 1) {
        let common = [...rowParticipants[firstOffset]];
        for (let lastOffset = firstOffset; lastOffset < HOUR_COUNT && common.length; lastOffset += 1) {
          if (lastOffset > firstOffset) common = intersect(common, rowParticipants[lastOffset]);
          if (!common.length) break;

          let maximalFirst = firstOffset;
          let maximalLast = lastOffset;
          while (maximalFirst > 0 && includesEvery(rowParticipants[maximalFirst - 1], common)) {
            maximalFirst -= 1;
          }
          while (
            maximalLast + 1 < HOUR_COUNT
            && includesEvery(rowParticipants[maximalLast + 1], common)
          ) {
            maximalLast += 1;
          }

          const key = candidateKey(day, maximalFirst, maximalLast, common);
          if (!unique.has(key)) {
            unique.set(key, buildCandidate({
              day,
              dayOrder,
              firstOffset: maximalFirst,
              lastOffset: maximalLast,
              hours,
              participantIndexes: common,
              participantCount,
              startHour,
            }));
          }
        }
      }
    });

    return [...unique.values()].sort(compareCandidates);
  }

  function normalizeThreshold(value, participantCount) {
    const requested = value ?? "auto";
    if (typeof requested === "string") {
      const normalized = requested.trim().toUpperCase();
      if (normalized === "AUTO") return { mode: "auto", requested: "auto", minimumAttendees: null };
      if (normalized === "N" || normalized === "N-1" || normalized === "N-2") {
        const offset = normalized === "N" ? 0 : Number(normalized.slice(2));
        return {
          mode: "minimum",
          requested: normalized,
          minimumAttendees: Math.max(participantCount - offset, participantCount ? 1 : 0),
        };
      }
      if (/^\d+$/.test(normalized)) {
        return normalizeThreshold(Number(normalized), participantCount);
      }
    }
    if (Number.isInteger(requested)) {
      if (requested < 1 || requested > participantCount || requested > MAX_PARTICIPANTS) {
        throw new RangeError("최소 참석 인원은 현재 참여자 수 안에서 정해 주세요.");
      }
      return { mode: "minimum", requested, minimumAttendees: requested };
    }
    throw new Error("후보 기준은 auto, N, N-1, N-2 또는 참석 인원 정수여야 합니다.");
  }

  function groupTiers(candidates) {
    const groups = new Map();
    candidates.forEach((candidate) => {
      if (!groups.has(candidate.attendeeCount)) groups.set(candidate.attendeeCount, []);
      groups.get(candidate.attendeeCount).push(candidate);
    });
    return [...groups.entries()]
      .sort(([left], [right]) => right - left)
      .map(([attendeeCount, tierCandidates]) => Object.freeze({
        attendeeCount,
        candidates: Object.freeze(tierCandidates),
      }));
  }

  function skyline(candidates) {
    return candidates.filter((candidate) => !candidates.some((other) => (
      other !== candidate
      && other.attendeeCount >= candidate.attendeeCount
      && other.duration >= candidate.duration
      && (
        other.attendeeCount > candidate.attendeeCount
        || other.duration > candidate.duration
      )
    )));
  }

  function findAvailabilityCandidates(source, options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("후보 설정은 객체여야 합니다.");
    }
    const duration = requireInteger(options.duration ?? DEFAULT_DURATION, "필요 연속 시간", 1, 6);
    const normalized = normalizeSource(source, options);
    const startDay = normalizeStartDay(options.startDay ?? source?.startDay ?? 0);
    const allCandidates = enumerateMaximalCandidates(
      normalized.cells,
      normalized.participantCount,
      normalized.startHour,
      startDay,
    );
    const durationCandidates = allCandidates.filter((candidate) => candidate.duration >= duration);
    const threshold = normalizeThreshold(options.threshold, normalized.participantCount);
    const automaticMinimumAttendees = normalized.participantCount
      ? Math.max(1, normalized.participantCount - 2)
      : 0;
    const automaticCandidates = durationCandidates.filter((candidate) => (
      candidate.attendeeCount >= automaticMinimumAttendees
    ));
    const selectedAttendeeCount = threshold.mode === "auto"
      ? automaticCandidates[0]?.attendeeCount ?? null
      : null;
    const minimumAttendees = threshold.mode === "auto"
      ? selectedAttendeeCount
      : threshold.minimumAttendees;
    const candidates = threshold.mode === "auto"
      ? automaticCandidates.filter((candidate) => candidate.attendeeCount === selectedAttendeeCount)
      : durationCandidates.filter((candidate) => candidate.attendeeCount >= threshold.minimumAttendees);
    const everyoneShortCandidates = allCandidates.filter((candidate) => (
      candidate.attendeeCount === normalized.participantCount
      && candidate.duration < duration
    )).sort(compareCandidates);

    return Object.freeze({
      participantCount: normalized.participantCount,
      startHour: normalized.startHour,
      startDay,
      duration,
      threshold: Object.freeze({
        ...threshold,
        effectiveMinimumAttendees: minimumAttendees,
      }),
      selectedAttendeeCount,
      candidates: Object.freeze(candidates),
      tiers: Object.freeze(groupTiers(durationCandidates)),
      allCandidates: Object.freeze(allCandidates),
      skylineCandidates: Object.freeze(skyline(automaticCandidates)),
      comparison: Object.freeze({
        everyoneShortCandidates: Object.freeze(everyoneShortCandidates),
      }),
    });
  }

  return Object.freeze({
    DAY_COUNT,
    HOUR_COUNT,
    SLOT_COUNT,
    SLOT_BYTES,
    MAX_PARTICIPANTS,
    DEFAULT_DURATION,
    aggregateParticipantSchedules,
    findAvailabilityCandidates,
  });
});
