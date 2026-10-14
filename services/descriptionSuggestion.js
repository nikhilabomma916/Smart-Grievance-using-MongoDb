async function suggestDescription({ category, notes }) {
  const providerUrl = process.env.DESCRIPTION_AI_URL;
  if (!providerUrl) {
    return {
      provider: "template",
      description: `The citizen reports a ${category.toLowerCase()} issue involving: ${notes}. Please review the submitted details and location.`
    };
  }

  const headers = { "Content-Type": "application/json" };
  if (process.env.DESCRIPTION_AI_API_KEY) {
    headers.Authorization = `Bearer ${process.env.DESCRIPTION_AI_API_KEY}`;
  }
  const response = await fetch(providerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      category,
      notes,
      instruction: "Rewrite only the citizen-provided facts into a clear, concise grievance description. Do not infer causes, severity, precise location, or consequences."
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Description provider returned HTTP ${response.status}.`);
  const result = await response.json();
  if (typeof result.description !== "string" || !result.description.trim()) {
    throw new Error("Description provider response must include a non-empty description string.");
  }
  return { provider: "configured", description: result.description.trim().slice(0, 5000) };
}

module.exports = { suggestDescription };
