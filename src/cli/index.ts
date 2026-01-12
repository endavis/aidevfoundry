#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run';
import { pipeCommand } from './commands/pipe';
import { checkCommand } from './commands/check';
import { serveCommand } from './commands/serve';
import { mcpStatusCommand } from './commands/mcp-status';
import { agentCommand } from './commands/agent';
import { compareCommand } from './commands/compare';
import { planCommand } from './commands/plan';
import {
  templateListCommand,
  templateShowCommand,
  templateCreateCommand,
  templateEditCommand,
  templateDeleteCommand
} from './commands/template';
import {
  profileListCommand,
  profileShowCommand,
  profileSetDefaultCommand,
  profileCreateCommand,
  profileDeleteCommand
} from './commands/profile';
import {
  sessionListCommand,
  sessionNewCommand,
  sessionInfoCommand,
  sessionDeleteCommand,
  sessionClearCommand
} from './commands/session';
import {
  correctionCommand,
  debateCommand,
  consensusCommand
} from './commands/collaboration';
import { pickbuildCommand } from './commands/pickbuild';
import { pkpoetCommand } from './commands/pkpoet';
import { ralphCommand } from './commands/ralph';
import {
  poetiqCommand,
  adversaryCommand,
  discoverCommand,
  codereasonCommand,
  featureCommand
} from './commands/factory-modes';
import { rememberCommand } from './commands/remember';
import { interactiveCommand } from './commands/interactive';
import { doCommand } from './commands/do';
import { evalCommand } from './commands/eval';
import {
  modelShowCommand,
  modelListCommand,
  modelSetCommand,
  modelClearCommand
} from './commands/model';
import { indexCommand } from './commands/indexing';
import {
  observeSummaryCommand,
  observeListCommand,
  observeExportCommand
} from './commands/observe';
import {
  loginCommand,
  logoutCommand,
  whoamiCommand
} from './commands/login';
import { tasksCommand } from './commands/tasks';
import { gameCommand } from './commands/game';
import { orchestrateCommand } from './commands/orchestrate';
import { spawnCommand } from './commands/spawn';
import { continuePlanCommand } from './commands/continue-plan';
import { startTUI } from '../tui';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

program
  .name('pk-puzldai')
  .description('PuzldAI - Multi-LLM Orchestrator')
  .version(pkg.version);

// Primary command - just works
program
  .command('do')
  .description('Execute a task with automatic approach selection (recommended)')
  .argument('<task>', 'The task to execute')
  .option('-v, --verbose', 'Show detailed progress')
  .option('--verify <command>', 'Verification command (e.g., "npm test")')
  .action((task, opts) => doCommand(task, {
    verbose: opts.verbose,
    verify: opts.verify,
  }));

// Evaluation command
program
  .command('eval')
  .description('Evaluate and verify approach selection accuracy')
  .option('-t, --task <task>', 'Evaluate a single task')
  .option('-f, --full', 'Run full evaluation suite')
  .option('-c, --classify', 'Test classification only (no execution)')
  .option('-v, --verbose', 'Show detailed output')
  .action((opts) => evalCommand({
    task: opts.task,
    full: opts.full,
    classify: opts.classify,
    verbose: opts.verbose,
  }));

// Legacy run command (for power users)
program
  .command('run')
  .description('Run a task with explicit control (legacy)')
  .argument('<task>', 'The task to execute')
  .option('-a, --agent <agent>', 'Force specific agent', 'auto')
  .option('-m, --model <model>', 'Override model')
  .option('-P, --pipeline <steps>', 'Run as pipeline')
  .option('-T, --template <name>', 'Use a saved template')
  .option('-i, --interactive', 'Prompt before each step')
  .option('-x, --agentic', 'Enable agentic mode')
  .option('--dry-run', 'Show the plan and exit')
  .option('--no-compress', 'Disable context compression')
  .option('-p, --profile <name>', 'Use orchestration profile (speed, balanced, quality)')
  .action(runCommand);

