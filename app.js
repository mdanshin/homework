const app = document.querySelector("#app");
const statusChip = document.querySelector("[data-status]");
const todayLabel = document.querySelector("[data-today]");

const SUBJECT_META = {
  math: { shortTitle: "Математика", initial: "М", className: "math" },
  russian: { shortTitle: "Русский", initial: "Р", className: "russian" },
  english: { shortTitle: "English", initial: "EN", className: "english" }
};

init().catch((error) => {
  console.error(error);
  setStatus("Ошибка");
  app.innerHTML = renderMessage(
    "Не удалось загрузить сайт",
    "Проверь, что страница открыта через GitHub Pages или локальный web-сервер, а файлы data/current.json и задания доступны."
  );
});

async function init() {
  const reportCode = getReportCodeFromHash();

  if (reportCode) {
    await renderReportMode(reportCode);
    return;
  }

  await renderCurrentAssignment();
}

async function renderCurrentAssignment() {
  setStatus("Загрузка");
  const current = await loadJson("data/current.json");
  const assignment = await loadAssignment(current.assignmentId);
  updateHeader(assignment, "Задание");
  renderAssignment(assignment);
}

async function renderReportMode(reportCode) {
  setStatus("Отчёт");
  const report = await decodeReportCode(reportCode);
  const assignment = await loadAssignment(report.payload.assignmentId);
  const result = await evaluateAssignment(assignment, report.payload.answers);
  const settings = await loadSettings();

  updateHeader(assignment, "Отчёт");
  renderReportAccess(assignment, report, result, reportCode, settings);
}

async function loadSettings() {
  return loadJson("data/settings.json");
}

function renderReportAccess(assignment, report, result, reportCode, settings, error = "") {
  const submittedAt = report.payload.submittedAt
    ? new Date(report.payload.submittedAt).toLocaleString("ru-RU")
    : "не указано";

  app.innerHTML = `
    <section class="report-panel parent-gate">
      <h2>Родительский доступ</h2>
      <p>${escapeHtml(assignment.title)}. Отправлено: ${escapeHtml(submittedAt)}.</p>
      <p>Введите PIN, чтобы открыть оценку, ответы ребёнка и разбор. Без PIN отчёт не показывает результат.</p>
      <form class="pin-form" data-pin-form>
        <label>
          <span class="task-points">PIN родителя</span>
          <input class="answer-input" name="parentPin" type="password" inputmode="numeric" autocomplete="off" placeholder="Введите PIN" required>
        </label>
        ${error ? `<p class="warning">${escapeHtml(error)}</p>` : ""}
        <button class="button" type="submit">Открыть отчёт</button>
      </form>
      <a class="button ghost" href="${escapeAttribute(location.href.split("#")[0])}">Открыть текущее задание</a>
    </section>
  `;

  app.querySelector("[data-pin-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const pin = String(formData.get("parentPin") || "").trim();
    const pinHash = await sha256Hex(`${settings.parentAccess.salt}:${pin}`);

    if (pinHash !== settings.parentAccess.pinHash) {
      renderReportAccess(assignment, report, result, reportCode, settings, "PIN не подошёл. Проверьте цифры и попробуйте ещё раз.");
      return;
    }

    renderVerifiedReport(assignment, report, result, reportCode);
  });
}

function renderVerifiedReport(assignment, report, result, reportCode) {
  renderAssignment(assignment, {
    answers: report.payload.answers,
    result,
    reportCode,
    reportView: true,
    showReview: true,
    reportMeta: {
      checksum: report.checksum,
      checksumValid: report.checksumValid,
      submittedAt: report.payload.submittedAt
    },
    readonly: true
  });
}

async function loadAssignment(assignmentId) {
  return loadJson(`data/assignments/${encodeURIComponent(assignmentId)}.json`);
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-cache" });

  if (!response.ok) {
    throw new Error(`Cannot load ${path}: ${response.status}`);
  }

  return response.json();
}

function updateHeader(assignment, status) {
  setStatus(status);
  todayLabel.textContent = `${assignment.dateLabel || assignment.title} · ${assignment.level}`;
}

function setStatus(value) {
  statusChip.textContent = value;
}

function getReportCodeFromHash() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  return params.get("report");
}

function renderAssignment(assignment, options = {}) {
  const tasks = getAllTasks(assignment);
  const answers = options.answers || {};
  const result = options.result || null;
  const showReview = Boolean(result && options.showReview);
  const readonly = Boolean(options.readonly || result);

  app.innerHTML = `
    ${renderReportIntro(options, assignment)}
    ${renderSummary(assignment, showReview ? result : null)}
    <form class="homework-form" data-homework-form>
      <div class="subject-list">
        ${assignment.subjects.map((subject) => renderSubject(subject, answers, result, readonly, showReview)).join("")}
      </div>
      ${result ? renderResultPanel(assignment, result, options, showReview) : renderActionBar(tasks.length)}
    </form>
  `;

  const form = app.querySelector("[data-homework-form]");

  if (!result) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleSubmit(assignment, form);
    });
  }

  attachResultActions(assignment, options, result);
}

