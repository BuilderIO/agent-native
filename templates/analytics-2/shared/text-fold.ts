export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC")
    .toLocaleLowerCase();
}
