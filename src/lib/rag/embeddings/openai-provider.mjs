export function createOpenAiEmbeddingProvider({
  model = 'text-embedding-3-small',
  apiKey = process.env.OPENAI_API_KEY,
  baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com',
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for the openai embedding provider.');
  }

  return {
    provider: 'openai',
    model,
    async embedTexts(texts = []) {
      if (texts.length === 0) {
        return { provider: 'openai', model, dimension: 0, vectors: [] };
      }

      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/embeddings`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, input: texts }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Embedding request failed with HTTP ${response.status}: ${body}`);
      }

      const payload = await response.json();
      const vectors = (payload.data ?? []).map((item) => item.embedding);
      return {
        provider: 'openai',
        model,
        dimension: vectors[0]?.length ?? 0,
        vectors,
      };
    },
  };
}