async function handleSubmit(assignment, form) {
  const answers = collectAnswers(assignment, form);
  const result = await evaluateAssignment(assignment, answers);
  const reportPayload = {
    v: 1,
    assignmentId: assignment.id,
    submittedAt: new Date().toISOString(),
    answers
  };
  const reportCode = await createReportCode(reportPayload);

  renderAssignment(assignment, {
    answers,
    result,
    reportCode,
    reportMeta: {
      checksum: await checksumPayload(reportPayload),
      checksumValid: true,
      submittedAt: reportPayload.submittedAt
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderReportIntro(options, assignment) {
  if (!options.reportView || !options.reportMeta) {
    return "";
  }

  const submittedAt = options.reportMeta.submittedAt
    ? new Date(options.reportMeta.submittedAt).toLocaleString("ru-RU")
    : "не указано";
  const checksumText = options.reportMeta.checksumValid ? "Контрольная сумма совпала" : "Контрольная сумма не совпала";
  const warning = options.reportMeta.checksumValid
    ? ""
    : `<p class="warning">Код отчёта был изменён или повреждён. Результат пересчитан по тем ответам, которые удалось прочитать.</p>`;

  return `
    <section class="report-panel">
      <h2>Отчёт по заданию</h2>
      <p>${escapeHtml(assignment.title)}. Отправлено: ${escapeHtml(submittedAt)}.</p>
      <span class="checksum">${escapeHtml(checksumText)} · ${escapeHtml(options.reportMeta.checksum || "нет")}</span>
      ${warning}
      <a class="button ghost" href="${escapeAttribute(location.href.split("#")[0])}">Открыть текущее задание</a>
    </section>
  `;
}

function renderSummary(assignment, result) {
  const subjectScores = result ? result.subjects : null;

  return `
    <section class="summary-grid" aria-label="Предметы">
      ${assignment.subjects.map((subject) => {
        const meta = getSubjectMeta(subject.id);
        const score = subjectScores ? subjectScores[subject.id] : null;
        const caption = score ? `${score.correct}/${score.total} правильно` : `${subject.tasks.length} задачи`;

        return `
          <article class="subject-summary ${meta.className}">
            <strong>${escapeHtml(meta.initial)}</strong>
            <span>${escapeHtml(subject.title)}</span>
            <span>${escapeHtml(caption)}</span>
          </article>
        `;
      }).join("")}
    </section>
  `;
}

function renderSubject(subject, answers, result, readonly, showReview) {
  const meta = getSubjectMeta(subject.id);

  return `
    <section class="subject-section" aria-labelledby="section-${escapeAttribute(subject.id)}">
      <div class="section-head">
        <h2 id="section-${escapeAttribute(subject.id)}">${escapeHtml(subject.title)}</h2>
        <span>${subject.tasks.length} задачи</span>
      </div>
      <div class="task-list">
        ${subject.tasks.map((task, index) => renderTask(task, meta, index, answers, result, readonly, showReview)).join("")}
      </div>
    </section>
  `;
}

function renderTask(task, meta, index, answers, result, readonly, showReview) {
  const answer = answers[task.id] ?? getEmptyAnswer(task);
  const taskResult = result && showReview ? result.taskResults[task.id] : null;
  const stateClass = taskResult ? (taskResult.correct ? "is-correct" : "is-wrong") : "";

  return `
    <article class="task-card ${meta.className} ${stateClass}">
      <div class="task-inner">
        <div class="task-meta">
          <span class="pill">${escapeHtml(meta.shortTitle)}</span>
          <span class="task-points">Задача ${index + 1} · ${task.points || 1} балл</span>
        </div>
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <p class="task-question">${formatText(task.question)}</p>
          ${task.instruction ? `<p class="task-instruction">${formatText(task.instruction)}</p>` : ""}
        </div>
        ${renderTaskInput(task, answer, readonly)}
        ${taskResult ? renderFeedback(task, taskResult, answer) : ""}
      </div>
    </article>
  `;
}

function renderTaskInput(task, answer, readonly) {
  if (task.type === "singleChoice" || task.type === "multiChoice") {
    return renderChoiceInput(task, answer, readonly);
  }

  const inputMode = task.type === "number" ? "decimal" : "text";

  return `
    <label>
      <span class="visually-hidden">Ответ</span>
      <input
        class="answer-input"
        name="${escapeAttribute(task.id)}"
        type="text"
        inputmode="${inputMode}"
        autocomplete="off"
        placeholder="${escapeAttribute(task.placeholder || "Ответ")}"
        value="${escapeAttribute(String(answer || ""))}"
        ${readonly ? "disabled" : ""}
      >
    </label>
  `;
}

function renderChoiceInput(task, answer, readonly) {
  const selected = Array.isArray(answer) ? answer : [answer];
  const inputType = task.type === "multiChoice" ? "checkbox" : "radio";

  return `
    <fieldset class="choice-list">
      <legend class="visually-hidden">Выбери ответ</legend>
      ${task.options.map((option) => {
        const checked = selected.includes(option.id) ? "checked" : "";

        return `
          <label class="choice-option">
            <input
              type="${inputType}"
              name="${escapeAttribute(task.id)}"
              value="${escapeAttribute(option.id)}"
              ${checked}
              ${readonly ? "disabled" : ""}
            >
            <span>${escapeHtml(option.label)}</span>
          </label>
        `;
      }).join("")}
    </fieldset>
  `;
}

function renderFeedback(task, taskResult, answer) {
  const answerText = formatAnswerForDisplay(task, answer);
  const status = taskResult.correct ? "Верно" : "Неверно";
  const feedbackClass = taskResult.correct ? "ok" : "bad";
  const explanation = task.explanation ? `<p>${formatText(task.explanation)}</p>` : "";

  return `
    <div class="feedback ${feedbackClass}">
      <strong>${status}</strong>
      <p>Ответ: ${escapeHtml(answerText || "не указан")}</p>
      ${explanation}
    </div>
  `;
}

function renderActionBar(taskCount) {
  return `
    <div class="action-bar">
      <button class="submit-button" type="submit">Проверить ${taskCount} задач</button>
      <p class="action-hint">Ответы не сохраняются в браузере. После проверки появится ссылка-отчёт для отправки родителю.</p>
    </div>
  `;
}

function renderResultPanel(assignment, result, options, showReview) {
  const reportUrl = options.reportCode ? getReportUrl(options.reportCode) : "";
  const telegramUrl = reportUrl
    ? `https://t.me/share/url?url=${encodeURIComponent(reportUrl)}&text=${encodeURIComponent("Результат домашнего задания")}`
    : "";

  if (!showReview) {
    return `
      <section class="result-panel" aria-labelledby="result-title">
        <div class="result-title">
          <h2 id="result-title">Отчёт готов</h2>
          <p>Работа проверена и зафиксирована в ссылке. Оценка, баллы и разбор откроются только в родительском отчёте после ввода PIN.</p>
        </div>
        ${reportUrl ? `
          <div class="review-gate">
            <strong>Отправь отчёт родителю</strong>
            <p>В Telegram будет отправлена ссылка без открытой оценки. Родитель откроет её на этом сайте и увидит результат после PIN.</p>
          </div>
          <div class="button-row report-actions">
            <button class="button secondary" type="button" data-copy-report data-report-url="${escapeAttribute(reportUrl)}">Скопировать отчёт</button>
            <a class="button" href="${escapeAttribute(telegramUrl)}" target="_blank" rel="noopener" data-telegram-report>Отправить в Telegram</a>
          </div>
        ` : ""}
      </section>
    `;
  }

  return `
    <section class="result-panel" aria-labelledby="result-title">
      <div class="result-topline">
        <div class="result-title">
          <h2 id="result-title">Оценка за день</h2>
          <p>${escapeHtml(assignment.title)} · ${result.score}/${result.maxScore} баллов</p>
        </div>
        <div class="grade-badge" aria-label="Оценка ${result.grade}">
          <strong>${result.grade}</strong>
        </div>
      </div>
      <div class="score-list">
        ${assignment.subjects.map((subject) => {
          const score = result.subjects[subject.id];
          return `
            <div class="score-card">
              <strong>${score.correct}/${score.total}</strong>
              <span>${escapeHtml(subject.title)}</span>
            </div>
          `;
        }).join("")}
      </div>
      ${reportUrl ? `
        <div class="review-gate is-open">
          <strong>Родительский отчёт открыт</strong>
          <p>Ниже показаны ответы ребёнка, правильность и объяснения.</p>
        </div>
        <div class="button-row report-actions">
          <button class="button secondary" type="button" data-copy-report data-report-url="${escapeAttribute(reportUrl)}">Скопировать отчёт</button>
          <a class="button" href="${escapeAttribute(telegramUrl)}" target="_blank" rel="noopener" data-telegram-report>Отправить в Telegram</a>
        </div>
      ` : ""}
    </section>
  `;
}

function attachResultActions(assignment, options, result) {
  const copyButton = app.querySelector("[data-copy-report]");
  const telegramLink = app.querySelector("[data-telegram-report]");
  const reportUrl = copyButton?.dataset.reportUrl || "";

  if (!copyButton && !telegramLink) {
    return;
  }

  copyButton?.addEventListener("click", async () => {
    const copied = await copyText(reportUrl);
    copyButton.textContent = copied ? "Отчёт скопирован" : "Открой Telegram";
  });

  telegramLink?.addEventListener("click", () => {
    telegramLink.textContent = "Telegram открыт";
  });
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function collectAnswers(assignment, form) {
  const formData = new FormData(form);
  const answers = {};

  for (const task of getAllTasks(assignment)) {
    if (task.type === "multiChoice") {
      answers[task.id] = formData.getAll(task.id).map(String).sort();
    } else {
      answers[task.id] = String(formData.get(task.id) || "");
    }
  }

  return answers;
}

async function evaluateAssignment(assignment, answers) {
  const subjects = {};
  const taskResults = {};
  let score = 0;
  let maxScore = 0;

  for (const subject of assignment.subjects) {
    let subjectCorrect = 0;
    let subjectTotal = 0;

    for (const task of subject.tasks) {
      const correct = await isCorrectAnswer(task, answers[task.id]);
      const points = task.points || 1;

      maxScore += points;
      subjectTotal += points;

      if (correct) {
        score += points;
        subjectCorrect += points;
      }

      taskResults[task.id] = { correct, points };
    }

    subjects[subject.id] = {
      correct: subjectCorrect,
      total: subjectTotal
    };
  }

  return {
    score,
    maxScore,
    grade: calculateGrade(score, maxScore),
    subjects,
    taskResults
  };
}

async function isCorrectAnswer(task, answer) {
  const normalized = normalizeAnswer(task, answer);

  if (!normalized) {
    return false;
  }

  const hash = await sha256Hex(normalized);
  return task.answerHashes.includes(hash);
}

function calculateGrade(score, maxScore) {
  const percent = maxScore ? score / maxScore : 0;

  if (percent >= 8 / 9) return 5;
  if (percent >= 6 / 9) return 4;
  if (percent >= 4 / 9) return 3;
  return 2;
}

function normalizeAnswer(task, answer) {
  if (task.type === "multiChoice") {
    return (Array.isArray(answer) ? answer : [answer]).filter(Boolean).map(String).sort().join("|");
  }

  if (task.type === "singleChoice") {
    return normalizeScalar(answer);
  }

  if (task.type === "number") {
    return normalizeScalar(answer).replace(",", ".").replace(/\s+/g, "");
  }

  return normalizeScalar(answer)
    .replace(/\s*\/\s*/g, "/")
    .replace(/[\.,!?;:]+$/g, "");
}

function normalizeScalar(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\u00a0/g, " ")
    .replace(/[“”«»]/g, "\"")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function createReportCode(payload) {
  const checksum = await checksumPayload(payload);
  return base64UrlEncode(JSON.stringify({ payload, checksum }));
}

async function decodeReportCode(code) {
  const parsed = JSON.parse(base64UrlDecode(code));
  const payload = parsed.payload;
  const checksum = parsed.checksum;
  const expectedChecksum = await checksumPayload(payload);

  if (!payload || payload.v !== 1 || !payload.assignmentId || !payload.answers) {
    throw new Error("Invalid report payload");
  }

  return {
    payload,
    checksum,
    checksumValid: checksum === expectedChecksum
  };
}

async function checksumPayload(payload) {
  return (await sha256Hex(stableStringify(payload))).slice(0, 16);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

async function sha256Hex(value) {
  if (window.crypto && window.crypto.subtle && window.isSecureContext) {
    const data = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(digest));
  }

  return sha256Fallback(value);
}

function sha256Fallback(value) {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  const view = new DataView(padded.buffer);
  const words = new Uint32Array(64);

  padded.set(bytes);
  padded[bytes.length] = 0x80;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(chunk + i * 4);
    }

    for (let i = 16; i < 64; i += 1) {
      const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[i] + words[i]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function getAllTasks(assignment) {
  return assignment.subjects.flatMap((subject) => subject.tasks);
}

function getSubjectMeta(subjectId) {
  return SUBJECT_META[subjectId] || { shortTitle: subjectId, initial: subjectId.slice(0, 2), className: subjectId };
}

function getEmptyAnswer(task) {
  return task.type === "multiChoice" ? [] : "";
}

function getReportUrl(reportCode) {
  return `${location.href.split("#")[0]}#report=${reportCode}`;
}

function formatAnswerForDisplay(task, answer) {
  if (task.type === "multiChoice") {
    return (Array.isArray(answer) ? answer : []).map((value) => optionLabel(task, value)).join(", ");
  }

  if (task.type === "singleChoice") {
    return optionLabel(task, answer);
  }

  return String(answer || "").trim();
}

function optionLabel(task, value) {
  const option = task.options.find((item) => item.id === value);
  return option ? option.label : String(value || "");
}

function renderMessage(title, text) {
  return `
    <section class="message-card">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
    </section>
  `;
}

function formatText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
