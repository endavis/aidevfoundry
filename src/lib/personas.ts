/**
 * Persona Modes
 *
 * Built-in personas for adjusting agent tone and style.
 * Used with `/persona <name>` command.
 */

export type PersonaName = 'borris' | 'dax' | 'brief' | 'teacher' | 'default';

export interface Persona {
  name: PersonaName;
  description: string;
  systemPrompt: string;
}

/**
 * Built-in persona definitions
 */
export const PERSONAS: Record<PersonaName, Persona> = {
  default: {
    name: 'default',
    description: 'Standard balanced responses',
    systemPrompt: '',
  },
  borris: {
    name: 'borris',
    description: 'Terse, blunt, gets to the point',
    systemPrompt: `Be extremely concise. No fluff. Just answer the question directly.
Skip pleasantries and unnecessary explanations.
If code is needed, show only the essential code.
One sentence answers when possible.`,
  },
  dax: {
    name: 'dax',
    description: 'Friendly mentor, explains reasoning',
    systemPrompt: `Be a helpful mentor. Explain your reasoning step by step.
Use analogies and examples to clarify concepts.
Encourage learning and understanding.
Be warm and supportive while remaining technically accurate.`,
  },
  brief: {
    name: 'brief',
    description: 'Minimal output, just facts',
    systemPrompt: `Minimal output only. Facts and code, no explanations.
Use bullet points when listing items.
Skip all introductions and conclusions.
Code blocks only when essential.`,
  },
  teacher: {
    name: 'teacher',
    description: 'Educational, step-by-step explanations',
    systemPrompt: `Teach the user. Break down concepts into digestible parts.
Use numbered steps for processes.
Provide examples for abstract concepts.
Ask guiding questions to check understanding.
Build from fundamentals to advanced concepts.`,
  },
};

/**
 * Get persona by name
 */
export function getPersona(name: string): Persona | null {
  const normalized = name.toLowerCase() as PersonaName;
  return PERSONAS[normalized] || null;
}

/**
 * List all available personas
 */
export function listPersonas(): Persona[] {
  return Object.values(PERSONAS);
}

/**
 * Format persona list for display
 */
export function formatPersonaList(): string {
  const lines = ['Available personas:', ''];
  const maxName = Math.max(...Object.keys(PERSONAS).map(n => n.length));

  for (const persona of Object.values(PERSONAS)) {
    const name = persona.name.padEnd(maxName + 2);
    lines.push(`  ${name} ${persona.description}`);
  }

  return lines.join('\n');
}

/**
 * Current persona state (session-level)
 */
let currentPersona: PersonaName = 'default';

export function setCurrentPersona(name: PersonaName): void {
  currentPersona = name;
}

export function getCurrentPersona(): Persona {
  return PERSONAS[currentPersona];
}

export function getCurrentPersonaName(): PersonaName {
  return currentPersona;
}

/**
 * Get system prompt overlay for current persona
 */
export function getPersonaSystemPrompt(): string {
  const persona = getCurrentPersona();
  if (!persona.systemPrompt) return '';
  return `[Persona: ${persona.name}]\n${persona.systemPrompt}\n\n`;
}
