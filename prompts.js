// prompts.js — Claude Code prompt templates for each task type
//
// EXPORTS: { codeReviewPrompt, testGenPrompt, depCheckPrompt, lintFixPrompt,
//           perfAuditPrompt, docsGenPrompt, featureIdeasPrompt, getPromptForType }
//
// Each function returns a string prompt ready to be piped to `claude --acp --stdio`.

/**
 * Build a code review prompt for recent changes.
 * @param {string} repoName - Repository name
 * @param {string} [recentFiles] - List of recently modified files (optional)
 * @returns {string}
 */
function codeReviewPrompt(repoName, recentFiles) {
  const fileList = recentFiles
    ? `\nRecently modified files:\n${recentFiles}`
    : '\nFocus on the most recent commits (last 24-48 hours).';

  return `You are an expert code reviewer. Analyze the repository "${repoName}" for code quality issues.

${fileList}

Perform a thorough code review and identify:
1. **Bugs** — Logic errors, off-by-one errors, null/undefined risks, race conditions
2. **Security Issues** — Injection vulnerabilities, hardcoded secrets, missing input validation, insecure defaults
3. **Performance Problems** — N+1 queries, unnecessary re-renders, memory leaks, expensive operations in hot paths
4. **Code Style** — Inconsistent patterns, poor naming, dead code, overly complex functions
5. **Architecture** — Coupling issues, missing error handling, poor separation of concerns

Output your review as structured JSON:
\`\`\`json
{
  "summary": "Brief overall assessment (2-3 sentences)",
  "score": 85,
  "findings": [
    {
      "severity": "critical|warning|info",
      "category": "bug|security|performance|style|architecture",
      "file": "path/to/file.js",
      "line": 42,
      "title": "Short description",
      "description": "Detailed explanation of the issue",
      "suggestion": "Code fix or recommendation"
    }
  ],
  "highlights": ["List of things done well"],
  "stats": {
    "files_reviewed": 12,
    "critical": 0,
    "warnings": 3,
    "info": 5
  }
}
\`\`\`

Be specific with file paths and line numbers. Provide actionable suggestions with code examples where appropriate.`;
}

/**
 * Build a test generation prompt for untested files.
 * @param {string} repoName
 * @param {string} [untestedFiles] - List of files without corresponding tests
 * @returns {string}
 */
function testGenPrompt(repoName, untestedFiles) {
  const fileList = untestedFiles
    ? `\nFiles that need tests:\n${untestedFiles}`
    : '\nFind source files that lack corresponding test files and generate tests for them.';

  return `You are an expert test engineer. Analyze the repository "${repoName}" and write comprehensive tests.

${fileList}

For each file that needs tests:
1. Analyze all exported functions, classes, and methods
2. Identify edge cases, error conditions, and boundary values
3. Write tests covering:
   - Happy path / expected behavior
   - Edge cases (empty inputs, nulls, boundaries)
   - Error handling
   - Integration points (API calls, DB queries — use mocks)

Use the existing test framework in the project (jest, mocha, vitest, etc.). If no test framework is detected, use jest.

Output your results as structured JSON:
\`\`\`json
{
  "summary": "Brief overview of testing work done",
  "framework_used": "jest|mocha|vitest",
  "test_files_created": [
    {
      "source_file": "path/to/source.js",
      "test_file": "path/to/source.test.js",
      "tests_written": 8,
      "categories": {
        "unit": 5,
        "integration": 2,
        "edge_cases": 1
      }
    }
  ],
  "total_tests_written": 24,
  "coverage_improvement": "Estimated coverage increase",
  "notes": ["Any files that were tricky to test and why"]
}
\`\`\`

Ensure all generated tests are syntactically correct and follow the project's existing test patterns.`;
}

/**
 * Build a dependency check prompt.
 * @param {string} repoName
 * @returns {string}
 */
