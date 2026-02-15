/**
 * OpenAI Service — Sentiment analysis and call summarization
 */
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Analyze sentiment from a call transcript
 * Returns: POSITIVE, NEUTRAL, NEGATIVE, or UNKNOWN
 */
async function analyzeSentiment(transcript) {
  if (!process.env.OPENAI_API_KEY || !transcript) return 'UNKNOWN';

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Analyze the sentiment of this phone call transcript. Respond with exactly one word: POSITIVE, NEUTRAL, or NEGATIVE.',
        },
        { role: 'user', content: transcript },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const result = response.choices[0]?.message?.content?.trim().toUpperCase();
    if (['POSITIVE', 'NEUTRAL', 'NEGATIVE'].includes(result)) return result;
    return 'UNKNOWN';
  } catch (err) {
    console.error('[OpenAI] Sentiment analysis failed:', err.message);
    return 'UNKNOWN';
  }
}

/**
 * Generate a summary of a call transcript
 */
async function summarizeCall(transcript) {
  if (!process.env.OPENAI_API_KEY || !transcript) return null;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Summarize this phone call transcript in 1-2 concise sentences. Focus on: what the caller wanted, what actions were taken, and the outcome.',
        },
        { role: 'user', content: transcript },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[OpenAI] Summarization failed:', err.message);
    return null;
  }
}

module.exports = { analyzeSentiment, summarizeCall };
