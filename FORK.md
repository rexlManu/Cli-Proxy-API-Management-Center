# Quota ledger

This fork opens the quota page in ledger view. It shows provider totals and
account rows with quota bars and reset times. Email addresses are hidden until
Show emails is selected. The original card view remains available.

The config panel also supports the `earliest-reset` routing strategy, which is
the default in the matching proxy fork:
https://github.com/rexlManu/CLIProxyAPI.

Builds still produce one `dist/index.html` file. Copy that file to the proxy's
static directory as `management.html`, or publish it as a release asset in this
repository. Source changes alone do not update a running proxy's panel.

For local panels, disable panel auto-updates in the proxy configuration:

```yaml
management:
  disable-auto-update-panel: true
```

See the proxy fork's `docs/fork-features.md` for routing and WebSocket settings.
