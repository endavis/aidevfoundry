/**
 * Profile command - manage orchestration profiles
 *
 * Usage:
 *   pk-puzldai profile list
 *   pk-puzldai profile show quality
 *   pk-puzldai profile set-default speed
 *   pk-puzldai profile create fast --from speed
 *   pk-puzldai profile delete fast
 */

import pc from 'picocolors';
import { loadConfig } from '../../lib/config';
import {
  resolveOrchestrationConfig,
  saveProfilesFile,
  validateOrchestrationConfig,
  getProfilesPath,
  loadProfilesFile
} from '../../orchestrator/profiles';

export async function profileListCommand(): Promise<void> {
  const config = loadConfig();
  const orchestration = resolveOrchestrationConfig(config.orchestration);
  const names = Object.keys(orchestration.profiles).sort();

  if (names.length === 0) {
    console.log(pc.dim('No profiles found'));
    return;
  }

  const source = loadProfilesFile() ? getProfilesPath() : 'config.json';
  console.log(pc.bold('
Available Profiles
'));
  console.log(pc.dim('Source: ' + source));

  for (const name of names) {
    const isDefault = name === orchestration.defaultProfile;
    const prefix = isDefault ? '*' : ' ';
    console.log(pc.green(`  ${prefix} ${name}`));
  }
  console.log();
}

export async function profileShowCommand(name: string): Promise<void> {
  const config = loadConfig();
  const orchestration = resolveOrchestrationConfig(config.orchestration);
  const profile = orchestration.profiles[name];

  if (!profile) {
    console.error(pc.red('Profile not found: ' + name));
    process.exit(1);
  }

  const isDefault = name === orchestration.defaultProfile ? ' (default)' : '';
  console.log(pc.bold(`
${name}${isDefault}`));
  console.log(JSON.stringify(profile, null, 2));
  console.log();
}

export async function profileSetDefaultCommand(name: string): Promise<void> {
  const config = loadConfig();
  const orchestration = resolveOrchestrationConfig(config.orchestration);

  if (!orchestration.profiles[name]) {
    console.error(pc.red('Profile not found: ' + name));
    process.exit(1);
  }

  orchestration.defaultProfile = name;
  const errors = validateOrchestrationConfig(orchestration);
  if (errors.length > 0) {
    console.error(pc.red('Invalid profile configuration:'));
    for (const error of errors) {
      console.error(pc.red('  - ' + error));
    }
    process.exit(1);
  }

  saveProfilesFile(orchestration);
  console.log(pc.green('Default profile set to: ' + name));
}

export async function profileCreateCommand(
  name: string,
  options: { from?: string }
): Promise<void> {
  const config = loadConfig();
  const orchestration = resolveOrchestrationConfig(config.orchestration);

  if (orchestration.profiles[name]) {
    console.error(pc.red('Profile already exists: ' + name));
    process.exit(1);
  }

  const fromName = options.from || orchestration.defaultProfile;
  const source = orchestration.profiles[fromName];
  if (!source) {
    console.error(pc.red('Source profile not found: ' + fromName));
    process.exit(1);
  }

  orchestration.profiles[name] = {
    ...source,
    name
  };

  const errors = validateOrchestrationConfig(orchestration);
  if (errors.length > 0) {
    console.error(pc.red('Invalid profile configuration:'));
    for (const error of errors) {
      console.error(pc.red('  - ' + error));
    }
    process.exit(1);
  }

  saveProfilesFile(orchestration);
  console.log(pc.green('Created profile: ' + name));
}

export async function profileDeleteCommand(name: string): Promise<void> {
  const config = loadConfig();
  const orchestration = resolveOrchestrationConfig(config.orchestration);

  if (!orchestration.profiles[name]) {
    console.error(pc.red('Profile not found: ' + name));
    process.exit(1);
  }

  if (name === orchestration.defaultProfile) {
    console.error(pc.red('Cannot delete the default profile: ' + name));
    process.exit(1);
  }

  delete orchestration.profiles[name];
  saveProfilesFile(orchestration);
  console.log(pc.green('Deleted profile: ' + name));
}
