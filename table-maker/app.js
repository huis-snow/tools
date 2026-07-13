(function (root) {
  "use strict";

  const SAMPLE_DATA = [
    "이름\t역할\t상태",
    "김민지\t디자이너\t진행 중",
    "Alex\t개발자\t완료 ✅",
    "佐藤\t리서처\t대기",
  ].join("\n");

  const BORDER_STYLES = {
    rounded: {
      horizontal: "─",
      vertical: "│",
      top: ["╭", "┬", "╮"],
      middle: ["├", "┼", "┤"],
      bottom: ["╰", "┴", "╯"],
    },
    square: {
      horizontal: "─",
      vertical: "│",
      top: ["┌", "┬", "┐"],
      middle: ["├", "┼", "┤"],
      bottom: ["└", "┴", "┘"],
    },
    heavy: {
      horizontal: "━",
      vertical: "┃",
      top: ["┏", "┳", "┓"],
      middle: ["┣", "╋", "┫"],
      bottom: ["┗", "┻", "┛"],
    },
    ascii: {
      horizontal: "-",
      vertical: "|",
      top: ["+", "+", "+"],
      middle: ["+", "+", "+"],
      bottom: ["+", "+", "+"],
    },
  };

  let graphemeSegmenter;
  try {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } catch (_error) {
    graphemeSegmenter = null;
  }

  let markPattern;
  let emojiPattern;
  try {
    markPattern = /^\p{Mark}$/u;
    emojiPattern = /\p{Extended_Pictographic}/u;
  } catch (_error) {
    markPattern = null;
    emojiPattern = null;
  }

  function splitGraphemes(value) {
    const text = String(value ?? "");
    if (graphemeSegmenter) {
      return Array.from(graphemeSegmenter.segment(text), (entry) => entry.segment);
    }
    return Array.from(text);
  }

  function isCombiningCodePoint(codePoint, character) {
    if (markPattern && markPattern.test(character)) return true;

    return (
      (codePoint >= 0x0300 && codePoint <= 0x036f) ||
      (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
      (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
      (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
      (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
    );
  }

  function isZeroWidthCodePoint(codePoint, character) {
    return (
      codePoint === 0x00ad ||
      codePoint === 0x034f ||
      codePoint === 0x061c ||
      codePoint === 0x115f ||
      codePoint === 0x200b ||
      codePoint === 0x200c ||
      codePoint === 0x200d ||
      codePoint === 0x2060 ||
      codePoint === 0xfeff ||
      (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
      (codePoint >= 0xe0020 && codePoint <= 0xe007f) ||
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
      (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
      (codePoint >= 0x1160 && codePoint <= 0x11ff) ||
      isCombiningCodePoint(codePoint, character)
    );
  }

  function isFullwidthCodePoint(codePoint) {
    if (codePoint < 0x1100) return false;

    return (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
      (codePoint >= 0x3040 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1b000 && codePoint <= 0x1b2ff) ||
      (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    );
  }

  function isEmojiCluster(cluster) {
    if (/\ufe0e/u.test(cluster)) return false;
    if (emojiPattern && emojiPattern.test(cluster)) return true;
    if (/\u20e3/u.test(cluster)) return true;

    const regionalIndicators = Array.from(cluster).filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
    });
    return regionalIndicators.length >= 2;
  }

  function displayWidth(value) {
    const text = String(value ?? "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
    let width = 0;

    for (const cluster of splitGraphemes(text)) {
      if (isEmojiCluster(cluster)) {
        width += 2;
        continue;
      }

      for (const character of Array.from(cluster)) {
        const codePoint = character.codePointAt(0);
        if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) continue;
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
        if (isZeroWidthCodePoint(codePoint, character)) continue;
        width += isFullwidthCodePoint(codePoint) ? 2 : 1;
      }
    }

    return width;
  }

  function padCell(value, targetWidth, alignment) {
    const text = String(value ?? "");
    const remaining = Math.max(0, targetWidth - displayWidth(text));

    if (alignment === "right") return " ".repeat(remaining) + text;
    if (alignment === "center") {
      const left = Math.floor(remaining / 2);
      return " ".repeat(left) + text + " ".repeat(remaining - left);
    }
    return text + " ".repeat(remaining);
  }

  function detectDelimiter(text) {
    const lines = String(text)
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(0, 8);

    if (!lines.length) return "\t";

    const candidates = ["\t", ",", "|"];
    let winner = "\t";
    let bestScore = 0;

    for (const delimiter of candidates) {
      const counts = lines.map((line) => countUnquoted(line, delimiter));
      const positive = counts.filter((count) => count > 0);
      if (!positive.length) continue;

      const common = mode(positive);
      const consistency = counts.filter((count) => count === common).length / lines.length;
      const score = consistency * 100 + common;
      if (score > bestScore) {
        bestScore = score;
        winner = delimiter;
      }
    }

    return winner;
  }

  function countUnquoted(line, delimiter) {
    let quoted = false;
    let count = 0;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === '"') {
        if (quoted && line[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && line[index] === delimiter) {
        count += 1;
      }
    }
    return count;
  }

  function mode(values) {
    const frequencies = new Map();
    let result = values[0];
    for (const value of values) {
      const count = (frequencies.get(value) || 0) + 1;
      frequencies.set(value, count);
      if (count > (frequencies.get(result) || 0)) result = value;
    }
    return result;
  }

  function parseDelimited(text, delimiter) {
    const source = String(text ?? "").replace(/\r\n?/g, "\n");
    if (!source.trim()) return [];

    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];

      if (character === '"') {
        if (quoted && source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === delimiter && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else if (character === "\n" && !quoted) {
        row.push(cell.trim());
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += character;
      }
    }

    row.push(cell.trim());
    if (row.some((value) => value !== "")) rows.push(row);

    if (delimiter === "|") {
      return rows.map((values) => {
        const result = values.slice();
        if (result[0] === "") result.shift();
        if (result[result.length - 1] === "") result.pop();
        return result;
      });
    }

    return rows;
  }

  function normalizeRows(rows) {
    const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    return rows.map((row) =>
      Array.from({ length: columnCount }, (_, index) => String(row[index] ?? "").replace(/\s*\n\s*/g, " ")),
    );
  }

  function buildRule(widths, padding, characters) {
    const segments = widths.map((width) => characters.horizontal.repeat(width + padding * 2));
    return characters.edges[0] + segments.join(characters.edges[1]) + characters.edges[2];
  }

  function buildMarkdownTable(rows, _widths, alignments, hasHeader) {
    if (!rows.length) return "";
    const safeRows = rows.map((row) => row.map((cell) => String(cell).replace(/\|/g, "\\|")));
    const widths = Array.from({ length: safeRows[0].length }, (_, index) =>
      Math.max(5, ...safeRows.map((row) => displayWidth(row[index]))),
    );
    const body = safeRows.map((row) =>
      "| " + row.map((cell, index) => padCell(cell, widths[index], alignments[index])).join(" | ") + " |",
    );

    const rules = widths.map((width, index) => {
      const alignment = alignments[index];
      if (alignment === "right") return "-".repeat(width - 1) + ":";
      if (alignment === "center") return ":" + "-".repeat(width - 2) + ":";
      return ":" + "-".repeat(width - 1);
    });

    const ruleLine = "| " + rules.join(" | ") + " |";
    if (hasHeader) {
      body.splice(1, 0, ruleLine);
    } else {
      const blankHeader = "| " + widths.map((width) => " ".repeat(width)).join(" | ") + " |";
      body.unshift(blankHeader, ruleLine);
    }
    return body.join("\n");
  }

  function generateTable(rawRows, options = {}) {
    const rows = normalizeRows(rawRows);
    if (!rows.length) return "";

    const columnCount = rows[0].length;
    const alignments = Array.from({ length: columnCount }, (_, index) => options.alignments?.[index] || "left");
    const widths = Array.from({ length: columnCount }, (_, index) =>
      Math.max(0, ...rows.map((row) => displayWidth(row[index]))),
    );

    if (options.style === "markdown") {
      return buildMarkdownTable(rows, widths, alignments, options.hasHeader !== false);
    }

    const style = BORDER_STYLES[options.style] || BORDER_STYLES.rounded;
    const padding = Number.isFinite(options.padding) ? options.padding : 1;
    const top = buildRule(widths, padding, { horizontal: style.horizontal, edges: style.top });
    const middle = buildRule(widths, padding, { horizontal: style.horizontal, edges: style.middle });
    const bottom = buildRule(widths, padding, { horizontal: style.horizontal, edges: style.bottom });
    const lines = [top];

    rows.forEach((row, rowIndex) => {
      const cells = row.map((cell, columnIndex) => {
        const padded = padCell(cell, widths[columnIndex], alignments[columnIndex]);
        return " ".repeat(padding) + padded + " ".repeat(padding);
      });
      lines.push(style.vertical + cells.join(style.vertical) + style.vertical);
      if (options.hasHeader && rowIndex === 0 && rows.length > 1) lines.push(middle);
    });

    lines.push(bottom);
    return lines.join("\n");
  }

  async function renderTableImage(value, options = {}) {
    if (typeof document === "undefined") throw new Error("이미지는 브라우저에서만 만들 수 있습니다.");

    const text = String(value ?? "");
    if (!text.trim()) throw new Error("이미지로 만들 표가 없습니다.");

    const lines = text.split("\n");
    const scale = options.scale || 2;
    const fontSize = options.fontSize || 16;
    const lineHeight = options.lineHeight || 27;
    const paddingX = 30;
    const topBarHeight = 42;
    const tablePaddingTop = 24;
    const tablePaddingBottom = 27;
    const fontFamily = '"Bandeut D2Coding", "D2Coding", "Noto Sans Mono CJK KR", monospace';

    if (document.fonts) {
      await document.fonts.ready;
      await document.fonts.load(`400 ${fontSize}px "Bandeut D2Coding"`, "한글A─│");
    }

    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");
    measureContext.font = `400 ${fontSize}px ${fontFamily}`;
    const textWidth = Math.max(...lines.map((line) => measureContext.measureText(line).width));
    const logicalWidth = Math.max(360, Math.ceil(textWidth + paddingX * 2));
    const logicalHeight = Math.ceil(topBarHeight + tablePaddingTop + lines.length * lineHeight + tablePaddingBottom);

    if (logicalWidth * scale > 16384 || logicalHeight * scale > 16384) {
      throw new Error("표가 너무 커서 한 장의 이미지로 만들 수 없습니다.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = logicalWidth * scale;
    canvas.height = logicalHeight * scale;
    const context = canvas.getContext("2d");
    context.scale(scale, scale);

    context.fillStyle = options.background || "#1e1f22";
    context.fillRect(0, 0, logicalWidth, logicalHeight);
    context.fillStyle = "#2b2d31";
    context.fillRect(0, 0, logicalWidth, topBarHeight);

    const dotColors = ["#f26d50", "#e8b94f", "#70ae64"];
    dotColors.forEach((color, index) => {
      context.beginPath();
      context.arc(18 + index * 13, topBarHeight / 2, 3.2, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    });

    context.font = `400 10px ${fontFamily}`;
    context.fillStyle = "#949ba4";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText("BANDEUT TABLE · D2CODING", logicalWidth - 18, topBarHeight / 2 + 0.5);

    context.font = `400 ${fontSize}px ${fontFamily}`;
    context.fillStyle = options.foreground || "#dbdee1";
    context.textAlign = "left";
    context.textBaseline = "top";
    lines.forEach((line, index) => {
      context.fillText(line, paddingX, topBarHeight + tablePaddingTop + index * lineHeight);
    });

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 이미지를 만들지 못했습니다."));
      }, "image/png");
    });
  }

  function delimiterPhrase(delimiter) {
    return { "\t": "탭으로", ",": "쉼표로", "|": "세로줄로" }[delimiter] || "구분자로";
  }

  function initApp() {
    const elements = {
      dataInput: document.querySelector("#dataInput"),
      delimiter: document.querySelector("#delimiterSelect"),
      border: document.querySelector("#borderSelect"),
      padding: document.querySelector("#paddingSelect"),
      header: document.querySelector("#headerToggle"),
      output: document.querySelector("#tableOutput"),
      parseStatus: document.querySelector("#parseStatus"),
      outputMeta: document.querySelector("#outputMeta"),
      alignmentList: document.querySelector("#alignmentList"),
      sampleButton: document.querySelector("#sampleButton"),
      copyButton: document.querySelector("#copyButton"),
      copyLabel: document.querySelector("#copyLabel"),
      imageButton: document.querySelector("#imageButton"),
      imageLabel: document.querySelector("#imageLabel"),
      downloadButton: document.querySelector("#downloadButton"),
      toast: document.querySelector("#toast"),
      currentYear: document.querySelector("#currentYear"),
    };

    let alignments = [];
    let lastHeaders = [];
    let toastTimer;

    function selectedDelimiter() {
      const selected = elements.delimiter.value;
      if (selected === "tab") return "\t";
      if (selected === "comma") return ",";
      if (selected === "pipe") return "|";
      return detectDelimiter(elements.dataInput.value);
    }

    function renderAlignmentControls(rows) {
      const headers = rows[0] || [];
      const signature = JSON.stringify(headers);
      if (signature === JSON.stringify(lastHeaders) && alignments.length === headers.length) return;

      lastHeaders = headers.slice();
      alignments = Array.from({ length: headers.length }, (_, index) => alignments[index] || "left");
      elements.alignmentList.replaceChildren();

      const labels = { left: "왼쪽", center: "가운데", right: "오른쪽" };
      const icons = { left: "≡↤", center: "≡", right: "↦≡" };

      headers.forEach((header, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "alignment-button";

        function updateLabel() {
          const name = header || `${index + 1}열`;
          button.textContent = `${icons[alignments[index]]} ${name}`;
          button.title = `${name}: ${labels[alignments[index]]} 정렬`;
          button.setAttribute("aria-label", `${name} 열 ${labels[alignments[index]]} 정렬. 눌러서 변경`);
        }

        button.addEventListener("click", () => {
          const order = ["left", "center", "right"];
          alignments[index] = order[(order.indexOf(alignments[index]) + 1) % order.length];
          updateLabel();
          update();
        });

        updateLabel();
        elements.alignmentList.append(button);
      });
    }

    function update() {
      const delimiter = selectedDelimiter();
      const rows = normalizeRows(parseDelimited(elements.dataInput.value, delimiter));
      renderAlignmentControls(rows);

      const output = generateTable(rows, {
        style: elements.border.value,
        padding: Number(elements.padding.value),
        hasHeader: elements.header.checked,
        alignments,
      });

      elements.output.textContent = output || "데이터를 입력하면 여기에 표가 나타납니다.";
      const columnCount = rows[0]?.length || 0;
      elements.parseStatus.textContent = rows.length
        ? `${delimiterPhrase(delimiter)} 구분한 ${rows.length}행 · ${columnCount}열`
        : "데이터를 기다리는 중";
      elements.outputMeta.textContent = output
        ? `유니코드 폭 보정 완료 · ${displayWidth(output.split("\n")[0])}칸`
        : "유니코드 폭을 자동으로 계산해요";
      elements.copyButton.disabled = !output;
      elements.imageButton.disabled = !output;
      elements.downloadButton.disabled = !output;
    }

    function showToast(message) {
      window.clearTimeout(toastTimer);
      elements.toast.textContent = message;
      elements.toast.classList.add("show");
      toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 1800);
    }

    async function copyOutput() {
      const text = elements.output.textContent;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const helper = document.createElement("textarea");
          helper.value = text;
          helper.style.position = "fixed";
          helper.style.opacity = "0";
          document.body.append(helper);
          helper.select();
          document.execCommand("copy");
          helper.remove();
        }
        elements.copyLabel.textContent = "복사 완료!";
        showToast("테이블을 클립보드에 복사했어요");
        window.setTimeout(() => (elements.copyLabel.textContent = "테이블 복사"), 1600);
      } catch (_error) {
        showToast("복사하지 못했어요. 결과를 직접 선택해 주세요.");
      }
    }

    function downloadOutput() {
      const blob = new Blob([elements.output.textContent + "\n"], { type: "text/plain;charset=utf-8" });
      downloadBlob(blob, "table.txt");
      showToast("table.txt 파일을 저장했어요");
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function copyImage() {
      const originalLabel = elements.imageLabel.textContent;
      elements.imageButton.disabled = true;
      elements.imageLabel.textContent = "이미지 만드는 중";

      try {
        const imagePromise = renderTableImage(elements.output.textContent).then(canvasToBlob);
        let copied = false;

        if (window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
          try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": imagePromise })]);
            copied = true;
          } catch (_clipboardError) {
            copied = false;
          }
        }

        if (copied) {
          elements.imageLabel.textContent = "이미지 복사 완료!";
          showToast("Discord 입력창에 바로 붙여넣을 수 있어요");
        } else {
          const blob = await imagePromise;
          downloadBlob(blob, "bandeut-table.png");
          elements.imageLabel.textContent = "PNG 저장 완료!";
          showToast("이미지 복사를 지원하지 않아 PNG로 저장했어요");
        }
      } catch (error) {
        elements.imageLabel.textContent = "다시 시도해 주세요";
        showToast(error.message || "이미지를 만들지 못했어요");
      } finally {
        window.setTimeout(() => {
          elements.imageLabel.textContent = originalLabel;
          elements.imageButton.disabled = !elements.output.textContent.trim();
        }, 1800);
      }
    }

    elements.dataInput.value = SAMPLE_DATA;
    elements.currentYear.textContent = new Date().getFullYear();
    elements.dataInput.addEventListener("input", update);
    [elements.delimiter, elements.border, elements.padding, elements.header].forEach((element) =>
      element.addEventListener("change", update),
    );
    elements.sampleButton.addEventListener("click", () => {
      elements.dataInput.value = SAMPLE_DATA;
      elements.delimiter.value = "auto";
      alignments = [];
      lastHeaders = [];
      update();
      elements.dataInput.focus();
      showToast("예시 데이터를 채웠어요");
    });
    elements.copyButton.addEventListener("click", copyOutput);
    elements.imageButton.addEventListener("click", copyImage);
    elements.downloadButton.addEventListener("click", downloadOutput);

    update();
  }

  const api = {
    displayWidth,
    padCell,
    detectDelimiter,
    parseDelimited,
    normalizeRows,
    generateTable,
    renderTableImage,
    canvasToBlob,
    splitGraphemes,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BandeutTable = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initApp);
    else initApp();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
