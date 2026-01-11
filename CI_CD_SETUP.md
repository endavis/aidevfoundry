# CI/CD Setup for PuzldAI

## Overview

PuzldAI now has a comprehensive CI/CD pipeline using GitHub Actions to ensure code quality, prevent breaking changes, and automate the release process.

---

## CI Workflow (`.github/workflows/ci.yml`)

### Triggers
- **Push to `main` branch** - Runs full CI pipeline
- **Pull requests to `main`** - Runs full CI pipeline

### Jobs

#### 1. Type Check
- Runs `bun run typecheck`
- Validates TypeScript types
- Catches type errors before they reach production
- **Must pass** before other jobs run

#### 2. Run Tests
- Runs `bun run test`
- Executes all unit tests with Bun test framework
- Validates business logic
- **Must pass** before build job runs

#### 3. Build CLI
- Runs `bun run build`
- Compiles TypeScript to JavaScript
- Creates `dist/cli/index.js` executable
- **Depends on**: typecheck, test
- Verifies CLI works with smoke tests

#### 4. CLI Smoke Test
- Tests built CLI actually works
- Verifies `--version`, `--help`, and `check` commands
- **Depends on**: build
- Ensures distributable CLI is functional

#### 5. Code Quality Checks
- Checks for large files (>1MB)
- Detects debug `console.log` statements
- Counts TODO/FIXME comments (warns if >10)
- Normalizes file permissions
- Runs in parallel with other jobs

#### 6. Security Scan
- Runs `npm audit` for dependency vulnerabilities
- Uses TruffleHog to scan for secrets/credentials
- Runs with read-only permissions
- **Doesn't block** builds (informational)

---

## CD Workflow (`.github/workflows/npm-publish.yml`)

### Triggers
- **Published GitHub Release** - Automatically publishes to npm

### Process
1. Checks out code
2. Sets up Bun
3. Installs dependencies
4. Builds CLI
5. Publishes to npm registry
6. Uses `NPM_TOKEN` secret for authentication

---

## Job Dependencies

```
typecheck ──┬──> test ──┬──> build ──> cli-smoke-test
             │         │
             └─────────┴─────┘

code-quality (parallel)
security (parallel, informational)
```

---

## Status Badge

Add this to your README.md:

```markdown
[![CI](https://github.com/kingkillery/Puzld.ai/workflows/CI/badge.svg)](https://github.com/kingkillery/Puzld.ai/actions/workflows/ci)
```

