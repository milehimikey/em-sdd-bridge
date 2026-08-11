/** Pure text transform for flipping a slice doc's Status -> implemented
 *  and filling Implemented in -> the PR URL. Kept separate from file I/O so it's
 *  trivially unit-testable and idempotent. */

import { BridgeError } from "./bridge-error.js";

export interface MarkImplementedResult {
  content: string;
  changed: boolean;
}

// [ \t]* (not \s*) deliberately -- \s matches newlines too, and when the
// captured value is empty (e.g. a fresh "- **Implemented in:**" with nothing
// after it), a greedy \s* would eat forward across the blank line into
// whatever heading follows, and the replacement would delete it.
const STATUS_RE = /^(-[ \t]*\*\*Status:\*\*[ \t]*)(.*)$/m;
const IMPLEMENTED_IN_RE = /^(-[ \t]*\*\*Implemented in:\*\*[ \t]*)(.*)$/m;

function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return v === "" || v.includes("{{");
}

export function applyImplementedStatus(markdown: string, prUrl: string, sourceLabel = "<slice doc>"): MarkImplementedResult {
  if (!prUrl || !prUrl.trim()) {
    throw new BridgeError(`${sourceLabel}: a PR URL is required.`);
  }

  const statusMatch = markdown.match(STATUS_RE);
  if (!statusMatch) {
    throw new BridgeError(`${sourceLabel}: no "- **Status:**" field found -- refusing.`);
  }
  const implMatch = markdown.match(IMPLEMENTED_IN_RE);
  if (!implMatch) {
    throw new BridgeError(`${sourceLabel}: no "- **Implemented in:**" field found -- refusing.`);
  }

  const currentStatus = statusMatch[2].trim();
  const currentImpl = implMatch[2].trim();
  const currentImplSet = !isPlaceholder(currentImpl);

  if (currentStatus === "implemented" && currentImplSet) {
    if (currentImpl === prUrl) {
      return { content: markdown, changed: false }; // idempotent no-op
    }
    throw new BridgeError(
      `${sourceLabel}: already marked implemented with a different URL ` +
        `(existing: ${currentImpl}, requested: ${prUrl}) -- refusing.`
    );
  }

  // Replace both fields by index so we touch only the matched lines, in an
  // order safe regardless of which appears first in the file. Rebuild each
  // line from its known label rather than reusing captured whitespace --
  // the "Implemented in" field is typically empty (no trailing space in the
  // source line) before this runs, so trusting captured group 1 verbatim
  // would glue the URL onto the label with no separating space.
  const edits = [
    { index: statusMatch.index!, oldLen: statusMatch[0].length, next: `- **Status:** implemented` },
    { index: implMatch.index!, oldLen: implMatch[0].length, next: `- **Implemented in:** ${prUrl}` },
  ].sort((a, b) => b.index - a.index); // apply from the end so earlier indices stay valid

  let content = markdown;
  for (const edit of edits) {
    content = content.slice(0, edit.index) + edit.next + content.slice(edit.index + edit.oldLen);
  }

  return { content, changed: true };
}
