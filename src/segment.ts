// Keep long text below the translator input limit, preserving every character.
export function chunks(text: string, limit = 1800, sourceLanguage = 'en'): string[] {
  const result: string[] = [];
  let chunk = '';
  const sentences = new Intl.Segmenter(sourceLanguage, { granularity: 'sentence' }).segment(text);
  for (const { segment } of sentences) {
    if (chunk && chunk.length + segment.length > limit) { result.push(chunk); chunk = ''; }
    if (segment.length <= limit) { chunk += segment; continue; }
    let rest = segment;
    while (rest.length > limit) {
      const space = rest.lastIndexOf(' ', limit);
      let cut = space > limit / 2 ? space + 1 : limit;
      // Do not divide a UTF-16 surrogate pair.
      if (/[\uD800-\uDBFF]/u.test(rest[cut - 1])) cut--;
      result.push(rest.slice(0, cut)); rest = rest.slice(cut);
    }
    chunk = rest;
  }
  if (chunk) result.push(chunk);
  return result;
}
