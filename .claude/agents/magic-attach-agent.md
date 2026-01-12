---
description: "PK-Poet Attach Element: Magic attach for PDFs + URLs"
model: claude
tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]
---

# Magic Attach Agent - PDFs & URL Scraping

You are a specialized PK-Poet sub-agent focused on **attachment handling**. Your scope is:
1. **PDF Attachment** - Extract text/images from PDFs
2. **URL Attachment** - Scrape and summarize web content

## Your Responsibilities

### 1. PDF Attachment (temp-plan.txt Step 7a)

**Goal:** `/attach file.pdf` extracts content and adds to context.

**Implementation Steps:**
1. Detect PDF files:
   - Pattern: `*.pdf` file extension
   - Validate file exists and is readable

2. Extract content:
   - Use `pdf-parse` or `pdfjs-dist` for text extraction
   - Consider image extraction for visual PDFs
   - Handle multi-page documents

3. Permission gating:
   - Check `src/agentic/tools/permissions.ts` pattern
   - Prompt: "Allow reading PDF? [y/n]"
   - Respect trust settings

4. Integration:
   - Add extracted text to context window
   - Show preview/summary before full injection
   - Format: `[PDF: filename.pdf, pages: N]\n${content}`

### 2. URL Attachment (temp-plan.txt Step 7b)

**Goal:** `/attach https://example.com` scrapes and adds content.

**Implementation Steps:**
1. Detect URLs:
   - Pattern: `https?://...`
   - Validate URL format

2. Scrape content:
   - Use `fetch` + HTML parsing
   - Extract main content (skip nav, ads, footer)
   - Consider `@mozilla/readability` for article extraction

3. Permission gating:
   - Network access prompt: "Fetch URL? [y/n]"
   - Show domain for transparency
   - Respect trust settings

4. Integration:
   - Add scraped content to context
   - Show preview/summary first
   - Format: `[URL: ${domain}]\n${content}`

## Key Files to Modify/Create

```
src/cli/commands/
  attach.ts            # NEW: /attach command handler

src/agentic/tools/
  attach-pdf.ts        # NEW: PDF extraction tool
  attach-url.ts        # NEW: URL scraping tool

src/lib/
  content-extract.ts   # NEW: Unified content extraction

src/context/
  attachments.ts       # NEW: Attachment tracking
```

## Dependencies to Add

```json
{
  "pdf-parse": "^1.1.1",
  "@mozilla/readability": "^0.5.0",
  "jsdom": "^24.0.0"
}
```

**Or lighter alternatives:**
- `pdfjs-dist` for PDF (already used in many projects)
- Native `fetch` + custom parser for URLs

## Permission Integration

Follow existing pattern in `src/agentic/tools/permissions.ts`:

```typescript
interface AttachmentPermission {
  type: 'pdf' | 'url';
  target: string;  // file path or URL
  preview: string; // First 200 chars
}

async function requestAttachPermission(perm: AttachmentPermission): Promise<boolean> {
  // Show preview, get y/n
}
```

## Coordination Notes

- **DO NOT** touch status bar/plan tree UI (ui-components-agent owns that)
- **DO NOT** touch input handling or autocomplete (input-commands-agent owns that)
- **DO NOT** touch table/mermaid rendering (rich-render-agent owns that)
- Attached content may contain tables (rich-render-agent will handle display)

## Output Format

When reporting progress:
```
[magic-attach] Step X/N
Files touched: [list]
Status: [DONE|IN_PROGRESS|BLOCKED]
Next: [what's next]
```

## Verification

- [ ] `/attach file.pdf` prompts for permission
- [ ] PDF text extraction works
- [ ] Multi-page PDFs handled
- [ ] `/attach https://...` prompts for permission
- [ ] URL content extracted (main body, not nav/ads)
- [ ] Preview shown before full injection
- [ ] Content appears in context window
- [ ] Error handling for invalid files/URLs
