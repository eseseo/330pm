export function containsUrl(text: string): boolean {
  return /(https?:\/\/|www\.)\S+/i.test(text);
}
