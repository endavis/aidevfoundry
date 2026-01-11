#!/usr/bin/env node

/**
 * Ralph Wiggum Loop Implementation Test
 * 
 * This script verifies that all Ralph Wiggum loop slash commands
 * are properly installed and accessible across different CLI tools.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface TestResult {
  tool: string;
  commandPath: string;
  exists: boolean;
  valid: boolean;
  issues: string[];
}

const results: TestResult[] = [];

function checkFile(path: string): { exists: boolean; content?: string } {
  if (existsSync(path)) {
    return {
      exists: true,
      content: readFileSync(path, 'utf-8')
    };
  }
  return { exists: false };
}

function testClaudeCommand(): TestResult {
  const result: TestResult = {
    tool: 'Claude Code',
    commandPath: '.claude/commands/ralph.md',
    exists: false,
    valid: false,
    issues: []
  };

  const check = checkFile(join(process.cwd(), result.commandPath));
  result.exists = check.exists;

  if (check.exists && check.content) {
    const content = check.content;
    
    // Check for required frontmatter
    if (!content.includes('description:')) {
      result.issues.push('Missing description in frontmatter');
    }
    if (!content.includes('argument-hint:')) {
      result.issues.push('Missing argument-hint in frontmatter');
    }
    if (!content.includes('allowed-tools:')) {
      result.issues.push('Missing allowed-tools in frontmatter');
    }
    
    // Check for required sections
    if (!content.includes('## Goal')) {
      result.issues.push('Missing ## Goal section');
    }
    if (!content.includes('## Operating Rules')) {
      result.issues.push('Missing ## Operating Rules section');
    }
    if (!content.includes('MAX_ITERS')) {
      result.issues.push('Missing MAX_ITERS budget');
    }
    if (!content.includes('Per-Iteration Contract')) {
      result.issues.push('Missing Per-Iteration Contract');
    }
    
    result.valid = result.issues.length === 0;
  } else {
    result.issues.push('Command file does not exist');
  }

  return result;
}

function testCodexPrompt(): TestResult {
  const result: TestResult = {
    tool: 'Codex CLI',
    commandPath: '.codex/prompts/ralph.md',
    exists: false,
    valid: false,
    issues: []
  };

  const check = checkFile(join(process.cwd(), result.commandPath));
  result.exists = check.exists;

  if (check.exists && check.content) {
    const content = check.content;
    
    // Check for required frontmatter
    if (!content.includes('description:')) {
      result.issues.push('Missing description in frontmatter');
    }
    if (!content.includes('argument-hint:')) {
      result.issues.push('Missing argument-hint in frontmatter');
    }
    
    // Check for variable placeholders
    if (!content.includes('$GOAL')) {
      result.issues.push('Missing $GOAL placeholder');
    }
    if (!content.includes('$ITERS')) {
      result.issues.push('Missing $ITERS placeholder');
    }
    if (!content.includes('$TESTS')) {
      result.issues.push('Missing $TESTS placeholder');
    }
    
    // Check for required sections
    if (!content.includes('## Goal')) {
      result.issues.push('Missing ## Goal section');
    }
    if (!content.includes('Per-Iteration Contract')) {
      result.issues.push('Missing Per-Iteration Contract');
    }
    
    result.valid = result.issues.length === 0;
  } else {
    result.issues.push('Prompt file does not exist');
  }

  return result;
}

function testGeminiCommand(): TestResult {
  const result: TestResult = {
    tool: 'Gemini CLI',
    commandPath: '.gemini/commands/ralph.toml',
    exists: false,
    valid: false,
    issues: []
  };

  const check = checkFile(join(process.cwd(), result.commandPath));
  result.exists = check.exists;

  if (check.exists && check.content) {
    const content = check.content;
    
    // Check for TOML structure
    if (!content.includes('description =')) {
      result.issues.push('Missing description in TOML');
    }
    if (!content.includes('prompt =')) {
      result.issues.push('Missing prompt in TOML');
    }
    
    // Check for variable placeholder
    if (!content.includes('{{args}}')) {
      result.issues.push('Missing {{args}} placeholder');
    }
    
    // Check for required sections
    if (!content.includes('## Goal')) {
      result.issues.push('Missing ## Goal section');
    }
    if (!content.includes('MAX_ITERS')) {
      result.issues.push('Missing MAX_ITERS budget');
    }
    
    result.valid = result.issues.length === 0;
  } else {
    result.issues.push('Command file does not exist');
  }

  return result;
}

function testFactoryCommand(): TestResult {
  const result: TestResult = {
    tool: 'Factory (droid)',
    commandPath: '.factory/commands/ralph.md',
    exists: false,
    valid: false,
    issues: []
  };

  const check = checkFile(join(process.cwd(), result.commandPath));
  result.exists = check.exists;

  if (check.exists && check.content) {
    const content = check.content;
    
    // Check for required frontmatter
    if (!content.includes('description:')) {
      result.issues.push('Missing description in frontmatter');
    }
    if (!content.includes('argument-hint:')) {
      result.issues.push('Missing argument-hint in frontmatter');
    }
    if (!content.includes('allowed-tools:')) {
      result.issues.push('Missing allowed-tools in frontmatter');
    }
    
    // Check for tool-specific tools
    if (!content.includes('view') || !content.includes('glob') || !content.includes('grep')) {
      result.issues.push('Missing agentic tools (view, glob, grep)');
    }
    
    // Check for required sections
    if (!content.includes('## Goal')) {
      result.issues.push('Missing ## Goal section');
    }
    if (!content.includes('Per-Iteration Contract')) {
      result.issues.push('Missing Per-Iteration Contract');
    }
    
    result.valid = result.issues.length === 0;
  } else {
    result.issues.push('Command file does not exist');
  }

  return result;
}

function testCrushCommand(): TestResult {
  const result: TestResult = {
    tool: 'Charm Crush',
    commandPath: '.crush/commands/ralph.md',
    exists: false,
    valid: false,
    issues: []
  };

  const check = checkFile(join(process.cwd(), result.commandPath));
  result.exists = check.exists;

  if (check.exists && check.content) {
    const content = check.content;
    
    // Check for required frontmatter
    if (!content.includes('description:')) {
      result.issues.push('Missing description in frontmatter');
    }
    if (!content.includes('argument-hint:')) {
      result.issues.push('Missing argument-hint in frontmatter');
    }
    
    // Check for required sections
    if (!content.includes('## Goal')) {
      result.issues.push('Missing ## Goal section');
    }
    if (!content.includes('Per-Iteration Contract')) {
      result.issues.push('Missing Per-Iteration Contract');
    }
    
    result.valid = result.issues.length === 0;
  } else {
    result.issues.push('Command file does not exist');
  }

  return result;
}

function printResults() {
  console.log('\n🔄 Ralph Wiggum Loop Implementation Test\n');
  console.log('='.repeat(60));

  let allValid = true;

  for (const result of results) {
    console.log(`\n${result.tool}:`);
    console.log(`  Path: ${result.commandPath}`);
    console.log(`  Exists: ${result.exists ? '✅' : '❌'}`);
    console.log(`  Valid: ${result.valid ? '✅' : '❌'}`);

    if (result.issues.length > 0) {
      allValid = false;
      console.log('  Issues:');
      for (const issue of result.issues) {
        console.log(`    • ${issue}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  
  if (allValid) {
    console.log('\n✅ All Ralph Wiggum loop implementations are valid!\n');
  } else {
    console.log('\n❌ Some implementations have issues. Please fix them.\n');
  }

  console.log('📚 Usage Guide:');
  console.log('  Claude Code:  /ralph "<goal>" --iters N --tests "cmd"');
  console.log('  Codex CLI:    /prompts:ralph GOAL="..." ITERS=N TESTS="..."');
  console.log('  Gemini CLI:   /ralph "<goal>"');
  console.log('  Factory:      /ralph "<goal>" --iters N --tests "cmd"');
  console.log('  Charm Crush:  /ralph "<goal>" --iters N --tests "cmd"');
  console.log('\nSee RALPH_WIGGUM_LOOP.md for full documentation.\n');
}

// Run tests
try {
  results.push(testClaudeCommand());
  results.push(testCodexPrompt());
  results.push(testGeminiCommand());
  results.push(testFactoryCommand());
  results.push(testCrushCommand());
  
  printResults();
} catch (error) {
  console.error('Error running tests:', error);
  process.exit(1);
}