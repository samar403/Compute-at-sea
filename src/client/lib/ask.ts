/** Any page can open the Bridge Officer with a prepared question. */
export function askBridge(prompt: string): void {
  window.dispatchEvent(new CustomEvent('cas:ask', { detail: prompt }));
}
