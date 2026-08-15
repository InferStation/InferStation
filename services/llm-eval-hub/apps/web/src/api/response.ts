export async function readResponseBody(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) return null;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}