Renders as:
[![CI](https://github.com/kingkillery/Puzld.ai/workflows/CI/badge.svg)](https://githubkillery/Puzld.ai/actions/workflows/ci)

---

## What Gets Checked

### ✅ Type Safety
- All TypeScript code compiles without errors
- No implicit `any` types
- Strict null checks enabled

### ✅ Tests
- All unit tests pass
- Agent loop tests pass
- Stream parser tests pass
- Game session tests pass

### ✅ Build
- CLI compiles successfully
- Executable is created
- CLI is properly permissioned

### ✅ Functionality
- Version command works
- Help command works
- Check command works (even if no agents available)

### ✅ Code Quality
- No oversized files (>1MB)
- Minimal debug statements
- Manageable TODO count (<10)
- Proper file permissions

### ⚠️ Security
- Dependency vulnerabilities reported
- Secrets scanning for leaked credentials

---

## Testing Locally Before Pushing

To avoid CI failures, run the same checks locally:

```bash
# Type check
bun run typecheck

# Run tests
bun run test

# Build
bun run build

# Test built CLI
node dist/cli/index.js --version
node dist/cli/index.js --help
```

---

## Common CI Failures & Fixes

### Type Check Failures
**Error**: `Type 'X' is not assignable to type 'Y'`

**Fix**: 
```bash
# Run locally to see full error
bun run typecheck

# Fix type errors in your editor
# Commit the fix
```

### Test Failures
**Error**: Tests fail in CI but pass locally

**Fix**:
```bash
# Ensure tests pass locally first
bun run test

# Check platform-specific issues
# CI runs on Ubuntu, you might be on Windows/macOS
```

### Build Failures
**Error**: Build fails in CI

**Fix**:
```bash
# Clean build artifacts
rm -rf dist/
bun run build

# Verify build output
ls -la dist/cli/
```

### Smoke Test Failures
**Error**: CLI doesn't work when built

**Fix**:
```bash
# Test locally
bun run build
node dist/cli/index.js --version

# Check build output file permissions
chmod +x dist/cli/index.js
```

---

## Secrets Required

### NPM_TOKEN (for publishing)
1. Go to npmjs.com
2. Create an access token
3. Add to GitHub Secrets:
   - Repo Settings → Secrets and variables → Actions
   - New repository secret
   - Name: `NPM_TOKEN`
   - Value: Your npm token

---

## Branch Protection Rules (Recommended)

Enable these in GitHub settings for better security:

### For `main` branch:
- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- ✅ Require pull request reviews before merging
- ❌ Do not allow bypassing the above settings

### Required Status Checks:
- `Type Check`
- `Run Tests`
- `Build CLI`
- `CLI Smoke Test`

---

## Troubleshooting

### CI runs but passes locally
- Check for platform-specific code
- Verify dependencies are installable on Ubuntu
- Check environment variables

### Secret scanning fails
- Review the flagged files
- Remove genuine secrets
- Add false positives to `.gitignore`

### Build succeeds but tests fail
- Check test order dependencies
- Verify test isolation
- Look for race conditions

---

## Future Improvements

### Potential Additions

1. **Integration Tests**
   - Test actual CLI tool integrations
   - Mock external APIs
   - Test adapter availability checks

2. **Performance Tests**
   - Benchmark CLI startup time
   - Test memory usage
   - Profile bottlenecks

3. **Multi-Platform Testing**
   - Test on macOS, Windows, Linux
   - Matrix build for different Node versions

4. **Coverage Reporting**
   - Generate code coverage reports
   - Enforce minimum coverage thresholds
   - Track coverage trends over time

5. **Dependency Scanning**
   - Dependabot for automated PRs
   - Synk for vulnerability scanning
   - Renovate for dependency updates

---

## Monitoring CI/CD

### View Workflow Runs
1. Go to: https://github.com/kingkillery/Puzld.ai/actions
2. Click on "CI" workflow
3. View recent runs and their status

### View Logs
1. Click on a workflow run
2. Click on a job (e.g., "Type Check")
3. Click on a step to view logs

### Download Artifacts
- Currently no artifacts are uploaded
- Can add test reports, coverage reports later

---

## Cost & Performance

### GitHub Actions Limits
- **Free tier**: 2000 minutes/month
- **Public repos**: Unlimited
- **Private repos**: 2000 minutes/month

### Typical Runtime
- Type check: ~30 seconds
- Tests: ~1 minute
- Build: ~30 seconds
- Smoke tests: ~20 seconds
- **Total**: ~3 minutes per run

### Estimated Usage
- 10 PRs/month × 3 runs = 30 runs/month
- 30 runs × 3 minutes = 90 minutes/month
- **Well within** free tier limits

---

## Maintainer Notes

### When to Update CI/CD

Update the CI/CD workflows when:

1. **New test types added** - Add to test job
2. **Build process changes** - Update build job
3. **New dependencies** - Update security scan
4. **Quality standards change** - Update code quality job

### Testing CI/CD Changes

1. Create feature branch
2. Modify workflow files
3. Push to create PR
4. Verify CI passes
5. Merge when green

### Breaking Changes

If CI is broken:
1. **Immediately** notify team
2. **Stop** merging to main
3. **Fix** critical failures first
4. **Deploy** hotfix if needed
5. **Document** post-mortem

---

*This CI/CD setup ensures PuzldAI maintains high quality standards while enabling rapid, safe development.*