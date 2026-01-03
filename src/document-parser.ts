import type { docs_v1 } from "googleapis";

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
  type: "heading" | "link" | "bullet";
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
 * - • prefix for bullet points (use • or * when inserting)
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
  searchText: string,
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
  heading: HeadingInfo,
): number {
  const headings = findHeadings(document);
  const headingIndex = headings.findIndex(
    (h) => h.startIndex === heading.startIndex,
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
 * Represents a text match location in the document
 */
export interface TextMatch {
  text: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Find all occurrences of a text string in the document
 */
export function findTextInDocument(
  document: docs_v1.Schema$Document,
  searchText: string,
  caseSensitive = false,
): TextMatch[] {
  const content = document.body?.content;
  if (!content) {
    return [];
  }

  const matches: TextMatch[] = [];
  const searchLower = caseSensitive ? searchText : searchText.toLowerCase();

  for (const element of content) {
    if (element.paragraph) {
      const elements = element.paragraph.elements || [];

      for (const elem of elements) {
        if (elem.textRun?.content) {
          const text = elem.textRun.content;
          const textToSearch = caseSensitive ? text : text.toLowerCase();
          const elemStartIndex = elem.startIndex || 0;

          let searchStart = 0;
          let foundIndex = textToSearch.indexOf(searchLower, searchStart);

          while (foundIndex !== -1) {
            matches.push({
              text: text.substring(foundIndex, foundIndex + searchText.length),
              startIndex: elemStartIndex + foundIndex,
              endIndex: elemStartIndex + foundIndex + searchText.length,
            });
            searchStart = foundIndex + 1;
            foundIndex = textToSearch.indexOf(searchLower, searchStart);
          }
        }
      }
    }
  }

  return matches;
}

/**
 * Parse marked text content into plain text and formatting requests
 *
 * Input format:
 * - [H1], [H2], [H3] at start of line for headings
 * - [text](url) for links
 * - • or * at start of line for bullet points
 */
export function parseContentForInsertion(
  content: string,
  insertionIndex: number,
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
    let isBullet = false;
    if (line.startsWith("[H1] ")) {
      headingLevel = 1;
      line = line.substring(5);
    } else if (line.startsWith("[H2] ")) {
      headingLevel = 2;
      line = line.substring(5);
    } else if (line.startsWith("[H3] ")) {
      headingLevel = 3;
      line = line.substring(5);
    } else if (line.startsWith("• ")) {
      // Bullet point marker (used in output from documentToText)
      isBullet = true;
      line = line.substring(2);
    } else if (line.startsWith("* ")) {
      // Alternative bullet point marker (common markdown style)
      isBullet = true;
      line = line.substring(2);
    }

    // Parse links in the line: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let processedLine = "";
    let lastEnd = 0;

    for (const match of line.matchAll(linkRegex)) {
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
    const lineWithNewline = isLastLine ? processedLine : `${processedLine}\n`;
    const lineLength = lineWithNewline.length;

    // Add heading formatting request for the entire line INCLUDING the newline
    // Google Docs requires the newline to be included in the range for paragraph styling
    if (headingLevel > 0 && processedLine.length > 0) {
      formattingRequests.push({
        type: "heading",
        startIndex: currentIndex,
        // Include the newline character in the range for proper paragraph styling
        endIndex: currentIndex + lineWithNewline.length,
        level: headingLevel,
      });
    }

    // Add bullet formatting request for the entire line
    if (isBullet && processedLine.length > 0) {
      formattingRequests.push({
        type: "bullet",
        startIndex: currentIndex,
        endIndex: currentIndex + lineWithNewline.length,
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
  insertionIndex: number,
): docs_v1.Schema$Request[] {
  const { plainText, formattingRequests } = parseContentForInsertion(
    content,
    insertionIndex,
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

    // Apply NORMAL_TEXT paragraph style to inserted paragraphs.
    // IMPORTANT: We exclude the final newline from paragraph styling to avoid
    // affecting the adjacent paragraph's style (e.g., converting a heading to normal text).
    // Paragraph styles in Google Docs apply to entire paragraphs, and including the
    // trailing newline can inadvertently restyle the following paragraph.
    const styleEndIndex = plainText.endsWith("\n")
      ? insertionIndex + plainText.length - 1
      : insertionIndex + plainText.length;

    if (styleEndIndex > insertionIndex) {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: insertionIndex,
            endIndex: styleEndIndex,
          },
          paragraphStyle: {
            namedStyleType: "NORMAL_TEXT",
          },
          fields: "namedStyleType",
        },
      });
    }

    // Reset text formatting for the inserted text to avoid inheriting styles (like bold)
    // from adjacent text. This ensures clean, normal text by default.
    // Note: We only reset boolean styles here. foregroundColor and fontSize cannot be
    // reset with empty objects - they would cause "Unsupported dimension unit:UNIT_UNSPECIFIED" errors.
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: insertionIndex,
          endIndex: insertionIndex + plainText.length,
        },
        textStyle: {
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          smallCaps: false,
        },
        fields: "bold,italic,underline,strikethrough,smallCaps",
      },
    });
  }

  // Then apply formatting (in reverse order of index to avoid shifting issues)
  const sortedFormatting = [...formattingRequests].sort(
    (a, b) => b.startIndex - a.startIndex,
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
    } else if (fmt.type === "bullet") {
      requests.push({
        createParagraphBullets: {
          range: {
            startIndex: fmt.startIndex,
            endIndex: fmt.endIndex,
          },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
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
  endIndex: number,
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

/**
 * Extract only heading lines from document text
 */
export function extractHeadingsOnly(documentText: string): string {
  const lines = documentText.split("\n");
  const headingLines = lines.filter(
    (line) =>
      line.startsWith("[H1] ") ||
      line.startsWith("[H2] ") ||
      line.startsWith("[H3] "),
  );
  return headingLines.join("\n");
}

/**
 * Calculate document statistics
 */
export interface DocumentStats {
  characterCount: number;
  wordCount: number;
  headingCount: number;
  headingStructure: string[];
}

export function calculateDocumentStats(
  document: docs_v1.Schema$Document,
): DocumentStats {
  const content = document.body?.content;
  if (!content) {
    return {
      characterCount: 0,
      wordCount: 0,
      headingCount: 0,
      headingStructure: [],
    };
  }

  let characterCount = 0;
  let wordCount = 0;
  const headingStructure: string[] = [];

  for (const element of content) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      const paragraphStyle = paragraph.paragraphStyle?.namedStyleType;
      const elements = paragraph.elements || [];

      let paragraphText = "";
      for (const elem of elements) {
        if (elem.textRun?.content) {
          paragraphText += elem.textRun.content;
        }
      }

      characterCount += paragraphText.length;
      // Count words (split by whitespace, filter empty)
      const words = paragraphText.trim().split(/\s+/).filter(Boolean);
      wordCount += words.length;

      // Track headings
      if (
        paragraphStyle === "HEADING_1" ||
        paragraphStyle === "HEADING_2" ||
        paragraphStyle === "HEADING_3"
      ) {
        const level =
          paragraphStyle === "HEADING_1"
            ? 1
            : paragraphStyle === "HEADING_2"
              ? 2
              : 3;
        const headingText = paragraphText.replace(/\n$/, "").trim();
        headingStructure.push(`[H${level}] ${headingText}`);
      }
    }
  }

  return {
    characterCount,
    wordCount,
    headingCount: headingStructure.length,
    headingStructure,
  };
}

/**
 * Extract section content from a heading until the next heading of equal or higher level
 */
export function extractSectionContent(
  document: docs_v1.Schema$Document,
  headingText: string,
  includeSubsections = true,
  maxCharacters?: number,
): { content: string; found: boolean; totalCharacters: number } {
  const headings = findHeadings(document);
  const searchLower = headingText.toLowerCase().trim();

  // Find the target heading
  let targetHeadingIndex = -1;
  for (let i = 0; i < headings.length; i++) {
    if (
      headings[i].text.toLowerCase() === searchLower ||
      headings[i].text.toLowerCase().includes(searchLower)
    ) {
      targetHeadingIndex = i;
      break;
    }
  }

  if (targetHeadingIndex === -1) {
    return { content: "", found: false, totalCharacters: 0 };
  }

  const targetHeading = headings[targetHeadingIndex];
  const startIndex = targetHeading.startIndex;

  // Find the end of the section
  let endIndex = getDocumentEndIndex(document);
  for (let i = targetHeadingIndex + 1; i < headings.length; i++) {
    const nextHeading = headings[i];
    if (includeSubsections) {
      // Stop at equal or higher level
      if (nextHeading.level <= targetHeading.level) {
        endIndex = nextHeading.startIndex;
        break;
      }
    } else {
      // Stop at any heading
      endIndex = nextHeading.startIndex;
      break;
    }
  }

  // Extract the text from startIndex to endIndex
  const content = document.body?.content;
  if (!content) {
    return { content: "", found: true, totalCharacters: 0 };
  }

  // Build the section text by iterating through content
  let sectionText = "";
  for (const element of content) {
    const elemStart = element.startIndex || 0;
    const elemEnd = element.endIndex || 0;

    if (elemEnd <= startIndex) continue;
    if (elemStart >= endIndex) break;

    if (element.paragraph) {
      const paragraph = element.paragraph;
      const paragraphStyle = paragraph.paragraphStyle?.namedStyleType;
      const elements = paragraph.elements || [];

      let prefix = "";
      if (paragraphStyle === "HEADING_1") prefix = "[H1] ";
      else if (paragraphStyle === "HEADING_2") prefix = "[H2] ";
      else if (paragraphStyle === "HEADING_3") prefix = "[H3] ";
      else if (paragraph.bullet) prefix = "• ";

      let paragraphText = "";
      for (const elem of elements) {
        if (elem.textRun) {
          const textRun = elem.textRun;
          let text = textRun.content || "";
          const link = textRun.textStyle?.link?.url;
          if (link && text.trim()) {
            const linkText = text.replace(/\n$/, "");
            text = `[${linkText}](${link})`;
            if (textRun.content?.endsWith("\n")) text += "\n";
          }
          paragraphText += text;
        }
      }

      if (paragraphText.trim()) {
        sectionText += `${prefix}${paragraphText.replace(/\n$/, "")}\n`;
      }
    }
  }

  const totalCharacters = sectionText.length;
  let resultContent = sectionText;

  if (maxCharacters && sectionText.length > maxCharacters) {
    resultContent =
      sectionText.substring(0, maxCharacters) +
      `\n\n[Content truncated. Section contains approximately ${totalCharacters - maxCharacters} more characters.]`;
  }

  return { content: resultContent.trim(), found: true, totalCharacters };
}
