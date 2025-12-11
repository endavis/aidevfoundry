/**
 * Response Parser (Phase 9.2)
 *
 * Parses LLM responses to extract AgenticResponse JSON.
 * Handles various formats: raw JSON, markdown code blocks, etc.
 */

export interface FileOperation {
  path: string;
  operation: 'create' | 'edit' | 'delete';
  content?: string;       // For create/overwrite
  search?: string;        // For edit: find this
  replace?: string;       // For edit: replace with
}

export interface AgenticResponse {
  explanation: string;
  files: FileOperation[];
}

export interface ParseResult {
  success: boolean;
  response?: AgenticResponse;
  error?: string;
  rawJson?: string;
}

/**
 * Attempts to fix common JSON issues in LLM responses
 */
function fixJsonString(json: string): string {
  // Fix unescaped newlines inside strings
  // This is a common issue with LLMs generating multi-line content
  let fixed = json;
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < fixed.length; i++) {
    const char = fixed[i];
    const nextChar = fixed[i + 1];

    if (escape) {
      result += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    // If we're in a string and hit a literal newline, escape it
    if (inString && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') {
        result += '\\n';
        i++; // Skip the \n
      } else {
        result += '\\n';
      }
      continue;
    }

    // If we're in a string and hit an unescaped tab, escape it
    if (inString && char === '\t') {
      result += '\\t';
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Uses brace matching to extract a complete JSON object
 */
function extractWithBraceMatching(text: string, startIndex: number = 0): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let started = false;
  let startPos = startIndex;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        if (!started) {
          started = true;
          startPos = i;
        }
        depth++;
      }
      if (char === '}') {
        depth--;
        if (depth === 0 && started) {
          return text.slice(startPos, i + 1);
        }
      }
    }
  }

  return null;
}

/**
 * Attempts to extract JSON from various response formats
 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();

  // Try 1: JSON in markdown code block (most common with LLMs)
  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    const blockContent = jsonBlockMatch[1].trim();
    // Apply brace matching to handle any trailing content
    const extracted = extractWithBraceMatching(blockContent);
    if (extracted) return extracted;
    return blockContent;
  }

  // Try 2: Raw JSON starting with {
  if (trimmed.startsWith('{')) {
    const extracted = extractWithBraceMatching(trimmed);
    if (extracted) return extracted;
  }

  // Try 3: Find JSON object that contains our expected fields
  const jsonStartMatch = trimmed.match(/\{[\s\S]*?"explanation"/);
  if (jsonStartMatch) {
    const startIdx = trimmed.indexOf(jsonStartMatch[0]);
    const extracted = extractWithBraceMatching(trimmed, startIdx);
    if (extracted) return extracted;
  }

  // Try 4: Last resort - find any JSON-like structure
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace !== -1) {
    const extracted = extractWithBraceMatching(trimmed, firstBrace);
    if (extracted) return extracted;
  }

  return null;
}

/**
 * Validates a FileOperation object
 */
function validateFileOperation(op: unknown, index: number): { valid: boolean; error?: string } {
  if (typeof op !== 'object' || op === null) {
    return { valid: false, error: `files[${index}] is not an object` };
  }

  const file = op as Record<string, unknown>;

  if (typeof file.path !== 'string' || !file.path) {
    return { valid: false, error: `files[${index}].path must be a non-empty string` };
  }

  if (!['create', 'edit', 'delete'].includes(file.operation as string)) {
    return { valid: false, error: `files[${index}].operation must be 'create', 'edit', or 'delete'` };
  }

  if (file.operation === 'create' && typeof file.content !== 'string') {
    return { valid: false, error: `files[${index}].content required for 'create' operation` };
  }

  if (file.operation === 'edit') {
    if (typeof file.search !== 'string' || !file.search) {
      return { valid: false, error: `files[${index}].search required for 'edit' operation` };
    }
    if (typeof file.replace !== 'string') {
      return { valid: false, error: `files[${index}].replace required for 'edit' operation` };
    }
  }

  return { valid: true };
}

/**
 * Parses an LLM response string into AgenticResponse
 */
export function parseResponse(text: string): ParseResult {
  if (!text || typeof text !== 'string') {
    return {
      success: false,
      error: 'Empty or invalid response'
    };
  }

  // Extract JSON from response
  const rawJson = extractJson(text);
  if (!rawJson) {
    return {
      success: false,
      error: 'No valid JSON found in response'
    };
  }

  // Check for truncated response (max tokens hit)
  if (!rawJson.trim().endsWith('}')) {
    return {
      success: false,
      error: 'Response appears truncated (no closing brace)',
      rawJson
    };
  }

  // Parse JSON - try raw first, then with fixes
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    // Try fixing common JSON issues (unescaped newlines, etc.)
    try {
      const fixedJson = fixJsonString(rawJson);
      parsed = JSON.parse(fixedJson);
    } catch {
      return {
        success: false,
        error: `JSON parse error: ${(e as Error).message}`,
        rawJson
      };
    }
  }

  // Validate structure
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      success: false,
      error: 'Response is not an object',
      rawJson
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Check explanation
  if (typeof obj.explanation !== 'string') {
    return {
      success: false,
      error: 'Missing or invalid "explanation" field',
      rawJson
    };
  }

  // Check files array
  if (!Array.isArray(obj.files)) {
    return {
      success: false,
      error: 'Missing or invalid "files" array',
      rawJson
    };
  }

  // Validate each file operation
  for (let i = 0; i < obj.files.length; i++) {
    const validation = validateFileOperation(obj.files[i], i);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        rawJson
      };
    }
  }

  // Build typed response
  const response: AgenticResponse = {
    explanation: obj.explanation,
    files: obj.files.map((f: Record<string, unknown>) => ({
      path: f.path as string,
      operation: f.operation as 'create' | 'edit' | 'delete',
      content: f.content as string | undefined,
      search: f.search as string | undefined,
      replace: f.replace as string | undefined
    }))
  };

  return {
    success: true,
    response,
    rawJson
  };
}

/**
 * Creates an empty AgenticResponse (no changes)
 */
export function emptyResponse(explanation: string = 'No file changes needed.'): AgenticResponse {
  return {
    explanation,
    files: []
  };
}

/**
 * Checks if a response has any file operations
 */
export function hasFileOperations(response: AgenticResponse): boolean {
  return response.files.length > 0;
}

/**
 * Gets a summary of file operations
 */
export function getOperationSummary(response: AgenticResponse): string {
  if (response.files.length === 0) {
    return 'No file changes';
  }

  const counts = { create: 0, edit: 0, delete: 0 };
  for (const file of response.files) {
    counts[file.operation]++;
  }

  const parts: string[] = [];
  if (counts.create > 0) parts.push(`${counts.create} create`);
  if (counts.edit > 0) parts.push(`${counts.edit} edit`);
  if (counts.delete > 0) parts.push(`${counts.delete} delete`);

  return parts.join(', ');
}
