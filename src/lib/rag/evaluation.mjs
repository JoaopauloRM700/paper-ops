function precisionAtK(expectedSet, retrieved, k) {
  const retrievedAtK = retrieved.slice(0, k);
  if (retrievedAtK.length === 0) {
    return 0;
  }
  const hits = retrievedAtK.filter((chunkId) => expectedSet.has(chunkId)).length;
  return hits / k;
}

function recallAtK(expectedSet, retrieved, k) {
  if (expectedSet.size === 0) {
    return 0;
  }
  const retrievedAtK = retrieved.slice(0, k);
  const hits = retrievedAtK.filter((chunkId) => expectedSet.has(chunkId)).length;
  return hits / expectedSet.size;
}

function reciprocalRank(expectedSet, retrieved) {
  for (const [index, chunkId] of retrieved.entries()) {
    if (expectedSet.has(chunkId)) {
      return 1 / (index + 1);
    }
  }
  return 0;
}

function average(values) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateRetrievalQuality({ expected = [], retrieved = [], k = 10 } = {}) {
  const precisionValues = [];
  const recallValues = [];
  const reciprocalRanks = [];

  for (let index = 0; index < expected.length; index += 1) {
    const expectedSet = new Set(expected[index] ?? []);
    const retrievedForQuery = retrieved[index] ?? [];
    precisionValues.push(precisionAtK(expectedSet, retrievedForQuery, k));
    recallValues.push(recallAtK(expectedSet, retrievedForQuery, k));
    reciprocalRanks.push(reciprocalRank(expectedSet, retrievedForQuery));
  }

  return {
    precisionAtK: average(precisionValues),
    recallAtK: average(recallValues),
    mrr: average(reciprocalRanks),
  };
}
