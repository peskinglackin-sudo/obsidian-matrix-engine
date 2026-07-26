# Real Obsidian platform runner

Use only a disposable Obsidian profile and disposable vault. The external
operator performs actions; the plugin and finalizer assign all statuses.

For the `minimum-1.11.4` cell, prepare an `initial` request against the current
target bundle, install it as `matrix-engine-spike`, run the command
`Matrix Engine Spike: Run approved platform probe`, copy
`.matrix-engine-spike/checkpoints.json`, close Obsidian, destroy the disposable
profile and vault, and run `pnpm platform:finalize`.

For `current-stable`, use one vault/profile and these phases:

1. Package/install version `0.0.0`; prepare phase `initial`; run the probe.
2. Disable and enable the plugin; prepare phase `reloaded`; run again.
3. Replace it with version `0.0.1`; prepare phase `upgraded`; run again.
4. Prepare phase `complete`; run again and copy checkpoints outside the vault.
5. Close Obsidian and destroy both the profile and vault before finalization.

Example preparation:

```bash
pnpm platform:prepare \
  --manifest <bundle>/artifact-manifest.json \
  --vault <disposable-vault> \
  --profile <disposable-profile> \
  --cell current-stable \
  --app-version <exact-version> \
  --phase initial
```

On macOS/Linux the equivalent self-contained entry point is
`scripts/run-platform-probe.sh prepare ...`; on Windows PowerShell use
`scripts/run-platform-probe.ps1 prepare ...`. Both invoke the same validated
Node state machine and contain no evaluation logic.

Preparation requires both directories to exist and stores only SHA-256 hashes
of their normalized paths. The initial vault must not already contain
`.matrix-engine-spike`; later phases must use the same bound vault/profile,
runner, target, app version, and exact preceding checkpoint state.

Example finalization:

```bash
pnpm platform:finalize \
  --checkpoints <copied-checkpoints.json> \
  --vault <destroyed-vault-path> \
  --profile <destroyed-profile-path> \
  --output <safe-result.json>
```

Use the same wrappers with `finalize` on each platform. The finalizer refuses
to pass while the disposable profile or vault still exists.
Node/CI prechecks cannot be converted into a real Obsidian pass.
