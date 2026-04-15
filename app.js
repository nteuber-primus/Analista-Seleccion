/* ═══════════════════════════════════════════════
   Estado de la aplicación
═══════════════════════════════════════════════ */
const state = {
  history: [],          // Historial de mensajes para la API de Claude
  jobProfile: null,     // { name, blocks }
  cvs: [],              // [{ name, blocks, status }]
  isLoading: false,
  lastReport: '',
};

/* ═══════════════════════════════════════════════
   Elementos del DOM
═══════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const els = {
  // Sidebar - Perfil
  profileDropZone:  $('profileDropZone'),
  profileFileInput: $('profileFileInput'),
  profileDropContent: $('profileDropContent'),
  profileLoaded:    $('profileLoaded'),
  profileFileName:  $('profileFileName'),
  profileBadge:     $('profileBadge'),
  removeProfile:    $('removeProfile'),
  profileText:      $('profileText'),
  sendProfileText:  $('sendProfileText'),
  // Sidebar - CVs
  cvsDropZone:      $('cvsDropZone'),
  cvsFileInput:     $('cvsFileInput'),
  cvsBadge:         $('cvsBadge'),
  cvList:           $('cvList'),
  // Sidebar - Actions
  btnGenerateReport: $('btnGenerateReport'),
  btnExport:         $('btnExport'),
  btnNewSession:     $('btnNewSession'),
  // Chat
  messages:         $('messages'),
  chatStatus:       $('chatStatus'),
  statusText:       $('statusText'),
  progressInfo:     $('progressInfo'),
  progressText:     $('progressText'),
  // Input
  inputArea:        $('inputArea'),
  userInput:        $('userInput'),
  sendBtn:          $('sendBtn'),
  btnAttachCV:      $('btnAttachCV'),
  attachCVInput:    $('attachCVInput'),
  // Modal
  apiModal:         $('apiModal'),
};

/* ═══════════════════════════════════════════════
   Markdown renderer (sin dependencias externas)
═══════════════════════════════════════════════ */
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    // Escapar HTML básico
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Bloques de código (```) antes que inline code
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Encabezados
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    // Separadores
    .replace(/^---+$/gm, '<hr>')
    // Negrita e itálica
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    // Código inline
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Listas (ul)
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    // Listas (ol)
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Tablas: marcamos filas de separación para detectarlas luego
    .replace(/^\|(.+)\|$/gm, row => {
      const cells = row.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) return '<!--sep-->';
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    });

  // Envolver <li> consecutivos en <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  // Envolver <tr> en <table> — primera fila antes del separador = <thead>
  html = html.replace(/(<tr>[\s\S]*?<\/tr>\n?<!--sep-->\n?)(<tr>[\s\S]*?<\/tr>\n?)+/g, m => {
    const sepIdx = m.indexOf('<!--sep-->');
    const headerRow = m.slice(0, sepIdx).trim()
      .replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>');
    const bodyRows = m.slice(sepIdx + 10).trim();
    return `<table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`;
  });
  // Tablas sin separador (fallback)
  html = html.replace(/(<tr>[\s\S]*?<\/tr>\n?)+/g, m => {
    if (m.includes('<table>')) return m;
    return `<table>${m}</table>`;
  });

  // Párrafos: líneas separadas por \n\n
  html = html
    .split(/\n{2,}/)
    .map(block => {
      if (/^<(h[1-3]|ul|ol|li|pre|hr|table|blockquote)/.test(block.trim())) return block;
      if (!block.trim()) return '';
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html;
}

/* ═══════════════════════════════════════════════
   Utilidades de archivos
═══════════════════════════════════════════════ */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

async function serverParseFile(file, endpoint) {
  const data = await fileToBase64(file);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`Error al procesar ${file.name}: ${(await res.json()).error}`);
  return (await res.json()).text;
}

async function buildContentBlocks(file, label) {
  const ext = file.name.split('.').pop().toLowerCase();
  const blocks = [{ type: 'text', text: label }];

  if (ext === 'pdf') {
    const text = await serverParseFile(file, '/api/parse-pdf');
    blocks.push({ type: 'text', text: `[Archivo: ${file.name}]\n\n${text}` });
  } else if (['txt', 'md'].includes(ext)) {
    const text = await fileToText(file);
    blocks.push({ type: 'text', text: `[Archivo: ${file.name}]\n\n${text}` });
  } else if (ext === 'docx') {
    const text = await serverParseFile(file, '/api/parse-docx');
    blocks.push({ type: 'text', text: `[Archivo: ${file.name}]\n\n${text}` });
  } else {
    throw new Error(`Formato no soportado: .${ext}. Usa PDF, TXT o DOCX.`);
  }
  return blocks;
}

/* ═══════════════════════════════════════════════
   API Key (localStorage)
═══════════════════════════════════════════════ */
function getStoredApiKey() {
  return localStorage.getItem('anthropic_api_key') || '';
}
function saveApiKey(key) {
  localStorage.setItem('anthropic_api_key', key.trim());
}
function showApiKeyModal() {
  const input = document.getElementById('apiKeyInput');
  if (input) input.value = getStoredApiKey();
  els.apiModal.classList.remove('hidden');
  if (input) setTimeout(() => input.focus(), 100);
}

/* ═══════════════════════════════════════════════
   API - Streaming
═══════════════════════════════════════════════ */
async function* streamChat(messages) {
  const abort = new AbortController();
  // 6 minutos de timeout en el cliente (un poco más que el servidor)
  const timeout = setTimeout(() => abort.abort(), 6 * 60 * 1000);

  const res = await fetch('/api/chat', {
    method: 'POST',
    signal: abort.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, apiKey: getStoredApiKey() }),
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = `Error ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      message = (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) || message;
    } catch { message = text || message; }
    throw new Error(message);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentBlockType = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;

      let event;
      try { event = JSON.parse(raw); } catch { continue; }

      if (event.type === 'content_block_start') {
        currentBlockType = event.content_block?.type;
      }
      if (event.type === 'content_block_delta' &&
          currentBlockType === 'text' &&
          event.delta?.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}

