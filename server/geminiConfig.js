/**
 * Dynamic Gemini model selection — avoids 404 by using ListModels
 * and falling back to known-good models.
 */

const FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
  'gemini-pro',
];

let cachedModel = null;
let cachedModelList = null;

function is404OrNotSupported(err) {
  const msg = err?.message || String(err);
  return (
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('not supported') ||
    msg.includes('Model') && msg.includes('does not exist')
  );
}

async function fetchAvailableModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ListModels failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.models || [];
}

function pickBestModel(models) {
  const names = (models || [])
    .map((m) => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean);

  // Prefer flash models (faster, cheaper)
  const flash = names.find((n) => /flash/i.test(n));
  if (flash) return flash;

  // Then pro
  const pro = names.find((n) => /pro/i.test(n));
  if (pro) return pro;

  // Then any gemini
  const any = names.find((n) => /gemini/i.test(n));
  return any || null;
}

/**
 * Get the Gemini model name to use. Caches result.
 * Tries ListModels first; falls back to FALLBACK_MODELS.
 */
async function getGeminiModelName() {
  if (cachedModel) return cachedModel;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  try {
    const models = await fetchAvailableModels(apiKey);
    cachedModelList = models.map((m) => (m.name || '').replace(/^models\//, '')).filter(Boolean);

    // Log first ~10 model names (no secrets)
    const toLog = cachedModelList.slice(0, 10);
    console.log('[Gemini] ListModels returned (first 10):', toLog.join(', ') || '(none)');

    const selected = pickBestModel(models);
    if (selected) {
      cachedModel = selected;
      console.log('[Gemini] Selected model:', cachedModel);
      return cachedModel;
    }
  } catch (err) {
    console.warn('[Gemini] ListModels failed, using fallback:', err.message);
  }

  // Use first fallback that we'll verify on first use
  cachedModel = FALLBACK_MODELS[0];
  console.log('[Gemini] Using fallback model:', cachedModel);
  return cachedModel;
}

/**
 * Get model name, or null if not yet initialized.
 */
function getCachedModel() {
  return cachedModel;
}

/**
 * Get list of models to try on 404 (current + fallbacks)
 */
function getModelFallbackList() {
  const list = [cachedModel, ...FALLBACK_MODELS.filter((m) => m !== cachedModel)].filter(Boolean);
  return [...new Set(list)];
}

/**
 * Clear cache so next call to getGeminiModelName will re-fetch or use next fallback.
 * Call this when we get a 404 to try a different model.
 */
function invalidateModelCache() {
  cachedModel = null;
}

/**
 * Set the model to try next (used when 404 and we want to try a specific fallback)
 */
function setModelToTry(modelName) {
  cachedModel = modelName;
}

module.exports = {
  getGeminiModelName,
  getCachedModel,
  getModelFallbackList,
  invalidateModelCache,
  setModelToTry,
  is404OrNotSupported,
  FALLBACK_MODELS,
};
