#!/usr/bin/env node

/**
 * CLI Adapter Fixes Verification Script
 * 
 * This script verifies that the CLI adapter fixes have been applied correctly
 * by checking the source code against the expected patterns.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface TestResult {
  adapter: string;
  test: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function checkFile(path: string, testName: string, checkFn: (content: string) => { passed: boolean; details: string }) {
  if (!existsSync(path)) {
    results.push({
      adapter: path.split('/').pop() || 'unknown',
      test: testName,
      passed: false,
      details: 'File not found'
    });
    return;
  }

  const content = readFileSync(path, 'utf-8');
  const result = checkFn(content);
  
  results.push({
    adapter: path.split('/').pop() || 'unknown',
    test: testName,
    passed: result.passed,
    details: result.details
  });
}

// Test 1: Claude adapter - Check prompt comes after flags
checkFile(
  join(process.cwd(), 'src/adapters/claude.ts'),
  'Claude: Prompt after flags',
  (content) => {
    // Look for the pattern where prompt is added last
    const hasCorrectOrder = content.includes("args.push(prompt);") && 
                           !content.includes("const args = ['-p', prompt,");
    
    return {
      passed: hasCorrectOrder,
      details: hasCorrectOrder 
        ? '✓ Prompt correctly placed after flags' 
        : '✗ Prompt should come after flags, not in args initialization'
    };
  }
);

// Test 2: Gemini adapter - Check no --yolo flag
checkFile(
  join(process.cwd(), 'src/adapters/gemini.ts'),
  'Gemini: No --yolo flag',
  (content) => {
    const hasYoloFlag = content.includes("args.push('--yolo')");
    
    return {
      passed: !hasYoloFlag,
      details: hasYoloFlag 
        ? '✗ Still using --yolo flag (does not exist in Gemini CLI)' 
        : '✓ Correctly removed --yolo flag usage'
    };
  }
);

// Test 3: Gemini adapter - Check correct approval mode handling
checkFile(
  join(process.cwd(), 'src/adapters/gemini.ts'),
  'Gemini: Correct approval mode',
  (content) => {
    const hasCorrectLogic = content.includes("geminiApprovalMode === 'yolo' || geminiApprovalMode === 'auto_edit'");
    
    return {
      passed: hasCorrectLogic,
      details: hasCorrectLogic 
        ? '✓ Correctly handles yolo as auto_edit' 
        : '✗ Should map yolo to auto_edit mode'
    };
  }
);

// Test 4: Factory adapter - Check autonomy handling
checkFile(
  join(process.cwd(), 'src/adapters/factory.ts'),
  'Factory: Autonomy not forced',
  (content) => {
    const forcesLowAutonomy = content.includes("autonomy || 'low'") || 
                             content.includes("args.push('--auto', 'low')") && 
                             !content.includes('if (autonomy)');
    
    return {
      passed: !forcesLowAutonomy,
      details: forcesLowAutonomy 
        ? '✗ Forces low autonomy even when not specified' 
        : '✓ Autonomy only added when explicitly specified'
    };
  }
);

// Test 5: Crush adapter - Check no 'run' subcommand
checkFile(
  join(process.cwd(), 'src/adapters/crush.ts'),
  'Crush: No run subcommand',
  (content) => {
    const hasRunSubcommand = content.includes("const args: string[] = ['run']");
    
    return {
      passed: !hasRunSubcommand,
      details: hasRunSubcommand 
        ? '✗ Still using non-existent "run" subcommand' 
        : '✓ Correctly removed run subcommand'
    };
  }
);

// Test 6: Crush adapter - Check --yolo flag instead of -y
checkFile(
  join(process.cwd(), 'src/adapters/crush.ts'),
  'Crush: Uses --yolo flag',
  (content) => {
    const usesYoloFlag = content.includes("args.push('--yolo')");
    const usesOldFlag = content.includes("args.push('-y')");
    
    return {
      passed: usesYoloFlag && !usesOldFlag,
      details: usesYoloFlag && !usesOldFlag 
        ? '✓ Correctly uses --yolo flag' 
        : usesOldFlag 
        ? '✗ Using deprecated -y flag instead of --yolo' 
        : '✗ Missing --yolo flag for auto-accept'
    };
  }
);

function printResults() {
  console.log('\n🔧 CLI Adapter Fixes Verification\n');
  console.log('='.repeat(70));

  let allPassed = true;
  let passCount = 0;
  let failCount = 0;

  for (const result of results) {
    console.log(`\n${result.adapter}:`);
    console.log(`  Test: ${result.test}`);
    console.log(`  Status: ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  ${result.details}`);

    if (result.passed) {
      passCount++;
    } else {
      failCount++;
      allPassed = false;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`\n📊 Summary: ${passCount} passed, ${failCount} failed`);
  
  if (allPassed) {
    console.log('\n✅ All fixes have been successfully applied!\n');
  } else {
    console.log('\n❌ Some fixes are missing or incorrect. Please review the failed tests.\n');
  }
}

try {
  printResults();
  process.exit(results.every(r => r.passed) ? 0 : 1);
} catch (error) {
  console.error('Error running tests:', error);
  process.exit(1);
}