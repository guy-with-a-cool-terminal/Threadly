// Splits the boilerplate a reply carries along ("On <date>, <sender>
// wrote:" plus the quoted original) from the actual new content, so it can
// be collapsed behind a toggle the way Gmail does. Best-effort across mail
// clients (there's no real standard here) - when nothing recognizable is
// found, `quoted` is null and the caller renders the whole body exactly as
// before, so a miss never hides real content.

export function splitQuotedText(text: string): { main: string; quoted: string | null } {
  const lines = text.split(/\r?\n/);
  let quoteStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^>/.test(lines[i].trim())) {
      quoteStart = i;
      break;
    }
  }
  if (quoteStart === -1) return { main: text, quoted: null };

  // Fold in a preceding blank line and a "... wrote:" intro line, if
  // present, so the intro collapses together with the quote it introduces
  // instead of being left dangling above it.
  let start = quoteStart;
  while (start > 0 && lines[start - 1].trim() === "") start -= 1;
  if (start > 0 && /wrote:\s*$/.test(lines[start - 1].trim())) start -= 1;
  if (start === 0) return { main: text, quoted: null };

  const main = lines.slice(0, start).join("\n").trimEnd();
  const quoted = lines.slice(start).join("\n");
  return { main, quoted };
}

const QUOTE_SELECTORS = [
  ".gmail_quote",
  ".protonmail_quote",
  ".yahoo_quoted",
  ".moz-cite-prefix",
  "blockquote",
];

export function splitQuotedHtml(html: string): { main: string; quoted: string | null } {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return { main: html, quoted: null };
  }
  for (const selector of QUOTE_SELECTORS) {
    const el = doc.body.querySelector(selector);
    // A blockquote wrapping virtually the whole message isn't a "quoted
    // reply" - some senders format their entire message that way. Only
    // collapse it if there's meaningful content outside it.
    if (el && el.outerHTML.length < html.length * 0.9) {
      const quotedHtml = el.outerHTML;
      el.remove();
      return { main: doc.body.innerHTML.trim(), quoted: quotedHtml };
    }
  }
  return { main: html, quoted: null };
}
