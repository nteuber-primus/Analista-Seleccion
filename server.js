import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mammoth from 'mammoth';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '200mb' }));
app.use(express.static(__dirname));

const SYSTEM_PROMPT = `Eres un experto en recursos humanos y selección de personal con más de 20 años de experiencia evaluando candidatos en procesos de selección corporativos.

Cuando recibes el perfil del cargo, lo registras y confirmas brevemente los criterios clave de evaluación. No haces más que eso.

Cuando recibes todos los CVs y se solicita el informe, produces un análisis comparativo con este formato EXACTO:

---

# Informe de Selección — [Nombre del cargo]

## Matriz de Competencias

Crea una tabla donde:
- Las FILAS son los candidatos (nombre corto de cada uno)
- Las COLUMNAS son las competencias/requisitos clave del cargo
- Las celdas indican: ✅ Cumple | ⚠️ Cumple parcialmente | ❌ No cumple

| Candidato | [Competencia 1] | [Competencia 2] | [Competencia 3] | ... |
|---|---|---|---|---|
| [Nombre candidato] | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | ... |
| [Nombre candidato] | ✅/⚠️/❌ | ... | ... | ... |

## Ranking de Candidatos

Lista completa de todos los candidatos, ordenada de mayor a menor idoneidad:

1. 🥇 **[Nombre]** — Puntuación: X/10
2. 🥈 **[Nombre]** — Puntuación: X/10
3. 🥉 **[Nombre]** — Puntuación: X/10
4. **[Nombre]** — Puntuación: X/10
5. **[Nombre]** — Puntuación: X/10
...y así para todos los candidatos restantes

## Análisis de los Top 7 Candidatos

Para cada uno de los 7 candidatos mejor posicionados, escribe exactamente dos párrafos:

**[Nombre del candidato #1]**

*Idoneidad para el cargo:* [Párrafo 1: Explicación concisa y específica de por qué este candidato es el más adecuado para la posición, citando evidencia concreta del CV: tecnologías, años de experiencia, logros cuantificables, trayectoria relevante.]

*Fortalezas y debilidades:* [Párrafo 2: Análisis equilibrado de sus principales fortalezas para este rol específico y las brechas o debilidades que podría presentar, basándose estrictamente en lo que figura en el CV.]

**[Nombre del candidato #2]**

*Idoneidad para el cargo:* [Párrafo 1]

*Fortalezas y debilidades:* [Párrafo 2]

**[Nombre del candidato #3]**

*Idoneidad para el cargo:* [Párrafo 1]

*Fortalezas y debilidades:* [Párrafo 2]

**[Nombre del candidato #4]**

*Idoneidad para el cargo:* [Párrafo 1]

*Fortalezas y debilidades:* [Párrafo 2]

**[Nombre del candidato #5]**

*Idoneidad para el cargo:* [Párrafo 1]

*Fortalezas y debilidades:* [Párrafo 2]

**[Nombre del candidato #6]**

*Idoneidad para el cargo:* [Párrafo 1]

*Fortalezas y debilidades:* [Párrafo 2]

**[Nombre del candidato #7]**

*Idoneidad para el cargo:* [Párrafo 1]

*Fortalezas y debilidades:* [Párrafo 2]

---

Reglas:
- Siempre responde en español, con tono profesional y objetivo
- Basa cada evaluación exclusivamente en evidencia del CV; no hagas suposiciones
- En la matriz, usa únicamente ✅ ⚠️ ❌ como valores de celda
- El ranking debe incluir a TODOS los candidatos evaluados, sin excepción
- Si hay menos de 7 candidatos, analiza en detalle a todos los disponibles
- Los párrafos de análisis deben ser específicos: nombra tecnologías, años, cargos anteriores y logros concretos`;

app.get('/api/debug', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.json({
    hasKey: !!key,
    length: key.length,
    prefix: key.slice(0, 10),
    vercel: process.env.VERCEL,
    nodeEnv: process.env.NODE_ENV,
  });
});

app.post('/api/parse-docx', async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Campo "data" requerido.' });
  try {
    const buffer = Buffer.from(data, 'base64');
    const result = await mammoth.extractRawText({ buffer });
    res.json({ text: result.value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parse-pdf', async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Campo "data" requerido.' });
  try {
    const buffer = Buffer.from(data, 'base64');
    const result = await pdfParse(buffer);
    res.json({ text: result.text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const keyInvalid = !apiKey || apiKey.startsWith('tu-api') || apiKey === 'sk-ant-...' || apiKey.length < 20;

  if (keyInvalid) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY no configurada o inválida. Edita el archivo .env con tu clave real (sk-ant-...) y reinicia el servidor.'
    });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Campo "messages" requerido.' });
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5 * 60 * 1000); // 5 min máximo

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        stream: true,
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const body = await anthropicRes.text();
      let message = `Error ${anthropicRes.status}: ${anthropicRes.statusText}`;
      try {
        const parsed = JSON.parse(body);
        // Anthropic format: { error: { message: "..." } }
        message = parsed?.error?.message || parsed?.error || message;
      } catch { /* body is not JSON (e.g., HTML from Cloudflare) */ }
      return res.status(anthropicRes.status).json({ error: message });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of anthropicRes.body) {
      if (res.writableEnded) break;
      res.write(chunk);
    }
    clearTimeout(timeout);
    res.end();

  } catch (err) {
    clearTimeout(timeout);
    const msg = err.name === 'AbortError'
      ? 'El análisis tardó demasiado (>5 min). Intenta con menos CVs o un perfil más corto.'
      : err.message;
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  }
});

// En local escucha en puerto; en Vercel se exporta el app
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║      🔍 Revisor de CVs con IA        ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  → Abre en tu navegador: http://localhost:${PORT}`);
    console.log('');
  });
}

export default app;
