// ====================== MAIN.JS - CYBER-GEN TERMINAL ======================

const MODELS_FALLBACK = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash"
];

const SYSTEM_PROMPT = `Eres un ANALISTA DE DATOS SENIOR. Reglas:
1. Usa titulos (##) y negritas (**) para lo importante.
2. Aplica formato de codigo a numeros, porcentajes y montos.
3. Si el usuario pide un grafico, responde incluyendo un bloque exacto asi:
[CHART_DATA: { "type": "bar", "data": { "labels": [...], "datasets": [{"label":"...", "data":[...]}] } }]
No uses puntos suspensivos en los arrays, usa numeros reales. No envuelvas el bloque en markdown.`;

const API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();

let history = JSON.parse(localStorage.getItem("cybergen_history") || "[]");
let sessionStart = history.length;
let uploadedFiles = [];

const chatBox = document.getElementById("chat-box");
const promptInput = document.getElementById("prompt-input");
const chatForm = document.getElementById("chat-form");
const sidebar = document.getElementById("sidebar");
const modelStatus = document.getElementById("model-status");
const historyList = document.getElementById("history-list");
const fileUpload = document.getElementById("file-upload");
const filePreviewZone = document.getElementById("file-preview-zone");

function renderHistory() {
  historyList.innerHTML = "";
  history.forEach((h, i) => {
    if (h.role !== "user") return;
    const li = document.createElement("li");
    li.className = "history-item text-truncate";
    li.textContent = h.text.slice(0, 30) + "...";
    li.onclick = () => {
      chatBox.innerHTML = "";
      appendMessage("user", marked.parse(h.text));
      if (history[i + 1]?.role === "model") {
        const r = renderModelText(history[i + 1].text);
        appendMessage("model", r.html, r.charts);
      }
    };
    historyList.appendChild(li);
  });
}

function appendMessage(role, html, charts = []) {
  const id = "msg-" + Date.now() + Math.random().toString(16).slice(2);
  const div = document.createElement("div");
  div.className = `message ${role}-msg`;
  div.id = id;
  div.innerHTML = `<div class="msg-content">${html}</div>`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;

  if (role === "model" && charts.length) {
    setTimeout(() => {
      charts.forEach(ch => {
        const canvas = document.getElementById(ch.id);
        if (!canvas) return;
        try {
          new Chart(canvas.getContext("2d"), {
            type: ch.config.type,
            data: ch.config.data,
            options: { responsive: true, maintainAspectRatio: false, ...ch.config.options }
          });
        } catch (e) { console.error("Chart error:", e); }
      });
    }, 50);
  }
  return id;
}

// Extrae bloques [CHART_DATA: {...}] del texto y los convierte en <canvas>
function renderModelText(text) {
  let working = text;
  const charts = [];
  const TAG = "[CHART_DATA:";

  while (working.includes(TAG)) {
    const tagIdx = working.indexOf(TAG);
    const jsonStart = working.indexOf("{", tagIdx);
    if (jsonStart === -1) { working = working.replace(TAG, ""); continue; }

    let depth = 0, jsonEnd = -1;
    for (let i = jsonStart; i < working.length; i++) {
      if (working[i] === "{") depth++;
      else if (working[i] === "}") { depth--; if (depth === 0) { jsonEnd = i; break; } }
    }
    if (jsonEnd === -1) { working = working.replace(TAG, ""); continue; }

    const closeBracket = working.indexOf("]", jsonEnd);
    const blockEnd = (closeBracket !== -1 && closeBracket - jsonEnd < 5) ? closeBracket + 1 : jsonEnd + 1;
    const fullBlock = working.substring(tagIdx, blockEnd);
    const jsonStr = working.substring(jsonStart, jsonEnd + 1);

    try {
      const config = JSON.parse(jsonStr);
      const id = `chart-${Date.now()}-${charts.length}`;
      charts.push({ id, config });
      working = working.replace(fullBlock, `\n\n%%CHART_${charts.length - 1}%%\n\n`);
    } catch (e) {
      working = working.replace(fullBlock, "\n\n*(No se pudo generar el grafico)*\n\n");
    }
  }

  let html = marked.parse(working);
  charts.forEach((ch, i) => {
    html = html.replace(`%%CHART_${i}%%`,
      `<div class="cyber-card p-3 my-3"><div style="position:relative;width:100%;height:320px;"><canvas id="${ch.id}"></canvas></div></div>`);
  });
  return { html, charts };
}

