// ai.js — ZAI GLM-4.7 integration for Feature Ideas

const config = require('./config');

const ZAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

/**
 * Generate feature ideas for a repo using ZAI's GLM-4.7 reasoning model.
 * @param {string} repoName - Repository name
 * @param {string} repoStructure - Directory tree / file listing
 * @param {string} recentCommits - Recent commit messages
 * @param {string} readme - README content
 * @returns {Promise<Array>} Array of feature idea objects
 */
async function generateFeatureIdeas(repoName, repoStructure, recentCommits, readme) {
  const apiKey = config.ZAI_API_KEY;
  if (!apiKey) throw new Error('ZAI_API_KEY not configured');

  const systemPrompt = `You are a senior product engineer and software architect. Analyze the repository and propose new features that would add the most value. Return ONLY valid JSON, no markdown fences.`;

  const userPrompt = `Analyze the repository "${repoName}" and propose 3-5 new feature ideas.

Repository structure:
\`\`\`
${repoStructure || 'Not available'}
\`\`\`

Recent commits:
${recentCommits || 'Not available'}

README:
\`\`\`
${readme || 'Not available'}
\`\`\`

Based on your deep analysis, propose features that:
1. Build on existing patterns and infrastructure (low integration cost)
2. Address real user needs or pain points visible in the code
3. Are technically feasible given the current stack
4. Provide clear value with reasonable effort

For each feature, provide:
- title: Clear, concise name
- description: 2-3 sentences explaining what it does
- why: Contextual reasoning — WHY this makes sense for THIS specific project
- difficulty: S (Small, <1 day), M (Medium, 1-3 days), L (Large, 1+ week)
- code_preview: Stub implementation (~20-30 lines) showing the key code structure
- mock_ui_html: Simple HTML/CSS preview of how the feature could look in the UI

Output as a JSON array of objects:
[
  {
    "title": "Feature Name",
    "description": "What it does",
    "why": "Why this makes sense for this project",
    "difficulty": "S|M|L",
    "code_preview": "// Stub implementation",
    "mock_ui_html": "<div style='...'>Simple mockup</div>"
  }
]

Output ONLY the JSON array, no other text.`;

  const body = {
    model: 'GLM-4.7',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 16000,
  };

  return _callWithRetry(apiKey, body);
}

/**
 * Call the ZAI API with retry logic.
 * @param {string} apiKey
 * @param {object} body
 * @param {number} [retries=2]
 * @returns {Promise<Array>}
 */
async function _callWithRetry(apiKey, body, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout

      const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        throw new Error(`ZAI API error ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content || content.trim().length === 0) {
        // Reasoning model may have used all tokens for reasoning
        throw new Error('Empty response from ZAI (reasoning model may have exhausted tokens)');
      }

      return _parseIdeas(content);

    } catch (err) {
      if (attempt < retries && err.name !== 'AbortError') {
        console.log(`[ai] Retry ${attempt + 1}/${retries} after error: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Parse feature ideas from the API response content.
 * Handles truncated JSON and various response formats.
 * @param {string} content - Raw response content
 * @returns {Array}
 */
function _parseIdeas(content) {
  let text = content.trim();

  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Try direct parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.ideas && Array.isArray(parsed.ideas)) return parsed.ideas;
    throw new Error('Unexpected JSON structure');
  } catch (_e) {
    // Try bracket repair for truncated JSON
  }

  // Attempt to repair truncated JSON array
  try {
    const repaired = _repairTruncatedJson(text);
    const parsed = JSON.parse(repaired);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.ideas && Array.isArray(parsed.ideas)) return parsed.ideas;
  } catch (_e) {
    // Give up on parsing
  }

  // Try to find a JSON array in the text
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]);
    } catch (_e) {
      const repaired = _repairTruncatedJson(arrMatch[0]);
      return JSON.parse(repaired);
    }
  }

  throw new Error('Could not parse feature ideas from ZAI response');
}

/**
 * Attempt to repair a truncated JSON array by closing open brackets.
 * @param {string} json
 * @returns {string}
 */
function _repairTruncatedJson(json) {
  let repaired = json.trimEnd();

  // Remove trailing comma
  if (repaired.endsWith(',')) {
    repaired = repaired.slice(0, -1);
  }

  // Count open vs close brackets/braces
  let openBrackets = 0;
  let openBraces = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') openBrackets++;
    if (ch === ']') openBrackets--;
    if (ch === '{') openBraces++;
    if (ch === '}') openBraces--;
  }

  // Close unclosed string
  if (inString) repaired += '"';

  // Close unclosed braces and brackets
  for (let i = 0; i < openBraces; i++) repaired += '}';
  for (let i = 0; i < openBrackets; i++) repaired += ']';

  return repaired;
}

/**
 * Test the ZAI API connection with a simple call.
 * @returns {Promise<{ok: boolean, model: string, message: string}>}
 */
async function testConnection() {
  const apiKey = config.ZAI_API_KEY;
  if (!apiKey) {
    return { ok: false, model: 'GLM-4.7', message: 'ZAI_API_KEY not configured' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'GLM-4.7',
        messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }],
        max_tokens: 10,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      return { ok: false, model: 'GLM-4.7', message: `API error ${res.status}: ${errText}` };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    return {
      ok: true,
      model: 'GLM-4.7',
      message: `Connected successfully. Response: ${content.trim().slice(0, 50)}`,
    };
  } catch (err) {
    return { ok: false, model: 'GLM-4.7', message: `Connection failed: ${err.message}` };
  }
}

module.exports = { generateFeatureIdeas, testConnection };