function depCheckPrompt(repoName) {
  return `You are a dependency security and maintenance expert. Analyze the repository "${repoName}" for dependency issues.

Check the following:
1. **Outdated Dependencies** — Find packages with newer versions available
2. **Security Vulnerabilities** — Check for known CVEs in current dependencies
3. **Unused Dependencies** — Find packages listed but never imported/required
4. **Deprecated Packages** — Find packages that have been deprecated by maintainers
5. **License Issues** — Flag any problematic licenses (GPL in proprietary projects, etc.)
6. **Dependency Confusion** — Check for internal package naming that could be exploited

Output your results as structured JSON:
\`\`\`json
{
  "summary": "Brief overview of dependency health",
  "package_manager": "npm|yarn|pnpm",
  "total_dependencies": 45,
  "outdated": [
    {
      "package": "express",
      "current": "4.18.0",
      "latest": "4.19.0",
      "severity": "patch|minor|major",
      "breaking_changes": false
    }
  ],
  "vulnerabilities": [
    {
      "package": "lodash",
      "severity": "high",
      "cve": "CVE-2021-XXXX",
      "description": "Prototype pollution vulnerability",
      "fix_version": "4.17.21"
    }
  ],
  "unused": ["package1", "package2"],
  "deprecated": [
    {
      "package": "request",
      "alternative": "node-fetch or got"
    }
  ],
  "recommendations": ["List of actionable recommendations"]
}
\`\`\`

Run \`npm audit\` and \`npm outdated\` if available. Parse package.json and lock files for detailed analysis.`;
}

/**
 * Build a lint fix prompt.
 * @param {string} repoName
 * @returns {string}
 */
function lintFixPrompt(repoName) {
  return `You are a code quality expert. Analyze and fix linting issues in the repository "${repoName}".

Perform the following:
1. **Detect Linter** — Identify if ESLint, JSHint, Pylint, or another linter is configured
2. **Run Linter** — Execute the linter and capture all issues
3. **Auto-fix** — Fix all auto-fixable issues (formatting, missing semicolons, unused vars, etc.)
4. **Manual Fixes Report** — For issues that require manual intervention, provide specific guidance

If no linter is configured, set up a sensible default (ESLint for JS/TS, Pylint for Python, etc.).

Output your results as structured JSON:
\`\`\`json
{
  "summary": "Brief overview of linting work",
  "linter": "eslint",
  "auto_fixed": {
    "files_modified": 8,
    "issues_fixed": 34,
    "types": {
      "semi": 12,
      "no-unused-vars": 8,
      "indent": 14
    }
  },
  "manual_fixes_needed": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "rule": "no-eval",
      "message": "Unexpected use of 'eval'",
      "suggestion": "Use JSON.parse() instead of eval() for parsing JSON"
    }
  ],
  "warnings_remaining": 5,
  "errors_remaining": 2,
  "config_changes": ["List of linter config modifications made"]
}
\`\`\`

Always preserve the project's existing code style. Only fix issues, don't reformat working code unnecessarily.`;
}

/**
 * Build a performance audit prompt.
 * @param {string} repoName
 * @returns {string}
 */
function perfAuditPrompt(repoName) {
  return `You are a performance engineering expert. Profile the codebase "${repoName}" for performance issues.

Analyze the following:
1. **Algorithmic Complexity** — Find O(n²) or worse algorithms that could be optimized
2. **Database Queries** — Identify N+1 queries, missing indexes, slow queries
3. **Memory Issues** — Memory leaks, unnecessary large object retention, unbounded caches
4. **Network/IO** — Excessive API calls, missing caching, large payloads
5. **Frontend Performance** — Bundle size, unnecessary re-renders, missing lazy loading
6. **Startup Time** — Heavy initialization, synchronous operations at boot
7. **Resource Leaks** — Unclosed connections, file handles, event listeners

Output your results as structured JSON:
\`\`\`json
{
  "summary": "Brief performance assessment",
  "overall_score": "A-F grade",
  "findings": [
    {
      "severity": "critical|warning|info",
      "category": "algorithm|database|memory|network|frontend|startup|leak",
      "file": "path/to/file.js",
      "location": "functionName (line ~42)",
      "title": "N+1 database query in user list endpoint",
      "description": "Detailed explanation of the performance issue",
      "current_complexity": "O(n²)",
      "suggested_fix": "Use batched query or DataLoader pattern",
      "estimated_improvement": "~100x faster for 1000 records",
      "code_example": "// Suggested optimized code"
    }
  ],
  "metrics": {
    "critical_issues": 1,
    "warnings": 3,
    "info": 2
  },
  "top_recommendations": [
    "Most impactful optimizations ordered by effort vs. reward"
  ]
}
\`\`\`

Focus on issues that have measurable impact. Provide benchmarks or estimates where possible.`;
}

/**
 * Build a documentation generation prompt.
 * @param {string} repoName
 * @param {string} [undocumentedModules] - List of modules needing docs
 * @returns {string}
 */
