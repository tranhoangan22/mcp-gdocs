import { docs_v1 } from "googleapis";

/**
 * Represents a parsed heading with its location in the document
 */
export interface HeadingInfo {
  text: string;
  level: number; // 1, 2, or 3
  startIndex: number;
  endIndex: number;
}

/**
 * Represents a formatting request to apply after text insertion
 */
export interface FormattingRequest {
  type: "heading" | "link";
  startIndex: number;
  endIndex: number;
  level?: number; // For headings
  url?: string; // For links
}

/**
 * Result of parsing content for insertion
 */
export interface ParsedContent {
  plainText: string;
  formattingRequests: FormattingRequest[];
}

/**
 * Convert Google Docs API document structure to marked text format
 *
 * Output format:
 * - [H1], [H2], [H3] prefixes for headings
 * - [text](url) for links
 * - • prefix for bullet points
 */
export function documentToText(document: docs_v1.Schema$Document): string {
  const content = document.body?.content;
  if (!content) {
    return "";
  }

  const lines: string[] = [];

  for (const element of content) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      const paragraphStyle = paragraph.paragraphStyle?.namedStyleType;

      // Determine heading level
      let prefix = "";
      if (paragraphStyle === "HEADING_1") {
        prefix = "[H1] ";
      } else if (paragraphStyle === "HEADING_2") {
        prefix = "[H2] ";
      } else if (paragraphStyle === "HEADING_3") {
        prefix = "[H3] ";
      }

      // Check for bullet/list
      const bullet = paragraph.bullet;
      if (bullet) {
        prefix = "• ";
      }

      // Extract text from paragraph elements
      const textParts: string[] = [];
      const elements = paragraph.elements || [];

      for (const elem of elements) {
        if (elem.textRun) {
          const textRun = elem.textRun;
          let text = textRun.content || "";

          // Check for links
          const link = textRun.textStyle?.link?.url;
          if (link && text.trim()) {
            // Format as markdown link, remove trailing newline for link text
            const linkText = text.replace(/\n$/, "");
            text = `[${linkText}](${link})`;
            // Add back newline if it was there
            if (textRun.content?.endsWith("\n")) {
              text += "\n";
            }
          }

          textParts.push(text);
        }
      }

      const paragraphText = textParts.join("");

      // Skip empty paragraphs (just newlines)
      if (paragraphText.trim()) {
        lines.push(prefix + paragraphText.replace(/\n$/, ""));
      } else if (paragraphText === "\n") {
        // Preserve blank lines
        lines.push("");
      }
    } else if (element.table) {
      lines.push("[TABLE]");
    }
  }

  return lines.join("\n");
}

/**
 * Find all headings in the document with their indices
 */
export function findHeadings(document: docs_v1.Schema$Document): HeadingInfo[] {
  const content = document.body?.content;
  if (!content) {
    return [];
  }

  const headings: HeadingInfo[] = [];

  for (const element of content) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      const paragraphStyle = paragraph.paragraphStyle?.namedStyleType;

      let level = 0;
      if (paragraphStyle === "HEADING_1") {
        level = 1;
      } else if (paragraphStyle === "HEADING_2") {
        level = 2;
      } else if (paragraphStyle === "HEADING_3") {
        level = 3;
      }

      if (level > 0) {
        // Extract heading text
        const elements = paragraph.elements || [];
        let text = "";
        for (const elem of elements) {
          if (elem.textRun?.content) {
            text += elem.textRun.content;
          }
        }

        headings.push({
          text: text.replace(/\n$/, "").trim(),
          level,
          startIndex: element.startIndex || 0,
          endIndex: element.endIndex || 0,
        });
      }
    }
  }

  return headings;
}

/**
 * Find a heading by its text (case-insensitive partial match)
 */
export function findHeadingByText(
  document: docs_v1.Schema$Document,
  searchText: string
): HeadingInfo | null {
  const headings = findHeadings(document);
  const searchLower = searchText.toLowerCase().trim();

  // First try exact match
  for (const heading of headings) {
    if (heading.text.toLowerCase() === searchLower) {
      return heading;
    }
  }

  // Then try partial match
  for (const heading of headings) {
    if (heading.text.toLowerCase().includes(searchLower)) {
      return heading;
    }
  }

  return null;
}

/**
 * Find the end index of a section (content under a heading until next same-level or higher heading)
 */