async function callGemini(promptText, files, modelIndex = 0) {
  const model = MODELS_FALLBACK[modelIndex] || MODELS_FALLBACK[0];
  modelStatus.textContent = `LINK: ${model}`;

  const ctx = history.slice(sessionStart).slice(-8).map(h => ({ role: h.role, parts: [{ text: h.text }] }));
  const userPart = { role: "user", parts: [{ text: promptText }] };
  files.forEach(f => {
    if (f.isBase64) userPart.parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
    else userPart.parts[0].text += `\n\n[ARCHIVO: ${f.name}]\n${f.data}`;
  });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [...ctx, userPart],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
      })
    }
  );

  if (!res.ok) {
    if (modelIndex < MODELS_FALLBACK.length - 1) return callGemini(promptText, files, modelIndex + 1);
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

chatForm.onsubmit = async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text && uploadedFiles.length === 0) return;

  appendMessage("user", marked.parse(text));
  history.push({ role: "user", text });
  promptInput.value = "";

  const loadingId = appendMessage("system", '<i class="fa-solid fa-satellite-dish fa-fade"></i> Procesando...');

  try {
    if (!API_KEY) throw new Error("Falta VITE_GEMINI_API_KEY en tu .env");
    const data = await callGemini(text, [...uploadedFiles]);
    document.getElementById(loadingId).remove();

    let raw = "";
    data.candidates?.[0]?.content?.parts?.forEach(p => { if (p.text) raw += p.text; });

    const { html, charts } = renderModelText(raw);
    appendMessage("model", html, charts);

    history.push({ role: "model", text: raw });
    localStorage.setItem("cybergen_history", JSON.stringify(history));
    renderHistory();

    uploadedFiles = [];
    filePreviewZone.classList.add("d-none");
    filePreviewZone.innerHTML = "";
  } catch (err) {
    document.getElementById(loadingId).innerHTML = `<span class="text-danger">Error: ${err.message}</span>`;
  }
};

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (promptInput.value.trim() || uploadedFiles.length) chatForm.requestSubmit();
  }
});
promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = promptInput.scrollHeight + "px";
});

fileUpload.onchange = async (e) => {
  uploadedFiles = [];
  filePreviewZone.innerHTML = "";
  filePreviewZone.classList.remove("d-none");

  for (const file of e.target.files) {
    const ext = file.name.split(".").pop().toLowerCase();
    const tag = document.createElement("span");
    tag.className = "file-tag";
    tag.textContent = file.name;
    filePreviewZone.appendChild(tag);

    if (["xlsx", "xls"].includes(ext)) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      let csv = "";
      wb.SheetNames.forEach(n => { csv += `[HOJA: ${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}\n`; });
      uploadedFiles.push({ name: file.name, data: csv, isBase64: false });
    } else if (file.type === "application/pdf" || file.type.startsWith("image/")) {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      uploadedFiles.push({ name: file.name, data: b64, mimeType: file.type, isBase64: true });
    } else {
      const text = await file.text();
      uploadedFiles.push({ name: file.name, data: text, isBase64: false });
    }
  }
};

document.getElementById("clear-btn").onclick = () => {
  if (confirm("Borrar toda la memoria guardada?")) {
    localStorage.removeItem("cybergen_history");
    location.reload();
  }
};

document.getElementById("btn-download-session").onclick = () => {
  let log = "=== SESION CYBER-GEN ===\n\n";
  history.forEach(h => { log += `[${h.role.toUpperCase()}]\n${h.text}\n\n`; });
  const blob = new Blob([log], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sesion_${Date.now()}.txt`;
  a.click();
};

document.getElementById("toggle-sidebar").onclick = () => sidebar.classList.toggle("collapsed");
document.getElementById("close-sidebar").onclick = () => sidebar.classList.add("collapsed");

modelStatus.textContent = API_KEY ? `LINK: ${MODELS_FALLBACK[0]}` : "SIN API KEY";
renderHistory();
