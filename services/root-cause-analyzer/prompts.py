"""
Prompt templates for LLM-based root cause analysis.

Uses Jinja2 templates to construct structured prompts
that produce consistent, actionable root cause suggestions.
"""

from jinja2 import Template


# ─────────────────────────────────────────────
# Root Cause Analysis Prompt
# ─────────────────────────────────────────────

ROOT_CAUSE_TEMPLATE = Template("""You are an expert software debugging assistant. Analyze the following bug report and provide a root cause analysis.

## Bug Report
**Title:** {{ title }}
**Severity:** {{ severity }} (confidence: {{ severity_score }})
**Category:** {{ category }}

{% if description %}
**Description:**
{{ description }}
{% endif %}

{% if stack_trace %}
**Stack Trace:**
```
{{ stack_trace | truncate(3000) }}
```
{% endif %}

{% if file_path %}
**File:** {{ file_path }}{% if line_number %} (line {{ line_number }}){% endif %}
{% endif %}

{% if code_snippet %}
**Code Context:**
```{{ language }}
{{ code_snippet | truncate(1000) }}
```
{% endif %}

{% if environment %}
**Environment:**
- Runtime: {{ environment.get('runtime', 'unknown') }} {{ environment.get('runtime_version', '') }}
- Framework: {{ environment.get('framework', 'unknown') }} {{ environment.get('framework_version', '') }}
- OS: {{ environment.get('os', 'unknown') }}
{% endif %}

{% if similar_bugs %}
## Similar Historical Bugs
{% for bug in similar_bugs[:3] %}
- **{{ bug.external_id }}** ({{ bug.severity }}): {{ bug.title }}
  {% if bug.root_cause_suggestion %}Root Cause: {{ bug.root_cause_suggestion | truncate(200) }}{% endif %}
  {% if bug.status == 'resolved' %}✅ Resolved{% endif %}
{% endfor %}
{% endif %}

## Instructions
Provide your analysis in the following JSON format:
```json
{
  "root_cause": "A clear, concise explanation of the likely root cause (2-3 sentences max)",
  "suggested_fix": "A specific, actionable fix recommendation",
  "affected_components": ["list", "of", "affected", "components"],
  "confidence": 0.0 to 1.0,
  "additional_investigation": ["list of things to check if fix doesn't work"]
}
```

Be specific and technical. Reference exact error types, line numbers, and code patterns when possible.""")


# ─────────────────────────────────────────────
# Fallback Analysis (No LLM Available)
# ─────────────────────────────────────────────