function docsGenPrompt(repoName, undocumentedModules) {
  const moduleList = undocumentedModules
    ? `\nModules that need documentation:\n${undocumentedModules}`
    : '\nFind all undocumented functions, classes, and modules across the codebase.';

  return `You are a technical documentation expert. Analyze the repository "${repoName}" and generate documentation.

${moduleList}

Perform the following:
1. **Find Undocumented Code** — Identify functions/methods missing JSDoc/docstrings
2. **Generate JSDoc/Docstrings** — Write clear, accurate documentation for each
3. **Check README** — Identify missing sections (installation, usage, API, contributing)
4. **Check API Docs** — Ensure API endpoints are documented
5. **Check Type Docs** — Document interfaces, types, and configuration objects

Output your results as structured JSON:
\`\`\`json
{
  "summary": "Brief overview of documentation work",
  "files_documented": [
    {
      "file": "path/to/file.js",
      "functions_documented": 5,
      "classes_documented": 1,
      "types_added": 3
    }
  ],
  "readme_updates": {
    "sections_added": ["Installation", "API Reference", "Configuration"],
    "sections_missing": [],
    "existing_sections_updated": ["Usage"]
  },
  "api_docs": {
    "endpoints_documented": 8,
    "missing_endpoints": []
  },
  "total_docs_added": 24,
  "examples_created": ["List of code examples added"],
  "notes": ["Any documentation challenges encountered"]
}
\`\`\`

Documentation should be clear, concise, and follow the project's existing documentation style. Include parameter types, return types, and usage examples.`;
}

/**
 * Build a feature ideas prompt for Opus-level analysis.
 * @param {string} repoName
 * @param {string} [repoStructure] - Directory tree or file listing
 * @param {string} [readme] - README content for context
 * @returns {string}
 */
function featureIdeasPrompt(repoName, repoStructure, readme) {
  const structure = repoStructure
    ? `\nRepository structure:\n\`\`\`\n${repoStructure}\n\`\`\``
    : '\nAnalyze the repository structure and codebase to understand the project.';
  const readmeSection = readme
    ? `\nREADME:\n\`\`\`\n${readme}\n\`\`\``
    : '';

  return `You are a senior product engineer and software architect. Analyze the repository "${repoName}" and propose new features that would add the most value.

${structure}
${readmeSection}

Based on your deep analysis of the codebase, architecture, and existing features, propose 3-5 new features that:
1. Build on existing patterns and infrastructure (low integration cost)
2. Address real user needs or pain points visible in the code
3. Are technically feasible given the current stack
4. Provide clear value with reasonable effort

For each feature, provide:
- **title**: Clear, concise name
- **description**: 2-3 sentences explaining what it does
- **why**: Contextual reasoning — WHY this makes sense for THIS specific project
- **difficulty**: S (Small, <1 day), M (Medium, 1-3 days), L (Large, 1+ week)
- **code_preview**: Stub implementation (~20-30 lines) showing the key code structure
- **mock_ui_html**: Simple HTML/CSS preview of how the feature could look in the UI

Output as structured JSON:
\`\`\`json
{
  "analysis": "Brief analysis of the codebase and its current state",
  "ideas": [
    {
      "title": "Feature Name",
      "description": "What it does and how it works",
      "why": "Why this makes sense for this specific project — contextual reasoning",
      "difficulty": "S|M|L",
      "effort_hours": 8,
      "impact": "high|medium|low",
      "dependencies": ["List of existing code/patterns this builds on"],
      "code_preview": "// Stub implementation code here",
      "mock_ui_html": "<div style='...'>Simple visual mockup HTML/CSS</div>"
    }
  ],
  "tech_debt_spotted": ["Optional: tech debt that should be addressed first"],
  "architecture_notes": ["Optional: observations about the codebase architecture"]
}
\`\`\`

Be creative but practical. Each idea should be genuinely useful and implementable.`;
}

// ─── Prompt dispatcher ────────────────────────────────────────────────────────

const TASK_TYPE_MAP = {
  code_review: codeReviewPrompt,
  test_gen: testGenPrompt,
  dep_check: depCheckPrompt,
  lint_fix: lintFixPrompt,
  perf_audit: perfAuditPrompt,
  docs_gen: docsGenPrompt,
  feature_ideas: featureIdeasPrompt,
};

/**
 * Get the prompt function for a task type, or null if unknown.
 * @param {string} taskType
 * @returns {Function|null}
 */
function getPromptForType(taskType) {
  return TASK_TYPE_MAP[taskType] || null;
}

/**
 * Get all supported task types.
 * @returns {string[]}
 */
function getSupportedTaskTypes() {
  return Object.keys(TASK_TYPE_MAP);
}

module.exports = {
  codeReviewPrompt,
  testGenPrompt,
  depCheckPrompt,
  lintFixPrompt,
  perfAuditPrompt,
  docsGenPrompt,
  featureIdeasPrompt,
  getPromptForType,
  getSupportedTaskTypes,
};