program
  .command('compare')
  .description('Compare responses from multiple agents')
  .argument('<prompt>', 'The prompt to send to all agents')
  .option('-a, --agents <agents>', 'Comma-separated agents to compare', 'claude,gemini')
  .option('-s, --sequential', 'Run agents sequentially instead of parallel')
  .option('-p, --pick', 'Have an LLM pick the best response')
  .action(compareCommand);

program
  .command('orchestrate')
  .description('Intelligently orchestrate multi-agent workflows')
  .argument('<task>', 'The task to orchestrate')
  .option('-m, --mode <mode>', 'Orchestration mode: delegate|coordinate|supervise', 'delegate')
  .option('-a, --agents <agents>', 'Comma-separated agents to use', 'claude,gemini')
  .option('-A, --agent <agent>', 'Primary agent (overrides agents)', 'auto')
  .option('--dry-run', 'Show the plan and exit')
  .option('--no-compress', 'Disable context compression')
  .option('-p, --profile <name>', 'Use orchestration profile (speed, balanced, quality)')
  .action((task, opts) => orchestrateCommand(task, {
    mode: opts.mode as 'delegate' | 'coordinate' | 'supervise',
    agents: opts.agents,
    agent: opts.agent,
    profile: opts.profile,
    dryRun: opts.dryRun,
    noCompress: opts.noCompress
  }));

program
  .command('autopilot')
  .description('Generate and optionally execute an AI-planned workflow')
  .argument('<task>', 'The task to plan')
  .option('-x, --execute', 'Execute the plan after generating')
  .option('-i, --interactive', 'Prompt before each step (requires --execute)')
  .option('-p, --planner <agent>', 'Agent to use for planning', 'ollama')
  .action(planCommand);

program
  .command('check')
  .description('Check available agents and dependencies')
  .action(checkCommand);

