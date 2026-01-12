/**
 * Persona Command
 *
 * Switch between persona modes for different response styles.
 * Usage: pk-puzldai persona <name>
 */

import pc from 'picocolors';
import {
  getPersona,
  formatPersonaList,
  setCurrentPersona,
  getCurrentPersonaName,
  getCurrentPersona,
  type PersonaName,
} from '../../lib/personas';

interface PersonaOptions {
  list?: boolean;
  show?: boolean;
}

/**
 * Persona command handler
 */
export async function personaCommand(
  name: string | undefined,
  options: PersonaOptions
): Promise<void> {
  // List all personas
  if (options.list || (!name && !options.show)) {
    console.log('');
    console.log(formatPersonaList());
    console.log('');
    console.log(pc.dim(`Current persona: ${getCurrentPersonaName()}`));
    console.log('');
    console.log(pc.dim('Usage: pk-puzldai persona <name>'));
    return;
  }

  // Show current persona details
  if (options.show) {
    const current = getCurrentPersona();
    console.log('');
    console.log(pc.cyan(`Current Persona: ${current.name}`));
    console.log(pc.dim(current.description));
    console.log('');
    if (current.systemPrompt) {
      console.log(pc.dim('System prompt overlay:'));
      console.log(pc.dim('─'.repeat(40)));
      console.log(current.systemPrompt);
      console.log(pc.dim('─'.repeat(40)));
    } else {
      console.log(pc.dim('(no system prompt overlay)'));
    }
    console.log('');
    return;
  }

  // Set persona
  if (name) {
    const persona = getPersona(name);

    if (!persona) {
      console.error(pc.red(`Unknown persona: ${name}`));
      console.log('');
      console.log(formatPersonaList());
      process.exit(1);
    }

    setCurrentPersona(persona.name as PersonaName);
    console.log(pc.green(`✓ Switched to persona: ${persona.name}`));
    console.log(pc.dim(persona.description));

    if (persona.systemPrompt) {
      console.log('');
      console.log(pc.dim('Prompt style:'));
      console.log(pc.dim(persona.systemPrompt.split('\n')[0] + '...'));
    }
  }
}

/**
 * Get persona status for display
 */
export function getPersonaStatus(): string {
  const name = getCurrentPersonaName();
  if (name === 'default') {
    return '';
  }
  return pc.magenta(`[persona: ${name}]`);
}
