/**
 * Template command - manage pipeline templates
 *
 * Usage:
 *   pulzdai template list
 *   pulzdai template show code-review
 *   pulzdai template create my-flow -P "claude:plan,codex:code"
 *   pulzdai template delete my-flow
 */

import pc from 'picocolors';
import {
  listTemplates,
  loadTemplate,
  saveTemplate,
  deleteTemplate,
  createTemplate
} from '../../executor/templates';
import { parsePipelineString } from '../../executor';

export async function templateListCommand(): Promise<void> {
  const templates = listTemplates();

  if (templates.length === 0) {
    console.log(pc.dim('No templates found'));
    return;
  }

  console.log(pc.bold('\nAvailable Templates\n'));
  for (const name of templates) {
    const t = loadTemplate(name);
    const steps = t?.steps.map(s => s.agent + ':' + s.action).join(' → ') || '';
    console.log(pc.green('  ' + name));
    if (t?.description) console.log(pc.dim('    ' + t.description));
    console.log(pc.dim('    ' + steps));
  }
  console.log();
}

export async function templateShowCommand(name: string): Promise<void> {
  const t = loadTemplate(name);
  if (!t) {
    console.error(pc.red('Template not found: ' + name));
    process.exit(1);
  }

  console.log(pc.bold('\n' + t.name));
  if (t.description) console.log(pc.dim(t.description));
  console.log();

  t.steps.forEach((s, i) => {
    console.log(pc.yellow((i + 1) + '. ') + s.agent + ':' + s.action);
  });
  console.log();
}

export async function templateCreateCommand(
  name: string,
  options: { pipeline: string; description?: string }
): Promise<void> {
  const opts = parsePipelineString(options.pipeline);
  const template = createTemplate(name, opts.steps, options.description);
  saveTemplate(template);
  console.log(pc.green('Created template: ' + name));
}

export async function templateEditCommand(
  name: string,
  options: { pipeline?: string; description?: string }
): Promise<void> {
  const existing = loadTemplate(name);
  if (!existing) {
    console.error(pc.red('Template not found: ' + name));
    process.exit(1);
  }

  // Check if it's a built-in (createdAt === 0)
  if (existing.createdAt === 0) {
    console.error(pc.red('Cannot edit built-in template: ' + name));
    console.log(pc.dim('Create a copy instead: pulzdai template create my-' + name + ' -P "..."'));
    process.exit(1);
  }

  const steps = options.pipeline
    ? parsePipelineString(options.pipeline).steps
    : existing.steps;

  const description = options.description ?? existing.description;

  const updated = {
    ...existing,
    steps,
    description,
    updatedAt: Date.now()
  };

  saveTemplate(updated);
  console.log(pc.green('Updated template: ' + name));
}

export async function templateDeleteCommand(name: string): Promise<void> {
  if (deleteTemplate(name)) {
    console.log(pc.green('Deleted template: ' + name));
  } else {
    console.error(pc.red('Template not found or is built-in: ' + name));
    process.exit(1);
  }
}