export function findSectionEnd(
  document: docs_v1.Schema$Document,
  heading: HeadingInfo
): number {
  const headings = findHeadings(document);
  const headingIndex = headings.findIndex(
    (h) => h.startIndex === heading.startIndex
  );

  if (headingIndex === -1) {
    return getDocumentEndIndex(document);
  }

  // Find next heading of same or higher level
  for (let i = headingIndex + 1; i < headings.length; i++) {
    if (headings[i].level <= heading.level) {
      return headings[i].startIndex;
    }
  }

  // No next heading found, section goes to end of document
  return getDocumentEndIndex(document);
}

/**
 * Get the end index of the document (for appending content)
 */
export function getDocumentEndIndex(document: docs_v1.Schema$Document): number {
  const content = document.body?.content;
  if (!content || content.length === 0) {
    return 1;
  }

  const lastElement = content[content.length - 1];
  // Subtract 1 because endIndex is exclusive and we want to insert before the final newline
  return (lastElement.endIndex || 1) - 1;
}

/**
 * Parse marked text content into plain text and formatting requests
 *
 * Input format:
 * - [H1], [H2], [H3] at start of line for headings
 * - [text](url) for links
 */
export function parseContentForInsertion(
  content: string,
  insertionIndex: number
): ParsedContent {
  const formattingRequests: FormattingRequest[] = [];
  let plainText = "";
  let currentIndex = insertionIndex;

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const isLastLine = i === lines.length - 1;

    // Check for heading markers at start of line
    let headingLevel = 0;
    if (line.startsWith("[H1] ")) {
      headingLevel = 1;
      line = line.substring(5);
    } else if (line.startsWith("[H2] ")) {
      headingLevel = 2;
      line = line.substring(5);
    } else if (line.startsWith("[H3] ")) {
      headingLevel = 3;
      line = line.substring(5);
    }

    // Parse links in the line: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let processedLine = "";
    let lastEnd = 0;
    let match;

    while ((match = linkRegex.exec(line)) !== null) {
      // Add text before the link
      processedLine += line.substring(lastEnd, match.index);

      const linkText = match[1];
      const linkUrl = match[2];

      // Calculate the index where this link will be inserted
      const linkStartIndex = currentIndex + processedLine.length;
      const linkEndIndex = linkStartIndex + linkText.length;

      formattingRequests.push({
        type: "link",
        startIndex: linkStartIndex,
        endIndex: linkEndIndex,
        url: linkUrl,
      });

      processedLine += linkText;
      lastEnd = match.index + match[0].length;
    }

    // Add remaining text after last link
    processedLine += line.substring(lastEnd);

    // Add newline except for last line (caller will add if needed)
    const lineWithNewline = isLastLine ? processedLine : processedLine + "\n";
    const lineLength = lineWithNewline.length;

    // Add heading formatting request for the entire line
    if (headingLevel > 0 && processedLine.length > 0) {
      formattingRequests.push({
        type: "heading",
        startIndex: currentIndex,
        endIndex: currentIndex + processedLine.length,
        level: headingLevel,
      });
    }

    plainText += lineWithNewline;
    currentIndex += lineLength;
  }

  return { plainText, formattingRequests };
}

/**
 * Generate Google Docs API requests for inserting and formatting text
 */
export function generateInsertRequests(
  content: string,
  insertionIndex: number
): docs_v1.Schema$Request[] {
  const { plainText, formattingRequests } = parseContentForInsertion(
    content,
    insertionIndex
  );

  const requests: docs_v1.Schema$Request[] = [];

  // First, insert the plain text
  if (plainText) {
    requests.push({
      insertText: {
        location: { index: insertionIndex },
        text: plainText,
      },
    });
  }

  // Then apply formatting (in reverse order of index to avoid shifting issues)
  const sortedFormatting = [...formattingRequests].sort(
    (a, b) => b.startIndex - a.startIndex
  );

  for (const fmt of sortedFormatting) {
    if (fmt.type === "heading" && fmt.level) {
      const namedStyleType =
        fmt.level === 1
          ? "HEADING_1"
          : fmt.level === 2
          ? "HEADING_2"
          : "HEADING_3";

      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: fmt.startIndex,
            endIndex: fmt.endIndex,
          },
          paragraphStyle: {
            namedStyleType,
          },
          fields: "namedStyleType",
        },
      });
    } else if (fmt.type === "link" && fmt.url) {
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: fmt.startIndex,
            endIndex: fmt.endIndex,
          },
          textStyle: {
            link: {
              url: fmt.url,
            },
          },
          fields: "link",
        },
      });
    }
  }

  return requests;
}

/**
 * Generate requests to delete a range of content
 */
export function generateDeleteRequest(
  startIndex: number,
  endIndex: number
): docs_v1.Schema$Request {
  return {
    deleteContentRange: {
      range: {
        startIndex,
        endIndex,
      },
    },
  };
}