program
  .command('serve')
  .description('Start the API server or MCP bridge')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('-H, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('-w, --web', 'Also start ttyd web terminal')
  .option('-t, --terminal-port <port>', 'Terminal port (default: 3001)')
  .option('--mcp', 'Start MCP bridge server instead of API server')
  .option('--mcp-port <port>', 'MCP bridge port (default: 9234)')
  .option('--local', 'Force local HTTP bridge (no cloud WebSocket)')
  .action((opts) => serveCommand({
    port: parseInt(opts.port, 10),
    host: opts.host,
    web: opts.web,
    terminalPort: opts.terminalPort ? parseInt(opts.terminalPort, 10) : undefined,
    mcp: opts.mcp,
    mcpPort: opts.mcpPort ? parseInt(opts.mcpPort, 10) : undefined,
    local: opts.local
  }));

program
  .command('mcp-status')
  .description('Show MCP bridge status')
  .action(() => mcpStatusCommand());

program
  .command('agent')
  .description('Interactive agent mode')
  .option('-a, --agent <agent>', 'Force specific agent (claude, gemini, codex, ollama)', 'auto')
  .option('-m, --model <model>', 'Override model for the agent')
  .action((opts) => agentCommand({ agent: opts.agent, model: opts.model }));

program
  .command('spawn [agents...]')
  .description('Spawn custom agents from .claude/agents/')
  .option('-l, --list', 'List available agents')
  .option('-p, --parallel', 'Run multiple agents in parallel')
  .option('-m, --model <model>', 'Override model for agents')
  .action((agents, opts) => spawnCommand(agents || [], {
    list: opts.list,
    parallel: opts.parallel,
    model: opts.model
  }));

program
  .command('continue-plan')
  .alias('cp')
  .description('Execute temp-plan.txt with parallel PK-Poet agents')
  .option('-s, --sequential', 'Run agents sequentially instead of parallel')
  .option('-a, --agent <name>', 'Run only a specific agent')
  .option('-n, --dry-run', 'Show what would be executed without running')
  .action((opts) => continuePlanCommand({
    sequential: opts.sequential,
    agent: opts.agent,
    dryRun: opts.dryRun
  }));

program
  .command('tui')
  .description('Launch interactive terminal UI')
  .action(() => startTUI());

program
  .command('index [path]')
  .description('Index codebase for semantic search and context injection')
  .option('-q, --quick', 'Quick index (skip embedding)')
  .option('-c, --clear', 'Clear the code index')
  .option('-s, --stats', 'Show index statistics')
  .option('-S, --search <query>', 'Search indexed code')
  .option('-C, --context <task>', 'Get relevant code context for a task')
  .option('--config', 'Show project configuration details')
  .option('-g, --graph', 'Show dependency graph summary')
  .option('-m, --max-files <n>', 'Maximum files to index', '1000')
  .action((path, opts) => indexCommand(path || '.', {
    quick: opts.quick,
    clear: opts.clear,
    stats: opts.stats,
    search: opts.search,
    context: opts.context,
    config: opts.config,
    graph: opts.graph,
    maxFiles: opts.maxFiles ? parseInt(opts.maxFiles, 10) : undefined,
  }));

// Model subcommands
const modelCmd = program
  .command('model')
  .description('Manage model settings');

modelCmd
  .command('show')
  .description('Show current model settings')
  .action(modelShowCommand);

modelCmd
  .command('list [agent]')
  .description('List available models (optionally for specific agent)')
  .action(modelListCommand);

modelCmd
  .command('set <agent> <model>')
  .description('Set model for an agent (e.g., pk-puzldai model set claude sonnet)')
  .action(modelSetCommand);

modelCmd
  .command('clear <agent>')
  .description('Clear model override for an agent (use CLI default)')
  .action(modelClearCommand);

// Template subcommands
const templateCmd = program
  .command('template')
  .description('Manage pipeline templates');

templateCmd
  .command('list')
  .description('List all available templates')
  .action(templateListCommand);

templateCmd
  .command('show <name>')
  .description('Show template details')
  .action(templateShowCommand);

templateCmd
  .command('create <name>')
  .description('Create a new template')
  .requiredOption('-P, --pipeline <steps>', 'Pipeline steps (e.g., "claude:plan,codex:code")')
  .option('-d, --description <desc>', 'Template description')
  .action((name, opts, cmd) => templateCreateCommand(name, cmd.opts()));

templateCmd
  .command('edit <name>')
  .description('Edit an existing user template')
  .option('-P, --pipeline <steps>', 'New pipeline steps')
  .option('-d, --description <desc>', 'New description')
  .action((name, opts, cmd) => templateEditCommand(name, cmd.opts()));

templateCmd
  .command('delete <name>')
  .description('Delete a user template')
  .action(templateDeleteCommand);

// Profile subcommands
const profileCmd = program
  .command('profile')
  .description('Manage orchestration profiles');

profileCmd
  .command('list')
  .description('List all available profiles')
  .action(profileListCommand);

profileCmd
  .command('show <name>')
  .description('Show profile details')
  .action(profileShowCommand);

profileCmd
  .command('set-default <name>')
  .description('Set the default profile')
  .action(profileSetDefaultCommand);

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('-f, --from <name>', 'Clone from existing profile')
  .action((name, opts, cmd) => profileCreateCommand(name, cmd.opts()));

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action(profileDeleteCommand);

// Session subcommands
const sessionCmd = program
  .command('session')
  .description('Manage chat sessions');

sessionCmd
  .command('list [agent]')
  .description('List all sessions (optionally filter by agent)')
  .action(sessionListCommand);

sessionCmd
  .command('new [agent]')
  .description('Create a new session')
  .action(sessionNewCommand);

sessionCmd
  .command('info <id>')
  .description('Show session details')
  .action(sessionInfoCommand);

sessionCmd
  .command('delete <id>')
  .description('Delete a session')
  .action(sessionDeleteCommand);

sessionCmd
  .command('clear <id>')
  .description('Clear session history (keep session, remove messages)')
  .action(sessionClearCommand);

// Observe subcommands
const observeCmd = program
  .command('observe')
  .description('Manage and export observations for training');

observeCmd
  .command('summary')
  .description('Show observation summary')
  .option('-a, --agent <agent>', 'Filter by agent')
  .action((opts) => observeSummaryCommand(opts.agent));

observeCmd
  .command('list')
  .description('List recent observations')
  .option('-a, --agent <agent>', 'Filter by agent')
  .option('-n, --limit <n>', 'Number of observations to show', '10')
  .action((opts) => observeListCommand({
    agent: opts.agent,
    limit: opts.limit ? parseInt(opts.limit, 10) : 10
  }));

observeCmd
  .command('export <output>')
  .description('Export observations to file')
  .option('-f, --format <format>', 'Output format (jsonl, json, csv)', 'jsonl')
  .option('-a, --agent <agent>', 'Filter by agent')
  .option('-n, --limit <n>', 'Maximum records to export', '10000')
  .option('-t, --type <type>', 'Export type (observations, preferences)', 'observations')
  .option('--no-content', 'Exclude content (metadata only)')
  .action((output, opts) => observeExportCommand(output, {
    format: opts.format as 'jsonl' | 'json' | 'csv',
    agent: opts.agent,
    limit: opts.limit ? parseInt(opts.limit, 10) : 10000,
    type: opts.type as 'observations' | 'preferences',
    noContent: !opts.content
  }));

// MCP Authentication commands
program
  .command('login')
  .description('Login to PuzldAI MCP server')
  .option('-t, --token <token>', 'API token (or enter interactively)')
  .option('-e, --endpoint <url>', 'MCP server endpoint')
  .action((opts) => loginCommand({
    token: opts.token,
    endpoint: opts.endpoint
  }));

program
  .command('logout')
  .description('Logout from PuzldAI MCP server')
  .action(logoutCommand);

program
  .command('whoami')
  .description('Show current login status')
  .action(whoamiCommand);

// Multi-agent collaboration commands
program
  .command('correct')
  .description('Cross-agent correction: one produces, another reviews')
  .argument('<task>', 'The task to execute')
  .requiredOption('--producer <agent>', 'Agent to produce initial output')
  .requiredOption('--reviewer <agent>', 'Agent to review and critique')
  .option('-f, --fix', 'Have producer fix issues after review')
  .action(correctionCommand);

program
  .command('debate')
  .description('Multi-agent debate on a topic')
  .argument('<topic>', 'The topic to debate')
  .requiredOption('-a, --agents <agents>', 'Comma-separated agents to debate')
  .option('-r, --rounds <n>', 'Number of debate rounds', '2')
  .option('-m, --moderator <agent>', 'Agent to synthesize conclusion')
  .action(debateCommand);

program
  .command('consensus')
  .description('Build consensus among multiple agents')
  .argument('<task>', 'The task to reach consensus on')
  .requiredOption('-a, --agents <agents>', 'Comma-separated agents to participate')
  .option('-r, --rounds <n>', 'Number of voting rounds', '2')
  .option('-s, --synthesizer <agent>', 'Agent to synthesize final result')
  .action(consensusCommand);

// Compare→Pick→Build workflow (Mode C)
program
  .command('pickbuild')
  .description('Compare plans from multiple agents, pick best, then implement')
  .argument('<task>', 'The task to implement')
  .option('-a, --agents <agents>', 'Comma-separated agents to propose plans', 'claude,gemini')
  .option('--picker <agent|human>', 'Who selects the winning plan', 'human')
  .option('--build-agent <agent>', 'Agent to implement the selected plan', 'claude')
  .option('--reviewer <agent>', 'Optional review agent')
  .option('--sequential', 'Run proposers sequentially instead of parallel')
  .option('-i, --interactive', 'Confirm plan selection and risky operations')
  .option('--format <json|md>', 'Plan output format for proposers', 'json')
  .option('--no-review', 'Skip review step')
  .action((task, opts) => pickbuildCommand(task, {
    agents: opts.agents,
    picker: opts.picker,
    buildAgent: opts.buildAgent,
    reviewer: opts.reviewer,
    sequential: opts.sequential,
    interactive: opts.interactive,
    format: opts.format,
    noReview: !opts.review
  }));

// PK-Poet: Ultimate Reasoning Paradigm (simplified)
program
  .command('pkpoet')
  .alias('pk-poet')
  .description('Deep analysis with REASON→DISCOVER→ATTACK→FORTIFY→EXECUTE')
  .argument('<task>', 'The task to analyze and implement')
  .option('-d, --depth <depth>', 'Analysis depth: shallow, medium, deep', 'medium')
  .option('--verify <command>', 'Verification command (e.g., "npm test")')
  .action((task, opts) => pkpoetCommand(task, {
    depth: opts.depth,
    verify: opts.verify,
  }));

program
  .command('ralph')
  .description('Plan-first iterative loop until completion (Ralph Wiggum style)')
  .argument('<task>', 'The task to execute')
  .option('-i, --iters <n>', 'Maximum iterations', '5')
  .option('-p, --planner <agent>', 'Planner agent (default: gemini)', 'gemini')
  .option('-c, --completion <token>', 'Completion token', '<promise>COMPLETE</promise>')
  .option('-m, --model <model>', 'Override model for planner/steps')
  .option('--tests <command>', 'Verification command (e.g., "npm test")')
  .option('--scope <paths>', 'Limit file changes to paths')
  .option('--stop <criteria>', 'Stop conditions')
  .action((task, opts) => ralphCommand(task, {
    iterations: opts.iters,
    planner: opts.planner,
    completion: opts.completion,
    model: opts.model,
    tests: opts.tests,
    scope: opts.scope,
    stop: opts.stop
  }));

// Factory-Droid Mode Commands (simplified - no agent options)
program
  .command('poetiq')
  .alias('poetic')
  .description('Verification-first problem solving')
  .argument('<task>', 'The task to solve')
  .option('--verify <command>', 'Verification command')
  .action((task, opts) => poetiqCommand(task, { verify: opts.verify }));

program
  .command('adversary')
  .description('Security red-team analysis')
  .argument('<task>', 'The target to analyze')
  .option('-f, --files <files>', 'Target files (comma-separated)')
  .action((task, opts) => adversaryCommand(task, { files: opts.files }));

program
  .command('discover')
  .alias('self-discover')
  .description('Atomic problem analysis')
  .argument('<task>', 'The task to analyze')
  .option('-d, --depth <depth>', 'Analysis depth: shallow, medium, deep', 'medium')
  .action((task, opts) => discoverCommand(task, { depth: opts.depth }));

program
  .command('codereason')
  .description('Solve problems using code as reasoning')
  .argument('<task>', 'The problem to solve')
  .action((task) => codereasonCommand(task, {}));

program
  .command('feature')
  .description('Multi-phase feature implementation')
  .argument('<task>', 'The feature to implement')
  .option('--verify <command>', 'Verification command')
  .action((task, opts) => featureCommand(task, { verify: opts.verify }));

// Memory commands
program
  .command('remember [memory]')
  .description('Capture a memory to personal or project memory file')
  .option('-s, --scope <scope>', 'Memory scope: personal or project', 'personal')
  .option('-l, --list', 'List saved memories instead of adding one')
  .action((memory, opts) => rememberCommand(memory, {
    scope: opts.scope as 'personal' | 'project',
    list: opts.list
  }));

// Interactive mode command (simplified)
program
  .command('interact')
  .description('Run a task with interactive CLI tool handling')
  .argument('<task>', 'The task to execute interactively')
  .option('-v, --verbose', 'Show detailed output')
  .action((task, opts) => interactiveCommand(task, { verbose: opts.verbose }));

// Task management commands
program
  .command('tasks [action] [target]')
  .description('Manage background tasks (list, show, output, kill, delete, clear)')
  .option('-s, --status <status>', 'Filter by status (running, completed, failed, cancelled)')
  .option('-t, --type <type>', 'Filter by type (agent, shell, plan)')
  .option('-l, --limit <number>', 'Limit number of results', '20')
  .option('-w, --wait', 'Wait for task completion (for output command)')
  .action((action, target, opts) => tasksCommand(action, target, {
    status: opts.status,
    type: opts.type,
    limit: parseInt(opts.limit, 10),
    wait: opts.wait
  }));

// Game commands
gameCommand(program);

// If no arguments, launch TUI; otherwise parse commands
if (process.argv.length <= 2) {
  startTUI();
} else {
  program.parseAsync().then(() => {
    setTimeout(() => process.exit(0), 100);
  });
}