KNOWN_PATTERNS = [
    {
        "pattern": ["NullPointerException", "NullReferenceException", "null", "undefined is not"],
        "root_cause": "Null/undefined reference — a variable or object property is being accessed before initialization or after being set to null.",
        "suggested_fix": "Add null checks before accessing the variable, use optional chaining (?.), or ensure proper initialization in the constructor/setup.",
        "confidence": 0.75,
    },
    {
        "pattern": ["IndexError", "IndexOutOfBoundsException", "index out of range", "ArrayIndexOutOfBounds"],
        "root_cause": "Array/list index out of bounds — code is accessing an index that doesn't exist in the collection.",
        "suggested_fix": "Add bounds checking before array access, use safe access methods (.get(), .at()), or verify the collection size matches expectations.",
        "confidence": 0.80,
    },
    {
        "pattern": ["TypeError", "type error", "cannot read property", "is not a function"],
        "root_cause": "Type mismatch — a value of an unexpected type is being used. Common causes: API response shape changed, missing type coercion, or incorrect function signature.",
        "suggested_fix": "Add runtime type validation at API boundaries, use TypeScript/type hints for static checking, and verify the data contract between producer and consumer.",
        "confidence": 0.70,
    },
    {
        "pattern": ["ConnectionRefused", "ECONNREFUSED", "connection refused", "connection reset"],
        "root_cause": "Network connectivity failure — the target service is unreachable. Common causes: service not running, incorrect host/port, firewall rules, or DNS resolution failure.",
        "suggested_fix": "Verify the target service is running and healthy, check network configuration (host, port, firewall), add connection retry logic with exponential backoff.",
        "confidence": 0.72,
    },
    {
        "pattern": ["TimeoutError", "timeout", "deadline exceeded", "ETIMEDOUT"],
        "root_cause": "Operation timeout — a request or operation took longer than the configured deadline. Common causes: slow database query, network congestion, resource contention, or undersized connection pool.",
        "suggested_fix": "Profile the slow operation, optimize database queries (add indexes), increase timeout for legitimate long-running operations, or add caching.",
        "confidence": 0.68,
    },
    {
        "pattern": ["OutOfMemoryError", "OOM", "heap space", "memory allocation failed"],
        "root_cause": "Memory exhaustion — the process consumed all available heap memory. Common causes: memory leak (unclosed resources, growing caches), processing oversized data, or insufficient memory allocation.",
        "suggested_fix": "Profile memory usage with a heap dump, check for unclosed streams/connections, implement pagination for large datasets, and increase memory limits if the workload justifies it.",
        "confidence": 0.82,
    },
    {
        "pattern": ["deadlock", "Deadlock", "lock wait timeout", "concurrent modification"],
        "root_cause": "Concurrency issue — multiple threads/processes are competing for shared resources in an incompatible order, causing a deadlock or race condition.",
        "suggested_fix": "Review lock acquisition order across threads, use lock-free data structures where possible, reduce lock scope, or implement optimistic concurrency control.",
        "confidence": 0.77,
    },
    {
        "pattern": ["PermissionDenied", "EACCES", "403", "access denied", "unauthorized"],
        "root_cause": "Permission/authorization failure — the operation was rejected due to insufficient privileges. Common causes: expired or invalid credentials, incorrect IAM/RBAC configuration, or file system permission mismatch.",
        "suggested_fix": "Verify the authentication credentials are valid and not expired, check RBAC/IAM policies for the required permission, and ensure the service account has the correct role assignment.",
        "confidence": 0.74,
    },
    {
        "pattern": ["UNIQUE constraint", "duplicate key", "integrity constraint", "foreign key violation"],
        "root_cause": "Database constraint violation — an INSERT/UPDATE violated a uniqueness or referential integrity constraint. Common causes: race condition on creation, missing upsert logic, or stale foreign key reference.",
        "suggested_fix": "Use INSERT ... ON CONFLICT (upsert) for idempotent writes, add application-level deduplication before insert, or verify foreign key references exist before writing.",
        "confidence": 0.85,
    },
    {
        "pattern": ["import error", "ModuleNotFoundError", "Cannot find module", "No module named"],
        "root_cause": "Missing dependency — a required module or package is not installed or not resolvable. Common causes: missing from requirements/package.json, virtual environment not activated, or version incompatibility.",
        "suggested_fix": "Install the missing dependency, verify it's listed in the project's dependency manifest, ensure the correct virtual environment is activated, and check for version conflicts.",
        "confidence": 0.88,
    },
]


def render_prompt(bug: dict, similar_bugs: list[dict] | None = None) -> str:
    """Render the root cause analysis prompt for an LLM."""
    return ROOT_CAUSE_TEMPLATE.render(
        title=bug.get("title", ""),
        description=bug.get("description", ""),
        severity=bug.get("severity", "unknown"),
        severity_score=bug.get("severity_score", 0),
        category=bug.get("category", "unknown"),
        stack_trace=bug.get("stack_trace", ""),
        file_path=bug.get("file_path", ""),
        line_number=bug.get("line_number"),
        code_snippet=bug.get("code_snippet", ""),
        language=bug.get("language", ""),
        environment=bug.get("environment") or {},
        similar_bugs=similar_bugs or [],
    )


def pattern_match_analysis(bug: dict) -> dict | None:
    """
    Fallback root cause analysis using pattern matching.
    Used when no LLM API key is configured.
    """
    text = f"{bug.get('title', '')} {bug.get('description', '')} {bug.get('stack_trace', '')}".lower()

    best_match = None
    best_match_count = 0

    for pattern_entry in KNOWN_PATTERNS:
        match_count = sum(1 for p in pattern_entry["pattern"] if p.lower() in text)
        if match_count > best_match_count:
            best_match_count = match_count
            best_match = pattern_entry

    if best_match and best_match_count > 0:
        return {
            "root_cause": best_match["root_cause"],
            "suggested_fix": best_match["suggested_fix"],
            "affected_components": [],
            "confidence": best_match["confidence"] * min(best_match_count / 2, 1.0),
            "additional_investigation": [],
            "source": "pattern_match",
        }

    return None
