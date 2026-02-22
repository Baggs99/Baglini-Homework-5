const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');
const { YOUTUBE_TOOL_DECLARATIONS, executeTool } = require('./youtubeTools');
const {
  getGeminiModelName,
  getModelFallbackList,
  is404OrNotSupported,
} = require('./geminiConfig');

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 2000;

function isRateLimitError(err) {
  const msg = err?.message || String(err);
  return msg.includes('429') || msg.includes('Resource exhausted');
}

async function withRetry(fn) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRateLimitError(err)) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

let cachedPrompt = null;

function loadSystemPrompt() {
  if (cachedPrompt !== null) return cachedPrompt;
  try {
    const p = path.join(__dirname, '..', 'public', 'prompt_chat.txt');
    cachedPrompt = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
  } catch {
    cachedPrompt = '';
  }
  return cachedPrompt;
}

function clearPromptCache() {
  cachedPrompt = null;
}

const SEARCH_TOOL = { googleSearch: {} };
const CODE_EXEC_TOOL = { codeExecution: {} };

function friendlyGeminiError() {
  return new Error(
    'Gemini is not available right now. No supported model could be reached. Please try again later.'
  );
}

function buildSystemHistory(userInfo) {
  const systemInstruction = loadSystemPrompt();
  if (!systemInstruction && !userInfo) return [];

  let preamble = '';
  if (systemInstruction) preamble += systemInstruction;
  if (userInfo?.firstName) {
    preamble += `\n\nThe current user's name is ${userInfo.firstName}${userInfo.lastName ? ' ' + userInfo.lastName : ''}. Address them by their first name.`;
  }

  if (!preamble) return [];
  return [
    { role: 'user', parts: [{ text: `Follow these instructions in every response:\n\n${preamble}` }] },
    { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
  ];
}

/**
 * Stream chat — yields NDJSON objects. Google Search or code execution mode.
 */
async function* streamChatInternal(history, newMessage, imageParts = [], useCodeExecution = false, userInfo = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  await getGeminiModelName();
  const modelsToTry = getModelFallbackList();

  let lastErr;
  for (const modelName of modelsToTry) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const tools = useCodeExecution ? [CODE_EXEC_TOOL] : [SEARCH_TOOL];
      const model = genAI.getGenerativeModel({ model: modelName, tools });

      const baseHistory = history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content || '' }],
      }));

      const chatHistory = [...buildSystemHistory(userInfo), ...baseHistory];
      const chat = model.startChat({ history: chatHistory });

      const parts = [
        { text: newMessage },
        ...(imageParts || []).map((img) => ({
          inlineData: { mimeType: img.mimeType || 'image/png', data: img.data },
        })),
      ].filter((p) => p.text !== undefined || p.inlineData !== undefined);

      const result = await withRetry(() => chat.sendMessageStream(parts));

      for await (const chunk of result.stream) {
        const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of chunkParts) {
          if (part.text) yield { type: 'text', text: part.text };
        }
      }

      const response = await result.response;
      const allParts = response.candidates?.[0]?.content?.parts || [];

      const hasCodeExecution = allParts.some(
        (p) =>
          p.executableCode ||
          p.codeExecutionResult ||
          (p.inlineData && p.inlineData.mimeType?.startsWith('image/'))
      );

      if (hasCodeExecution) {
        const structuredParts = allParts
          .map((p) => {
            if (p.text) return { type: 'text', text: p.text };
            if (p.executableCode)
              return { type: 'code', language: p.executableCode.language || 'PYTHON', code: p.executableCode.code };
            if (p.codeExecutionResult)
              return { type: 'result', outcome: p.codeExecutionResult.outcome, output: p.codeExecutionResult.output };
            if (p.inlineData)
              return { type: 'image', mimeType: p.inlineData.mimeType, data: p.inlineData.data };
            return null;
          })
          .filter(Boolean);
        yield { type: 'fullResponse', parts: structuredParts };
      }

      const grounding = response.candidates?.[0]?.groundingMetadata;
      if (grounding) yield { type: 'grounding', data: grounding };

      return;
    } catch (err) {
      if (is404OrNotSupported(err)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw friendlyGeminiError();
}

/**
 * Chat with YouTube tools — function calling loop.
 * channelData: array of video objects from loaded JSON.
 */
async function chatWithToolsInternal(history, newMessage, channelData = [], imageParts = [], userInfo = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  await getGeminiModelName();
  const modelsToTry = getModelFallbackList();

  let lastErr;
  for (const modelName of modelsToTry) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        tools: [{ functionDeclarations: YOUTUBE_TOOL_DECLARATIONS }],
      });

      const baseHistory = history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content || '' }],
      }));

      const chatHistory = [...buildSystemHistory(userInfo), ...baseHistory];
      const chat = model.startChat({ history: chatHistory });

      const parts = [
        { text: newMessage },
        ...(imageParts || []).map((img) => ({
          inlineData: { mimeType: img.mimeType || 'image/png', data: img.data },
        })),
      ].filter((p) => p.text !== undefined || p.inlineData !== undefined);

      let response = (await withRetry(() => chat.sendMessage(parts))).response;
      const charts = [];
      const toolCalls = [];

      for (let round = 0; round < 5; round++) {
        const respParts = response.candidates?.[0]?.content?.parts || [];
        const funcCall = respParts.find((p) => p.functionCall);
        if (!funcCall) break;

        const { name, args } = funcCall.functionCall;
        const toolResult = await executeTool(name, args, channelData);

        const displayResult = { ...toolResult };
        // For Gemini's function response, strip large binary data
        const geminiResult = { ...toolResult };
        delete geminiResult.imageBase64;

        toolCalls.push({ name, args, result: displayResult });

        if (displayResult._toolType) {
          charts.push(displayResult);
        }

        response = (
          await withRetry(() =>
            chat.sendMessage([
              { functionResponse: { name, response: { result: geminiResult } } },
            ])
          )
        ).response;
      }

      return { text: response.text(), charts, toolCalls };
    } catch (err) {
      if (is404OrNotSupported(err)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw friendlyGeminiError();
}

module.exports = { streamChatInternal, chatWithToolsInternal, clearPromptCache };
