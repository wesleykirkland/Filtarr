# Custom Script Security

## Overview

Filtarr supports custom JavaScript and shell scripts for advanced filter automation. This document explains the security model, risks, and best practices.

## Security Model

### Feature Flag Protection

Custom scripts are **DISABLED BY DEFAULT**. To enable:

```bash
export FILTARR_ENABLE_CUSTOM_SCRIPTS=true
```

**⚠️ Only enable this if you trust all users who can create filters.**

### JavaScript Sandbox

JavaScript scripts run in a Node.js `vm` context with:

- ✅ **Timeout protection**: 5-second hard limit
- ✅ **No eval/Function**: Code generation disabled
- ✅ **No require/import**: Cannot load modules
- ✅ **No filesystem access**: No `fs`, `path`, etc.
- ✅ **No network access**: No `http`, `https`, `net`, etc.
- ✅ **No process access**: No `process`, `child_process`, etc.
- ✅ **Limited globals**: Only `Math`, `JSON`, `Date`, basic types

### Shell Script Execution

Shell scripts run via `bash -lc` with:

- ✅ **Timeout protection**: 5-second hard limit
- ✅ **Environment isolation**: Custom environment variables
- ✅ **Buffer limits**: 1MB max output
- ⚠️ **Full shell access**: Can execute any command bash can run

## Known Risks

### ⚠️ VM Sandbox is NOT a Security Boundary

**From Node.js documentation:**

> The `vm` module is not a security mechanism. Do not use it to run untrusted code.

**Why?**

- VM escape vulnerabilities exist (prototype pollution, constructor manipulation)
- Example escape: `this.constructor.constructor('return process')()`
- New escapes may be discovered in the future

### ⚠️ Shell Scripts Have Full System Access

Shell scripts run with the same permissions as the Filtarr process:

- Can read/write files the Filtarr user can access
- Can make network requests
- Can execute system commands
- Can potentially escape containers (if misconfigured)

## Threat Model

### Trusted Users (Low Risk)

If only **trusted administrators** can create filters:

- ✅ Safe to enable custom scripts
- ✅ Users can automate complex workflows
- ✅ Accidental bugs are the main concern, not malicious code

### Untrusted Users (HIGH RISK)

If **untrusted users** can create filters:

- ❌ **DO NOT enable custom scripts**
- ❌ Malicious users can execute arbitrary code
- ❌ VM escapes can compromise the entire system
- ❌ Shell scripts can exfiltrate data or pivot to other systems

## Best Practices

### 1. Principle of Least Privilege

Run Filtarr with minimal permissions:

```dockerfile
# In your Containerfile/Dockerfile
USER filtarr:filtarr  # Non-root user
RUN chmod 700 /data   # Restrict data directory
```

### 2. Container Isolation

Run Filtarr in a container with:

- Read-only root filesystem (where possible)
- No privileged mode
- Limited capabilities
- Network policies restricting outbound connections

### 3. Audit Logging

Monitor filter creation and script execution:

```bash
# Enable debug logging to track script execution
export FILTARR_LOG_LEVEL=debug
```

### 4. Code Review

Review all custom scripts before deployment:

- Check for suspicious patterns (network calls, file access)
- Validate business logic
- Test in a non-production environment first

### 5. Disable When Not Needed

If you don't need custom scripts:

```bash
# Keep the feature disabled (default)
unset FILTARR_ENABLE_CUSTOM_SCRIPTS
```

## Mitigations in Place

1. **Feature flag**: Disabled by default, requires explicit opt-in
2. **Timeout**: 5-second execution limit prevents infinite loops
3. **No eval**: `codeGeneration.strings = false` blocks `eval()` and `Function()`
4. **No WASM**: `codeGeneration.wasm = false` blocks WebAssembly
5. **Limited globals**: No access to dangerous Node.js APIs
6. **Error isolation**: Script errors don't crash the main process
7. **Logging**: All script failures are logged for audit

## Future Improvements

Potential enhancements for defense-in-depth:

- [ ] Seccomp/AppArmor profiles for shell scripts
- [ ] Resource limits (CPU, memory) per script execution
- [ ] Script approval workflow (require admin approval)
- [ ] Static analysis of scripts before execution
- [ ] Allowlist of permitted shell commands
- [ ] Separate worker process for script execution

## Conclusion

Custom scripts are a powerful feature but come with security risks. Only enable them in trusted environments and follow the best practices above.

**When in doubt, keep custom scripts disabled.**

