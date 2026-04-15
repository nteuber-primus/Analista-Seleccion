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

## Resumen Ejecutivo

[Exactamente 3 oraciones dirigidas al gerente: (1) quiénes son los 2-3 finalistas más fuertes y en qué destacan, (2) el diferenciador principal entre ellos, (3) el riesgo o consideración más relevante al tomar la decisión.]

## Matriz de Competencias

Crea una tabla donde:
- Las FILAS son los candidatos (nombre corto de cada uno)
- Las COLUMNAS son las competencias/requisitos clave del cargo (máximo 7 columnas)
- Las celdas indican: ✅ Cumple | ⚠️ Cumple parcialmente | ❌ No cumple

| Candidato | [Competencia 1] | [Competencia 2] | [Competencia 3] | ... |
|---|---|---|---|---|
| [Nombre candidato] | ✅/⚠️/❌ | ✅/⚠️/❌ | ✅/⚠️/❌ | ... |
| [Nombre candidato] | ✅/⚠️/❌ | ... | ... | ... |

## Ranking de Candidatos

Lista completa de todos los candidatos, ordenada de mayor a menor idoneidad. Incluye un semáforo de riesgo al final de cada línea (🟢 bajo riesgo | 🟡 riesgo moderado | 🔴 alto riesgo):

1. 🥇 **[Nombre]** — Puntuación: X/10 🟢
2. 🥈 **[Nombre]** — Puntuación: X/10 🟡
3. 🥉 **[Nombre]** — Puntuación: X/10 🟢
4. **[Nombre]** — Puntuación: X/10 🔴
...y así para todos los candidatos restantes

Criterios del semáforo: 🔴 si presenta job-hopping (>3 trabajos en <4 años), brecha de empleo >12 meses sin explicación, sobrequalificación evidente o logros muy vagos. 🟡 si tiene 1-2 señales leves. 🟢 si no presenta señales de alerta.

## ⚠️ Red Flags Detectadas

Lista concisa de alertas identificadas en los CVs. Si no hay ninguna, escribe: "No se detectaron red flags significativas."

- **[Nombre candidato]:** [descripción breve del red flag]
- **[Nombre candidato]:** [descripción breve]

## Análisis de los Top 5 Candidatos

Para cada uno de los 5 candidatos mejor posicionados, escribe exactamente cuatro secciones:

**[Nombre del candidato #1]**

**Trayectoria:** [Empresa corta 1] ([año inicio]–[año fin]) → [Empresa corta 2] ([año inicio]–[año fin]) → [Empresa actual] ([año inicio]–presente)

*Idoneidad para el cargo:* [Máximo 3 oraciones. Cita evidencia concreta: cargo anterior, años de experiencia, tecnología o habilidad específica, logro cuantificable.]

*Fortalezas y debilidades:* [Máximo 3 oraciones. Nombra 1-2 fortalezas clave y 1 debilidad o brecha concreta basada en el CV.]

*Preguntas sugeridas para la entrevista:*
1. [Pregunta personalizada para este candidato]
2. [Pregunta]
3. [Pregunta]
4. [Pregunta]
5. [Pregunta]
6. [Pregunta]
7. [Pregunta]
8. [Pregunta]
9. [Pregunta]
10. [Pregunta]

**[Nombre del candidato #2]**

**Trayectoria:** [misma estructura]

*Idoneidad para el cargo:* [máximo 3 oraciones]

*Fortalezas y debilidades:* [máximo 3 oraciones]

*Preguntas sugeridas para la entrevista:*
1–10. [10 preguntas personalizadas]

**[Nombre del candidato #3]**

**Trayectoria:** [misma estructura]

*Idoneidad para el cargo:* [máximo 3 oraciones]

*Fortalezas y debilidades:* [máximo 3 oraciones]

*Preguntas sugeridas para la entrevista:*
1–10. [10 preguntas personalizadas]

**[Nombre del candidato #4]**

**Trayectoria:** [misma estructura]

*Idoneidad para el cargo:* [máximo 3 oraciones]

*Fortalezas y debilidades:* [máximo 3 oraciones]

*Preguntas sugeridas para la entrevista:*
1–10. [10 preguntas personalizadas]

**[Nombre del candidato #5]**

**Trayectoria:** [misma estructura]

*Idoneidad para el cargo:* [máximo 3 oraciones]

*Fortalezas y debilidades:* [máximo 3 oraciones]

*Preguntas sugeridas para la entrevista:*
1–10. [10 preguntas personalizadas]

---

Reglas:
- Siempre responde en español, con tono profesional y objetivo
- Basa cada evaluación exclusivamente en evidencia del CV; no hagas suposiciones
- En la matriz, usa únicamente ✅ ⚠️ ❌ como valores de celda
- El ranking debe incluir a TODOS los candidatos evaluados, sin excepción
- Si hay menos de 5 candidatos, analiza en detalle a todos los disponibles
- Los párrafos de análisis deben ser específicos: nombra tecnologías, años, cargos anteriores y logros concretos
- Las 10 preguntas de entrevista deben ser personalizadas para cada candidato: algunas explorando sus fortalezas, otras indagando en sus brechas o debilidades detectadas, y otras situacionales/conductuales relevantes al cargo`;

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

// Endpoint para que el cliente sepa si el servidor ya tiene la API key configurada
app.get('/api/has-server-key', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  const hasKey = !!key && !key.startsWith('tu-api') && key !== 'sk-ant-...' && key.length >= 20;
  res.json({ hasKey });
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
  // Acepta la key desde el env var del servidor o desde el body del request (modo cliente)
  const apiKey = process.env.ANTHROPIC_API_KEY || req.body.apiKey || '';
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