/* ═══════════════════════════════════════════════
   Mensajes en el Chat
═══════════════════════════════════════════════ */
function addActionLabel(text) {
  const el = document.createElement('div');
  el.className = 'msg-action';
  el.textContent = text;
  els.messages.appendChild(el);
  scrollDown();
}

function addUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg user-msg';
  el.innerHTML = `
    <div class="msg-avatar">👤</div>
    <div class="msg-body">
      <div class="msg-name">Tú</div>
      <div class="msg-text">${escapeHtml(text)}</div>
    </div>`;
  els.messages.appendChild(el);
  scrollDown();
}

function addAgentMessage(htmlContent = '') {
  const el = document.createElement('div');
  el.className = 'msg agent-msg';
  el.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-body">
      <div class="msg-name">Asistente de Selección</div>
      <div class="msg-text">${htmlContent || '<div class="typing-dots"><span></span><span></span><span></span></div>'}</div>
    </div>`;
  els.messages.appendChild(el);
  scrollDown();
  return el.querySelector('.msg-text');
}

function scrollDown() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ═══════════════════════════════════════════════
   Enviar mensaje con streaming
═══════════════════════════════════════════════ */
async function sendMessage(userBlocks, userLabel, isReport = false) {
  if (state.isLoading) return;
  state.isLoading = true;
  setLoading(true);

  // Añadir a historial de la API
  state.history.push({ role: 'user', content: userBlocks });

  // Mostrar label en chat
  if (userLabel) addActionLabel(userLabel);

  // Contenedor para la respuesta del agente
  const msgEl = addAgentMessage();
  let fullText = '';

  try {
    for await (const delta of streamChat(state.history)) {
      fullText += delta;
      msgEl.innerHTML = renderMarkdown(fullText);
      scrollDown();
    }

    // Guardar respuesta en historial
    state.history.push({ role: 'assistant', content: fullText });

    if (isReport) {
      state.lastReport = fullText;
      els.btnExport.disabled = false;
    }

  } catch (err) {
    const isKeyError = err.message.toLowerCase().includes('api') || err.message.toLowerCase().includes('key') || err.message.toLowerCase().includes('auth');
    msgEl.innerHTML = isKeyError
      ? `<span style="color:#ef4444">🔑 <strong>API Key inválida o no configurada.</strong> <a href="#" onclick="showApiKeyModal();return false;" style="color:#6366f1">Haz clic aquí para configurarla</a>.</span>`
      : `<span style="color:#ef4444">⚠ Error: ${escapeHtml(err.message)}</span>`;
    if (isKeyError) showApiKeyModal();
    // Revertir último mensaje del historial
    state.history.pop();
  } finally {
    state.isLoading = false;
    setLoading(false);
  }
}

/* ═══════════════════════════════════════════════
   Acciones del agente
═══════════════════════════════════════════════ */

// Cargar perfil del cargo
async function loadJobProfile(file = null, textOverride = null) {
  try {
    let blocks, name;

    if (textOverride) {
      if (textOverride.trim().length < 20) {
        showToast('El perfil es muy corto. Agrega más detalles.');
        return;
      }
      blocks = [
        { type: 'text', text: 'A continuación el perfil del cargo que debes tener en cuenta para evaluar todos los CVs:' },
        { type: 'text', text: textOverride },
      ];
      name = 'Perfil (texto)';
    } else {
      blocks = await buildContentBlocks(file, 'A continuación el perfil del cargo que debes tener en cuenta para evaluar todos los CVs:');
      name = file.name;
    }

    state.jobProfile = { name, blocks };

    // Actualizar UI del sidebar
    els.profileDropContent.classList.add('hidden');
    els.profileLoaded.classList.remove('hidden');
    els.profileFileName.textContent = name;
    els.profileBadge.textContent = 'Cargado';
    els.profileBadge.className = 'badge badge-ok';
    els.profileText.value = '';

    // Habilitar inputs de CVs y chat
    els.userInput.disabled = false;
    els.sendBtn.disabled = false;
    els.btnAttachCV.disabled = false;
    setStatus('ready', `Perfil cargado · ${state.cvs.length} CV(s)`);

    await sendMessage(
      blocks,
      `📋 Perfil cargado: ${name}`
    );

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Carga múltiples CVs de forma secuencial para evitar saturar el servidor
async function loadCVsSequentially(files) {
  for (const file of files) {
    await loadCV(file);
  }
}

// Cargar un CV — solo lo acumula, NO llama a Claude
async function loadCV(file) {
  if (!state.jobProfile) {
    showToast('Primero carga el perfil del cargo.');
    return;
  }
  // Evitar duplicados por nombre
  if (state.cvs.find(c => c.name === file.name)) {
    showToast(`"${file.name}" ya fue agregado.`);
    return;
  }
  try {
    const blocks = await buildContentBlocks(file, `CV del candidato "${file.name.replace(/\.(pdf|txt|md|docx)$/i, '')}":`);;
    const cvEntry = { name: file.name, blocks, status: 'ready' };
    state.cvs.push(cvEntry);
    renderCVList();
    updateCVsBadge();
    addActionLabel(`📄 CV agregado: ${file.name}`);
    els.btnGenerateReport.disabled = false;
    setStatus('ready', `${state.cvs.length} CV(s) listos · Genera el informe cuando quieras`);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Generar informe final — envía el perfil + TODOS los CVs en un único mensaje
async function generateReport() {
  if (!state.jobProfile || state.cvs.length === 0) return;

  els.btnGenerateReport.disabled = true;
  const n = state.cvs.length;
  const names = state.cvs.map(c => c.name.replace(/\.(pdf|txt|md|docx)$/i, '')).join(', ');

  // Construir un único mensaje con perfil + todos los CVs
  const blocks = [
    // Instrucción principal
    {
      type: 'text',
      text: `Aquí están el perfil del cargo y los CVs de los ${n} candidatos. Analízalos a TODOS comparativamente y genera el informe completo con: (1) matriz de competencias (candidatos como filas, competencias como columnas), (2) ranking completo con puntuación X/10 para cada candidato, (3) análisis detallado de cada uno de los top 7 con tres secciones: idoneidad para el cargo, fortalezas y debilidades, y 10 preguntas sugeridas para la entrevista personalizadas según el perfil de cada candidato.`
    },
    // Perfil del cargo
    ...state.jobProfile.blocks,
    // Separador
    { type: 'text', text: `--- A continuación los ${n} CVs de los candidatos: ${names} ---` },
    // Todos los CVs
    ...state.cvs.flatMap(cv => cv.blocks),
    // Instrucción de formato final
    {
      type: 'text',
      text: `Genera ahora el informe completo con: (1) matriz de competencias con candidatos como filas y competencias como columnas, (2) ranking completo de todos los candidatos de mayor a menor preferencia con puntuación X/10, (3) análisis de los top 7 candidatos con tres secciones cada uno: idoneidad para el cargo, fortalezas y debilidades, y exactamente 10 preguntas sugeridas para la entrevista personalizadas para ese candidato. Usa Markdown.`
    }
  ];

  // Reiniciar historial para que Claude vea todo desde cero en un solo mensaje
  state.history = [];

  setStatus('loading', `Analizando ${n} candidatos…`);
  await sendMessage(blocks, `📊 Generando informe comparativo de ${n} candidatos`, true);
  setStatus('ready', `Informe generado · ${n} candidatos`);
  els.btnGenerateReport.disabled = false;
}

// Exportar informe
function exportReport() {
  if (!state.lastReport) return;

  const fecha = new Date().toLocaleDateString('es-CL', { dateStyle: 'long' });
  const cargo = (() => {
    const m = state.lastReport.match(/Informe de Selecci[oó]n\s*[—–-]\s*(.+)/i);
    return m ? m[1].trim() : 'Proceso de Selección';
  })();

  // Post-procesa el markdown renderizado para aplicar estilos semánticos a la matriz
  let bodyHtml = renderMarkdown(state.lastReport);

  // Colorea celdas de la matriz según símbolo
  bodyHtml = bodyHtml
    .replace(/<td>✅<\/td>/g, '<td class="cell-ok">✅</td>')
    .replace(/<td>⚠️<\/td>/g,  '<td class="cell-warn">⚠️</td>')
    .replace(/<td>❌<\/td>/g,  '<td class="cell-no">❌</td>');

  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de Selección — ${cargo}</title>
<style>
  /* ── Reset & base ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 10.5pt;
    color: #1e2a3a;
    background: #fff;
    line-height: 1.65;
  }

  /* ── Portada ── */
  .cover {
    background: linear-gradient(145deg, #0f2044 0%, #1a3a6e 60%, #1e4d8c 100%);
    color: #fff;
    padding: 72px 64px 56px;
    min-height: 200px;
  }
  .cover-label {
    font-size: 9pt;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #93b8e8;
    margin-bottom: 20px;
    font-weight: 500;
  }
  .cover h1 {
    font-size: 26pt;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 8px;
    color: #fff;
    border: none;
    padding: 0;
  }
  .cover-cargo {
    font-size: 14pt;
    color: #b8d4f5;
    margin-bottom: 36px;
    font-weight: 400;
  }
  .cover-meta {
    display: flex;
    gap: 40px;
    font-size: 9pt;
    color: #93b8e8;
    border-top: 1px solid rgba(255,255,255,0.15);
    padding-top: 20px;
  }
  .cover-meta span strong { color: #fff; display: block; font-size: 10pt; margin-bottom: 2px; }

  /* ── Contenido ── */
  .content {
    max-width: 900px;
    margin: 0 auto;
    padding: 48px 64px 64px;
  }

  /* ── Tipografía ── */
  h1 {
    font-size: 18pt;
    color: #0f2044;
    border-bottom: 3px solid #1a3a6e;
    padding-bottom: 10px;
    margin: 48px 0 20px;
    font-weight: 700;
  }
  h2 {
    font-size: 13pt;
    color: #1a3a6e;
    margin: 36px 0 14px;
    padding-bottom: 6px;
    border-bottom: 1.5px solid #d1dff5;
    font-weight: 600;
  }
  h3 {
    font-size: 11pt;
    color: #1e2a3a;
    margin: 24px 0 8px;
    font-weight: 600;
  }
  p { margin-bottom: 10px; }
  em { font-style: italic; color: #334155; }
  strong { font-weight: 600; }

  /* ── Sección con fondo ── */
  .section-card {
    background: #f7f9fc;
    border-left: 4px solid #1a3a6e;
    border-radius: 0 6px 6px 0;
    padding: 16px 20px;
    margin: 20px 0;
  }

  /* ── Matriz de competencias ── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0 28px;
    font-size: 9pt;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    border-radius: 6px;
    overflow: hidden;
  }
  thead tr { background: #0f2044; color: #fff; }
  thead th {
    padding: 10px 12px;
    text-align: center;
    font-weight: 600;
    font-size: 8.5pt;
    letter-spacing: 0.3px;
    border: none;
  }
  thead th:first-child { text-align: left; min-width: 130px; }
  tbody tr:nth-child(even) { background: #f0f5fb; }
  tbody tr:nth-child(odd)  { background: #fff; }
  tbody tr:hover { background: #e6eef9; }
  td {
    padding: 8px 12px;
    border: 1px solid #dde6f0;
    font-size: 9pt;
    text-align: center;
    vertical-align: middle;
  }
  td:first-child { text-align: left; font-weight: 500; }

  /* Colores semáforo en la matriz */
  .cell-ok   { background: #dcfce7 !important; color: #166534; font-size: 13pt; }
  .cell-warn { background: #fef9c3 !important; color: #854d0e; font-size: 13pt; }
  .cell-no   { background: #fee2e2 !important; color: #991b1b; font-size: 13pt; }

  /* ── Ranking ── */
  ol.ranking { list-style: none; padding: 0; margin: 16px 0; }
  ol.ranking li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    margin-bottom: 6px;
    border-radius: 6px;
    border: 1px solid #dde6f0;
    background: #fff;
    font-size: 10pt;
  }
  ol.ranking li:nth-child(1) { border-left: 4px solid #b8860b; background: #fffbeb; }
  ol.ranking li:nth-child(2) { border-left: 4px solid #718096; background: #f7f9fc; }
  ol.ranking li:nth-child(3) { border-left: 4px solid #b45309; background: #fff7ed; }
  ol.ranking li .rank-num {
    font-size: 13pt;
    font-weight: 700;
    color: #1a3a6e;
    min-width: 28px;
  }
  ol.ranking li .rank-score {
    margin-left: auto;
    font-size: 9pt;
    color: #64748b;
    white-space: nowrap;
  }

  /* ── Tarjetas de candidatos ── */
  .candidate-card {
    border: 1px solid #d1dff5;
    border-radius: 8px;
    margin: 24px 0;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .candidate-header {
    background: #1a3a6e;
    color: #fff;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .candidate-rank-badge {
    background: rgba(255,255,255,0.2);
    border-radius: 50%;
    width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 11pt;
  }
  .candidate-header h3 { color: #fff; margin: 0; font-size: 11.5pt; border: none; }
  .candidate-body { padding: 16px 20px; }
  .candidate-section { margin-bottom: 12px; }
  .candidate-section-label {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #1a3a6e;
    margin-bottom: 4px;
  }
  .candidate-section p { font-size: 9.5pt; color: #334155; margin: 0; }

  /* ── Listas ── */
  ul, ol:not(.ranking) { padding-left: 22px; margin: 8px 0 14px; }
  li { margin-bottom: 4px; font-size: 10pt; }

  /* ── Separador ── */
  hr { border: none; border-top: 1.5px solid #e2e8f0; margin: 32px 0; }

  /* ── Footer ── */
  .footer {
    margin-top: 56px;
    padding: 20px 64px;
    background: #f7f9fc;
    border-top: 2px solid #d1dff5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8pt;
    color: #64748b;
  }
  .footer-logo { font-weight: 700; color: #1a3a6e; font-size: 9pt; }

  /* ── Impresión ── */
  @media print {
    body { font-size: 9.5pt; }
    .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cover, .content, .footer { page-break-inside: avoid; }
    h1 { page-break-after: avoid; }
    h2 { page-break-after: avoid; }
    .candidate-card { page-break-inside: avoid; }
    table { page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    @page {
      margin: 18mm 16mm;
      size: A4;
    }
    .cell-ok, .cell-warn, .cell-no {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    thead tr {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>

<div class="cover">
  <div class="cover-label">Informe de Selección de Personal</div>
  <h1>Evaluación de Candidatos</h1>
  <div class="cover-cargo">${cargo}</div>
  <div class="cover-meta">
    <span><strong>Fecha de emisión</strong>${fecha}</span>
    <span><strong>Candidatos evaluados</strong>${state.cvs.length}</span>
    <span><strong>Generado con</strong>Revisor de CVs IA</span>
  </div>
</div>

<div class="content">
${bodyHtml}
</div>

<div class="footer">
  <span class="footer-logo">Revisor de CVs · IA</span>
  <span>Documento generado el ${fecha} — Uso confidencial</span>
</div>

</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `informe-seleccion-${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// Nueva sesión
function newSession() {
  if (state.isLoading) return;
  if (!confirm('¿Iniciar una nueva sesión? Se perderá el análisis actual.')) return;

  state.history     = [];
  state.jobProfile  = null;
  state.cvs         = [];
  state.isLoading   = false;
  state.lastReport  = '';

  // Reset sidebar
  els.profileDropContent.classList.remove('hidden');
  els.profileLoaded.classList.add('hidden');
  els.profileFileName.textContent = '';
  els.profileBadge.textContent    = 'Pendiente';
  els.profileBadge.className      = 'badge badge-pending';
  els.profileText.value           = '';
  els.cvList.innerHTML            = '';

  // Reset buttons
  els.btnGenerateReport.disabled = true;
  els.btnExport.disabled         = true;
  els.userInput.disabled         = true;
  els.sendBtn.disabled           = true;
  els.btnAttachCV.disabled       = true;

  updateCVsBadge();
  setStatus('waiting', 'Esperando perfil del cargo…');

  // Reset chat
  els.messages.innerHTML = `
    <div class="msg agent-msg">
      <div class="msg-avatar">🤖</div>
      <div class="msg-body">
        <div class="msg-name">Asistente de Selección</div>
        <div class="msg-text">
          <p>Nueva sesión iniciada. Carga el <strong>perfil del cargo</strong> para comenzar.</p>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════
   UI Helpers
═══════════════════════════════════════════════ */
function setStatus(type, text) {
  els.chatStatus.className = `status-pill status-${type}`;
  els.statusText.textContent = text;
}

function setLoading(on) {
  els.sendBtn.disabled    = on || !state.jobProfile;
  els.btnAttachCV.disabled= on || !state.jobProfile;
  els.userInput.disabled  = on || !state.jobProfile;
  if (on) setStatus('loading', 'Analizando…');
}

function renderCVList() {
  els.cvList.innerHTML = state.cvs.map(cv => `
    <li class="cv-item">
      <span class="cv-item-icon">📄</span>
      <span class="cv-item-name" title="${cv.name}">${cv.name}</span>
      <span class="cv-item-status ${cv.status === 'analyzing' ? 'status-analyzing' : 'status-done'}">
        ${cv.status === 'analyzing' ? '⏳' : '✅'}
      </span>
    </li>`).join('');
}

function updateCVsBadge() {
  const n = state.cvs.length;
  els.cvsBadge.textContent = `${n} CV${n !== 1 ? 's' : ''}`;
  els.cvsBadge.className = n > 0 ? 'badge badge-ok' : 'badge badge-neutral';
}

function showToast(msg, type = 'warning') {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:${type==='error'?'#ef4444':'#f59e0b'}; color:#fff;
    padding:10px 20px; border-radius:10px; font-size:13px; font-weight:600;
    z-index:200; animation:fadeUp .2s ease; box-shadow:0 4px 12px rgba(0,0,0,.2);
    max-width:90vw; text-align:center;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ═══════════════════════════════════════════════
   Drag & Drop helpers
═══════════════════════════════════════════════ */
function setupDropZone(zone, onFile, multiple = false) {
  zone.addEventListener('click', () => {
    const input = zone.querySelector('input[type=file]');
    if (input) input.click();
  });
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      zone.querySelector('input[type=file]')?.click();
    }
  });
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (multiple) loadCVsSequentially(files);
    else onFile(files[0]);
  });
}

/* ═══════════════════════════════════════════════
   Event Listeners
═══════════════════════════════════════════════ */
function init() {
  // Perfil - drop zone
  setupDropZone(els.profileDropZone, file => loadJobProfile(file));
  els.profileFileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadJobProfile(e.target.files[0]);
    e.target.value = '';
  });

  // Perfil - quitar
  els.removeProfile.addEventListener('click', e => {
    e.stopPropagation();
    if (confirm('¿Quitar el perfil del cargo? Esto reiniciará la sesión.')) newSession();
  });

  // Perfil - texto manual
  els.sendProfileText.addEventListener('click', () => {
    loadJobProfile(null, els.profileText.value);
  });
  els.profileText.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) loadJobProfile(null, els.profileText.value);
  });

  // CVs - drop zone
  setupDropZone(els.cvsDropZone, file => loadCV(file), true);
  els.cvsFileInput.addEventListener('change', e => {
    loadCVsSequentially([...e.target.files]);
    e.target.value = '';
  });

  // Adjuntar CV desde input bar
  els.btnAttachCV.addEventListener('click', () => els.attachCVInput.click());
  els.attachCVInput.addEventListener('change', e => {
    loadCVsSequentially([...e.target.files]);
    e.target.value = '';
  });

  // Chat - enviar mensaje libre
  async function sendFreeMessage() {
    const text = els.userInput.value.trim();
    if (!text || state.isLoading || !state.jobProfile) return;
    els.userInput.value = '';
    addUserMessage(text);
    await sendMessage(
      [{ type: 'text', text }],
      null
    );
  }
  els.sendBtn.addEventListener('click', sendFreeMessage);
  els.userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFreeMessage(); }
  });

  // Botones de acciones
  els.btnGenerateReport.addEventListener('click', generateReport);
  els.btnExport.addEventListener('click', exportReport);
  els.btnNewSession.addEventListener('click', newSession);

  // Modal API Key
  const saveBtn = document.getElementById('saveApiKey');
  const keyInput = document.getElementById('apiKeyInput');
  if (saveBtn && keyInput) {
    saveBtn.addEventListener('click', () => {
      const key = keyInput.value.trim();
      if (!key.startsWith('sk-ant-') || key.length < 20) {
        keyInput.style.borderColor = '#ef4444';
        keyInput.placeholder = 'Debe comenzar con sk-ant-...';
        return;
      }
      saveApiKey(key);
      els.apiModal.classList.add('hidden');
      showToast('API Key guardada correctamente', 'ok');
    });
    keyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveBtn.click();
      keyInput.style.borderColor = '#d1dff5';
    });
  }

  // Mostrar modal si no hay key guardada al iniciar
  if (!getStoredApiKey()) showApiKeyModal();
}

document.addEventListener('DOMContentLoaded', init);
