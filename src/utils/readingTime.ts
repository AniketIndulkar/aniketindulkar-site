const WORDS_PER_MINUTE = 225;

export function getReadingTime(markdown = ''): number {
  const readableText = markdown
    .replace(/^---[\s\S]*?---/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_#[\]()>|~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const wordCount = readableText ? readableText.split(' ').length : 0;
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}
